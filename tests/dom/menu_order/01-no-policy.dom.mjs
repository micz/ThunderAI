// Spec 08 Overview ("with no policy installed the behaviour is byte-for-byte what it was
// before this existed") and "UI", on the menu_order page: the managed code leaves no trace -
// nothing disabled or marked, no banner, no padlock - and every row can be reordered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noPolicyScenario } from '../../helpers/dom-no-policy.mjs';

const ctx = await noPolicyScenario('menu_order', { usesManagedUi: false });

test('every row is draggable and none is badged as disabled by policy', () => {
    const rows = ctx.$$('li.sortable_item');
    assert.ok(rows.length > 0, 'the lists rendered');
    for (const r of rows) assert.equal(r.draggable, true, r.dataset.id);
    assert.equal(ctx.$$('.badge_inactive').length, 0);
});
