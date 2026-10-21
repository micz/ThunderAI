// The actions on an answer in a summary session: api_send carries action "0" (nothing to insert)
// and a prompt_info with headerMessageId and summaryTabId. Usage display on (its default).
//
// Spec 01 "The rich-text layer" closing paragraphs (the "save as summary" button closes over the
// answer snapshot), "Transcript DOM contract" ("Self-closing chatgpt_close must be fire-and-forget":
// every button that finishes an action - save-summary included - ends by closing its own window;
// the save call awaited first). Spec 07 "Two things the picker deliberately bypasses" (a summary
// session and a picker session are mutually exclusive). Spec 04 "Rendering in the chat window" (the
// chip after Copy and Save as Summary; only Close follows it).

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { webchatTests } from '../../helpers/known-issues/webchat.mjs';
import {
    openWebchat,
    apiSend,
    typeAndSend,
    botTurns,
    answerEls,
    actionBar,
    toolbar,
    commandNames,
    sentCommands,
} from '../../webchat/webchat-page.mjs';

const { ctx, worker } = await openWebchat({
    commands: {
        chatgpt_saveSummary: () => true,
        chatgpt_close: () => true,
    },
});
after(() => ctx.close());
const k = webchatTests('12');

const S_SNAP = 'spec 01 "The rich-text layer — `js/lib/mzta-html-lines.js` (classic) + `js/mzta-richtext.js` (module)"';
const S_DOM = 'spec 01 "Transcript DOM contract"';
const S_USAGE = 'spec 04 "Rendering in the chat window"';
const S_ACT = 'spec 01 "Actions on an answer"';

const norm = html => new ctx.window.DOMParser().parseFromString(html, 'text/html').body.innerHTML.replace(/>\s+</g, '><').trim();

await apiSend(ctx, { prompt: 'Summarize', action: '0', tabId: 5, mailMessageId: 12,
    prompt_info: { headerMessageId: 'abc@example.com', summaryTabId: 9, use_diff_viewer: '0' } });
await worker.stream(ctx, ['The mail asks for a meeting.\n- Monday\n- Tuesday']);
const bar = () => actionBar(botTurns(ctx)[0]);
const msg = key => ctx.ctl.browser.i18n.getMessage(key);
/** What a compact toolbar holds, in order: each button by its label, the usage chip as "chip". */
const toolKinds = tools => [...tools.children].map(el => el.classList.contains('mzta-usage') ? 'chip' : el.getAttribute('aria-label'));

k.test('no-insert', S_DOM, 'action "0": nothing to insert, so no "use this answer" button', () => {
    assert.equal(bar().querySelector('split-button'), null);
});

k.test('order', S_USAGE, 'the bar reads Copy, Save as Summary, the usage chip, Close', () => {
    const kinds = [...bar().children].map(el =>
        el.classList.contains('copy_btn') ? 'copy'
            : el.classList.contains('save_summary_btn') ? 'save'
                : el.classList.contains('mzta-usage') ? 'chip'
                    : el.classList.contains('close_btn') ? 'close' : el.localName);
    assert.deepEqual(kinds, ['copy', 'save', 'chip', 'close']);
});

k.test('save', S_SNAP, 'Save as Summary sends chatgpt_saveSummary with the answer snapshot for that message, then closes the window', async () => {
    const since = ctx.ctl.sent.length;
    await ctx.click(bar().querySelector('.save_summary_btn'));
    assert.deepEqual(commandNames(ctx, since), ['chatgpt_saveSummary', 'chatgpt_close']);
    const save = sentCommands(ctx, 'chatgpt_saveSummary').at(-1);
    assert.equal(norm(save.text), norm(answerEls(botTurns(ctx)[0])[0].innerHTML));
    assert.equal(save.headerMessageId, 'abc@example.com');
    assert.deepEqual(sentCommands(ctx, 'chatgpt_close').at(-1), { command: 'chatgpt_close', window_id: 1 });
});

k.test('save-target', S_ACT, 'chatgpt_saveSummary names its target: the headerMessageId and the summaryTabId (9, not the tab 5 of the prompt), besides the text, and nothing else', () => {
    const save = sentCommands(ctx, 'chatgpt_saveSummary').at(-1);
    assert.deepEqual(Object.keys(save).sort(), ['command', 'headerMessageId', 'tabId', 'text']);
    assert.equal(save.tabId, 9);
});

k.test('toolbar-summary', S_ACT, 'once a newer answer arrives, the compact toolbar of a summary answer holds Copy and the usage chip only: no Save as Summary', async () => {
    await typeAndSend(ctx, 'Shorter');
    await worker.stream(ctx, ['A meeting, Monday or Tuesday.']);
    assert.equal(actionBar(botTurns(ctx)[0]), null);
    assert.deepEqual(toolKinds(toolbar(botTurns(ctx)[0])), [msg('apiwebchat_copy'), 'chip']);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
