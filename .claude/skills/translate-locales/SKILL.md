---
name: translate-locales
description: Translate the missing and modified ThunderAI UI strings of the locales listed in LANG_AUTO.md, from _locales/en/messages.json. Use when asked to update, sync, complete or fix the translations / locales / messages.json files, or to check which strings still need translating.
---

# Translate locales

All file work goes through the script; never edit a `messages.json` or `baseline.json` by hand.

```
node .claude/skills/translate-locales/scripts/i18n.mjs <command> [--langs it,de] [--limit N] [--prune]
```

Languages: those the user names, otherwise every entry of `LANG_AUTO.md` (the script maps entries to `_locales/` folders and reports any without one).

1. If `baseline.json` (next to this file) does not exist, stop and ask the user whether to run `init`. Do not run it on your own.
2. Run `status`, then `extract` for the chosen languages. For a large backlog, pass `--limit 150` and repeat steps 3–5 per batch.
3. Open each `.claude/i18n-work/<lang>.json` and fill `translation` for every entry, changing nothing else in the file:
   - use `description` as context and `reference` for the locale's terminology and tone;
   - `missing`: translate `en`;
   - `modified`: start from `current_translation` and change it only as far as `en` differs from `previous_en` (when `previous_en` is null, check `current_translation` against `en` and fix what does not match).
4. Keep unchanged: `$NAME$` tokens, `$1`-style substitutions, HTML tags with their attributes, and product/provider names (ThunderAI, Thunderbird, ChatGPT, Gemini, Claude, Ollama, OpenAI, DeepSeek, Grok, Mistral, OpenRouter, Perplexity, LM Studio). Match the length and register of the English (menu labels stay short).
5. Run `apply`. For every entry it reports as invalid, fix `translation` in the work file (its `error` field says why) and run `apply` again.
6. Run `status` to confirm, then report a per-language summary (written, invalid, still pending) and `git diff --stat`. Never commit, add or push.

`--prune` (on `apply`) deletes the keys `en` no longer has: use it only when the user asks.
