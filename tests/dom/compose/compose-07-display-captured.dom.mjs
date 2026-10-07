// Group A in the message display, on the captured HTML mail (captured/mail_html_reading.txt, its
// body in Thunderbird's div.moz-text-html wrapper). The same script reads the displayed message:
// spec 01 "Which path actually feeds {%mail_text_body%}" (getTextOnly is the interactive path,
// "compose script" is a misnomer). Then the add-on draws everything it can draw into that message -
// the summary, the translation, the spam badge, the generic error, the alert dialog - and the user
// runs a prompt: none of it may be read back (MZTA_INJECTED_SELECTORS), on any reading command.
//
// Spec 03 "Newline contract of the body placeholders"; spec 01 "The text/HTML rule" (getFullHtml is
// the markup); spec 01 "getCleanBodyHtml() returns a DETACHED clone" (the reading never edits the
// live document).

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    DISPLAY_URL,
    injected,
    openMailDocument,
    readCapture,
    select,
    send,
} from '../../compose/compose-doc.mjs';

// ISO-8859-1 bytes behind a utf-8 header: the capture was re-saved after anonymizing (README).
const capture = readCapture('mail_html_reading.txt', { encoding: 'latin1' });
const MSG_ID = capture.headers['message-id'].replace(/^<|>$/g, '');
const ctx = await openMailDocument({
    url: DISPLAY_URL,
    displayedMessageId: MSG_ID,
    html: '<!DOCTYPE html><html><head></head><body><div class="moz-text-html" lang="x-unicode">'
        + capture.body + '</div></body></html>',
});
after(() => ctx.close());
const { cleanupNewlines } = ctx.mods.utils;
const k = composeTests('07');

const S_PATH = 'spec 01 "Which path actually feeds `{%mail_text_body%}`"';
const S_BODY = 'spec 03 "Newline contract of the body placeholders"';
const S_TEXT_HTML = 'spec 01 "The text/HTML rule: stripped from the TEXT, never from the HTML"';
const S_DETACHED = 'spec 01 "`getCleanBodyHtml()` returns a DETACHED clone, so `innerText` does not work there"';

const TEXT = 'Buongiorno,\necco il riepilogo della settimana. Tutto procede secondo i piani e non ci sono '
    + 'criticità da segnalare al momento.\nGrazie.';
const read = async () => ({
    text: cleanupNewlines(await send(ctx, { command: 'getTextOnly' })),
    html: await send(ctx, { command: 'getFullHtml' }),
});
const bodyHtml = ctx.document.body.innerHTML;
let before;

k.test('text-body', S_BODY, 'the displayed mail\'s three paragraphs, one per line, the compact markup not welded', async () => {
    before = await read();
    assert.equal(before.text, TEXT);
});

k.test('full-html', S_TEXT_HTML, 'getFullHtml is the displayed body\'s markup', () => {
    assert.equal(before.html, bodyHtml);
});

k.test('reading-is-detached', S_DETACHED, 'reading leaves the displayed document as it was', () => {
    assert.equal(ctx.document.body.innerHTML, bodyHtml);
});

k.test('selected-text', 'spec 03 "Selection twins (`selected_text` / `selected_html`)"', 'a selection in the displayed mail is read as selected', async () => {
    select(ctx, 'riepilogo della settimana');
    assert.equal(await send(ctx, { command: 'getSelectedText' }), 'riepilogo della settimana');
    assert.equal(await send(ctx, { command: 'getSelectedHtml' }), 'riepilogo della settimana');
    ctx.window.getSelection().removeAllRanges();
});

k.test('draw-everything', S_PATH, 'the add-on draws its panels, badge and dialog into the displayed message', async () => {
    await send(ctx, { command: 'showSpamReport', data: { spamValue: 12, SpamThreshold: 70, explanation: 'Looks fine.', headerMessageId: MSG_ID } });
    await send(ctx, { command: 'showSummary', data: { summary: 'A weekly update: all on track.', summary_html: '<p>A weekly <b>update</b>.</p>', headerMessageId: MSG_ID } });
    await send(ctx, { command: 'showTranslation', data: { translated_text: 'Good morning, here is the summary.', translated_subject: 'Weekly update', lang: 'en', headerMessageId: MSG_ID } });
    await send(ctx, { command: 'showGenericError', data: { message: 'Tagging failed.', source: 'Add tags' } });
    await send(ctx, { command: 'sendAlert', curr_tab_type: 'mail', message: 'Select some text first.' });
    assert.ok(ctx.$('#mzta-summary-banner') && ctx.$('#mzta-translation-banner') && ctx.$('#mzta-toolbar-spam')
        && ctx.$('#mzta-generic-error') && ctx.$('dialog.mzta_dialog'));
    assert.equal(injected(ctx).length, 2, '#mzta-container and the dialog');
});

k.test('text-body-skips-injected', S_BODY, 'the body text reads the mail only', async () => {
    assert.equal(cleanupNewlines(await send(ctx, { command: 'getTextOnly' })), before.text);
});

k.test('full-html-skips-injected', S_TEXT_HTML, 'the HTML body carries none of the add-on\'s elements', async () => {
    assert.equal(await send(ctx, { command: 'getFullHtml' }), before.html);
});

k.test('harness-clean', S_PATH, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
