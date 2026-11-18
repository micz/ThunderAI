// The options page's QNote row with QNote not installed and the switch off (the default), no AI
// connection, no policy.
//
// Spec 05 "QNote integration row" [#980]: at load the page asks QNote getStatus only (it never
// prompts); QNote not reachable and the switch off: the whole row is hidden; the row is the last
// of the Features section, after the #no_sparks notice; nothing is written at load.
//
// QNote is `otherAddons` below (the ui plugin): it rejects like an add-on that is not installed.

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
const ctx = await openPage('options', {
    otherAddons: async (id, message) => {
        if (id !== QNOTE_ID) return null;   // Sparks: absent
        toQNote.push(message);
        throw new Error('Could not establish connection. Receiving end does not exist.');
    },
});
after(() => ctx.close());
const k = uiTests('options', '10');
const $ = ctx.$;

const S_ROW = 'spec 05 "QNote integration row"';

k.test('hidden', S_ROW, 'QNote not reachable and the switch off: the whole row is hidden', () => {
    assert.equal($('#qnote_integration').checked, false);
    assert.equal(shown($('#qnote_tr')), false);
});

k.test('load-status-only', S_ROW, 'at load the page asks QNote getStatus, and nothing else', () => {
    assert.deepEqual(toQNote, [{ command: 'getStatus' }]);
});

k.test('place', S_ROW, 'the row is the last of the Features section, after the Sparks notice', () => {
    assert.equal($('#no_sparks').nextElementSibling, $('#qnote_tr'));
    assert.equal($('#qnote_tr').nextElementSibling, null);
    assert.ok($('#qnote_tr').classList.contains('feature_row'));
});

k.test('nothing-written', S_ROW, 'the preference is not written at load', () => {
    assert.equal(Object.hasOwn(ctx.ctl.localData(), 'qnote_integration'), false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
