// The storage management page (pages/storage/), no policy: the search for the entries whose
// message no longer exists.
//
// Stored state: four Message-IDs. kept@x has a summary and a translation with empty metadata, and
// its message is in the mail store; full@x has a summary with its metadata, and its message too;
// gone@x has a summary and a spam report, and no message; broken@x's lookup fails. The tests run in
// order on one page.
//
// Spec 05 "Storage Management Page" (orphan scan): a warning before it starts (refused: nothing
// looked up); one messages.query() per Message-ID, whatever the number of its entries; the progress;
// the entries of a message not found listed, with the note that the list is indicative; a found
// message completes the entries with empty metadata (taStorage.fillMetadata(), from the
// MessageHeader); a lookup that fails is neither listed nor filled; Stop; one button deletes the
// entries listed (confirmed). Spec 01 "Per-Message Data Storage" (getEntryKeys(), fillMetadata(),
// removeEntries()).

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { seedMessageData } from '../../ui/dom-helpers.mjs';

const empty = { subject: [], from: [], message_date: '' };
const SEEDED = {
    summary: [
        { messageId: 'kept@x', createdAt: 1000, summary: 'S', ...empty },
        { messageId: 'full@x', createdAt: 2000, summary: 'S', subject: ['Kept subject'], from: ['Kept <k@x>'], message_date: '2026-01-01T00:00:00.000Z' },
        { messageId: 'gone@x', createdAt: 3000, summary: 'S', ...empty },
        { messageId: 'broken@x', createdAt: 4000, summary: 'S', ...empty },
    ],
    translation: [{ messageId: 'kept@x', createdAt: 1500, translated_text: 'T', lang: 'Italian', ...empty }],
    spam: [{ messageId: 'gone@x', createdAt: 3500, spamValue: 10, ...empty }],
};
await seedMessageData(SEEDED);
// The durable copy of the same records: the fill rewrites a record only when its mirror value
// still has the createdAt seen too.
const MIRROR = Object.fromEntries(Object.entries(SEEDED).flatMap(([type, list]) =>
    list.map(r => [type + ':' + r.messageId, r])));
const store = {
    messages: [
        { id: 1, headerMessageId: 'kept@x', subject: 'Hello', author: 'Alice <a@x>', date: '2026-02-03T04:05:06.000Z' },
        { id: 2, headerMessageId: 'full@x', subject: 'Other', author: 'Other <o@x>', date: '2026-02-03T04:05:06.000Z' },
    ],
    fails: ['broken@x'],
};
const ctx = await openPage('storage', { messageStore: store, local: MIRROR });
after(() => ctx.close());
const k = uiTests('storage', '05');
const S_ORPH = 'spec 05 "Storage Management Page — orphan scan"';
const $ = sel => ctx.$(sel);
const raw = (type, id) => new Promise((resolve, reject) => {
    const open = ctx.window.indexedDB.open('thunderai-message-data');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
        const db = open.result;
        const req = db.transaction(type, 'readonly').objectStore(type).get(id);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
    };
});
async function withConfirm(answer, fn) {
    const real = globalThis.confirm;
    globalThis.confirm = (...args) => { ctx.dialogs.push({ kind: 'confirm', args }); return answer; };
    try { return await fn(); } finally { globalThis.confirm = real; }
}

k.test('warning-refused', S_ORPH, 'the search warns first that it can take long; refused, no message is looked up', async () => {
    await withConfirm(false, () => ctx.click($('#btn_orphans_start')));
    assert.deepEqual(ctx.dialogs.at(-1), { kind: 'confirm', args: [msg('storage_orphans_confirm')] });
    assert.deepEqual(store.queried, []);
    assert.equal($('#orphans_results').style.display, 'none');
});

k.test('scan', S_ORPH, 'one lookup per Message-ID; the progress at the end; the entries of the missing message listed with the note', async () => {
    await ctx.click($('#btn_orphans_start'));
    assert.deepEqual([...store.queried].sort(), ['broken@x', 'full@x', 'gone@x', 'kept@x']);
    assert.equal($('#orphans_progress').textContent, msg('storage_orphans_progress', ['4', '4']));
    const listed = ctx.$$('#orphans_body tr').map(r => [r.cells[0].textContent, r.cells[1].textContent]);
    assert.deepEqual(listed.sort(), [[msg('storage_type_spam'), 'gone@x'], [msg('storage_type_summary'), 'gone@x']].sort());
    assert.notEqual($('#orphans_note').style.display, 'none');
    assert.ok($('#orphans_summary').textContent.includes(msg('storage_orphans_found', ['2'])));
    assert.ok($('#orphans_summary').textContent.includes(msg('storage_orphans_filled', ['2'])));
    assert.equal($('#btn_orphans_start').disabled, false);
    assert.equal($('#btn_orphans_stop').disabled, true);
});

k.test('filled', S_ORPH, 'a found message completes its entries with empty metadata, both places, createdAt kept; one already complete is left alone', async () => {
    const summary = await raw('summary', 'kept@x');
    assert.deepEqual(summary.subject, ['Hello']);
    assert.deepEqual(summary.from, ['Alice <a@x>']);
    assert.equal(summary.message_date, '2026-02-03T04:05:06.000Z');
    assert.equal(summary.createdAt, 1000);
    assert.deepEqual(ctx.ctl.localData()['summary:kept@x'], summary, 'the mirror holds the same record');
    assert.deepEqual((await raw('translation', 'kept@x')).subject, ['Hello']);
    assert.deepEqual((await raw('summary', 'full@x')).subject, ['Kept subject']);
    assert.deepEqual((await raw('summary', 'broken@x')).subject, [], 'a failed lookup fills nothing');
});

k.test('delete-orphans', S_ORPH, 'Delete these entries asks first, then removes exactly the listed ones and hides the list', async () => {
    await ctx.click($('#btn_orphans_delete'));
    assert.deepEqual(ctx.dialogs.at(-1), { kind: 'confirm', args: [msg('storage_orphans_delete_confirm', ['2'])] });
    assert.equal(await raw('summary', 'gone@x'), undefined);
    assert.equal(await raw('spam', 'gone@x'), undefined);
    assert.ok(await raw('summary', 'broken@x'), 'not listed: kept');
    assert.equal('summary:gone@x' in ctx.ctl.localData(), false, 'the mirror keys too');
    assert.equal('spam:gone@x' in ctx.ctl.localData(), false);
    assert.ok('summary:broken@x' in ctx.ctl.localData());
    assert.equal($('#orphans_results').style.display, 'none');
    assert.equal($('#orphans_result').textContent, msg('storage_removed_result', [[
        msg('storage_count_item', [msg('storage_type_summary'), '1']),
        msg('storage_count_item', [msg('storage_type_translation'), '0']),
        msg('storage_count_item', [msg('storage_type_spam'), '1']),
    ].join(', ')]));
});

k.test('stop', S_ORPH, 'Stop ends the search after the lookup in progress: the rest is not looked up, the search says it stopped', async () => {
    store.queried.length = 0;
    // The first lookup waits until Stop has been pressed.
    let release;
    const gate = new Promise(r => { release = r; });
    const query = globalThis.browser.messages.query;
    const realQuery = query.bind(globalThis.browser.messages);
    store.fails = [];
    const original = store.messages;
    let entered = 0;
    globalThis.browser.messages.query = async (info) => { entered++; await gate; return realQuery(info); };
    try {
        $('#btn_orphans_start').click();
        for (let i = 0; i < 10000 && entered === 0; i++) await new Promise(r => setImmediate(r));
        assert.equal(entered, 1, 'the first lookup started');
        assert.equal($('#btn_orphans_stop').disabled, false, 'Stop enabled while it runs');
        $('#btn_orphans_stop').click();
        release();
        await ctx.settle();
    } finally {
        globalThis.browser.messages.query = query;
        store.messages = original;
    }
    assert.equal(store.queried.length, 1, 'one lookup, then stopped');
    assert.ok($('#orphans_summary').textContent.startsWith(msg('storage_orphans_stopped')));
});

k.test('harness-clean', S_ORPH, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
