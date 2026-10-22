// Spec 08 Overview ("with no policy installed the behaviour is byte-for-byte what it was
// before this existed") and "UI", on the addtags page: the managed code leaves no trace -
// nothing disabled or marked, no banner, no padlock - and the prompt text and its buttons, and the account selector, are editable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noPolicyScenario } from '../../helpers/dom-no-policy.mjs';
import { loadFixture } from '../../helpers/load.mjs';

const ctx = await noPolicyScenario('addtags', { accounts: loadFixture('accounts.json') });

test('the special prompt text is editable', () => {
    for (const id of ['addtags_prompt_text']) {
        const ta = ctx.$('#' + id);
        assert.ok(ta, id);
        assert.equal(ta.readOnly, false, id);
        assert.equal(ta.disabled, false, id);
    }
});

test('the Save and Reset buttons carry no managed mark (their state is up to the page)', () => {
    for (const id of ['btn_reset_prompt'].flatMap(r => [r, r.replace('reset', 'save')])) {
        assert.ok(ctx.$('#' + id), id);
        assert.equal(ctx.$('#' + id).dataset.mztaManaged, undefined, id);
    }
});

test('the account selector is editable, with no managed note', () => {
    const boxes = ctx.$$('#account_selector_checkboxes input[type="checkbox"]');
    assert.ok(boxes.length > 0, 'the account checkboxes were built');
    for (const b of boxes) assert.equal(b.disabled, false, b.value);
    assert.equal(ctx.$('#accounts_select_all').disabled, false);
    assert.equal(ctx.$('#accounts_deselect_all').disabled, false);
    assert.equal(ctx.$('#account_selector_checkboxes_managed_note'), null);
});
