#!/usr/bin/env bun
// Transcribe a local audio or video file with Voxtral 3 through OpenRouter.
// Usage: bun transcribe.ts <file> [--speakers] [--timestamps] [--model mini|small]
//        [--language xx] [--context "term"]... [--out file.md] [--json]
//        [--estimate] [--max-cost 1] [--refresh]
// The API key is read from the macOS Keychain item "openrouter-api-key" and never printed.

import { parseArgs } from "node:util";
import { basename, extname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";

const MODELS = {
  mini: { id: "mistralai/voxtral-mini-transcribe-3-0", name: "Voxtral Mini Transcribe 3", usdPerSecond: 0.0000583 },
  small: { id: "mistralai/voxtral-small-transcribe-3-0", name: "Voxtral Small Transcribe 3", usdPerSecond: 0.0000667 },
} as const;
type ModelKey = keyof typeof MODELS;

const ENDPOINT = "https://openrouter.ai/api/v1/audio/transcriptions";
const KEYCHAIN_SERVICE = "openrouter-api-key";
const CACHE_DIR = join(homedir(), "Library/Caches/audio-transcription");
// Formats OpenRouter accepts as-is; anything else is converted with ffmpeg.
const DIRECT_FORMATS = new Set(["mp3", "wav", "flac", "m4a", "ogg", "webm", "aac"]);
// OpenRouter rejects bodies over 25 MB for Mistral, and upstream requests time out after 60 s.
const MAX_DIRECT_BYTES = 24 * 1024 * 1024;
const PART_SECONDS = 600;
// Longer transcripts are saved to a file instead of flooding the agent's context.
const INLINE_MAX_SECONDS = 1800;
const CONCURRENCY = 3;

type Segment = { start: number; end: number; text: string; speaker?: string };
type Result = {
  file: string;
  model: ModelKey;
  seconds: number;
  cost: number;
  parts: number;
  text: string;
  segments: Segment[];
};

class Fail extends Error {
  constructor(message: string, readonly code = 1) {
    super(message);
  }
}

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    speakers: { type: "boolean", default: false },
    timestamps: { type: "boolean", default: false },
    model: { type: "string" },
    language: { type: "string" },
    context: { type: "string", multiple: true, default: [] },
    out: { type: "string" },
    json: { type: "boolean", default: false },
    estimate: { type: "boolean", default: false },
    "max-cost": { type: "string", default: "1" },
    refresh: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

async function main() {
  if (opts.help || positionals.length !== 1) {
    console.log(
      "Usage: bun transcribe.ts <file> [--speakers] [--timestamps] [--model mini|small] [--language xx] [--context term]... [--out file.md] [--json] [--estimate] [--max-cost USD] [--refresh]",
    );
    process.exit(opts.help ? 0 : 2);
  }

  const path = resolve(positionals[0].replace(/^~(?=\/)/, homedir()));
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new Fail(`Not a file: ${path}`, 2);

  const modelKey = (opts.model ?? (opts.speakers ? "small" : "mini")) as ModelKey;
  if (!(modelKey in MODELS)) throw new Fail(`--model must be mini or small`, 2);
  const model = MODELS[modelKey];
  const segmented = opts.speakers || opts.timestamps;
  const maxCost = Number(opts["max-cost"]);
  if (opts.language && !/^[a-z]{2}$/.test(opts.language)) throw new Fail("--language takes a two-letter ISO 639-1 code", 2);

  const ext = extname(path).slice(1).toLowerCase();
  const probe = await probeAudio(path);
  const seconds = probe?.seconds ?? 0;
  const needsConversion = !DIRECT_FORMATS.has(ext) || info.size > MAX_DIRECT_BYTES || seconds > PART_SECONDS;
  if (!probe && needsConversion) throw new Fail("ffprobe and ffmpeg are needed for this file. Install them with: brew install ffmpeg");
  if (probe && !probe.hasAudio) throw new Fail(`No audio track in ${path}`);
  const parts = needsConversion ? Math.max(1, Math.ceil(seconds / PART_SECONDS)) : 1;
  const estimate = seconds * model.usdPerSecond;

  if (opts.estimate) {
    console.log(
      `${basename(path)}: ${clock(seconds)}, ${parts} part(s), ${model.name}, about $${estimate.toFixed(4)}${needsConversion ? ", converted with ffmpeg" : ""}`,
    );
    return;
  }

  const key = cacheKey(await sha256(path), modelKey);
  const cachedJson = Bun.file(join(CACHE_DIR, `${key}.json`));
  let result: Result;
  let cached = false;
  if (!opts.refresh && (await cachedJson.exists())) {
    result = { ...(await cachedJson.json()), file: path };
    cached = true;
  } else {
    if (estimate > maxCost) {
      throw new Fail(
        `Estimated cost $${estimate.toFixed(2)} for ${clock(seconds)} exceeds --max-cost $${maxCost}. Ask the user, then rerun with a higher --max-cost.`,
        3,
      );
    }
    const apiKey = await readKey();
    result = await transcribe(path, ext, needsConversion, modelKey, segmented, apiKey);
    await mkdir(CACHE_DIR, { recursive: true });
    await Bun.write(cachedJson, JSON.stringify(result));
  }

  const markdown = render(result, cached, segmented, opts.speakers);
  const savedPath = join(CACHE_DIR, `${key}.md`);
  await Bun.write(savedPath, markdown);
  if (opts.out) await Bun.write(resolve(opts.out), markdown);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.seconds > INLINE_MAX_SECONDS && !opts.out) {
    console.log(markdown.split("\n").slice(0, 3).join("\n"));
    console.log(`\nLong transcript (${markdown.length} characters) saved to ${savedPath}. Read it in parts.`);
  } else {
    console.log(markdown);
  }
  console.error(`Transcript saved to ${opts.out ? resolve(opts.out) : savedPath}`);
}

async function transcribe(
  path: string,
  ext: string,
  needsConversion: boolean,
  modelKey: ModelKey,
  segmented: boolean,
  apiKey: string,
): Promise<Result> {
  const work = needsConversion ? await mkdtemp(join(tmpdir(), "transcribe-audio-video-")) : null;
  try {
    const parts = work ? await splitToMp3(path, work) : [{ path, format: ext === "m4a" ? "m4a" : ext, start: 0 }];
    const responses = await mapLimit(parts, CONCURRENCY, (part) => requestPart(part.path, part.format, modelKey, segmented, apiKey));

    const segments: Segment[] = [];
    responses.forEach((res, i) => {
      for (const seg of res.segments ?? []) {
        const raw = seg.speaker ?? seg.speaker_id;
        let speaker = raw === undefined || raw === null ? undefined : speakerLabel(raw);
        if (speaker && parts.length > 1) speaker += `/p${i + 1}`;
        segments.push({ start: seg.start + parts[i].start, end: seg.end + parts[i].start, text: String(seg.text).trim(), speaker });
      }
    });
    return {
      file: path,
      model: modelKey,
      seconds: responses.reduce((s, r) => s + (r.usage?.seconds ?? r.duration ?? 0), 0),
      cost: responses.reduce((s, r) => s + (r.usage?.cost ?? 0), 0),
      parts: parts.length,
      text: responses.map((r) => String(r.text ?? "").trim()).join("\n\n"),
      segments,
    };
  } finally {
    if (work) await rm(work, { recursive: true, force: true });
  }
}

async function requestPart(path: string, format: string, modelKey: ModelKey, segmented: boolean, apiKey: string) {
  const data = Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64");
  const mistral: Record<string, unknown> = {};
  if (opts.speakers) mistral.diarize = true;
  if (opts.context.length) mistral.context_bias = opts.context;
  const body = {
    model: MODELS[modelKey].id,
    input_audio: { data, format },
    ...(opts.language ? { language: opts.language } : {}),
    ...(segmented ? { response_format: "verbose_json", timestamp_granularities: ["segment"] } : {}),
    provider: { zdr: true, ...(Object.keys(mistral).length ? { options: { mistral } } : {}) },
  };

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "transcribe-audio-video skill" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      if (attempt < 3) {
        await Bun.sleep(2000 * attempt);
        continue;
      }
      throw new Fail(`Network error calling OpenRouter: ${(error as Error).message}`);
    }
    if (res.ok) return (await res.json()) as any;
    const detail = (await res.text()).slice(0, 500);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await Bun.sleep(2000 * 2 ** attempt);
      continue;
    }
    if (res.status === 401) throw new Fail(`OpenRouter rejected the key in Keychain item "${KEYCHAIN_SERVICE}" (401).`);
    if (res.status === 402 || res.status === 403) throw new Fail(`OpenRouter refused the request (${res.status}): spend limit reached, key disabled or access blocked. ${detail}`);
    throw new Fail(`OpenRouter error ${res.status}: ${detail}`);
  }
}

async function splitToMp3(path: string, work: string) {
  const list = join(work, "parts.csv");
  // Mono 16 kHz MP3 matches Voxtral's input rate and keeps each 10-minute part near 3.6 MB.
  await run(["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k",
    "-f", "segment", "-segment_time", String(PART_SECONDS), "-reset_timestamps", "1",
    "-segment_list", list, "-segment_list_type", "csv", join(work, "part%03d.mp3")]);
  const rows = (await Bun.file(list).text()).trim().split("\n");
  return rows.map((row) => {
    const [name, start] = row.split(",");
    return { path: join(work, name), format: "mp3", start: Number(start) };
  });
}

async function probeAudio(path: string) {
  if (!Bun.which("ffprobe")) return null;
  const out = await run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path]).catch(() => {
    throw new Fail(`ffprobe cannot read ${path}: unsupported or damaged media file.`);
  });
  const json = JSON.parse(out);
  return {
    seconds: Number(json.format?.duration ?? 0),
    hasAudio: (json.streams ?? []).some((s: { codec_type?: string }) => s.codec_type === "audio"),
  };
}

async function readKey() {
  const proc = Bun.spawn(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], { stdout: "pipe", stderr: "ignore" });
  const key = (await new Response(proc.stdout).text()).trim();
  if ((await proc.exited) !== 0 || !key) {
    throw new Fail(
      `No OpenRouter key in Keychain item "${KEYCHAIN_SERVICE}". Ask the user to store one with: security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -U -w`,
    );
  }
  return key;
}

async function run(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Fail(`${cmd[0]} failed: ${err.trim().slice(0, 300)}`);
  return out;
}

async function sha256(path: string) {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

function cacheKey(fileHash: string, modelKey: ModelKey) {
  const variant = JSON.stringify([modelKey, opts.speakers, opts.timestamps, opts.language ?? "", opts.context]);
  return `${fileHash.slice(0, 32)}-${new Bun.CryptoHasher("sha256").update(variant).digest("hex").slice(0, 12)}`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

function render(r: Result, cached: boolean, segmented: boolean, speakers: boolean) {
  const meta = [r.file, clock(r.seconds), MODELS[r.model].name, `$${r.cost.toFixed(4)}`, cached ? "cached, no new charge" : ""].filter(Boolean);
  const lines = [`# Transcript: ${basename(r.file)}`, meta.join(" · "), ""];
  if (speakers && !r.segments.some((s) => s.speaker)) {
    lines.push("No speaker labels: OpenRouter does not forward diarization for Voxtral 3 (verified 2026-11-03). Tell speakers apart from context.", "");
  } else if (speakers && r.parts > 1) lines.push(`Speaker labels restart in each ${PART_SECONDS / 60}-minute part (/p1, /p2…): match voices across parts from context.`, "");
  if (segmented && r.segments.length) {
    // Merge consecutive segments from the same speaker to save tokens.
    let current: Segment | null = null;
    const flush = () => current && lines.push(`[${clock(current.start)}]${current.speaker ? ` ${current.speaker}:` : ""} ${current.text}`);
    for (const seg of r.segments) {
      if (current && speakers && seg.speaker === current.speaker) {
        current = { ...current, end: seg.end, text: `${current.text} ${seg.text}` };
      } else {
        flush();
        current = { ...seg };
      }
    }
    flush();
  } else {
    if (segmented) lines.push("(The provider returned no segments; plain text follows.)", "");
    lines.push(r.text);
  }
  return `${lines.join("\n")}\n`;
}

function speakerLabel(raw: unknown) {
  return typeof raw === "number" ? `speaker_${raw + 1}` : String(raw);
}

function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [h, m, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
}

main().catch((error) => {
  console.error(error instanceof Fail ? error.message : `Unexpected error: ${(error as Error).stack ?? error}`);
  process.exit(error instanceof Fail ? error.code : 1);
});
