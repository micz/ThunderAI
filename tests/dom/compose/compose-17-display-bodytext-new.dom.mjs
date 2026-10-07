// Group A on a live message display: a new message written in Body Text mode, opened from the sent
// folder (captured/html_compose_bodytext_new_live.html). Its lines are text and <br> directly in
// div.moz-text-html, and the last one, "tomorrow.", is followed straight by the signature <div> with
// no <br> between: the block must open its own line (spec 01 "htmlBodyToPlainText() injects the line
// structure", pass 0). The shared checks are in tests/compose/display-live.mjs.

import { liveDisplayTests } from '../../compose/display-live.mjs';

await liveDisplayTests('17', {
    file: 'html_compose_bodytext_new_live.html',
    text: 'Hello Bob,\nsee you\ntomorrow.\n--\nExample',
    header: ['Subject:', 'test Compose HTML'],
});
