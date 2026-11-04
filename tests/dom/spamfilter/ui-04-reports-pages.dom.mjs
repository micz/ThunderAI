// The spam log of the Spam Filter page, paged: 120 saved reports, no policy.
//
// Spec 05 "Spam Filter page" log (#955): 50 rows per page, newest first, read from the database
// (getPage() on the createdAt index, count() for the total); Previous and Next; a label such as
// "1–50 of 120"; the report date is the time the report was saved (createdAt). No search, no
// sorting. Spec 02 "Missing special prompts": the log's empty-state row is kept (ui-02).

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
const S_LOG = 'spec 05 "Spam Filter page"';
const ids = () => ctx.$$('#report_data_body tr').map(r => r.cells[0].textContent);
const label = () => ctx.$('#report_page_label').textContent;
const prev = () => ctx.$('#report_prev_btn');
const next = () => ctx.$('#report_next_btn');
const range = (from, to) => Array.from({ length: from - to + 1 }, (_, i) => 'r' + (from - i) + '@x');

k.test('first-page', S_LOG, 'the first page: the 50 newest reports, newest first', () => {
    assert.deepEqual(ids(), range(119, 70));
});

k.test('first-label', S_LOG, 'the label says "1–50 of 120"; Previous disabled, Next enabled; the pager shown', () => {
    assert.equal(label(), msg('spamfilter_report_page_label', ['1', '50', '120']));
    assert.equal(label(), '1–50 of 120');
    assert.equal(prev().disabled, true);
    assert.equal(next().disabled, false);
    assert.notEqual(ctx.$('#report_pager').style.display, 'none');
});

k.test('report-date', S_LOG, 'the report date column is the createdAt of the record', () => {
    const row = ctx.$$('#report_data_body tr')[0];
    assert.equal(row.cells[7].textContent, new Date(BASE + 119 * 60000).toLocaleString());
});

k.test('next', S_LOG, 'Next shows the following 50, "51–100 of 120"', async () => {
    await ctx.click(next());
    assert.deepEqual(ids(), range(69, 20));
    assert.equal(label(), '51–100 of 120');
    assert.equal(prev().disabled, false);
    assert.equal(next().disabled, false);
});

k.test('last', S_LOG, 'the last page holds the 20 oldest, "101–120 of 120", Next disabled', async () => {
    await ctx.click(next());
    assert.deepEqual(ids(), range(19, 0));
    assert.equal(label(), '101–120 of 120');
    assert.equal(next().disabled, true);
});

k.test('previous', S_LOG, 'Previous goes back a page, then to the first', async () => {
    await ctx.click(prev());
    assert.deepEqual(ids(), range(69, 20));
    await ctx.click(prev());
    assert.deepEqual(ids(), range(119, 70));
    assert.equal(prev().disabled, true);
});

k.test('no-writes', S_LOG, 'paging writes nothing', () => {
    assert.deepEqual(ctx.localWrites(0), []);
});

k.test('harness-clean', S_LOG, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
