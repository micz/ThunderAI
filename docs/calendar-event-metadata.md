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
exact names only, removes duplicates and ignores invalid or unknown entries. The
`capabilities.categories.maxCount` of the calendar that receives the event limits the
result; when the selected calendar cannot receive it, that is the first eligible one in
the calendar list's order, as Thunderbird's dialog picks it, and with no eligible
calendar Sparks reports an error instead of opening nothing; a native warning
explains any resulting loss. Invalid optional metadata does not prevent the rest
of the event from being opened for review.

Links must be absolute HTTP or HTTPS URLs. URL parsing rejects malformed values,
embedded credentials, control characters, whitespace and backslashes. Normalized
URLs are deduplicated while retaining their query and fragment. Sparks constructs
`CalAttachment` URI attachments with `Services.io.newURI()` and `addAttachment()`;
it never downloads files or attaches binary contents. Valid links are also kept
in the plain text description, without repeating one it already contains, even
wrapped in punctuation or Markdown. The first link also fills the native event
`URL` field, which holds a single link. If the calendar declares attachments unsupported,
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
ThunderAI logs the reason (timeout, invalid reply, no reply) to the console, without
any reply content. Older ThunderAI continues to use the existing message and version contracts.

## Turning it on in ThunderAI

This feature needs the matching ThunderAI change. There is no option: the prompt
decides, as it does for `attendees`.

- The shipped prompt asks for both, in any language. ThunderAI adds the instruction
  by code, as it does for the reminder: the shipped text stays as it is, and the
  names of your categories and the addresses of the message's links are sent to the
  AI provider.
- A prompt you edited asks for what it names: `{%calendar_categories%}` or a
  `"categories"` field, `{%mail_links%}` or a `"links"` field. Leave one out and the
  event does not get it, and its data is not sent.
- A saved prompt is never rewritten. If yours was saved by an earlier version whose
  shipped text has changed since, it counts as edited and gets neither: use **Reset
  to default** once.

When a field is asked, ThunderAI tells the AI that it must fill it: at least one
existing category, the closest one even if the fit is approximate, and every
relevant link, the video call first. It never invents a category. For example:

```text
Available categories (JSON): {%calendar_categories%}
Links found in the message, with their text and target (JSON): {%mail_links%}
```

The variable is resolved at send time using `JSON.stringify()`, preserving names
with accents, commas and quotes. It is offered in placeholder autocomplete. If
the catalogue is unavailable it becomes `[]`. You can keep `attendees: []` in
your own prompt; no attendee preference or additional metadata switch is needed.

`{%mail_links%}` lists the links the selection touches, else those of the message,
as a JSON array of `{text, url}`: the text the AI reads keeps what a link shows, not
where it goes. A selection made inside a link's text keeps that link. HTTP/HTTPS
targets only, the first 30, an image-only link described by its `alt`, and `[]` for
clipboard text. Elements hidden by the `hidden` attribute or by inline styles are
left out; CSS class rules are not resolved, so a link hidden that way is kept. These
addresses are sent to the AI provider, like the mail text.

ThunderAI also accepts `links` entries shaped like that list. When the model leaves
`links` out or gives no usable link, the links it wrote in the description are used,
in reading order.

## Observed on Google Calendar

On Thunderbird 159 with a Google calendar over CalDAV, for one synthetic event:

- `CATEGORIES` and `URL` survived the read-back after saving and a later edit on
  the Google site.
- The URI `ATTACH` was gone as soon as the event was saved, because Thunderbird
  re-reads an item from the server after writing it.
- `DESCRIPTION`, including its links, was kept.

CalDAV declares no attachment limit, so neither Thunderbird nor Sparks can warn about
this loss. Keep links in the description and rely on `URL` for the main one.
Whether Google displays `URL` in its own interface was not checked.

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

Native UI, save/reopen, CalDAV and the remaining Google checks stay **NOT VERIFIED**
until those steps are actually executed. A sandbox or Snap startup refusal is a blocker
to record, not a reason to change system confinement.
