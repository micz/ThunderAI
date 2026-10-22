// Spec 08 Overview ("with no policy installed the behaviour is byte-for-byte what it was
// before this existed") and "UI", on the customprompts page: the managed code leaves no trace -
// nothing disabled or marked, no banner, no padlock - and prompt management is fully available.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noPolicyScenario } from '../../helpers/dom-no-policy.mjs';

const ctx = await noPolicyScenario('customprompts');

test('New, Import and Export are available', () => {
    assert.equal(ctx.$('#btnNew').disabled, false);
    assert.notEqual(ctx.$('#import_export').style.display, 'none');
    assert.equal(ctx.$('#managed_restriction_note').classList.contains('shown'), false);
    assert.equal(ctx.$('#managed_restriction_defaults_note').classList.contains('shown'), false);
});

test('no prompt row is dimmed by a policy', () => {
    assert.ok(ctx.$$('.p_row').length > 0, 'the list rendered');
    assert.equal(ctx.$$('.p_row.is_dimmed').length, 0);
});
