// The options page opened while the background is still moving the saved per-message data from
// storage.local to IndexedDB (the migration flag `_message_data_migrating` set), no policy.
//
// Spec 01 "Per-Message Data Storage" (who opens the database: the management pages check the
// migration flag on open and show a short notice while it is set) and spec 05 "Options Page
// Advanced Section" (the storage block). The page never migrates anything itself.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const LEGACY = { 'msg:<a@example.com>': { v: 1, ts: 1, summary: { summary: 'not moved yet', ts: 1 } } };
const ctx = await openPage('options', {
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-test-key', _message_data_migrating: true, ...LEGACY },
});
after(() => ctx.close());
const k = uiTests('options', '08');
const S_STORE = 'spec 01 "Per-Message Data Storage"';

k.test('migrating-notice', S_STORE, 'the migration notice is shown in the storage block', () => {
    // Its own display: the advanced panel around it starts collapsed.
    assert.notEqual(ctx.$('#message_storage_migrating').style.display, 'none');
    assert.match(ctx.$('#message_storage_migrating').textContent, /moving the saved/);
    assert.equal(ctx.$('#message_storage_migration_failed').style.display, 'none', 'not the failure notice');
});

k.test('migrating-size', S_STORE, 'the size is still read from IndexedDB (nothing there yet)', () => {
    assert.equal(ctx.$('#message_storage_size').textContent, '0 Bytes');
});

k.test('page-never-migrates', S_STORE, 'the page leaves the legacy records and the flag alone', () => {
    const local = ctx.ctl.localData();
    assert.deepEqual(local['msg:<a@example.com>'], LEGACY['msg:<a@example.com>']);
    assert.equal(local._message_data_migrating, true);
});

k.test('harness-clean', S_STORE, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
