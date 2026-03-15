# Placeholders System

## Overview

Placeholders are dynamic tokens embedded in prompt text that get replaced with real data at runtime (email content, headers, user input, etc.).

**Format:** `{%placeholder_id%}`

Example in a prompt: `"Summarize this email: {%mail_text_body_or_selected%}"`

## Placeholder Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique identifier used in `{%id%}` tokens |
| `name` | string | Display name (i18n `__MSG_key__` or plain text) |
| `default_value` | string | Value used if placeholder cannot be resolved |
| `type` | number | `0` = always, `1` = reading only, `2` = composing only |
| `is_default` | string | `"1"` = built-in (not editable/deletable), `"0"` = custom |
| `is_dynamic` | string | `"0"` = fixed value, `"1"` = dynamic (takes a parameter after `:`) |
| `enabled` | number | `0` = disabled, `1` = enabled |
| `text` | string | Content for custom placeholders only |

## Built-in Placeholders (defined in `js/mzta-placeholders.js`)

| ID | Description | Type |
|----|-------------|------|
| `mail_text_body` | Full plain text of the email | 0 |
| `mail_html_body` | Full HTML of the email | 0 |
| `mail_typed_text` | Text typed so far in compose window | 2 |
| `mail_text_body_or_selected` | Plain text body, or selected text if any | 1 |
| `mail_html_body_or_selected` | HTML body, or selected HTML if any | 1 |
| `mail_selected_text` | Only the selected text | 1 |
| `mail_selected_html` | Only the selected HTML | 1 |
| `mail_subject` | Email subject line | 0 |
| `mail_date` | Email date | 1 |
| `mail_author` | Email sender | 0 |
| `mail_recipients` | Email recipients | 0 |
| `mail_tags` | Current tags on the email | 1 |
| `mail_available_tags` | All available tags in Thunderbird | 1 |
| `identity_name` | Current identity display name | 0 |
| `identity_email` | Current identity email address | 0 |
| `identity_signature` | Current identity signature | 0 |
| `additional_text[id]` | User input field (dynamic, shows input in popup) | 0 |
| `mail_header:name` | Any email header by name (dynamic) | 1 |

## Dynamic Placeholders

Dynamic placeholders use a colon separator to pass a parameter:

```
{%additional_text:my_field_id%}   →  shows an input field labelled "my_field_id" in the popup
{%mail_header:x-spam-score%}      →  fetches the X-Spam-Score header value
```

The `is_dynamic: "1"` property signals this behavior in the placeholder definition.

## Custom Placeholders

Users can define their own placeholders via `pages/customdataplaceholders/`. Custom placeholders:
- Have `is_default: "0"`
- Have a `text` property containing the replacement value
- Are stored in `browser.storage.local`
- Are merged with default placeholders at runtime before prompt processing

## Placeholder Resolution Order

1. Built-in placeholders are defined in `js/mzta-placeholders.js`
2. Custom placeholders are loaded from storage
3. At runtime, `mzta-background.js` gathers email data (via Thunderbird APIs)
4. Each `{%id%}` token in the prompt string is replaced with the resolved value
5. If a value cannot be resolved, `default_value` is used as fallback

## Adding a New Built-in Placeholder

1. Add the object to the `defaultPlaceholders` array in `js/mzta-placeholders.js`
2. Add the `name` i18n key to `_locales/en/messages.json` as `placeholder_<id>` (or choose a descriptive key)
3. Implement the resolution logic in the relevant section of `mzta-background.js`
