// The spam log of the Spam Filter page: only the 20 newest reports, then a link to the storage
// management page. 120 saved reports, no policy.
//
// Spec 05 "Spam Filter Page — the spam log" (#956): the 20 newest reports, newest first, read from
// the database (getPage() on the createdAt index); no pager; the report date is the time the report
// was saved (createdAt); under the table, the link that opens the storage management page on its
// spam list (#spam) in a new tab. Spec 02 "Missing special prompts": the log's empty-state row is
// kept (ui-02).

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { seedMessageData } from '../../ui/dom-helpers.mjs';

const TOTAL = 120;
const BASE = Date.UTC(2026, 2, 1);
// r0 is the oldest, r119 the newest; inserted in a shuffled order, so the order shown can only
// come from createdAt.
const reports = Array.from({ length: TOTAL }, (_, i) => ({
    messageId: 'r' + i + '@x', createdAt: BASE + i * 60000, spamValue: i % 100, explanation: 'n' + i,
    subject: [], from: [], message_date: '', moved: false, SpamThreshold: 70,
}));
for (let i = reports.length - 1; i > 0; i--) {
    const j = (i * 37) % (i + 1);
    [reports[i], reports[j]] = [reports[j], reports[i]];
}
await seedMessageData({ spam: reports });
const ctx = await openPage('spamfilter', { local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-test-key', spamfilter: true } });
after(() => ctx.close());
const k = uiTests('spamfilter', '04');
const S_LOG = 'spec 05 "Spam Filter Page — the spam log"';
const ids = () => ctx.$$('#report_data_body tr').map(r => r.cells[0].textContent);
const range = (from, to) => Array.from({ length: from - to + 1 }, (_, i) => 'r' + (from - i) + '@x');

k.test('newest-20', S_LOG, 'the log shows the 20 newest reports, newest first, and no more', () => {
    assert.deepEqual(ids(), range(119, 100));
});

k.test('no-pager', S_LOG, 'no pager: no Previous / Next, no "1–50 of 120" label', () => {
    assert.equal(ctx.$('#report_pager'), null);
    assert.equal(ctx.$('#report_prev_btn'), null);
    assert.equal(ctx.$('#report_next_btn'), null);
});

k.test('report-date', S_LOG, 'the report date column is the createdAt of the record', () => {
    const row = ctx.$$('#report_data_body tr')[0];
    assert.equal(row.cells[7].textContent, new Date(BASE + 119 * 60000).toLocaleString());
});

k.test('link-text', S_LOG, 'under the table: "the 20 most recent" and the link to the whole list', () => {
    const more = ctx.$('.report_more');
    assert.ok(more.textContent.includes(msg('spamfilter_report_newest_info')));
    assert.equal(ctx.$('#report_manage_link').textContent, msg('spamfilter_report_manage_link'));
});

k.test('link-opens', S_LOG, 'the link opens the storage management page on its spam list (#spam) in a new tab', async () => {
    const created = ctx.apiCalls('browser.tabs.create').length;
    await ctx.click(ctx.$('#report_manage_link'));
    const calls = ctx.apiCalls('browser.tabs.create').slice(created);
    assert.equal(calls.length, 1);
    assert.match(calls[0].args[0].url, /pages\/storage\/mzta-storage-manager\.html#spam$/);
});

k.test('no-writes', S_LOG, 'showing the log writes nothing', () => {
    assert.deepEqual(ctx.localWrites(0), []);
});

k.test('harness-clean', S_LOG, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
