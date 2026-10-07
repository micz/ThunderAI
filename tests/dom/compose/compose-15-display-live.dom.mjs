// Group A on a live message display: an HTML mail (captured/html_display_live.html), its source
// indented, its lines <br> directly in div.moz-text-html. The shared checks are in
// tests/compose/display-live.mjs.

import { liveDisplayTests } from '../../compose/display-live.mjs';

await liveDisplayTests('15', {
    file: 'html_display_live.html',
    text: 'Ciao,\nquesto è invece il body text, cosa mi dici?\neV',
    header: ['Subject:', 'test body text'],
});
