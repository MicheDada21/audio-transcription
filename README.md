# transcribe-audio-video

Trascrive il parlato di un file audio o video locale con Voxtral 3 tramite OpenRouter, con timestamp a richiesta.

Fa parte della [Prompt Library di CH Labs](https://www.cryptohelvetia.com/ch-labs/prompt-library), dove la pagina di riferimento è [Transcribe audio video](https://www.cryptohelvetia.com/ch-labs/prompt-library/skills/transcribe-audio-video). Il repo contiene una copia della skill, rigenerata a ogni aggiornamento della libreria.

## Installare

In Claude Code aggiungi una volta il marketplace e installa il plugin.

```
/plugin marketplace add MicheDada21/ch-labs-skills
/plugin install transcribe-audio-video@ch-labs-skills
```

Da shell i comandi sono `claude plugin marketplace add MicheDada21/ch-labs-skills` e `claude plugin install transcribe-audio-video@ch-labs-skills`. Nell'app desktop premi + accanto al campo del prompt, apri Plugins, aggiungi il marketplace `MicheDada21/ch-labs-skills` con Add marketplace e poi il plugin con Add plugin.

Per avere tutte le skill della libreria installa `tutte-le-skill@ch-labs-skills`. Con altri agenti copia la cartella `skills/transcribe-audio-video` tra le skill dell'agente, per esempio in `~/.codex/skills/transcribe-audio-video`.

## Requisiti

Servono [Bun](https://bun.sh), ffmpeg e una chiave OpenRouter salvata nel Portachiavi di macOS con il servizio `openrouter-api-key`.

## Licenza

MIT, testo completo in [LICENSE](LICENSE).
