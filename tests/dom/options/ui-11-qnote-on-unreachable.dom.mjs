// The options page's QNote row with the switch on and QNote not reachable, no AI connection, no
// policy.
//
// Spec 05 "QNote integration row" [#980]: with the switch on the row stays visible even though
// QNote does not answer, with the "not reachable" status, so the user can switch it off; switching
// it off stores false and asks QNote nothing.
//
// QNote is `otherAddons` below (the ui plugin): it rejects like an add-on that is not installed.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { shown } from '../../ui/dom-helpers.mjs';

const QNOTE_ID = 'qnote@dqdp.net';
const toQNote = [];
const ctx = await openPage('options', {
    local: { qnote_integration: true },
    otherAddons: async (id, message) => {
        if (id !== QNOTE_ID) return null;   // Sparks: absent
        toQNote.push(message);
        throw new Error('Could not establish connection. Receiving end does not exist.');
    },
});
after(() => ctx.close());
const k = uiTests('options', '11');
const $ = ctx.$;

const S_ROW = 'spec 05 "QNote integration row"';

k.test('visible-while-on', S_ROW, 'switched on, QNote not reachable: the row shows, with the "not reachable" status and Check access', () => {
    assert.equal($('#qnote_integration').checked, true);
    assert.equal(shown($('#qnote_tr')), true);
    assert.equal($('#qnote_status').textContent, msg('prefs_qnote_status_not_reachable'));
    assert.equal(shown($('#qnote_status')), true);
    assert.equal(shown($('#btnQNoteCheckAccess')), true);
    assert.equal($('#btnQNoteCheckAccess').textContent.trim(), msg('prefs_OptionText_qnote_check_access'));
});

k.test('enabled-no-connection', S_ROW, 'with no AI connection the switch stays usable', () => {
    assert.equal($('#qnote_integration').disabled, false);
    assert.equal($('#add_tags').disabled, true, 'a feature row that needs the connection is greyed');
});

k.test('load-status-only', S_ROW, 'at load the page asks QNote getStatus, and nothing else', () => {
    assert.deepEqual(toQNote, [{ command: 'getStatus' }]);
});

k.test('switch-off', S_ROW, 'switched off: false is stored, QNote is asked nothing, and the row hides (QNote not reachable)', async () => {
    await ctx.click($('#qnote_integration'));
    assert.strictEqual(ctx.ctl.localData().qnote_integration, false);
    assert.deepEqual(toQNote, [{ command: 'getStatus' }]);
    assert.equal(shown($('#qnote_tr')), false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
