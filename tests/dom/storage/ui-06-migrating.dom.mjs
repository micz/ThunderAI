// The storage management page (pages/storage/) opened while the background is still moving the
// legacy msg: records (the migration flag `_message_data_migrating` set), no policy.
//
// Spec 01 "Per-Message Data Storage" (the management pages read the migration flag on open: the
// in-progress notice, not the failure one; they show what the database holds, and never migrate:
// the legacy records and the flag are left alone), spec 05 "Storage Management Page".

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { seedMessageData } from '../../ui/dom-helpers.mjs';

await seedMessageData({
    summary: [{ messageId: 'moved@x', createdAt: 1000, summary: 'S', subject: [], from: [], message_date: '' }],
});
const LEGACY = { summary: { summary: 'old', ts: 5 } };
const ctx = await openPage('storage', { local: { _message_data_migrating: true, 'msg:legacy@x': LEGACY } });
after(() => ctx.close());
const k = uiTests('storage', '06');
const S_STORE = 'spec 01 "Per-Message Data Storage"';

k.test('notice', S_STORE, 'the in-progress notice is shown, not the failure one', () => {
    assert.notEqual(ctx.$('#storage_migrating').style.display, 'none');
    assert.equal(ctx.$('#storage_migrating').textContent, msg('storage_migration_in_progress'));
    assert.equal(ctx.$('#storage_migration_failed').style.display, 'none');
});

k.test('shows-database', S_STORE, 'the page still shows what the database holds', () => {
    assert.equal(ctx.$('#stats_body tr[data-type="summary"]').cells[1].textContent, '1');
    assert.equal(ctx.$$('#entries_body tr')[0].dataset.messageId, 'moved@x');
});

k.test('never-migrates', S_STORE, 'the page leaves the legacy records and the flag alone', () => {
    const local = ctx.ctl.localData();
    assert.equal(local._message_data_migrating, true);
    assert.deepEqual(local['msg:legacy@x'], LEGACY);
    assert.deepEqual(ctx.localWrites(0), []);
});

k.test('harness-clean', S_STORE, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
