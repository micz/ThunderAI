// The Spam Filter page opened after the move of the saved reports from storage.local to IndexedDB
// failed (the migration flag `_message_data_migrating` set to 'failed'), no policy.
//
// Spec 01 "Per-Message Data Storage" (the flag's three states: after a failed attempt the pages say
// so, show what the database holds, and never migrate) and spec 05 "Spam Filter page" log.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { seedMessageData } from '../../ui/dom-helpers.mjs';

const LEGACY = { 'msg:<old@x.example>': { v: 1, ts: 1, spam: { spamValue: 90, explanation: 'x', ts: 1 } } };
// A report saved after the failed attempt: the database works again for the new data.
await seedMessageData({ spam: [{
    messageId: 'new@x', createdAt: Date.UTC(2026, 2, 1), spamValue: 10, explanation: 'n',
    subject: [], from: [], message_date: '', moved: false, SpamThreshold: 70,
}] });
const ctx = await openPage('spamfilter', {
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-test-key', spamfilter: true, _message_data_migrating: 'failed', ...LEGACY },
});
after(() => ctx.close());
const k = uiTests('spamfilter', '06');
const S_STORE = 'spec 01 "Per-Message Data Storage"';

k.test('failed-notice', S_STORE, 'the failure notice is shown above the log', () => {
    assert.notEqual(ctx.$('#report_migration_failed').style.display, 'none');
    assert.equal(ctx.$('#report_migration_failed').textContent, msg('storage_migration_failed'));
});

k.test('failed-table', S_STORE, 'the log shows what the database holds, not the migration notice', () => {
    const rows = ctx.$$('#report_data_body tr');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cells[0].textContent, 'new@x');
});

k.test('page-never-migrates', S_STORE, 'the page leaves the legacy records and the flag alone', () => {
    const local = ctx.ctl.localData();
    assert.deepEqual(local['msg:<old@x.example>'], LEGACY['msg:<old@x.example>']);
    assert.equal(local._message_data_migrating, 'failed');
});

k.test('harness-clean', S_STORE, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
