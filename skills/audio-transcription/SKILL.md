---
name: audio-transcription
description: Transcribe speech from a local audio or video file (mp3, m4a, wav, ogg, opus, flac, webm, aac, aiff, mp4, mov) with Voxtral 3 through OpenRouter, with optional timestamps. Use when the user attaches or names a recording, voice note, meeting, interview or podcast whose words the task needs.
---

# Audio transcription

The IDEs pass images (and, in Claude Code, PDFs) to the model, never audio. Speech reaches the task only as text from `scripts/transcribe.ts`, run on the file's local path. The original file stays untouched.

## Steps

1. Find the path. Use the path of the attached or named file. When the IDE refused the attachment or shows no path, ask the user for the absolute path (Finder: select the file, then Option-Command-C). Done when you hold a path that exists.

2. Decide whether a transcript is needed. Transcribe when the task depends on what is said. When the task only moves, renames, converts or plays the file, work on the file directly. When a transcript already sits next to it (`.txt`, `.srt`, `.vtt`, `.md` with the same name), read that. Done when you have chosen one of the three.

3. Run the script. The user supplying the file counts as approval for the charge (about $0.21 per hour with Mini).

       bun <this skill's folder>/scripts/transcribe.ts "<path>" [options]

   | Option | When |
   |---|---|
   | `--speakers` | Several voices: meeting, interview, call. Uses Small with segment timestamps; speaker labels appear only once a provider returns them (OpenRouter does not yet for Voxtral 3). |
   | `--timestamps` | The user needs times, for quotes, subtitles or cuts. |
   | `--model small` | Hard audio: noise, accents, dense jargon. Default is Mini. |
   | `--language it` | The language is known; improves accuracy. |
   | `--context "term"` | Names or terms that must be spelled right; repeat per term. |
   | `--out <file.md>` | The user wants the transcript saved in the project. |
   | `--estimate` | Duration, parts and cost only, no call. |

   Done when the script exits 0 and prints the transcript, or the path of a saved long transcript.

4. Use the transcript as context for the task. A recording over 30 minutes is saved to a file and not printed: read it in parts. Quote times as `[hh:mm:ss]`. Done when the answer rests on the transcript's words.

## Exit codes and limits

- `3`: the estimate exceeds `--max-cost` (default $1, about 4.5 hours with Mini). Tell the user the estimate, and rerun with a higher `--max-cost` after their yes.
- `1`: the message names the cause: missing Keychain key, unreadable media, OpenRouter error. A missing key needs the user: they create a key at openrouter.ai/settings/keys and store it with `security add-generic-password -a "$USER" -s openrouter-api-key -U -w`.
- Results are cached by file hash and options in `~/Library/Caches/audio-transcription/`, so a repeat run is free; `--refresh` pays for a new one.
- Files over 10 minutes or 24 MB, and formats OpenRouter does not take directly, go through ffmpeg into 10-minute mono MP3 parts. Speaker labels restart in each part (`speaker_1/p2`).
- Voxtral 3 gives segment timestamps only, no word timestamps. Overlapping speech is not separated.
- OpenRouter answers a `diarize` request for Voxtral 3 with a 400 and drops it under `provider.options` (tested 2026-11-03), so speaker labels need Mistral's own API, which this skill does not call yet.
- Requests use OpenRouter zero-data-retention routing. The script needs macOS Keychain, so it runs on this Mac only, not in cloud agents.
