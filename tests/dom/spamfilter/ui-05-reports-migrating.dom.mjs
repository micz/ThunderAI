// The Spam Filter page opened while the background is still moving the saved reports from
// storage.local to IndexedDB (the migration flag `_message_data_migrating` set), no policy.
//
// Spec 01 "Per-Message Data Storage" (the management pages check the migration flag on open and,
// while it is set, show a short notice instead of an empty table; they never migrate) and spec 05
// "Spam Filter page" log.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const LEGACY = { 'msg:<old@x.example>': { v: 1, ts: 1, spam: { spamValue: 90, explanation: 'x', ts: 1 } } };
const ctx = await openPage('spamfilter', {
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-test-key', spamfilter: true, _message_data_migrating: true, ...LEGACY },
});
after(() => ctx.close());
const k = uiTests('spamfilter', '05');
const S_STORE = 'spec 01 "Per-Message Data Storage"';

k.test('notice-row', S_STORE, 'the log shows the migration notice in its one row, not the empty-state text', () => {
    assert.ok(ctx.$('#report_data thead tr'), 'the header row is kept');
    const rows = ctx.$$('#report_data_body tr');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cells[0].colSpan, 8);
    assert.equal(rows[0].cells[0].textContent, msg('storage_migration_in_progress'));
    assert.equal(ctx.$('#report_migration_failed').style.display, 'none', 'not the failure notice');
});

k.test('no-pager', S_STORE, 'no pager (the log has none); the link to the storage page is kept while the reports are being moved', () => {
    assert.equal(ctx.$('#report_pager'), null);
    assert.ok(ctx.$('#report_manage_link'));
});

k.test('page-never-migrates', S_STORE, 'the page leaves the legacy records and the flag alone', () => {
    const local = ctx.ctl.localData();
    assert.deepEqual(local['msg:<old@x.example>'], LEGACY['msg:<old@x.example>']);
    assert.equal(local._message_data_migrating, true);
});

k.test('harness-clean', S_STORE, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
