// The storage management page (pages/storage/), no policy: the entry list.
//
// Stored state: 60 summaries (the newest one an error, two with their message metadata), two
// translations, one spam report; one message still in the mail store (s59). The tests run in order
// on one page.
//
// Spec 05 "Storage Management Page" (entry list): a type selector, summaries first; newest first,
// 50 per page with Previous / Next and "1–50 of 60"; the columns of each type (saved on, status,
// subject, sender, message date, language for the translations; the spam log's columns for the
// spam reports, then status and actions); the subject and sender arrays joined as the spam log
// does; per row Open (messages.query() by headerMessageId, then messageDisplay.open(), or a message
// when it is gone) and Delete (confirmed, the record of that type only); no search; the list right
// after the overview, with a full-tab button closed by itself or by Escape.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { seedMessageData } from '../../ui/dom-helpers.mjs';

const BASE = Date.UTC(2026, 5, 1);
const summaries = Array.from({ length: 60 }, (_, i) => ({
    messageId: 's' + i + '@x', createdAt: BASE + i * 60000, summary: 'S' + i,
    subject: [], from: [], message_date: '',
}));
summaries[59] = { ...summaries[59], error: true, message: 'the model did not answer', subject: ['Quarterly report', 'Re'], from: ['Alice <a@x>'], message_date: '2026-05-31T10:00:00.000Z' };
summaries[58] = { ...summaries[58], subject: ['Lunch'], from: ['Bob <b@x>'] };
await seedMessageData({
    summary: summaries,
    translation: [
        { messageId: 't1@x', createdAt: BASE + 1000, translated_text: 'T', lang: 'Italian', subject: [], from: [], message_date: '' },
        { messageId: 't2@x', createdAt: BASE + 2000, translated_text: '', translation_status: '-1', lang: 'French', subject: [], from: [], message_date: '' },
    ],
    spam: [
        { messageId: 'p1@x', createdAt: BASE, spamValue: -999, explanation: 'no answer', moved: false, SpamThreshold: 70, subject: ['Win'], from: ['x@spam'], message_date: '' },
    ],
});
const store = { messages: [{ id: 101, headerMessageId: 's59@x', subject: 'Quarterly report', author: 'Alice <a@x>', date: '2026-05-31T10:00:00Z' }] };
const ctx = await openPage('storage', { messageStore: store });
after(() => ctx.close());
const k = uiTests('storage', '03');
const S_LIST = 'spec 05 "Storage Management Page — entry list"';
const $ = sel => ctx.$(sel);
const rows = () => ctx.$$('#entries_body tr');
const ids = () => rows().map(r => r.dataset.messageId);
const headers = () => ctx.$$('#entries_head th').map(th => th.textContent);
const label = () => $('#entries_page_label').textContent;
const rowOf = id => rows().find(r => r.dataset.messageId === id);
const setType = async type => {
    $('#entries_type').value = type;
    await ctx.fire($('#entries_type'), 'change');
};
const range = (from, to) => Array.from({ length: from - to + 1 }, (_, i) => 's' + (from - i) + '@x');
async function withConfirm(answer, fn) {
    const real = globalThis.confirm;
    globalThis.confirm = (...args) => { ctx.dialogs.push({ kind: 'confirm', args }); return answer; };
    try { return await fn(); } finally { globalThis.confirm = real; }
}

k.test('summaries-first', S_LIST, 'the summaries are listed first, with their columns', () => {
    assert.equal($('#entries_type').value, 'summary');
    assert.deepEqual(headers(), [msg('storage_col_saved'), msg('storage_col_status'), msg('Subject'), msg('From'), msg('Date'), msg('storage_col_actions')]);
});

k.test('first-page', S_LIST, 'the first page: the 50 newest, newest first; "1–50 of 60"; Previous disabled', () => {
    assert.deepEqual(ids(), range(59, 10));
    assert.equal(label(), msg('spamfilter_report_page_label', ['1', '50', '60']));
    assert.equal($('#entries_prev_btn').disabled, true);
    assert.equal($('#entries_next_btn').disabled, false);
});

k.test('row-cells', S_LIST, 'a row: saved on, status (an error carries its message), the joined subject and sender, the message date', () => {
    const cells = [...rowOf('s59@x').cells].map(c => c.textContent);
    assert.equal(cells[0], new Date(BASE + 59 * 60000).toLocaleString());
    assert.equal(cells[1], msg('storage_status_error'));
    assert.equal(rowOf('s59@x').cells[1].title, 'the model did not answer');
    assert.equal(cells[2], 'Quarterly report, Re');
    assert.equal(cells[3], 'Alice <a@x>');
    assert.equal(cells[4], new Date('2026-05-31T10:00:00.000Z').toLocaleString());
    assert.equal(rowOf('s58@x').cells[1].textContent, msg('storage_status_ok'));
    assert.equal(rowOf('s57@x').cells[2].textContent, '', 'no metadata: empty cells');
});

k.test('next-previous', S_LIST, 'Next shows the last 10, "51–60 of 60"; Previous goes back', async () => {
    await ctx.click($('#entries_next_btn'));
    assert.deepEqual(ids(), range(9, 0));
    assert.equal(label(), '51–60 of 60');
    assert.equal($('#entries_next_btn').disabled, true);
    await ctx.click($('#entries_prev_btn'));
    assert.deepEqual(ids(), range(59, 10));
});

k.test('open-found', S_LIST, 'Open looks the message up by its Message-ID and opens it in a tab', async () => {
    await ctx.click(rowOf('s59@x').querySelector('.entry_open'));
    assert.deepEqual(store.queried.at(-1), 's59@x');
    assert.deepEqual(store.opened, [{ messageId: 101, location: 'tab' }]);
    assert.equal($('#entries_result').textContent, '');
});

k.test('open-gone', S_LIST, 'a message that no longer exists: a message says so, nothing is opened', async () => {
    await ctx.click(rowOf('s58@x').querySelector('.entry_open'));
    assert.equal(store.queried.at(-1), 's58@x');
    assert.equal(store.opened.length, 1);
    assert.equal($('#entries_result').textContent, msg('storage_message_not_found'));
});

k.test('delete-refused', S_LIST, 'Delete asks first; refused, the entry stays', async () => {
    await withConfirm(false, () => ctx.click(rowOf('s58@x').querySelector('.entry_delete')));
    assert.deepEqual(ctx.dialogs.at(-1), { kind: 'confirm', args: [msg('storage_delete_entry_confirm')] });
    assert.ok(rowOf('s58@x'));
});

k.test('delete', S_LIST, 'confirmed, that summary goes (its mirror key too), the list and the overview are read again', async () => {
    await ctx.click(rowOf('s58@x').querySelector('.entry_delete'));
    assert.equal(rowOf('s58@x'), undefined);
    assert.equal($('#entries_result').textContent, msg('storage_entry_deleted'));
    assert.equal(label(), '1–50 of 59');
    assert.equal(ctx.$('#stats_body tr[data-type="summary"]').cells[1].textContent, '59');
    assert.ok(ctx.apiCalls('browser.storage.local.remove').some(c => [].concat(c.args[0]).includes('summary:s58@x')),
        'the mirror key removed');
});

k.test('translations', S_LIST, 'the translations: the language column; a skipped translation is not an error', async () => {
    await setType('translation');
    assert.deepEqual(headers(), [msg('storage_col_saved'), msg('storage_col_status'), msg('Subject'), msg('From'), msg('Date'),
        msg('storage_col_language'), msg('storage_col_actions')]);
    assert.deepEqual(ids(), ['t2@x', 't1@x']);
    assert.equal(rowOf('t2@x').cells[5].textContent, 'French');
    assert.equal(rowOf('t2@x').cells[1].textContent, msg('storage_status_ok'));
    assert.equal(label(), '1–2 of 2');
});

k.test('spam', S_LIST, 'the spam reports: the columns of the spam log, then status and actions', async () => {
    await setType('spam');
    assert.deepEqual(headers(), ['Message_ID', msg('Date'), msg('From'), msg('Subject'), msg('Spam_Value'), msg('Moved_to_Spam'),
        msg('Explanation'), msg('Report_Date'), msg('storage_col_status'), msg('storage_col_actions')]);
    const cells = [...rows()[0].cells].map(c => c.textContent);
    assert.equal(cells[0], 'p1@x');
    assert.equal(cells[2], 'x@spam');
    assert.equal(cells[3], 'Win');
    assert.equal(cells[4], '-999');
    assert.equal(cells[6], 'no answer');
    assert.equal(cells[8], msg('storage_status_error'));
    assert.ok(rows()[0].querySelector('.entry_open') && rows()[0].querySelector('.entry_delete'));
});

k.test('after-overview', S_LIST, 'the list comes right after the overview', () => {
    const sections = ctx.$$('#mzta_body > .mzta_section').map(s => s.id);
    assert.equal(sections.indexOf('entries_section'), sections.indexOf('overview_section') + 1);
});

k.test('fullscreen', S_LIST, 'the full-tab button pins the list over the tab and back, Escape closes it', async () => {
    const btn = $('#entries_fullscreen_btn');
    const section = $('#entries_section');
    const body = $('body');
    const isOn = () => [btn.getAttribute('aria-pressed'),
        section.classList.contains('entries_fullscreen_on'), body.classList.contains('entries_fullscreen')];
    assert.deepEqual(isOn(), ['false', false, false]);
    await ctx.click(btn);
    assert.deepEqual(isOn(), ['true', true, true]);
    await ctx.click(btn);
    assert.deepEqual(isOn(), ['false', false, false]);
    await ctx.click(btn);
    await ctx.fire(body, 'keydown', { key: 'Escape' });
    assert.deepEqual(isOn(), ['false', false, false]);
});

k.test('no-search', S_LIST, 'no search field', () => {
    assert.equal(ctx.$$('#entries_section input').length, 0);
});

k.test('no-prefs-written', S_LIST, 'nothing in the list writes a preference', () => {
    assert.equal(ctx.localWrites(0).length, 0);
});

k.test('harness-clean', S_LIST, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
