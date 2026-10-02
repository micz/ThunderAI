// Spec 08 "_disable_prompt_management" and "_disable_default_prompts" -> "Where it is
// enforced", on pages/menu_order/: the prompts a restriction makes inactive - the user's own
// and the built-in ones - are still listed (the page rewrites the stores from this list, so a
// missing prompt would be a deleted one) but dimmed, undraggable and badged
// menu_order_badge_policy_inactive. Special prompts back features of their own and are not
// touched by _disable_default_prompts.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/dom-page.mjs';

const USER_PROMPTS = [
    { id: 'prompt_mine_1', name: 'Mine', text: 'my text', type: '0', action: '0',
      is_default: '0', is_special: '0', show_in: 'both' },
];
const ctx = await openPage('menu_order', {
    policy: { _disable_prompt_management: true, _disable_default_prompts: true },
    local: { _custom_prompt: USER_PROMPTS },
});
after(() => ctx.close());

const rows = () => ctx.$$('li.sortable_item');
const rowsOf = id => rows().filter(r => r.dataset.id === id);

test('the user prompt and a built-in are listed, undraggable and badged as disabled by policy', () => {
    for (const id of ['prompt_mine_1', 'prompt_reply']) {
        const found = rowsOf(id);
        assert.ok(found.length > 0, id + ' is missing from the list');
        for (const r of found) {
            assert.equal(r.draggable, false, id + ' draggable');
            assert.equal(r.classList.contains('item_inactive'), true, id + ' not dimmed');
            const badge = r.querySelector('.badge_inactive');
            assert.ok(badge, id + ' has no badge');
            assert.equal(badge.textContent, msg('menu_order_badge_policy_inactive'));
        }
    }
});

test('special prompts stay active', () => {
    const special = rows().filter(r => /^prompt_(summarize|translate_this|get_calendar_event|get_task)$/.test(r.dataset.id));
    assert.ok(special.length > 0, 'no special prompt listed');
    for (const r of special) {
        assert.equal(r.draggable, true, r.dataset.id);
        assert.equal(r.classList.contains('item_inactive'), false, r.dataset.id);
    }
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
