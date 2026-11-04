# Calendar categories and URI links

Events accept two optional JSON fields:

```json
{
  "categories": ["Séminaire"],
  "links": ["https://example.org/programme.pdf?day=1#agenda"]
}
```

Categories must already exist in Thunderbird. No catalogue entries are created.
Sparks reads `cal.category.fromPrefs()` again when constructing the event, accepts
exact names only, removes duplicates and ignores invalid or unknown entries. A
calendar's `capabilities.categories.maxCount` limits the result; a native warning
explains any resulting loss. Invalid optional metadata does not prevent the rest
of the event from being opened for review.

Links must be absolute HTTP or HTTPS URLs. URL parsing rejects malformed values,
embedded credentials, control characters, whitespace and backslashes. Normalized
URLs are deduplicated while retaining their query and fragment. Sparks constructs
`CalAttachment` URI attachments with `Services.io.newURI()` and `addAttachment()`;
it never downloads files or attaches binary contents. Valid links are also kept
in the plain text description. If the calendar declares attachments unsupported,
or an attachment cannot be constructed, a native warning explains that the links
remain in the description.

The native event dialog always opens before saving. Empty `attendees: []` adds no
participants. Existing dates, all-day flag, timezone, location and reminders keep
their previous meanings. Diagnostics for metadata report fields and counts, not
mail contents or URLs.

## Companion capability contract

Only messages from `thunderai@micz.it` are accepted. `checkPresence` still returns
the manifest version string. A separate `{ "action": "getCapabilities" }` request
returns:

```json
{
  "calendarEventFields": ["startDate", "endDate", "summary", "location", "description", "forceAllDay", "attendees", "timezone", "use_timezone", "reminderMinutes", "categories", "links"],
  "calendarCategories": ["Séminaire"]
}
```

`CalendarTools.getCalendarCategories()` supplies the current native category list.
The old event message remains a JSON string in `calendar_event_data`. No calendar
identifier from that JSON is used. New ThunderAI validates capability responses
and bounds each request to two seconds. Older Sparks or an invalid/unanswered
response disables only the new native fields; valid links stay in the description.
Older ThunderAI continues to use the existing message and version contracts.

## Prompt configuration in ThunderAI

This feature needs the matching ThunderAI change that implements
`{%calendar_categories%}`. In **Calendar Event settings**, update your existing
prompt deliberately; saved, custom and administrator-managed texts are not
automatically replaced. Other locales are maintained through Weblate.

For example, add the following instructions and the two fields to your existing
event JSON example:

```text
Available categories (JSON): {%calendar_categories%}
Choose only exact names from that list, and only if justified by the text.
Never invent a category. Return categories: [] if none matches.
Return links as an array of relevant absolute HTTP or HTTPS URLs, or [].
Keep these URLs in the description too. Do not download files.
```

The variable is resolved at send time using `JSON.stringify()`, preserving names
with accents, commas and quotes. It is offered in placeholder autocomplete. If
the catalogue is unavailable it becomes `[]`. You can keep `attendees: []` in
your own prompt; no attendee preference or additional metadata switch is needed.

## Validation

The Node tests execute the real privileged `implementation.js` with Thunderbird
doubles. They check category and attachment calls, provider limits, URI handling,
legacy fields and `createEventWithDialog()`. They do not exercise XPCOM, the real
window, a calendar provider, persistence or synchronization.

Before marking native validation complete:

1. Start Thunderbird with a separate disposable profile. Use synthetic messages
   and a local test calendar. Load both add-ons temporarily through **Debug
   Add-ons**, selecting each `manifest.json`.
2. Create categories including `Séminaire` and `Name, "quoted"`. Run extraction
   from a synthetic mail and from the clipboard. Inspect the outgoing prompt:
   it must contain the JSON list and no remaining category token.
3. Check dates, timezone, all-day flag, reminder, location, description, zero
   attendees when requested, category selections and URI attachments. Edit them,
   cancel one event (no item saved), then save another and reopen it.
4. Change the native catalogue while generation is pending. Only names still
   present at creation may survive. Exercise a calendar declaring a category
   limit and one declaring attachments unsupported; verify the warnings and the
   description fallback.
5. Repeat on a disposable CalDAV calendar. Save, synchronize, close/reopen and
   refresh from the server. Inspect the same event UID in the server's iCalendar
   resource: compare `CATEGORIES`, URI-valued `ATTACH` and `DESCRIPTION`, then
   confirm the values after a fresh client read. Record Thunderbird/provider
   versions, UID and redacted evidence, without storing server credentials.
6. Test Google Calendar only in a dedicated test calendar. Record provider-specific
   losses or differences; do not assume URI attachments survive synchronization.
7. Repeat with old Sparks: the event should still open, with links in the
   description and no unsupported native metadata fields.

Native UI, save/reopen, CalDAV and Google checks remain **NOT VERIFIED** until
those steps are actually executed. A sandbox or Snap startup refusal is a blocker
to record, not a reason to change system confinement.
