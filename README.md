# audio-transcription

Trascrive il parlato di un file audio o video locale con Voxtral 3 tramite OpenRouter, con timestamp ed etichette dei parlanti a richiesta.

Fa parte della [Prompt Library di CH Labs](https://www.cryptohelvetia.com/ch-labs/prompt-library). Il repo contiene una copia della skill, rigenerata a ogni aggiornamento della libreria.

## Installare

In Claude Code aggiungi una volta il marketplace e installa il plugin.

```
/plugin marketplace add MicheDada21/ch-labs-skills
/plugin install audio-transcription@ch-labs-skills
```

Da shell i comandi sono `claude plugin marketplace add MicheDada21/ch-labs-skills` e `claude plugin install audio-transcription@ch-labs-skills`. Nell'app desktop premi + accanto al campo del prompt, apri Plugins, aggiungi il marketplace `MicheDada21/ch-labs-skills` con Add marketplace e poi il plugin con Add plugin.

Per avere tutte le skill della libreria installa `tutte-le-skill@ch-labs-skills`. Con altri agenti copia la cartella `skills/audio-transcription` tra le skill dell'agente, per esempio in `~/.codex/skills/audio-transcription`.

## Requisiti

Servono [Bun](https://bun.sh), ffmpeg e una chiave OpenRouter salvata nel Portachiavi di macOS con il servizio `openrouter-api-key`.

## Licenza

MIT, testo completo in [LICENSE](LICENSE).
