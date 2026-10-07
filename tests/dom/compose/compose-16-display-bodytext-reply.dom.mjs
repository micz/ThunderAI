// Group A on a live message display: a reply written in Body Text mode, opened from the sent folder
// (captured/html_compose_bodytext_reply_live.html). Its lines are text and <br> directly in
// div.moz-text-html, then the citation div, the blockquote type=cite, and the signature div with
// its own nested markup (div#Signature > p > span > b). The shared checks are in
// tests/compose/display-live.mjs.

import { liveDisplayTests } from '../../compose/display-live.mjs';

await liveDisplayTests('16', {
    file: 'html_compose_bodytext_reply_live.html',
    text: 'Hello Bob,\nsee you\ntomorrow.\nOn 08/09/2026 12:10, Example wrote:\naggiungi un task con descrizione '
        + '"pippo lavora" con titolo "fai lavorare pippo", location "paperopoli" e scadenza domani alle 15:00.\n--\nExample',
    header: ['Subject:', 'Re: test task'],
});
