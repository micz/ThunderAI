# ThunderAI Project Agent Context

## Project Overview
ThunderAI is a Mozilla Thunderbird add-on that integrates Large Language Models (LLMs) such as ChatGPT, Gemini, Claude, and Ollama for advanced email management. It allows users to analyze, draft, correct, tag, and create calendar events directly from the email client.

## Technical Stack
- **Languages:** JavaScript (ES6+), HTML5, CSS3.
- **Environment:** Thunderbird MailExtension API (based on WebExtensions).
- **Core Logic:** Primarily located in `background.js` and UI-specific scripts.
- **API Integrations:** Specific logic is contained within dedicated API provider files (e.g., `api_openai.js`, `api_google_gemini.js`).

## Development Rules & Style Guide
- **Code Style:** Use modern JavaScript. Prefer `async/await` over chained Promises.
- **Naming Conventions:** Use `camelCase` for variables and functions.
- **Security:** - Never hardcode API keys in the source code.
    - Use `messenger.storage.local` for data persistence.
    - Strictly adhere to CORS policies for external API calls.
- **i18n:** 
    - The project supports multiple languages via `_locales/`. When adding UI strings, always use `messenger.i18n.getMessage()`.
    - When you need to modify language file, modify only the english version.
- **Logging:**
    - When possibile use the taLog object to log errors, otherwise use the console.error(<msg>) method.
    - If it's useful to log add debug logs using taLog.log(<msg>) method.

## Files & Directories Structure
- `manifest.json`: Extension entry point and permission definitions.
- `api_*.js`: Modules for integration with different AI providers.
- `options/`: Configuration and settings pages.
- `_locales/`: Translation files (JSON format).
- `graphics/`: Visual assets and icons.

## Important Commands & Workflow
- **Testing:** Since this is a Thunderbird add-on, testing is performed by loading the extension as a "Temporary Add-on" via Thunderbird's `Debug Add-ons` menu.
- **Build:** The project does not use complex build tools (no Webpack/Vite by default); it is a "pure" MailExtension.

## Agent Instructions
1. **Context Awareness:** When modifying API-related files, ensure compatibility with the existing placeholder system (e.g., `{%mail_body%}`, `{%additional_text%}`).
2. **Permission Review:** Before modifying `manifest.json`, verify that any new permissions requested are strictly necessary for the feature.
3. **Compatibility:** Ensure code is compatible with the latest Thunderbird ESR (Extended Support Release) versions.