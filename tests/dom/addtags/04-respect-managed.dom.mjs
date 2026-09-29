// Spec 08 "Marker placement and inertness": page logic that reassigns `disabled` must go
// through setDisabledRespectingManaged(), so a locked control is never re-enabled.
//
// add_tags_auto_uselist_list is locked; the toggle that enables it, add_tags_auto_uselist,
// stays the user's and is flipped through the page.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/dom-page.mjs';
import { REASONS } from '../../helpers/dom-known-issues.mjs';

const ctx = await openPage('addtags', {
    policy: { add_tags_auto_uselist_list: 'invoice, contract' },
    local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-user-own', add_tags_auto: true },
});
after(() => ctx.close());

const list = () => ctx.$('#add_tags_auto_uselist_list');

test('the locked list starts disabled and marked', () => {
    assert.equal(list().disabled, true);
    assert.equal(list().dataset.mztaManaged, '1');
});

test('flipping add_tags_auto_uselist never re-enables the locked list', { todo: REASONS.uselistReenabled }, async () => {
    const toggle = ctx.$('#add_tags_auto_uselist');
    for (let i = 0; i < 3; i++) {
        await ctx.click(toggle);
        assert.equal(list().disabled, true, 're-enabled with add_tags_auto_uselist=' + toggle.checked);
    }
});

test('the locked list never reached storage', () => {
    assert.equal(ctx.ctl.localData().add_tags_auto_uselist_list, undefined);
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
