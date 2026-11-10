// Spec 08 Overview ("with no policy installed the behaviour is byte-for-byte what it was
// before this existed") and "UI", on the storage management page (pages/storage/): the managed
// code leaves no trace - nothing disabled or marked, no banner, no padlock - and every retention
// rule is editable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noPolicyScenario } from '../../helpers/dom-no-policy.mjs';

const ctx = await noPolicyScenario('storage');

test('every retention rule and the automatic cleanup switch are editable', () => {
    const rules = ctx.$$('.rule_input');
    // Three rules per type (the SmartBar's included), the automatic cleanup switch.
    assert.equal(rules.length, 13);
    for (const el of rules) assert.equal(el.disabled, false, el.id);
});
