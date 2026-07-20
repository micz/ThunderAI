# Localization

## Golden Rule

**Only ever modify `_locales/en/messages.json`.**

All other locale files (everything under `_locales/` except `en`) are managed by translators through [Weblate](https://hosted.weblate.org/). Never edit them manually.

## Message File Format

Each entry in `_locales/en/messages.json` follows the standard WebExtension i18n format:

```json
"key_name": {
    "message": "The English text",
    "description": "Context for translators explaining where/how this string is used"
}
```

The `description` field is important — it helps Weblate translators understand the context.

## Using Strings in Code

### In JavaScript
```javascript
import { i18n } from './mzta-i18n.js';
const text = i18n('key_name');
// or directly:
const text = browser.i18n.getMessage('key_name');
```

### In HTML
```html
<span data-i18n="key_name"></span>
<!-- or via manifest/attribute references: -->
__MSG_key_name__
```

### In manifest.json
```json
"description": "__MSG_extensionDescription__"
```

## Naming Conventions

| Prefix | Usage |
|--------|-------|
| `menu_*` | Context menu and popup menu labels |
| `prompt_*` | Built-in prompt names |
| `placeholder_*` | Placeholder display names |
| `options_*` | Settings page labels |
| `pages_*` | Feature page labels |
| `error_*` | Error messages |
| `info_*` | Informational messages |
| `btn_*` | Button labels |

## Adding a New String

1. Open `_locales/en/messages.json`
2. Add the new key in alphabetical order within the file (or near related keys)
3. Include both `message` and `description` fields
4. Use the string in code via `browser.i18n.getMessage('key_name')` or `__MSG_key_name__`

Example:
```json
"my_new_feature_label": {
    "message": "My New Feature",
    "description": "Label for the new feature button in the options page"
}
```

## Supported Languages

The authoritative list is the set of directories under `_locales/` (source of truth — do not duplicate it here as a static count, it changes as Weblate adds languages). As of writing:

| Code | Language |
|------|----------|
| `en` | English (source) |
| `bg` | Bulgarian |
| `cs` | Czech |
| `de` | German |
| `el` | Greek |
| `eo` | Esperanto |
| `es` | Spanish |
| `fr` | French |
| `hr` | Croatian |
| `hu` | Hungarian |
| `id` | Indonesian |
| `it` | Italian |
| `ja` | Japanese |
| `nb_NO` | Norwegian Bokmål |
| `nl` | Dutch |
| `pl` | Polish |
| `pt` | Portuguese |
| `pt-br` | Brazilian Portuguese |
| `ro` | Romanian |
| `ru` | Russian |
| `sk` | Slovak (directory present, no translated strings yet) |
| `sv` | Swedish |
| `tr` | Turkish |
| `zh_Hans` | Chinese Simplified |
| `zh_Hant` | Chinese Traditional |
