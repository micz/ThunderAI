// The Activity tab of the SmartBar page (pages/smartbar/), no policy, with the background's
// answers modelled here: a running instruction from the bar, a chat message whose router answer
// was unreadable (json), a translation stopped by a rate limit, a finished reply.
//
// Spec 10 "Activity": the default filter (Running when something runs); the rows (subject,
// sender, the source, the instruction truncated with the whole text as its tooltip, each
// operation with its state, the elapsed time of a running row, the finish time of the others);
// the actions of each kind of row and the commands they send (Open, Stop, Stop of one
// operation, Retry of the instruction or of the failed operation, Remove, Open in chat only for a
// json error), the rate-limit countdown, Stop all and Remove all errors, "Show more"; the list
// read again when the background says the activity changed (smartbar_activity_changed); the note
// on the history with its link to the storage management page.
// What the background does with these commands, and the bar and badge it keeps in step, is
// tests/background/46-smartbar-activity.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import {
    openPage,
    assertHarnessClean,
} from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { holdLongTimers } from '../../ui/dom-helpers.mjs';
import { enText } from '../../ui/feature-page.mjs';

const NOW = Date.now();
const realSetTimeout = globalThis.setTimeout;
const LONG = 'Please summarize this email, tag it as urgent and then reply to everyone saying that I will call them tomorrow morning';
const model = {
    records: [
        {
            id: 4, state: 'running', live: true, source: 'bar', createdAt: NOW - 5000, finishedAt: null,
            subject: ['Invoice 42'], from: ['Ann Example <ann@example.com>'], instruction: LONG,
            errorType: null, error: null, retryAt: null,
            operations: [
                { index: 0, id: 'summarize', params: {}, state: 'running' },
                { index: 1, id: 'tag', params: {}, state: 'done', result: { tags: ['urgent'] } },
            ],
        },
        {
            id: 3, state: 'error', live: false, source: 'chat', createdAt: NOW - 60000, finishedAt: null,
            subject: ['Meeting'], from: ['Bob <bob@example.com>'], instruction: 'who are the participants?',
            errorType: 'json', error: 'The answer could not be read', retryAt: null, operations: [], hasRawResponse: true,
        },
        {
            id: 2, state: 'error', live: false, source: 'bar', createdAt: NOW - 120000, finishedAt: NOW - 110000,
            subject: ['Bonjour'], from: ['Claire <claire@example.com>'], instruction: 'translate it',
            errorType: null, error: null, retryAt: null,
            operations: [{ index: 0, id: 'translate', params: {}, state: 'error', error: 'Too many requests', errorType: 'rate_limit', retryAt: NOW + 30000, finishedAt: NOW - 110000 }],
        },
        {
            id: 1, state: 'done', live: false, source: 'bar', createdAt: NOW - 3600000, finishedAt: NOW - 3590000,
            subject: ['Hello'], from: ['Dan <dan@example.com>'], instruction: 'reply yes',
            errorType: null, error: null, retryAt: null,
            operations: [{ index: 0, id: 'compose', params: { type: 'reply' }, state: 'done', result: { type: 'reply', recipient: '' }, finishedAt: NOW - 3590000 }],
        },
    ],
    more: false,
};
const STATES = { running: ['running', 'pending_confirmation'], errors: ['error'], all: null };
const sent = [];
const counts = () => ({
    running: model.records.filter(r => r.live).length,
    errors: model.records.filter(r => r.state === 'error').length,
});
const record = (name) => (message) => { sent.push({ command: name, ...message }); return { ok: true }; };

const ctx = await openPage('smartbar', {
    local: { connection_type: 'chatgpt_api', smartbar_enabled: true },
    commands: {
        smartbar_activity_list: (message) => {
            sent.push({ ...message });
            const states = STATES[message.filter] ?? null;
            let list = model.records.filter(r => !states || states.includes(r.state));
            if (Number.isInteger(message.beforeId)) list = list.filter(r => r.id < message.beforeId);
            return { ok: true, records: list, more: message.filter === 'all' && message.beforeId == null ? model.more : false, counts: counts() };
        },
        smartbar_activity_open: record('smartbar_activity_open'),
        smartbar_activity_open_chat: record('smartbar_activity_open_chat'),
        smartbar_activity_stop: record('smartbar_activity_stop'),
        smartbar_activity_stop_all: record('smartbar_activity_stop_all'),
        smartbar_activity_retry: record('smartbar_activity_retry'),
        smartbar_activity_remove: record('smartbar_activity_remove'),
        smartbar_activity_remove_errors: record('smartbar_activity_remove_errors'),
    },
});
after(() => ctx.close());
// The page's clock (a 1 s timer while the Activity tab shows running rows or countdowns) is held
// and advanced by hand.
// Real time, for the waits of this file (the held setTimeout would never run them).
const realWait = (ms) => new Promise(r => realSetTimeout(r, ms));
const clock = holdLongTimers(ctx, { over: 999 });
after(() => clock.uninstall());
const k = uiTests('smartbar', '05');
const $ = ctx.$;
const S_ACT = 'spec 10 "Activity"';
const S_PAGE = 'spec 05 "SmartBar Settings Page (`pages/smartbar/`)"';
const msg = (key, subs) => ctx.window.browser?.i18n?.getMessage
    ? ctx.window.browser.i18n.getMessage(key, subs) : enText(key);
const row = id => $('#smartbar_activity_rows tr[data-record-id="' + id + '"]');
const rowIds = () => ctx.$$('#smartbar_activity_rows tr[data-record-id]').map(tr => Number(tr.dataset.recordId));
const btn = (tr, action, index) => [...tr.querySelectorAll('button[data-action="' + action + '"]')]
    .find(b => index === undefined ? b.dataset.index === undefined : b.dataset.index === String(index));
const checked = () => ctx.$$('#smartbar_activity .smartbar_filter').filter(b => b.getAttribute('aria-checked') === 'true').map(b => b.dataset.filter);
const sentSince = (n, command) => sent.slice(n).filter(m => m.command === command);

k.test('default-filter', S_ACT, 'something runs: the Running filter is selected at load, with the counts', async () => {
    await ctx.click($('#tab_btn_activity'));
    assert.deepEqual(checked(), ['running']);
    assert.deepEqual(rowIds(), [4]);
    assert.equal($('.smartbar_count[data-count="running"]').textContent, '(1)');
    assert.equal($('.smartbar_count[data-count="errors"]').textContent, '(2)');
});

k.test('row', S_ACT, 'a row: subject, sender and source, the instruction truncated with the whole text as tooltip, the operations with their states', () => {
    const tr = row(4);
    assert.match(tr.textContent, /Invoice 42/);
    assert.match(tr.textContent, /Ann Example/);
    assert.equal(tr.querySelector('.smartbar_source').textContent, msg('smartbar_activity_source_bar'));
    const instr = tr.querySelector('.smartbar_instruction');
    assert.ok(instr.textContent.length < LONG.length, 'not truncated');
    assert.ok(instr.textContent.endsWith('…'));
    assert.equal(instr.title, LONG);
    const ops = [...tr.querySelectorAll('.smartbar_op')].map(d => d.className);
    assert.deepEqual(ops, ['smartbar_op smartbar_op_running', 'smartbar_op smartbar_op_done']);
    assert.match(tr.querySelector('.smartbar_op_done').textContent, /urgent/);
});

k.test('elapsed', S_ACT, 'a running row shows its elapsed time, counted every second', async () => {
    const cell = () => row(4).querySelector('.smartbar_time').textContent;
    assert.match(cell(), /^running for \d+ s$/);
    const before = Number(cell().match(/(\d+) s/)[1]);
    await realWait(1100);
    await clock.advance(1000);
    assert.ok(Number(cell().match(/(\d+) s/)[1]) > before, 'the clock did not move: ' + cell());
});

k.test('running-actions', S_ACT, 'a running row offers Open and Stop, a running operation its own Stop; each sends its command', async () => {
    const tr = row(4);
    assert.ok(btn(tr, 'open') && btn(tr, 'stop') && btn(tr, 'stop', 0));
    assert.equal(btn(tr, 'stop', 1), undefined, 'Stop on an operation already done');
    assert.equal(btn(tr, 'remove'), undefined, 'Remove on a running row');
    let n = sent.length;
    await ctx.click(btn(row(4), 'stop', 0));
    assert.deepEqual(sentSince(n, 'smartbar_activity_stop').map(m => [m.recordId, m.index]), [[4, 0]]);
    n = sent.length;
    await ctx.click(btn(row(4), 'stop'));
    assert.deepEqual(sentSince(n, 'smartbar_activity_stop').map(m => [m.recordId, m.index]), [[4, undefined]]);
    n = sent.length;
    await ctx.click(btn(row(4), 'open'));
    assert.deepEqual(sentSince(n, 'smartbar_activity_open').map(m => m.recordId), [4]);
});

k.test('stop-all', S_ACT, 'Stop all sends its command, then the list is read again', async () => {
    const n = sent.length;
    await ctx.click($('#smartbar_stop_all'));
    assert.equal(sentSince(n, 'smartbar_activity_stop_all').length, 1);
    assert.ok(sent.slice(n).some(m => m.command === 'smartbar_activity_list' && m.filter === 'running'), 'the list was not read again');
});

k.test('errors', S_ACT, 'the Errors filter: Retry, Remove and Open on every error row, Open in chat only on a json error', async () => {
    await ctx.click($('.smartbar_filter[data-filter="errors"]'));
    assert.deepEqual(checked(), ['errors']);
    assert.deepEqual(rowIds(), [3, 2]);
    const json = row(3);
    assert.ok(btn(json, 'retry') && btn(json, 'remove') && btn(json, 'open') && btn(json, 'open_chat'));
    assert.equal(json.querySelector('.smartbar_source').textContent, msg('smartbar_activity_source_chat'));
    const rate = row(2);
    assert.ok(btn(rate, 'retry', 0), 'the failed operation is retried by its index');
    assert.ok(btn(rate, 'remove') && btn(rate, 'open'));
    assert.equal(rate.querySelector('button[data-action="open_chat"]'), null, 'Open in chat on an error that is not json');
});

k.test('countdown', S_ACT, 'a rate-limited row counts down the seconds before its retry', async () => {
    const text = () => row(2).querySelector('.smartbar_countdown').textContent;
    const first = Number(text().match(/(\d+)/)[1]);
    assert.ok(first > 0 && first <= 30, text());
    await realWait(1100);
    await clock.advance(1000);
    assert.ok(Number(text().match(/(\d+)/)[1]) < first, text());
});

k.test('error-actions', S_ACT, 'Retry, Open in chat and Remove send their commands with the record and the line', async () => {
    let n = sent.length;
    await ctx.click(btn(row(2), 'retry', 0));
    assert.deepEqual(sentSince(n, 'smartbar_activity_retry').map(m => [m.recordId, m.index]), [[2, 0]]);
    n = sent.length;
    await ctx.click(btn(row(3), 'retry'));
    assert.deepEqual(sentSince(n, 'smartbar_activity_retry').map(m => [m.recordId, m.index]), [[3, undefined]]);
    n = sent.length;
    await ctx.click(btn(row(3), 'open_chat'));
    assert.deepEqual(sentSince(n, 'smartbar_activity_open_chat').map(m => [m.recordId, m.index]), [[3, undefined]]);
    n = sent.length;
    await ctx.click(btn(row(3), 'remove'));
    assert.deepEqual(sentSince(n, 'smartbar_activity_remove').map(m => m.recordId), [3]);
});

k.test('remove-errors', S_ACT, 'Remove all errors sends its command; the list read again no longer shows them', async () => {
    const n = sent.length;
    await ctx.click($('#smartbar_remove_errors'));
    assert.equal(sentSince(n, 'smartbar_activity_remove_errors').length, 1);
    model.records = model.records.filter(r => r.state !== 'error');
    await ctx.ctl.dispatchMessage({ command: 'smartbar_activity_changed' }, {});
    await ctx.settle();
    assert.deepEqual(rowIds(), []);
    assert.equal($('#smartbar_activity_empty').hidden, false);
    assert.equal($('#smartbar_remove_errors').disabled, true);
});

k.test('all', S_ACT, 'the All filter: a finished row offers Open and Remove and shows its finish time', async () => {
    await ctx.click($('.smartbar_filter[data-filter="all"]'));
    assert.deepEqual(rowIds(), [4, 1]);
    const done = row(1);
    assert.ok(btn(done, 'open') && btn(done, 'remove'));
    assert.equal(btn(done, 'retry'), undefined);
    assert.equal(done.querySelector('.smartbar_time').textContent, new Date(NOW - 3590000).toLocaleString());
});

k.test('live', S_ACT, 'the background says the activity changed: the list is read again and redrawn', async () => {
    model.records = model.records.map(r => r.id === 4
        ? { ...r, live: false, state: 'done', finishedAt: NOW, operations: r.operations.map(o => ({ ...o, state: 'done' })) }
        : r);
    await ctx.ctl.dispatchMessage({ command: 'smartbar_activity_changed' }, {});
    await ctx.settle();
    assert.equal(row(4).dataset.state, 'done');
    assert.equal(btn(row(4), 'stop'), undefined);
    assert.ok(btn(row(4), 'remove'));
    assert.equal($('#smartbar_stop_all').disabled, true, 'Stop all with nothing running');
});

k.test('more', S_ACT, '"Show more" asks for the records older than the last one shown', async () => {
    model.more = true;
    await ctx.ctl.dispatchMessage({ command: 'smartbar_activity_changed' }, {});
    await ctx.settle();
    assert.equal($('#smartbar_activity_more').hidden, false);
    const n = sent.length;
    await ctx.click($('#smartbar_activity_more'));
    assert.deepEqual(sent.slice(n).filter(m => m.filter).map(m => m.beforeId), [1]);
});

k.test('storage-link', S_ACT, 'the note on the history links to the storage management page', async () => {
    assert.match($('.smartbar_activity_note').textContent, /no backup/);
    const created = ctx.apiCalls('browser.tabs.create').length;
    await ctx.click($('#smartbar_open_storage'));
    const calls = ctx.apiCalls('browser.tabs.create').slice(created);
    assert.equal(calls.length, 1);
    assert.match(calls[0].args[0].url, /pages\/storage\/mzta-storage-manager\.html$/);
});

k.test('harness-clean', S_PAGE, 'the page ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
