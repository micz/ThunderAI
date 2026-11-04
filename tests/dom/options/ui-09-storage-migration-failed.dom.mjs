// The options page opened after the move of the saved per-message data from storage.local to
// IndexedDB failed (the migration flag `_message_data_migrating` set to 'failed'), no policy.
//
// Spec 01 "Per-Message Data Storage" (the flag's three states: after a failed attempt the pages say
// so, and never migrate) and spec 05 "Options Page Advanced Section" (the storage block).

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const LEGACY = { 'msg:<a@example.com>': { v: 1, ts: 1, summary: { summary: 'not moved', ts: 1 } } };
const ctx = await openPage('options', {
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-test-key', _message_data_migrating: 'failed', ...LEGACY },
});
after(() => ctx.close());
const k = uiTests('options', '09');
const S_STORE = 'spec 01 "Per-Message Data Storage"';

k.test('failed-notice', S_STORE, 'the failure notice is shown in the storage block, the in-progress one is not', () => {
    // Their own display: the advanced panel around them starts collapsed.
    assert.notEqual(ctx.$('#message_storage_migration_failed').style.display, 'none');
    assert.equal(ctx.$('#message_storage_migration_failed').textContent, msg('storage_migration_failed'));
    assert.equal(ctx.$('#message_storage_migrating').style.display, 'none');
});

k.test('failed-size', S_STORE, 'the size is still read from IndexedDB', () => {
    assert.equal(ctx.$('#message_storage_size').textContent, '0 Bytes');
});

k.test('page-never-migrates', S_STORE, 'the page leaves the legacy records and the flag alone', () => {
    const local = ctx.ctl.localData();
    assert.deepEqual(local['msg:<a@example.com>'], LEGACY['msg:<a@example.com>']);
    assert.equal(local._message_data_migrating, 'failed');
});

k.test('harness-clean', S_STORE, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
