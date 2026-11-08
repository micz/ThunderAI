// Spec 02 "Organization prompts (the fourth set)": "Local display preferences belong to the
// user. Menu position and visibility ride in _default_prompts_properties, exactly as for a
// built-in, so org prompts participate in pages/menu_order/ like any other prompt." Issue #990:
// they were saved but never read back, so after a reload an org prompt was where the policy put
// it again. Here an org prompt is moved to the top of the popup, another one is shown in the
// context menu and given an icon, Save All, and the page reloads its list from storage.
//
// One page per process (the page's modules are singletons), so the reload is the page's own
// cross-tab one: a write of the prompt stores from elsewhere makes it discard its list and
// rebuild it through getPromptsForMenuOrder(), the read path of a fresh open. The restart of
// the background is covered by tests/managed/06j-org-prompts-display-properties.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/dom-page.mjs';
import { loadFixture } from '../../helpers/load.mjs';

const ctx = await openPage('menu_order', { policy: loadFixture('org-prompts.json'), local: {} });
after(() => ctx.close());

const idsIn = list => ctx.$$('#' + list + ' > li').map(li => li.dataset.id);
const rowIn = (list, id) => ctx.$$('#' + list + ' > li').find(li => li.dataset.id === id);
const preview = (list, id) => rowIn(list, id).querySelector('img.item_icon_preview');
const AIRPORT = '../../images/context_menu/custom/airport.png';

function dragEvent(type, clientY) {
    const e = new ctx.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: { effectAllowed: '', dropEffect: '', setData() {}, getData() { return ''; } } });
    Object.defineProperty(e, 'clientY', { value: clientY });
    return e;
}
/** Drag a row to the top of a list: jsdom has no layout, a pointer above every row (-1) drops first. */
async function dragToTop(from, id, to) {
    const li = rowIn(from, id);
    assert.ok(li, id + ' is not in ' + from);
    li.dispatchEvent(dragEvent('dragstart', -1));
    const target = ctx.$('#' + to);
    target.dispatchEvent(dragEvent('dragover', -1));
    target.dispatchEvent(dragEvent('drop', -1));
    li.dispatchEvent(dragEvent('dragend', -1));
    await ctx.settle();
}

test('precondition: the org prompts are listed where the policy puts them', () => {
    assert.ok(idsIn('popup_list').includes('org_acme_summary'));
    assert.notEqual(idsIn('popup_list')[0], 'org_acme_summary');
    assert.ok(idsIn('context_list_hidden').includes('org_acme_reply'));
});

test('move, show in the context menu, pick an icon, Save All', async () => {
    await dragToTop('popup_list', 'org_acme_summary', 'popup_list');
    assert.equal(idsIn('popup_list')[0], 'org_acme_summary');
    await dragToTop('context_list_hidden', 'org_acme_reply', 'context_list');
    assert.equal(idsIn('context_list')[0], 'org_acme_reply');

    await ctx.click(preview('popup_list', 'org_acme_reply'));
    const cell = [...ctx.$('.icon_picker_popover').querySelectorAll('.icon_picker_cell')]
        .find(c => c.querySelector('img').getAttribute('src').endsWith('/airport.png'));
    await ctx.click(cell);

    await ctx.click(ctx.$('#btnSaveAll'));
    const local = ctx.ctl.localData();
    assert.equal(local._default_prompts_properties.org_acme_summary.position_display, 1);
    assert.equal(local._default_prompts_properties.org_acme_reply.show_in, 'both');
    assert.equal(local._default_prompts_properties.org_acme_reply.custom_icon, 'airport.png');
    assert.equal((local._custom_prompt || []).some(p => String(p.is_org) === '1'), false,
        'an org prompt was stored as a user prompt');
});

test('after the page reloads its list from storage, the choices are still there', async () => {
    const stored = ctx.ctl.localData()._default_prompts_properties;
    await ctx.ctl.browser.storage.local.set({ _default_prompts_properties: structuredClone(stored) });
    await ctx.settle();
    assert.equal(idsIn('popup_list')[0], 'org_acme_summary');
    assert.equal(idsIn('context_list')[0], 'org_acme_reply');
    assert.equal(idsIn('context_list_hidden').includes('org_acme_reply'), false);
    assert.equal(preview('popup_list', 'org_acme_reply').getAttribute('src'), AIRPORT);
    assert.equal(preview('context_list', 'org_acme_reply').getAttribute('src'), AIRPORT);
    assert.equal(ctx.$('#btnSaveAll').disabled, true, 'what was stored is what is shown');
    const m = Object.fromEntries((await ctx.mods.prompts.getPromptsForMenuOrder()).map(p => [p.id, p]));
    assert.equal(m.org_acme_reply.text, 'Reply formally to {%mail_text_body%}', 'the text stays the policy\'s');
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
