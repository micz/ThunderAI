// The SmartBar in the message display (js/mzta-smartbar-script.js), loaded after the scripts
// mzta-background.js registers before it, on a mail displayed as message "bar-A@example.com". The
// background's answers are scripted here; what the background does is the background area's
// (tests/background/44-smartbar).
//
// Spec 10 "Bar": a shadow-DOM host after ThunderAI's panels (#mzta-container), nothing when the
// feature is off or the mode is disabled; compact mode is an icon that opens the bar, expanded mode
// the bar at once; the state of the message comes from smartbar_get_state at load; the bar has no
// link to the feature page.
// Spec 10 "Keyboard": Enter sends, Shift+Enter is a new line, a key during an IME composition does
// nothing, no key typed in the bar reaches the page (Thunderbird's single-key shortcuts), ArrowUp in
// an empty bar recalls the last instruction, Escape closes the compact bar; an instruction carries
// the selected text (the compose operation's selected_text).
// Spec 10 "Result lines": one line per operation with its state, Stop on a running one, Retry /
// Remove on an error (Open in chat for a json error), the reports, the unrecognized part, "nothing
// matched" with the available operations; an update with an older seq or for another message is
// ignored. Spec 10 "Compose": the compose line named by its type, "compose window opened" with the
// recipient to add as a reminder. The line texts come from js/lib/mzta-smartbar-lines.js, loaded
// before the bar as the background registers it. A record of the chat (spec 10 "Chat"): a draft
// and a free answer each a line with Open in chat; Stop names the record; Open in chat on a json
// error names the record and the line (the chat prefills the instruction); the Stop of the routing
// line names the record.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import {
    assertHarnessClean,
    msg,
} from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    CONTENT_SCRIPTS,
    DISPLAY_URL,
    openMailDocument,
    sentCommands,
} from '../../compose/compose-doc.mjs';

const ID = 'bar-A@example.com';
const OTHER = 'bar-B@example.com';
const S_BAR = 'spec 10 "Bar"';
const S_KEYS = 'spec 10 "Keyboard"';
const S_LINES = 'spec 10 "Result lines"';

const config = { enabled: true, mode: 'compact', defaultDestination: 'execute', historySize: 20 };
const ok = () => ({ ok: true });
const ctx = await openMailDocument({
    url: DISPLAY_URL,
    displayedMessageId: ID,
    html: '<!DOCTYPE html><html><head></head><body><div class="moz-text-html">Hello, this is the mail.</div></body></html>',
    scripts: [...CONTENT_SCRIPTS, 'js/lib/mzta-smartbar-lines.js', 'js/mzta-smartbar-script.js'],
    commands: {
        smartbar_get_state: () => ({ config: { ...config }, seq: 0, headerMessageId: ID, state: null, suggestions: ['riassumi', 'traduci'] }),
        smartbar_run: ok,
        smartbar_stop: ok,
        smartbar_retry: ok,
        smartbar_dismiss: ok,
        smartbar_open_chat: ok,
        smartbar_confirm: ok,
        smartbar_cancel: ok,
        smartbar_open_page: ok,
        smartbar_placeholders: () => [],
    },
});
after(() => ctx.close());
const k = composeTests('21');

const host = () => ctx.document.getElementById('mzta-smartbar-host');
const root = () => host()?.shadowRoot;
const $ = sel => root().querySelector(sel);
const $$ = sel => [...root().querySelectorAll(sel)];
const hidden = node => node.classList.contains('hidden');
const textarea = () => $('textarea');
const lines = () => $$('.results .line').map(l => l.querySelector('.tx').textContent);
/**
 * A background command delivered to EVERY runtime.onMessage listener of the document, as Firefox
 * does. The core mock's dispatchMessage() stops at the first listener that answers, and
 * js/mzta-compose-script.js (registered first) answers every command it does not know with
 * Promise.resolve(false): through send() the bar's own listener would never be called.
 */
async function broadcast(message) {
    for (const fn of [...ctx.ctl.browser.runtime.onMessage._listeners]) {
        fn(structuredClone(message), { id: 'thunderai@micz.it' }, () => {});
    }
    await ctx.settle();
}
let seq = 0;
const update = (record, extra = {}) => broadcast({ command: 'smartbar_update', headerMessageId: ID, seq: ++seq,
    record, running: false, available: ['tag', 'summarize', 'translate'], ...extra });
const record = (over = {}) => ({ id: 1, messageId: ID, instruction: 'riassumi', state: 'done', operations: [], reports: [],
    unrecognized: null, errorType: null, error: null, dismissed: null, ...over });
async function key(name, init = {}) {
    const e = new ctx.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
    textarea().dispatchEvent(e);
    await ctx.settle();
    return e;
}
async function type(text) {
    textarea().value = text;
    await ctx.fire(textarea(), 'input');
}
const button = (lineIndex, cls) => $$('.results .line')[lineIndex].querySelector('button.' + cls);
const lastSent = command => sentCommands(ctx, command).at(-1);

// --- load and modes --------------------------------------------------------------------------

k.test('load', S_BAR, 'at load the bar asks for its state; its host is in the body, with an open shadow root', () => {
    assert.equal(sentCommands(ctx, 'smartbar_get_state').length, 1);
    assert.ok(host());
    assert.ok(root());
    assert.ok($('style'));
});

k.test('compact-closed', S_BAR, 'compact mode: the icon shows, the bar is closed', () => {
    assert.ok(!hidden($('.compact_row')));
    assert.ok(hidden($('.panel')));
});

k.test('compact-open', S_BAR, 'a click on the icon opens the bar, the collapse button closes it', async () => {
    await ctx.click($('.icon_btn'));
    assert.ok(hidden($('.compact_row')));
    assert.ok(!hidden($('.panel')));
    await ctx.click($('button.collapse'));
    assert.ok(hidden($('.panel')));
    await ctx.click($('.icon_btn'));
});

k.test('expanded', S_BAR, 'expanded mode: the bar is open with no icon and no collapse button', async () => {
    await broadcast({ command: 'smartbar_config', config: { ...config, mode: 'expanded' } });
    assert.ok(hidden($('.compact_row')));
    assert.ok(!hidden($('.panel')));
    assert.ok(hidden($('button.collapse')));
});

// --- keyboard ---------------------------------------------------------------------------------

k.test('enter-sends', S_KEYS, 'Enter sends the instruction to run, the bar empties', async () => {
    await type('  riassumi la mail  ');
    const e = await key('Enter');
    assert.equal(e.defaultPrevented, true);
    assert.deepEqual(lastSent('smartbar_run'), { command: 'smartbar_run', headerMessageId: ID, instruction: 'riassumi la mail', hasSelection: false, selection: '' });
    assert.equal(textarea().value, '');
});

k.test('shift-enter', S_KEYS, 'Shift+Enter is a new line: nothing is sent', async () => {
    const before = sentCommands(ctx, 'smartbar_run').length;
    await type('first line');
    const e = await key('Enter', { shiftKey: true });
    assert.equal(e.defaultPrevented, false);
    assert.equal(sentCommands(ctx, 'smartbar_run').length, before);
});

k.test('ime', S_KEYS, 'Enter during an IME composition sends nothing', async () => {
    const before = sentCommands(ctx, 'smartbar_run').length;
    await type('漢字');
    await key('Enter', { isComposing: true });
    assert.equal(sentCommands(ctx, 'smartbar_run').length, before);
    await type('');
});

k.test('no-page-keys', S_KEYS, 'no key typed in the bar reaches the page', async () => {
    const seen = [];
    const listener = e => seen.push(e.key);
    ctx.document.addEventListener('keydown', listener);
    ctx.window.addEventListener('keydown', listener);
    await key('j');
    await key('Delete');
    ctx.document.removeEventListener('keydown', listener);
    ctx.window.removeEventListener('keydown', listener);
    assert.deepEqual(seen, []);
});

k.test('arrow-up', S_KEYS, 'ArrowUp in an empty bar recalls the last instruction', async () => {
    await type('');
    await key('ArrowUp');
    assert.equal(textarea().value, 'riassumi la mail', 'the instruction just sent is the newest');
    await type('');
});

k.test('suggestions', S_KEYS, 'typing offers the matching past instructions; Escape closes the list', async () => {
    await type('tra');
    assert.ok(!hidden($('.suggest')));
    assert.deepEqual($$('.suggest li').map(li => li.textContent), ['traduci']);
    await key('Escape');
    assert.ok(hidden($('.suggest')));
    await type('');
});

// --- result lines -------------------------------------------------------------------------------

k.test('routing', S_LINES, 'while the router works: one routing line with Stop, a red square in place of its state symbol with the "Stop" tooltip', async () => {
    await update(record({ state: 'running' }), { running: true });
    assert.deepEqual(lines(), [msg('smartbar_routing')]);
    assert.ok(!hidden($('button.stop')));
    const line0 = $$('.results .line')[0];
    const st = line0.firstElementChild;
    assert.equal(st, button(0, 'stop'), 'Stop is the first element of the line, the state symbol');
    assert.ok(st.classList.contains('st'));
    assert.ok(st.querySelector('.stop_square'));
    assert.equal(st.title, msg('smartbar_stop'));
    assert.equal(st.getAttribute('aria-label'), msg('smartbar_stop'));
    assert.equal(line0.querySelectorAll('button').length, 1, 'no Stop on the right of the line');
    await ctx.click(button(0, 'stop'));
    // It names the record: a message of the chat shown in the bar is stopped too.
    assert.deepEqual(lastSent('smartbar_stop'), { command: 'smartbar_stop', headerMessageId: ID, recordId: 1 });
});

k.test('operation-lines', S_LINES, 'one line per operation; Stop on a running one names its index', async () => {
    await update(record({ state: 'running', operations: [
        { index: 0, id: 'summarize', state: 'done' },
        { index: 1, id: 'translate', state: 'running' },
    ] }), { running: true });
    assert.deepEqual(lines(), [msg('smartbar_result_summary_ready'), msg('smartbar_line_running', [msg('smartbar_op_translate')])]);
    assert.equal($$('.results .line')[1].firstElementChild, button(1, 'stop'), 'Stop on the left, in place of the state symbol');
    await ctx.click(button(1, 'stop'));
    assert.deepEqual(lastSent('smartbar_stop'), { command: 'smartbar_stop', headerMessageId: ID, recordId: 1, index: 1 });
});

k.test('dismiss-symbol', S_LINES, 'a done line is dismissed from its state symbol, a button with the "Dismiss" tooltip; no × button', async () => {
    await update(record({ id: 12, operations: [{ index: 0, id: 'summarize', state: 'done' }] }));
    const line0 = $$('.results .line')[0];
    const st = line0.querySelector('.st');
    assert.equal(st.tagName, 'BUTTON');
    assert.equal(st.textContent, '✔');
    assert.equal(st.title, msg('smartbar_dismiss_line'));
    assert.equal(st.getAttribute('aria-label'), msg('smartbar_dismiss_line'));
    assert.equal(line0.querySelectorAll('button').length, 1, 'the symbol is the only button of the line');
    await ctx.click(st);
    assert.deepEqual(lastSent('smartbar_dismiss'), { command: 'smartbar_dismiss', headerMessageId: ID, recordId: 12, what: 0 });
});

k.test('error-line', S_LINES, 'an operation in error: Retry and Remove are symbols right after the ⚠, with tooltips, and name the record and the index', async () => {
    await update(record({ id: 2, state: 'error', operations: [{ index: 0, id: 'tag', state: 'error', error: 'boom', errorType: 'api' }] }));
    assert.deepEqual(lines(), [msg('smartbar_line_error', [msg('smartbar_op_tag'), 'boom'])]);
    assert.equal(button(0, 'chat'), null);
    const kids = [...$$('.results .line')[0].children];
    assert.deepEqual(kids.map(n => n.classList[0] === 'st' ? 'st' : n.classList.contains('retry') ? 'retry' : n.classList.contains('remove') ? 'remove' : n.className),
        ['st', 'retry', 'remove', 'tx'], 'the ⚠, Retry, Remove, then the text: nothing on the right');
    assert.equal(button(0, 'retry').title, msg('smartbar_retry'));
    assert.equal(button(0, 'retry').getAttribute('aria-label'), msg('smartbar_retry'));
    assert.equal(button(0, 'remove').title, msg('smartbar_remove'));
    assert.equal(button(0, 'remove').getAttribute('aria-label'), msg('smartbar_remove'));
    await ctx.click(button(0, 'retry'));
    assert.deepEqual(lastSent('smartbar_retry'), { command: 'smartbar_retry', headerMessageId: ID, recordId: 2, index: 0, hasSelection: false, selection: '' });
    await ctx.click(button(0, 'remove'));
    assert.deepEqual(lastSent('smartbar_dismiss'), { command: 'smartbar_dismiss', headerMessageId: ID, recordId: 2, what: 0 });
});

k.test('json-error', S_LINES, 'a router json error offers Open in chat, naming the record: the chat prefills its instruction', async () => {
    await update(record({ id: 3, instruction: 'do the thing', state: 'error', errorType: 'json', error: 'not JSON' }));
    assert.deepEqual(lines(), [msg('smartbar_line_router_error', ['not JSON'])]);
    await ctx.click(button(0, 'chat'));
    assert.deepEqual(lastSent('smartbar_open_chat'), { command: 'smartbar_open_chat', headerMessageId: ID, fromError: { recordId: 3, index: null } });
});

k.test('reports-unrecognized', S_LINES, 'the reports and the unrecognized part get their own lines', async () => {
    await update(record({ id: 4, operations: [{ index: 0, id: 'summarize', state: 'done' }],
        reports: [{ kind: 'unavailable', id: 'translate' }], unrecognized: 'forward it to Marco' }));
    assert.deepEqual(lines(), [
        msg('smartbar_result_summary_ready'),
        msg('smartbar_report_unavailable', ['translate']),
        msg('smartbar_unrecognized', ['forward it to Marco']),
    ]);
});

k.test('nothing-matched', S_LINES, 'nothing matched: the line lists the operations available', async () => {
    await update(record({ id: 5, instruction: 'archive' }), { available: ['summarize'] });
    assert.deepEqual(lines(), [msg('smartbar_nothing_matched') + ' ' + msg('smartbar_available_operations', [msg('smartbar_op_summarize')])]);
});

k.test('compose-lines', S_LINES, 'compose: a line named by its type; done says the compose window opened, with the recipient to add', async () => {
    await update(record({ id: 6, state: 'running', operations: [
        { index: 0, id: 'tag', state: 'done', result: { tags: ['urgent'] } },
        { index: 1, id: 'compose', params: { type: 'reply_all' }, state: 'running' },
    ] }), { running: true });
    assert.deepEqual(lines(), [msg('smartbar_result_tags_added', ['urgent']), msg('smartbar_line_running', [msg('smartbar_op_compose_reply_all')])]);
    const done = [
        { index: 0, id: 'compose', params: { type: 'reply' }, state: 'done', result: { type: 'reply', recipient: '' } },
        { index: 1, id: 'compose', params: { type: 'reply_all' }, state: 'done', result: { type: 'reply_all', recipient: '' } },
        { index: 2, id: 'compose', params: { type: 'forward' }, state: 'done', result: { type: 'forward', recipient: 'Marco' } },
        { index: 3, id: 'compose', params: { type: 'new' }, state: 'done', result: { type: 'new', recipient: 'the supplier' } },
    ];
    await update(record({ id: 7, operations: done }));
    assert.deepEqual(lines(), [
        msg('smartbar_result_compose_opened', [msg('smartbar_op_compose_reply')]),
        msg('smartbar_result_compose_opened', [msg('smartbar_op_compose_reply_all')]),
        msg('smartbar_result_compose_opened_recipient', [msg('smartbar_op_compose_forward'), 'Marco']),
        msg('smartbar_result_compose_opened_recipient', [msg('smartbar_op_compose_new'), 'the supplier']),
    ]);
    assert.equal(lines()[1], 'Reply to all: compose window opened');
    assert.equal(lines()[2], 'Forward: compose window opened — recipient to add: Marco');
});

k.test('compose-json-error', S_LINES, 'a compose line in json error: Retry, Remove and Open in chat naming the record and the line', async () => {
    await update(record({ id: 8, instruction: 'reply nicely', state: 'error', operations: [
        { index: 0, id: 'compose', params: { type: 'reply' }, state: 'error', error: 'not JSON', errorType: 'json' },
    ] }));
    assert.deepEqual(lines(), [msg('smartbar_line_error', [msg('smartbar_op_compose_reply'), 'not JSON'])]);
    assert.ok(button(0, 'retry'));
    await ctx.click(button(0, 'chat'));
    assert.deepEqual(lastSent('smartbar_open_chat'), { command: 'smartbar_open_chat', headerMessageId: ID, fromError: { recordId: 8, index: 0 } });
});

k.test('chat-records', S_LINES, 'a record of the chat: a draft reads "draft ready in the chat", a free answer "Answered in the chat.", both with Open in chat', async () => {
    await update(record({ id: 9, source: 'chat', operations: [
        { index: 0, id: 'compose', params: { type: 'reply' }, state: 'drafted', result: { type: 'reply', recipient: '' } },
    ] }));
    assert.deepEqual(lines(), [msg('smartbar_line_drafted', [msg('smartbar_op_compose_reply')])]);
    assert.equal(lines()[0], 'Reply: draft ready in the chat');
    await ctx.click(button(0, 'chat'));
    assert.deepEqual(lastSent('smartbar_open_chat'), { command: 'smartbar_open_chat', headerMessageId: ID });
    await update(record({ id: 10, source: 'chat', instruction: 'who is the sender?', hasAnswer: true }), { available: ['summarize'] });
    // Not "Nothing matched": the message was answered in the chat.
    assert.deepEqual(lines(), [msg('smartbar_answered_in_chat')]);
    await ctx.click(button(0, 'chat'));
    assert.deepEqual(lastSent('smartbar_open_chat'), { command: 'smartbar_open_chat', headerMessageId: ID });
    await ctx.click(button(0, 'dismiss'));
    assert.deepEqual(lastSent('smartbar_dismiss'), { command: 'smartbar_dismiss', headerMessageId: ID, recordId: 10, what: 'unrecognized' });
    await update(record({ id: 11, source: 'chat', operations: [
        { index: 0, id: 'deliver_draft', params: {}, state: 'done', result: { type: 'forward', recipient: 'Marco' } },
    ] }));
    assert.deepEqual(lines(), ['Forward: compose window opened — recipient to add: Marco']);
});

k.test('stale-updates', S_LINES, 'an update with an older seq, or for another message, is ignored', async () => {
    const shown = lines();
    await broadcast({ command: 'smartbar_update', headerMessageId: ID, seq: seq - 1, record: record({ id: 9, state: 'error', errorType: 'api', error: 'old' }) });
    await broadcast({ command: 'smartbar_update', headerMessageId: OTHER, seq: ++seq, record: record({ id: 9, messageId: OTHER, state: 'error', errorType: 'api', error: 'other' }) });
    assert.deepEqual(lines(), shown);
});

k.test('selection-sent', S_KEYS, 'with text selected in the mail, the instruction carries the selection and its text', async () => {
    const mail = ctx.document.querySelector('.moz-text-html');
    const range = ctx.document.createRange();
    range.setStart(mail.firstChild, 7);
    range.setEnd(mail.firstChild, 11);
    const sel = ctx.document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    ctx.document.dispatchEvent(new ctx.window.Event('selectionchange'));
    await type('reply about this');
    await key('Enter');
    assert.deepEqual(lastSent('smartbar_run'), { command: 'smartbar_run', headerMessageId: ID, instruction: 'reply about this', hasSelection: true, selection: 'this' });
    sel.removeAllRanges();
    ctx.document.dispatchEvent(new ctx.window.Event('selectionchange'));
});

k.test('no-details', S_BAR, 'the bar has no Details link', () => {
    assert.equal($('a.details'), null);
    assert.equal($('.footer'), null);
});

k.test('disabled', S_BAR, 'the feature turned off removes the bar', async () => {
    await broadcast({ command: 'smartbar_config', config: { ...config, enabled: false } });
    assert.equal(host(), null);
});

k.test('harness-clean', S_BAR, 'the content scripts ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
