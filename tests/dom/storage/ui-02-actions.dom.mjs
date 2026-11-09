// The storage management page (pages/storage/), no policy: the preview and the manual actions.
//
// Stored state: per type, entries 40, 20 / 2 and 1 days old, some with an error; one saved rule
// (summaries kept 30 days). The tests run in order on one page, each on what the previous ones left.
//
// Spec 05 "Storage Management Page": Preview (the rules in the form, saved or not, counts only,
// nothing deleted or stored), Apply rules now (the saved rules; not the scheduled run: no last
// cleanup stored), delete by type, delete the errors, delete older than N days (an invalid number
// refused), delete everything, the realignment through the background's reconcileMessageStorage
// command (its counts, its error); every destructive action confirmed first (a refusal changes
// nothing), its outcome shown, the overview read again. Spec 01 "Per-Message Data Storage".

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    seedMessageData,
    userSets
} from '../../ui/dom-helpers.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const at = days => NOW - days * DAY;
const meta = { subject: [], from: [], message_date: '' };
await seedMessageData({
    summary: [
        { messageId: 's-old@x', createdAt: at(40), summary: 'a', ...meta },
        { messageId: 's-err@x', createdAt: at(20), error: true, message: 'boom', ...meta },
        { messageId: 's-new@x', createdAt: at(1), summary: 'c', ...meta },
    ],
    translation: [
        { messageId: 't-old@x', createdAt: at(40), translated_text: 'T', ...meta },
        { messageId: 't-err@x', createdAt: at(2), error: true, message: 'boom', ...meta },
    ],
    spam: [
        { messageId: 'p-old@x', createdAt: at(40), spamValue: 10, ...meta },
        { messageId: 'p-new@x', createdAt: at(1), spamValue: 90, ...meta },
    ],
});
let realign = { ok: true, counts: { spam: { restored: 0, removed: 0 }, summary: { restored: 2, removed: 1 }, translation: { restored: 0, removed: 0 } } };
const realignCalls = [];
const ctx = await openPage('storage', {
    local: { summarize_storage_max_age_days: 30 },
    commands: {
        reconcileMessageStorage: (message) => { realignCalls.push(message); return realign; },
    },
});
after(() => ctx.close());
const k = uiTests('storage', '02');
const S_ACT = 'spec 05 "Storage Management Page — manual actions"';
const $ = sel => ctx.$(sel);
const count = type => ctx.$(`#stats_body tr[data-type="${type}"]`).cells[1].textContent;
const counts = () => ({ summary: count('summary'), translation: count('translation'), spam: count('spam') });
const detail = (summary, translation, spam) => [
    msg('storage_count_item', [msg('storage_type_summary'), String(summary)]),
    msg('storage_count_item', [msg('storage_type_translation'), String(translation)]),
    msg('storage_count_item', [msg('storage_type_spam'), String(spam)]),
].join(', ');
async function withConfirm(answer, fn) {
    const real = globalThis.confirm;
    globalThis.confirm = (...args) => { ctx.dialogs.push({ kind: 'confirm', args }); return answer; };
    try { return await fn(); } finally { globalThis.confirm = real; }
}

k.test('preview', S_ACT, 'Preview counts what the rules in the form (unsaved) would delete now, and deletes and stores nothing', async () => {
    await userSets(ctx, $('#translate_storage_max_age_days'), '10');
    const since = ctx.ctl.calls.length;
    await ctx.click($('#btn_preview'));
    assert.equal($('#rules_result').textContent, msg('storage_preview_result', [detail(1, 1, 0)]));
    assert.deepEqual(ctx.localWrites(since), []);
    assert.deepEqual(counts(), { summary: '3', translation: '2', spam: '2' });
});

k.test('apply-refused', S_ACT, 'Apply rules now asks first; refused, nothing is deleted', async () => {
    await withConfirm(false, () => ctx.click($('#btn_apply_now')));
    assert.deepEqual(ctx.dialogs.at(-1), { kind: 'confirm', args: [msg('storage_apply_confirm')] });
    assert.deepEqual(counts(), { summary: '3', translation: '2', spam: '2' });
});

k.test('apply', S_ACT, 'confirmed, the SAVED rules apply (not the unsaved form), the count per type is shown, no last cleanup is stored', async () => {
    const since = ctx.ctl.calls.length;
    await ctx.click($('#btn_apply_now'));
    assert.equal($('#rules_result').textContent, msg('storage_removed_result', [detail(1, 0, 0)]));
    assert.deepEqual(counts(), { summary: '2', translation: '2', spam: '2' });
    assert.equal('_message_data_last_cleanup' in ctx.ctl.localData(), false);
    assert.deepEqual(ctx.localWrites(since), []);
});

k.test('delete-errors', S_ACT, 'Delete the entries with an error: confirmed, every error of every type goes, the results stay', async () => {
    await ctx.click($('#btn_delete_errors'));
    assert.deepEqual(ctx.dialogs.at(-1), { kind: 'confirm', args: [msg('storage_delete_errors_confirm')] });
    assert.equal($('#actions_result').textContent, msg('storage_removed_result', [detail(1, 1, 0)]));
    assert.deepEqual(counts(), { summary: '1', translation: '1', spam: '2' });
});

k.test('delete-older-invalid', S_ACT, 'Delete older than: a number of days below 1 is refused with a message, nothing asked or deleted', async () => {
    const dialogs = ctx.dialogs.length;
    await userSets(ctx, $('#delete_older_days'), '0');
    await ctx.click($('#btn_delete_older'));
    assert.equal(ctx.dialogs.length, dialogs);
    assert.equal($('#actions_result').textContent, msg('storage_days_invalid'));
    assert.ok($('#actions_result').classList.contains('storage_error'));
});

k.test('delete-older', S_ACT, 'Delete older than 30 days: confirmed with the number, every older entry of every type goes', async () => {
    await userSets(ctx, $('#delete_older_days'), '30');
    await ctx.click($('#btn_delete_older'));
    assert.deepEqual(ctx.dialogs.at(-1), { kind: 'confirm', args: [msg('storage_delete_older_confirm', ['30'])] });
    assert.equal($('#actions_result').textContent, msg('storage_removed_result', [detail(0, 1, 1)]));
    assert.ok(!$('#actions_result').classList.contains('storage_error'));
    assert.deepEqual(counts(), { summary: '1', translation: '0', spam: '1' });
});

k.test('delete-type-refused', S_ACT, 'Delete all the summaries asks first; refused, nothing goes', async () => {
    await withConfirm(false, () => ctx.click($('#btn_delete_summary')));
    assert.deepEqual(ctx.dialogs.at(-1), { kind: 'confirm', args: [msg('storage_delete_summary_confirm')] });
    assert.equal(count('summary'), '1');
});

k.test('delete-type', S_ACT, 'confirmed, that type only is emptied and the count shown', async () => {
    await ctx.click($('#btn_delete_summary'));
    assert.equal($('#actions_result').textContent, msg('storage_removed_result',
        [msg('storage_count_item', [msg('storage_type_summary'), '1'])]));
    assert.deepEqual(counts(), { summary: '0', translation: '0', spam: '1' });
});

k.test('realign', S_ACT, 'Realign asks the background (reconcileMessageStorage) and shows what it restored and removed per type', async () => {
    await ctx.click($('#btn_realign'));
    assert.deepEqual(ctx.dialogs.at(-1), { kind: 'confirm', args: [msg('storage_realign_confirm')] });
    assert.deepEqual(realignCalls, [{ command: 'reconcileMessageStorage' }]);
    assert.equal($('#actions_result').textContent, msg('storage_realign_done', [[
        msg('storage_realign_item', [msg('storage_type_summary'), '2', '1']),
        msg('storage_realign_item', [msg('storage_type_translation'), '0', '0']),
        msg('storage_realign_item', [msg('storage_type_spam'), '0', '0']),
    ].join(', ')]));
});

k.test('realign-error', S_ACT, 'a failed realignment shows the error the background answered, never swallowed', async () => {
    realign = { ok: false, error: 'the mirror could not be read' };
    await ctx.click($('#btn_realign'));
    assert.equal($('#actions_result').textContent, msg('storage_action_error', ['the mirror could not be read']));
    assert.ok($('#actions_result').classList.contains('storage_error'));
});

k.test('delete-all', S_ACT, 'Delete everything: confirmed, the three types are emptied and the count of removed entries shown', async () => {
    await ctx.click($('#btn_delete_all'));
    assert.deepEqual(ctx.dialogs.at(-1), { kind: 'confirm', args: [msg('prefs_storage_clear_confirm')] });
    assert.equal($('#actions_result').textContent, msg('prefs_storage_clear_done', ['1']));
    assert.deepEqual(counts(), { summary: '0', translation: '0', spam: '0' });
    assert.equal($('#stats_total_count').textContent, '0');
});

k.test('no-prefs-written', S_ACT, 'none of the actions wrote a preference (the unsaved form included)', () => {
    assert.deepEqual(ctx.localWrites(0), []);
});

k.test('harness-clean', S_ACT, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
