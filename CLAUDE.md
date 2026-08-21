# ThunderAI - Claude Code Guide

## Project Overview
ThunderAI is a **Thunderbird WebExtension (Manifest V2)** that integrates multiple AI providers (ChatGPT Web, OpenAI API, Google Gemini, Claude/Anthropic, Ollama, and OpenAI-compatible APIs) directly into the Thunderbird email client.

- **Extension ID:** `thunderai@micz.it`
- **Min Thunderbird:** 140.0+
- **Language:** Plain ES6+ JavaScript modules — no build tools, no transpilation, no npm
- **License:** GPLv3

## Key Rules

1. **Localization:** Modify ONLY `_locales/en/messages.json`. All other locale files are managed via Weblate — never touch them.
2. **No build system:** There is no bundler, compiler, or package manager. All JS files are plain ES6 modules loaded directly by the browser engine. (This still holds: the only dependency anywhere in the repo is `tools/debug/`'s Python venv, which is a developer tool — it is not shipped, and the extension needs no packaging step to run under it.)
3. **Module imports:** Use relative paths with `.js` extension (e.g., `import { foo } from '../js/mzta-utils.js'`).
4. **Placeholder format:** Placeholders in prompt text use the `{%placeholder_id%}` syntax (e.g., `{%mail_text_body_or_selected%}`).
5. **No test suite:** There is no automated test framework, and testing for feature work is done manually in Thunderbird. The one exception is [`tools/debug/`](tools/debug/): an **opt-in** Marionette harness for UI/persistence regressions, with its own venv. It adds no build step for the extension (the add-on is installed as the unpacked repo directory) — see [claude-spec/08-debug-harness.md](claude-spec/08-debug-harness.md).
6. **Settings defaults:** All new preferences must be added to `options/mzta-options-default.js` in `prefs_default`.
7. **Keep spec files up to date:** When making code changes that affect a subsystem described in claude-spec/, update the relevant spec file to reflect the new behavior. Read the spec before modifying, update it after.

## Directory Map

```
/
├── mzta-background.js      # Background script (main entry point)
├── mzta-background.html    # Loads the background script
├── manifest.json           # Extension manifest
├── js/                     # Core modules
│   ├── api/                # AI API integration modules
│   ├── workers/            # Web Workers (one per API provider)
│   ├── lib/                # Third-party libraries (diff.js)
│   └── mzta-*.js           # Core utilities, menus, prompts, placeholders
├── options/                # Settings UI
│   ├── mzta-options.html/.js/.css
│   ├── mzta-options-default.js   # ALL default preference values
│   └── mzta-release-notes.html
├── pages/                  # Feature-specific settings pages
│   ├── addtags/
│   ├── customprompts/
│   ├── customdataplaceholders/
│   ├── get-calendar-event/
│   ├── get-task/
│   ├── menu_order/         # Drag-and-drop reorder + visibility for popup/context menus
│   ├── spamfilter/
│   ├── summarize/
│   ├── translate/
│   ├── onboarding/
│   └── _lib/               # Shared libraries used by pages
├── popup/                  # Popup menu (shown on toolbar click)
│   └── mzta-popup.html/.js/.css
├── _locales/               # Localization
│   ├── en/messages.json    # ← ONLY THIS FILE is edited directly
│   └── [15 other languages managed by Weblate]
├── images/                 # Icons and graphical assets
├── api_webchat/            # Web chat API interface
└── tools/
    └── debug/              # Opt-in Marionette debug harness (Python venv, not shipped)
```

## Spec Files

For detailed documentation see [`claude-spec/`](claude-spec/):

- [01-architecture.md](claude-spec/01-architecture.md) — Module structure and data flow
- [02-prompts.md](claude-spec/02-prompts.md) — Prompt system (types, actions, properties)
- [03-placeholders.md](claude-spec/03-placeholders.md) — Placeholder system
- [04-api-integrations.md](claude-spec/04-api-integrations.md) — AI provider integrations
- [05-options.md](claude-spec/05-options.md) — Settings and preferences system
- [06-localization.md](claude-spec/06-localization.md) — i18n rules and workflow
- [07-diff-picker.md](claude-spec/07-diff-picker.md) — Interactive change picker for proofreading (hunk model, compose invariant)
- [08-debug-harness.md](claude-spec/08-debug-harness.md) — Opt-in Marionette debug harness (`tools/debug/`): setup, and the non-obvious Thunderbird/Gecko constraints it works around
- [99-thunderbird-team-spec.md](claude-spec/99-thunderbird-team-spec.md) — Thunderbird WebExtensions development guidelines (API usage, experiments, review requirements)
