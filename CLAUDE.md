# ThunderAI - Claude Code Guide

## Project Overview
ThunderAI is a **Thunderbird WebExtension (Manifest V2)** that integrates multiple AI providers (ChatGPT Web, OpenAI API, Google Gemini, Claude/Anthropic, Ollama, and OpenAI-compatible APIs) directly into the Thunderbird email client.

- **Extension ID:** `thunderai@micz.it`
- **Min Thunderbird:** 140.0+
- **Language:** Plain ES6+ JavaScript modules — no build tools, no transpilation; npm only for development tooling (the test suite), never for shipped code
- **License:** GPLv3

## Key Rules

1. **Localization:** Modify ONLY `_locales/en/messages.json`. All other locale files are managed via Weblate — never touch them.
2. **`LANG.md` is the release packaging allowlist, not a locale inventory.** It lists only the translations complete enough to ship, and is therefore a *deliberately partial* subset of `_locales/` — locales below the release bar are omitted on purpose. It is maintained by hand: add a locale when its translation is approved for release. Do not "fix" it to match `_locales/`.
3. **No build system:** There is no bundler or compiler. All JS files are plain ES6 modules loaded directly by the browser engine. **npm is allowed for development tooling only** (today: jsdom, the one pinned `devDependency` of the root `package.json`, for the DOM tests). It is never used for shipped code, and **no runtime code may import anything from `node_modules`**. Adding a dev dependency is a deliberate decision: pin it to an exact version and commit `package-lock.json`.
4. **Module imports:** Use relative paths with `.js` extension (e.g., `import { foo } from '../js/mzta-utils.js'`). When importing more than one name from the same file, put each name on its own line (4-space indent, no trailing comma) instead of listing them on a single line:
   ```js
   import {
       buildSendIcon,
       buildStopIcon,
   } from './svgIcons.js';
   ```
5. **Placeholder format:** Placeholders in prompt text use the `{%placeholder_id%}` syntax (e.g., `{%mail_text_body_or_selected%}`).
6. **Tests:** ThunderAI has an automated suite in `tests/` (Node's built-in runner). Today it covers the enterprise managed configuration, the static consistency of the locales and the preferences, the prompt and placeholder systems, the API integrations, and the settings pages with no policy (the options page, the six feature settings pages, the three prompt management pages, the setup wizard, the welcome page and the popup); it is designed to extend to the whole of ThunderAI, one area at a time: a generic core (`tests/helpers/core/`: loader, browser mock, DOM harness, known-issue mechanism) that never names an area, and per area its own files — level-1 tests in `tests/<area>/`, DOM tests in the shared `tests/dom/<page>/` with the area as a file-name prefix, fixtures in `tests/fixtures/<area>/`, a plugin in `tests/helpers/plugins/<area>.mjs` (its modules, background state and background answers), known issues in `tests/helpers/known-issues/<area>.mjs` — so an area never edits shared files. Two levels: **level 1** (`*.test.mjs`, the modules, no dependencies, Node 22+) runs with `node --test "tests/**/*.test.mjs"` and must keep running with nothing installed (nothing it imports may reach jsdom); the **DOM tests** (`tests/dom/<page>/*.dom.mjs`, the pages loaded in jsdom) need `npm ci`, and `npm test` runs both. Run from the repo root, and extend it when changing anything an area covers — today `claude-spec/08-managed-configuration.md` and its topic files `08a`–`08c` (see `tests/README.md` and `tests/managed/README.md`), and `claude-spec/05-options.md` / `06-localization.md` through the `static` area, which scans the tree and so covers new code by itself (see `tests/static/README.md`), and `claude-spec/02-prompts.md` / `03-placeholders.md` through the `prompts` area (see `tests/prompts/README.md`), and `claude-spec/04-api-integrations.md` through the `api` area (see `tests/api/README.md`), and the page sections of `claude-spec/05-options.md` (with the prompt management pages and the popup of `02-prompts.md` / `03-placeholders.md`) through the `ui` area (DOM files `tests/dom/<page>/ui-*.dom.mjs`, see `tests/ui/README.md`), and the API chat window of `claude-spec/01-architecture.md` / `04-api-integrations.md` with the diff picker of `07-diff-picker.md` through the `webchat` area (DOM files `tests/dom/webchat/webchat-*.dom.mjs`, see `tests/webchat/README.md`). Everything else is still tested manually in Thunderbird, and so is how the UI looks. Tests are written from the spec: a failing test is a potential bug to report, never a reason to bend the source. Until it is fixed it runs as a node:test TODO with its reason in the area's `tests/helpers/known-issues/<area>.mjs` (through `knownTest()`), and fails the run once it passes: then remove the entry. Never modify shipped source just to make it testable. `tests/`, `package.json`, `package-lock.json` and `node_modules/` are excluded from the XPI by the packaging script (`create_xpi_from_folder.bat`, outside this repository).
7. **Settings defaults:** All new preferences must be added to `options/mzta-options-default.js` in `prefs_default`. Every one becomes policy-settable; if its type does not express its domain (a select's values, a number range other than non-negative integer, a format), give it an entry in `PREF_ENUMS` / `PREF_NUMBER_RANGES` or a rule in `prefValueProblem()` (`js/mzta-managed.js`). A new per-provider field in `integration_options_config` becomes policy-settable automatically, both as a global preference and as a field of the `_special_prompts_connection` policy key (the per-feature connection). What still has to be checked by hand:
   - a content rule in `connectionFieldProblem()` (`js/mzta-managed.js`) if its type alone does not make a value usable (URL, number in a string, JSON, enumeration);
   - the `*_api_key` name for a secret;
   - the `${modelId_prefix}${integration}_${key}` input id in the connection panel.

   See "Adding a policy-settable preference" in `claude-spec/08-managed-configuration.md`.
8. **Keep spec files up to date:** When making code changes that affect a subsystem described in claude-spec/, update the relevant spec file to reflect the new behavior. Read the spec before modifying, update it after.
9. **Never commit or add on your own initiative.** Do not run `git commit` (or `git push`, or `git add`, or create branches) unless explicitly asked to in that same request. Finishing a task is *not* permission to commit it: leave the work modified, report what is ready, and let the maintainer decide when to commit and how to word the message. Approval to implement a plan is not approval to commit it.
10. **Never show the full diff in chat.** When finishing a task, do not paste the complete diff (or whole rewritten files) into the final message. Summarize what changed — files touched with clickable links, and a short description per change — and let the maintainer inspect the actual diff in the editor or via git. Short snippets are fine only when needed to explain a specific decision.
11. **Ask to run the full tests suite when completing a job.** Do not always run the full tests suite, ask the user if he wants to run it. If you want to run one or more specific test, you can run them without asking.

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
│   ├── setup-wizard/       # First-run guided connection setup
│   └── _lib/               # Shared libraries used by pages
├── popup/                  # Popup menu (shown on toolbar click)
│   └── mzta-popup.html/.js/.css
├── _locales/               # Localization
│   ├── en/messages.json    # ← ONLY THIS FILE is edited directly
│   └── [all other languages managed by Weblate — see `_locales/` for the current set]
├── images/                 # Icons and graphical assets
├── api_webchat/            # Web chat API interface
├── tests/                  # Test suite (node:test), never packaged: the managed configuration today, extensible per area
│   ├── helpers/core/       # Generic harness (loader, mock, DOM harness); areas plug in via helpers/plugins/<area>.mjs
│   ├── managed/            # Level 1 of the managed configuration: the modules, no dependencies
│   └── dom/<page>/         # DOM tests: the pages in jsdom (npm ci), shared by every area
└── package.json            # Dev tooling only (jsdom + npm test), never packaged
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
- [08-managed-configuration.md](claude-spec/08-managed-configuration.md) — Enterprise policy: resolution order, write guard, hydration, validation, lock convention, testing
  - [08a-managed-prompts.md](claude-spec/08a-managed-prompts.md) — restrictions, org prompts, enforced special prompt texts
  - [08b-managed-connections.md](claude-spec/08b-managed-connections.md) — policy values on the connection panels, enforced per-feature connections, account lists
  - [08c-managed-ui.md](claude-spec/08c-managed-ui.md) — how the settings pages present the policy (`pages/_lib/managed-ui.js`)
- [99-thunderbird-team-spec.md](claude-spec/99-thunderbird-team-spec.md) — Thunderbird WebExtensions development guidelines (API usage, experiments, review requirements)
