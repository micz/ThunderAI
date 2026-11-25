// The options page's QNote row with the switch on at load and QNote installed (its external API),
// switched off BEFORE QNote has answered the load's getStatus, no AI connection, no policy.
//
// Spec 05 "QNote integration row" [#980]: switching off stores false and calls nothing, and the
// load's getStatus answered after it is still applied (only a requestAccess answer is newer), so the
// row stays: QNote answered with its API. Dropping that answer hid a row QNote can use, until the
// page was reloaded.
//
// QNote is `otherAddons` below (the ui plugin). The user's click comes from inside its getStatus
// handler, so it happens while the page waits for the answer, whatever the timing of the run.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { shown } from '../../ui/dom-helpers.mjs';

const QNOTE_ID = 'qnote@dqdp.net';
const toQNote = [];
let checkedWhenAsked = null;
const ctx = await openPage('options', {
    local: { qnote_integration: true },
    otherAddons: async (id, message) => {
        if (id !== QNOTE_ID) return null;   // Sparks: absent
        toQNote.push(message);
        if (message.command === 'getStatus' && checkedWhenAsked === null) {
            // The user switches off while this answer is on its way.
            const toggle = globalThis.document.getElementById('qnote_integration');
            checkedWhenAsked = toggle.checked;
            toggle.click();
        }
        return { apiVersion: 1, access: 'granted' };
    },
});
after(() => ctx.close());
const k = uiTests('options', '13');
const $ = ctx.$;

const S_ROW = 'spec 05 "QNote integration row"';

k.test('off-stored', S_ROW, 'switched off while getStatus was pending: false is stored and QNote is asked nothing more', () => {
    assert.equal(checkedWhenAsked, true, 'the switch was on when the page asked QNote');
    assert.equal($('#qnote_integration').checked, false);
    assert.strictEqual(ctx.ctl.localData().qnote_integration, false);
    assert.deepEqual(toQNote, [{ command: 'getStatus' }]);
});

k.test('row-stays', S_ROW, 'the getStatus answered after the switch went off is applied: the row stays, status line and Check access hidden', () => {
    assert.equal(shown($('#qnote_tr')), true);
    assert.equal(shown($('#qnote_status')), false);
    assert.equal(shown($('#btnQNoteCheckAccess')), false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
