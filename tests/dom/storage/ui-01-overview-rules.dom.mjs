// The storage management page (pages/storage/), no policy: the overview and the retention rules.
//
// Stored state: three summaries (one with an error), one translation, two spam reports (one with an
// error), with known sizes and dates; a last automatic cleanup; some rules stored. The tests build
// on each other in order on the one opened page.
//
// Spec 05 "Storage Management Page": the overview (per type: entries, entries with an error,
// estimated size, oldest and newest entry; the total; the note on the disk used; the last
// automatic cleanup; Refresh), the retention rules (the stored values shown; saved by Save only,
// Save enabled by an edit; the unsaved-changes guard; a Save that would make the next automatic
// cleanup delete entries asks first, and a refusal saves nothing; no question with the automatic
// cleanup off; an invalid value refused; Restore defaults), the migration notices hidden with no
// migration. Spec 01 "Per-Message Data Storage" (getStats(), getLastCleanup(), previewCleanup()).

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    seedMessageData,
    userSets
} from '../../ui/dom-helpers.mjs';
import { prefs_default } from '../../../options/mzta-options-default.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const at = days => NOW - days * DAY;
await seedMessageData({
    summary: [
        { messageId: 's1@x', createdAt: at(30), size: 100, summary: 'a', subject: [], from: [], message_date: '' },
        { messageId: 's2@x', createdAt: at(10), size: 200, error: true, message: 'boom', subject: [], from: [], message_date: '' },
        { messageId: 's3@x', createdAt: at(1), size: 300, summary: 'c', subject: [], from: [], message_date: '' },
    ],
    translation: [
        { messageId: 't1@x', createdAt: at(5), size: 400, translated_text: 'T', translation_status: '1', subject: [], from: [], message_date: '' },
    ],
    spam: [
        { messageId: 'p1@x', createdAt: at(20), size: 50, spamValue: 80, subject: [], from: [], message_date: '' },
        { messageId: 'p2@x', createdAt: at(2), size: 70, spamValue: -999, explanation: 'x', subject: [], from: [], message_date: '' },
    ],
});
const LAST = { time: Date.UTC(2026, 10, 1, 8, 0, 0), removed: { spam: 4, summary: 1, translation: 0 } };
const ctx = await openPage('storage', {
    local: {
        summarize_storage_max_entries: 50,
        translate_storage_max_age_days: 365,
        _message_data_last_cleanup: LAST,
    },
});
after(() => ctx.close());
const k = uiTests('storage', '01');
const S_OVER = 'spec 05 "Storage Management Page — overview"';
const S_RULES = 'spec 05 "Storage Management Page — retention rules"';
const $ = sel => ctx.$(sel);
const row = type => $(`#stats_body tr[data-type="${type}"]`);
const cells = type => [...row(type).cells].map(c => c.textContent);
const save = () => $('#btn_save_rules');
/** Answer the next confirm() with `answer`, recording it in ctx.dialogs like the harness does. */
async function withConfirm(answer, fn) {
    const real = globalThis.confirm;
    globalThis.confirm = (...args) => { ctx.dialogs.push({ kind: 'confirm', args }); return answer; };
    try { return await fn(); } finally { globalThis.confirm = real; }
}

k.test('overview-rows', S_OVER, 'one row per type: entries, with an error, estimated size, oldest and newest entry', () => {
    assert.deepEqual(cells('summary'), [msg('storage_type_summary'), '3', '1', '600.00 Bytes',
        new Date(at(30)).toLocaleString(), new Date(at(1)).toLocaleString()]);
    assert.deepEqual(cells('translation'), [msg('storage_type_translation'), '1', '0', '400.00 Bytes',
        new Date(at(5)).toLocaleString(), new Date(at(5)).toLocaleString()]);
    assert.deepEqual(cells('spam'), [msg('storage_type_spam'), '2', '1', '120.00 Bytes',
        new Date(at(20)).toLocaleString(), new Date(at(2)).toLocaleString()]);
    assert.deepEqual(ctx.$$('#stats_body tr').map(r => r.dataset.type), ['summary', 'translation', 'spam']);
});

k.test('overview-total', S_OVER, 'the total row, and the note that the disk used is about twice as much', () => {
    assert.equal($('#stats_total_count').textContent, '6');
    assert.equal($('#stats_total_errors').textContent, '2');
    assert.equal($('#stats_total_size').textContent, '1.09 KB');
    assert.ok(ctx.document.body.textContent.includes(msg('storage_disk_note')));
});

k.test('overview-last-cleanup', S_OVER, 'the last automatic cleanup: its date and what it removed per type', () => {
    assert.equal($('#last_cleanup').textContent, msg('storage_last_cleanup', [new Date(LAST.time).toLocaleString(),
        [msg('storage_count_item', [msg('storage_type_summary'), '1']), msg('storage_count_item', [msg('storage_type_translation'), '0']),
            msg('storage_count_item', [msg('storage_type_spam'), '4'])].join(', ')]));
});

k.test('no-migration', S_OVER, 'no migration: neither notice is shown; no managed banner without a policy', () => {
    assert.equal($('#storage_migrating').style.display, 'none');
    assert.equal($('#storage_migration_failed').style.display, 'none');
    assert.equal($('#managed_config_banner').classList.contains('shown'), false);
});

k.test('rules-shown', S_RULES, 'the stored rules are shown, the defaults for the others (the error age 90, the cleanup on)', () => {
    assert.equal($('#summarize_storage_max_entries').value, '50');
    assert.equal($('#translate_storage_max_age_days').value, '365');
    assert.equal($('#spamfilter_storage_max_age_days').value, '0');
    for (const key of ['spamfilter', 'summarize', 'translate']) assert.equal($(`#${key}_storage_error_max_age_days`).value, '90', key);
    assert.equal($('#message_storage_cleanup_auto').checked, true);
    assert.equal(save().disabled, true, 'nothing to save at load');
});

k.test('rules-nothing-at-load', S_RULES, 'opening the page writes nothing', () => {
    assert.deepEqual(ctx.localWrites(0), []);
});

k.test('rules-save-plain', S_RULES, 'an edit enables Save (and the unsaved guard); a Save that deletes nothing asks nothing and stores every rule', async () => {
    await userSets(ctx, $('#spamfilter_storage_max_entries'), '10');
    assert.equal(save().disabled, false);
    const ev = new ctx.window.Event('beforeunload', { cancelable: true });
    ctx.window.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true, 'the unsaved guard warns before leaving');
    const since = ctx.ctl.calls.length;
    const dialogs = ctx.dialogs.length;
    await ctx.click(save());
    assert.equal(ctx.dialogs.length, dialogs, 'no question');
    const local = ctx.ctl.localData();
    assert.strictEqual(local.spamfilter_storage_max_entries, 10);
    assert.strictEqual(local.summarize_storage_max_entries, 50);
    assert.strictEqual(local.summarize_storage_error_max_age_days, 90);
    assert.strictEqual(local.message_storage_cleanup_auto, true);
    assert.ok(ctx.ctl.calls.slice(since).some(c => c.area === 'local' && c.op === 'set'));
    assert.equal(save().disabled, true);
    assert.equal($('#rules_result').textContent, msg('storage_rules_saved'));
});

k.test('rules-save-warns-refused', S_RULES, 'a Save that would delete entries says how many first; refused, nothing is stored and Save stays enabled', async () => {
    await userSets(ctx, $('#summarize_storage_max_age_days'), '7');
    const since = ctx.ctl.calls.length;
    await withConfirm(false, () => ctx.click(save()));
    const question = ctx.dialogs.at(-1);
    assert.equal(question.kind, 'confirm');
    assert.equal(question.args[0], msg('storage_rules_save_confirm', ['2',
        [msg('storage_count_item', [msg('storage_type_summary'), '2']), msg('storage_count_item', [msg('storage_type_translation'), '0']),
            msg('storage_count_item', [msg('storage_type_spam'), '0'])].join(', ')]));
    assert.deepEqual(ctx.localWrites(since), []);
    assert.equal(save().disabled, false);
    assert.equal(cells('summary')[1], '3', 'nothing deleted');
});

k.test('rules-save-warns-accepted', S_RULES, 'accepted, the rules are stored; nothing is deleted now (the cleanup does it)', async () => {
    await withConfirm(true, () => ctx.click(save()));
    assert.strictEqual(ctx.ctl.localData().summarize_storage_max_age_days, 7);
    assert.equal(cells('summary')[1], '3', 'still three summaries');
});

k.test('rules-save-auto-off', S_RULES, 'with the automatic cleanup off, a Save that lowers a limit asks nothing', async () => {
    await ctx.click($('#message_storage_cleanup_auto'));
    await userSets(ctx, $('#translate_storage_max_age_days'), '1');
    const dialogs = ctx.dialogs.length;
    await ctx.click(save());
    assert.equal(ctx.dialogs.length, dialogs);
    assert.strictEqual(ctx.ctl.localData().message_storage_cleanup_auto, false);
    assert.strictEqual(ctx.ctl.localData().translate_storage_max_age_days, 1);
});

k.test('rules-invalid', S_RULES, 'a value that is not a whole number of 0 or more is refused: the message, nothing stored', async () => {
    await userSets(ctx, $('#spamfilter_storage_max_age_days'), '-3');
    const since = ctx.ctl.calls.length;
    await ctx.click(save());
    assert.notEqual($('#rules_invalid').style.display, 'none');
    assert.deepEqual(ctx.localWrites(since), []);
    await userSets(ctx, $('#spamfilter_storage_max_age_days'), '0');
});

k.test('rules-restore-defaults', S_RULES, 'Restore defaults puts the prefs_default values in the form, unsaved until Save', async () => {
    const since = ctx.ctl.calls.length;
    await ctx.click($('#btn_restore_rules'));
    assert.deepEqual(ctx.localWrites(since), [], 'nothing stored yet');
    assert.equal($('#summarize_storage_max_entries').value, String(prefs_default.summarize_storage_max_entries));
    assert.equal($('#translate_storage_error_max_age_days').value, String(prefs_default.translate_storage_error_max_age_days));
    assert.equal($('#message_storage_cleanup_auto').checked, prefs_default.message_storage_cleanup_auto);
    assert.equal(save().disabled, false);
    await ctx.click(save());
    const local = ctx.ctl.localData();
    assert.strictEqual(local.summarize_storage_max_entries, 0);
    assert.strictEqual(local.summarize_storage_max_age_days, 0);
    assert.strictEqual(local.message_storage_cleanup_auto, true);
});

k.test('refresh', S_OVER, 'Refresh reads the overview again', async () => {
    const db = await new Promise((resolve, reject) => {
        const open = ctx.window.indexedDB.open('thunderai-message-data');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
    });
    await new Promise((resolve, reject) => {
        const tx = db.transaction('translation', 'readwrite');
        tx.objectStore('translation').put({ messageId: 't2@x', createdAt: at(3), size: 10, failed: 1, error: true });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    db.close();
    await ctx.click($('#btn_refresh'));
    assert.equal(cells('translation')[1], '2');
    assert.equal(cells('translation')[2], '1');
});

k.test('harness-clean', S_OVER, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
