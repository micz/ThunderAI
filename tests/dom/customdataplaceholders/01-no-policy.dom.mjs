// Spec 08 Overview ("with no policy installed the behaviour is byte-for-byte what it was
// before this existed") and "UI", on the customdataplaceholders page: the managed code leaves no trace -
// nothing disabled or marked, no banner, no padlock - and the page renders as usual.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noPolicyScenario } from '../../helpers/dom-no-policy.mjs';

const ctx = await noPolicyScenario('customdataplaceholders', { usesManagedUi: false });

test('the placeholder editor is available', () => {
    assert.equal(ctx.$('#btnNew').disabled, false);
    assert.notEqual(ctx.$('#import_export').style.display, 'none');
});
