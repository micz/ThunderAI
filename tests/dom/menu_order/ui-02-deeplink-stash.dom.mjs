// The Menu Order page opened by the "Menu position" button of the Custom Prompts editor, with no
// Menu Order tab open before: the target id waits in storage.session. No policy.
//
// Spec 02 "Menu Order Page (`pages/menu_order/`)", "'Menu position' deep-link": the stashed id is
// picked up after the initial load and deleted (read-and-deleted), and highlighted; "Sub-tab
// awareness of the deep-link": a composing-only target switches the popup panel to Composing,
// where it is the only highlighted row, and no sub-tab gets a dot.
//
// Stored state: one composing-only custom prompt, c_compose, in the popup; storage.session holds
// menu_order_highlight_target = 'c_compose', as revealPromptInMenuOrder() leaves it.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const ctx = await openPage('menu_order', {
    local: {
        _custom_prompt: [
            { id: 'c_compose', name: 'Compose helper', text: 't', type: '2', action: '0', is_default: '0',
              is_special: '0', show_in: 'popup', position_display: 1, position_compose: 1 },
        ],
    },
    session: { menu_order_highlight_target: 'c_compose' },
});
after(() => ctx.close());
const k = uiTests('menu_order', '02');
const $ = ctx.$;

const S_MO = 'spec 02 "Menu Order Page (`pages/menu_order/`)"';
const highlighted = () => ctx.$$('.sortable_item.mzta_highlight').map(li => li.parentElement.id + ':' + li.dataset.id);

k.test('stash-read-and-deleted', S_MO, 'the stashed target is read after the initial load, then deleted', async () => {
    const stash = await ctx.ctl.browser.storage.session.get(null);
    assert.equal('menu_order_highlight_target' in stash, false, 'the stash was left behind');
    assert.ok(ctx.apiCalls('browser.storage.session.remove').length > 0);
});

k.test('stash-highlight', S_MO, 'the stashed prompt is highlighted, the popup panel switched to Composing to show it', () => {
    assert.ok($('.sub_tab[data-view="compose"]').classList.contains('active'));
    assert.equal($('.sub_tab[data-view="display"]').classList.contains('active'), false);
    assert.deepEqual(highlighted(), ['popup_list:c_compose']);
    assert.equal(ctx.$$('.sub_tab.mzta_has_target').length, 0);
});

k.test('stash-nothing-pending', S_MO, 'opening on a deep-link leaves nothing unsaved', () => {
    assert.equal($('#btnSaveAll').disabled, true);
    assert.deepEqual(ctx.localWrites(0), []);
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
