# Thunderbird WebExtensions Development Guidelines

> **Purpose:** This file provides operative guidelines for Claude when helping develop or modify ThunderAI. These rules override general AI assistant behavior and must be followed strictly.

## ThunderAI-Specific Context

- ThunderAI uses **Manifest Version 2** — do not suggest or apply any MV3 migration.
- No build tools, no transpilation, no npm — plain ES6 modules loaded directly.
- The manifest already uses `browser_specific_settings` (not `applications`).
- All module imports use relative paths with `.js` extension.
- The `mzta-` prefix is used for all core module filenames.

---

## Important Guidelines for AI Assistants

### 1. Always use `browser_specific_settings` in manifest.json

The `applications` manifest entry is deprecated. Always use `browser_specific_settings`:

```json
{
    "manifest_version": 2,
    "name": "ThunderAI",
    "browser_specific_settings": {
        "gecko": {
            "id": "thunderai@micz.it",
            "strict_min_version": "140.0"
        }
    }
}
```

### 2. Do not guess APIs by using Try-Catch

A widespread antipattern in AI-generated Thunderbird extensions:

```javascript
// WRONG - Never do this!
try {
  await browser.someApi.method({ guessedParam: value });
} catch (e) {
  try {
    await browser.someApi.method({ differentGuess: value });
  } catch (e2) {
    // Giving up silently — this makes debugging impossible
  }
}
```

**Why this is harmful:**
- Makes code unmaintainable
- Hides real errors from developers
- Makes debugging extremely difficult

**The correct approach:**
1. Read the API documentation FIRST
2. Use the exact parameter names and types specified
3. Only use try-catch for expected error conditions with proper handling
4. Never suppress errors without logging or handling them

### 3. Do not use Experiments unnecessarily

```javascript
// WRONG - Using Experiment when standard API exists
// Don't use Experiment just because you found example code using it

// RIGHT - Check if standard API can do it first
const folders = await browser.folders.query({ name: "Inbox" });
```

### 4. Handle file storage correctly

```javascript
// WRONG - Trying to use raw filesystem APIs
const fs = require('fs'); // Not available!

// RIGHT - Use storage.local with File objects
const file = new File([content], "data.txt", { type: "text/plain" });
await browser.storage.local.set({ file });
```

### 5. Do not use async listeners for the runtime.onMessage listener

See https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onMessage

### 6. Parse vCard, vTodo, vEvent and iCal strings using a 3rd party library

Follow https://webextension-api.thunderbird.net/en/mv2/guides/vcard.html to parse vCard, vEvent and vTodo strings.

### 7. Parse Mailbox Strings using messengerUtilities

Extract email addresses from mailbox strings like "John Doe <john@example.com>":

```javascript
const parsed = await browser.messengerUtilities.parseMailboxString(
  "John Doe <john@example.com>, Jane <jane@example.com>"
);

// Result:
// [
//   { name: "John Doe", email: "john@example.com" },
//   { name: "Jane", email: "jane@example.com" }
// ]

// Extract just emails:
const emails = parsed.map(p => p.email);
```

**Documentation:** https://webextension-api.thunderbird.net/en/mv2/messengerUtilities.html

**Options:**
- `preserveGroups`: Keep grouped hierarchies
- `expandMailingLists`: Expand Thunderbird mailing lists (requires `addressBook` permission)

### 8. Set correct `strict_min_version` entry

Make sure `manifest.json` has a `strict_min_version` entry matching the used functions. If a function added in Thunderbird 137 is used, it must be set to `137.0` or higher.

### 9. Always use background type "module"

Always use `type: "module"` for background scripts. This allows use of the `import` directive for ES6 modules, and non-ES6 libraries can still be loaded via the `scripts` array:

```json
// RIGHT - Always use type: "module"
"background": {
  "scripts": ["lib/some-non-ES6-lib.js", "background.js"],
  "type": "module"
}
```

Then in `background.js`, import libraries explicitly:
```javascript
// Import ES6 module with default export
import ICAL from "./lib/ical.js";

// Import ES6 module with named exports
import { someFunction, someConstant } from "./lib/somemodule.js";
```

### 10. Verify API return types — do not assume array access

Many Thunderbird APIs return wrapped objects, not direct arrays. Always verify the return type in the documentation before accessing the data.

**Common pitfall — MessageList:**
```javascript
// WRONG - getDisplayedMessages() returns MessageList, not an array
const [message] = await browser.messageDisplay.getDisplayedMessages(tabId);

// RIGHT - MessageList has a .messages array property
const { messages: [message] } = await browser.messageDisplay.getDisplayedMessages(tabId);
```

**Common pitfall — HeadersDictionary:**
```javascript
// WRONG - headers might not exist or might not be an array
let returnPath = headers["Return-Path"];

// RIGHT - keys are lowercase, values are always arrays
const returnPathArray = headers["return-path"];
const returnPath = returnPathArray?.[0] ?? null;
```

**APIs that return wrapped objects (NOT direct arrays):**

| API | Returns | Access Pattern |
|-----|---------|----------------|
| `messageDisplay.getDisplayedMessages()` | `MessageList` | `result.messages[0]` |
| `messages.list()` | `MessageList` | `result.messages[0]` |
| `messages.query()` | `MessageList` | `result.messages[0]` |
| `messages.getHeaders()` | `HeadersDictionary` | `result["header-name"][0]` |
| `messages.getFull()` | `MessagePart` | `result.headers["header-name"][0]` |

**APIs that return direct arrays:**

| API | Returns | Access Pattern |
|-----|---------|----------------|
| `tabs.query()` | array of Tab | `result[0]` |
| `mailTabs.query()` | array of MailTab | `result[0]` |
| `addressBooks.list()` | array of AddressBookNode | `result[0]` |
| `contacts.list()` | array of ContactNode | `result[0]` |
| `folders.query()` | array of MailFolder | `result[0]` |

---

## Official API Documentation

**Primary resource:** https://webextension-api.thunderbird.net/en/mv2/

Documentation exists for different channels:
- **Release (mv2):** https://webextension-api.thunderbird.net/en/mv2/
- **ESR (esr-mv2):** https://webextension-api.thunderbird.net/en/esr-mv2/

**Key feature:** Search functionality and cross-references between types and functions.

---

## Understanding Thunderbird Release Channels

### Standard Release Channel (Monthly)
- Update cadence: ~4 weeks
- A new major version with each release (`147.0`, `148.0`, ...)
- Gets new features and APIs (and bug fixes & security fixes)

### ESR Channel (Extended Support Release)
- Update cadence: 1 major update per year, with lots of versions "missing" in between (`115.*`, `128.*`, `140.*`, `153.*`, ...)
- Receives bug fixes & security fixes on regular basis alongside the major monthly releases, but as minor releases (`140.1`, `140.2`, ...)
- No new features or APIs

### For ThunderAI
- Target the Release channel for standard API usage.
- Target the ESR channel for add-ons relying on Experiment APIs. Targeting the Release channel with Experiments is acceptable *only* when the developer can guarantee required monthly updates.

---

## Experiment APIs

### What Are Experiment APIs?
Experiment APIs allow add-ons to access Thunderbird's core internals directly. They have full access to modify everything in Thunderbird.

### Critical Rules for Experiments

**1. Avoid Experiments Unless Absolutely Necessary**
- Standard WebExtension APIs should always be your first choice
- Only use Experiments when standard APIs genuinely cannot accomplish your goal

**2. Experiments Require Updates for Each Major Version**
- This was manageable with ESR (1x/year)
- Became unsustainable with monthly Release channel (12x/year)

**3. When Suggesting Experiments**
- Only if standard APIs cannot accomplish the core goal
- Developer must explicitly understand the maintenance burden
- **Target ESR channel specifically**
- Reference `esr-mv2` documentation

### Available semi-official Experiment APIs

#### Calendar Experiment API

Use this instead of creating a custom Experiment for calendar interactions.

**Use cases:**
- Reading existing event/task items from Thunderbird's calendar
- Listening for item updates
- Creating/updating/deleting items

**Setup requirements:**
1. Temporarily clone the [webext-experiments](https://github.com/thunderbird/webext-experiments/) repository.
2. Add all `experiment_apis` entries found in `calendar/manifest.json` to the project's `manifest.json`.
3. Copy `calendar/experiments/calendar/` into the project as `experiments/calendar/`. Do not modify these files.

**Note:** Always request iCal format:

```javascript
// Always consult schema first, if this example is still correct
browser.calendar.items.onCreated.addListener(
  async (calendarItem) => {
    if (calendarItem.type === "task") {
      console.log("Task in iCal format:", calendarItem.item);
    }
  },
  { returnFormat: "ical" }
);
```

### Other Experiment Repositories

- https://github.com/thunderbird/webext-support — Helper APIs and modules
- https://github.com/thunderbird/webext-examples — Example extensions (includes some Experiments)

---

## Native File System Access

### Current Limitations
Native filesystem access is NOT available in Thunderbird WebExtensions.

### Recommended Approach

**For data persistence:**
```javascript
await browser.storage.local.set({ myData: someValue });
const data = await browser.storage.local.get("myData");
```

**For user file input:**
```javascript
const file = new File([content], "filename.txt", { type: "text/plain" });
await browser.storage.local.set({ file });

// Retrieve later
const data = await browser.storage.local.get("file");
console.log(data.file.name);
```

**Important:** File objects can be stored directly in `browser.storage.local` without serialization.

---

## Add-on Review Requirements

**Review policy:** https://thunderbird.github.io/atn-review-policy/

### Key Requirements

**1. No Build Tools**
- Include 3rd party libraries directly (don't use webpack, rollup, etc.)
- Include a `VENDOR.md` file documenting all 3rd party libraries with links to exact versions (not "latest"). Example: https://webextension-api.thunderbird.net/en/mv2/guides/vcard.html

**2. Permissions**
- Only request permissions you actually need
- The `tabs` and `activeTab` permissions are almost never needed in Thunderbird
- Unnecessary permissions may cause rejection during ATN review

---

## Example Repositories

- https://github.com/thunderbird/webext-examples — Official example extensions
- https://github.com/thunderbird/webext-support — Support libraries and helpers

Use these to see proper code structure, learn common patterns, and understand best practices.

---

## Mandatory Checklist Before Providing Code

Before providing any code, verify ALL of these:

- [ ] Consulted official API documentation — do NOT guess methods or parameters
- [ ] NO try-catch blocks for guessing API parameters
- [ ] Used 3rd party libraries or API methods for parsing — minimize manual string parsing or regex
- [ ] Used 3rd party libraries are the most recent stable version
- [ ] Event listeners registered at file scope (NOT inside init function)
- [ ] VENDOR.md includes ALL dependencies with exact version URLs
- [ ] Used `browser_specific_settings` (NOT deprecated `applications`)
- [ ] Included proper error handling
- [ ] Code has comments explaining the approach
- [ ] No hardcoded user-facing strings — use the i18n API (`_locales/en/messages.json` only)
- [ ] Add-on fulfills all requirements in the "Add-on Review Requirements" section
- [ ] All guidelines in "Important Guidelines for AI Assistants" are followed
- [ ] Manifest uses correct `strict_min_version`
- [ ] If using Experiments: manifest has `strict_max_version` targeting current ESR (fetch https://webextension-api.thunderbird.net/en/esr-mv2/ to get the major version, then use format `"<major>.*"`)

If ANY checkbox is unchecked, DO NOT provide the code. Fix it first.

---

## Mandatory 3rd Party Library Audit

For EACH 3rd party library included in the project:

- [ ] Inspect the actual file to determine the export type:
  - **ES6 default export:** Look for `export default` → use `import LibName from "./lib/file.js"`
  - **ES6 named exports:** Look for `export { name1, name2 }` → use `import { name1, name2 } from "./lib/file.js"`
  - **UMD/IIFE (no ES6 exports):** Look for `(function(root, factory)` or assignments to `window`/`globalThis` → load via `scripts` array in manifest
- [ ] Always prefer the minified module version
- [ ] Output a library audit table:

| Library | File | Module Type | Import Statement |
|---------|------|-------------|------------------|
| ical.js | lib/ical.js | ES6 default | `import ICAL from "./lib/ical.js"` |

- [ ] Update VENDOR.md with the correct file path and version URL

---

## Mandatory API Audit

Before finalizing any code:

- [ ] List all used API methods
- [ ] For EACH API method, fetch its documentation page: `https://webextension-api.thunderbird.net/en/mv2/<api-name>.html`
- [ ] For EACH API method, verify:
  - **Parameters:** Correct names and types
  - **Return type:** The actual type returned by the Promise
  - **Access pattern:** How to extract data from the return value
  - **Required permission:** What permission is needed in manifest.json
- [ ] Output an API audit table:

| API Method | Returns | Access Pattern | Required Permission |
|------------|---------|----------------|---------------------|
| `browser.messageDisplay.getDisplayedMessages()` | MessageList | `result.messages[0]` | messagesRead |
| `browser.messages.getHeaders()` | HeadersDictionary | `result["header-name"][0]` | messagesRead |
| `browser.mailTabs.query()` | array of MailTab | `result[0]` | (none) |
| `browser.storage.local.get` | object | `result.keyName` | storage |
| `browser.i18n.getMessage` | string | direct | (none) |

- [ ] Update the permissions entry in manifest.json to include ALL required permissions

---

## Getting Help

- **Developer documentation:** https://developer.thunderbird.net/
- **Support forum:** https://thunderbird.topicbox.com/groups/addons
- **Matrix chat:** #tb-addon-developers:mozilla.org
