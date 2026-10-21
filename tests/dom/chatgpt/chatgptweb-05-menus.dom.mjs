// The model menu during the extended check (the option ON, the newer UI): whose menu it is.
//
// Spec 04 "Model verification": the check reads the selection already in the DOM and never
// expands the simple view (the selected row is kept in the simple view's inactive model track); it
// changes neither the model, nor the effort, nor the view; it closes only a menu it opened and gives
// the focus back; a menu the user opened keeps its view and its focus on success and on timeout, and
// the manual button leaves a menu the user reopened alone; a focus the user moved during the check
// stays where it is. And the model menu's stacking: the menu holding the model picker and its Radix
// portal are raised above ThunderAI's bar (z-index 1001), other menus keep theirs.
//
// Every scenario is a fresh ChatGPT page with the real pre-script and content script, driven by the
// background's `chatgpt_send` on a controlled clock (tests/chatgptweb/chatgpt-page.mjs).

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { chatgptwebTests } from '../../helpers/known-issues/chatgptweb.mjs';
import {
    openChatGPTHost,
    scenario
} from '../../chatgptweb/chatgpt-page.mjs';

const ctx = await openChatGPTHost();
after(() => ctx.close());
const k = chatgptwebTests('05');
const S = 'spec 04 "Model verification"';

const finished = h => h.logs().filter(l => l.includes('checkGPTModel finished: ')).map(l => l.split('checkGPTModel finished: ')[1]);

for (const [model, effort] of [['gpt-6', 'none'], ['gpt-6-thinking', 'medium']]) {
    const ON = { extendedCheck: true, model, effort };

    for (const view of ['simple', 'advanced']) {
        for (const matches of [true, false]) {
            const outcome = matches ? 'success' : 'timeout';
            k.test(`${model}-user-${view}-${outcome}`, S, `${model}: a menu the user opened in the ${view} view keeps its view and focus on ${outcome}`, async () => {
                await scenario(ctx, { ...ON, selected: matches ? 'GPT-6' : 'Other' }, async h => {
                    h.openMenu();
                    const menu = h.menu();
                    if (view === 'advanced') menu.querySelector('[data-model-picker-view-toggle]').click();
                    const focused = view === 'simple'
                        ? menu.querySelector('[data-model-picker-view-toggle]')
                        : menu.querySelector('[data-model-selected]');
                    focused.focus();
                    const clicks = h.events.viewClicks;
                    await h.send();
                    if (matches) assert.deepEqual(finished(h), ['matched']);
                    else await h.advance(15000);
                    assert.ok(menu.isConnected, 'the user\'s menu was closed');
                    assert.ok(menu.querySelector(`[data-model-picker-view="${view}"]`), 'the view changed');
                    assert.equal(h.doc.activeElement, focused, 'the focus moved');
                    assert.equal(h.events.viewClicks, clicks, 'the check clicked the view toggle');
                    assert.equal(h.events.closes, 0);
                    assert.equal(h.events.opens, 1, 'the check opened a menu of its own');
                    await h.advance(1000);
                    assert.equal(h.events.sends, matches ? 1 : 0);
                    h.assertVerifierClean();
                });
            });
        }
    }

    k.test(`${model}-own-menu-focus`, S, `${model}: the menu the check opened is closed and the composer gets the focus back, the view never expanded`, async () => {
        await scenario(ctx, ON, async h => {
            h.composer().focus();
            await h.send();
            assert.deepEqual(finished(h), ['matched']);
            assert.equal(h.events.closes, 1);
            assert.equal(h.events.viewClicks, 0);
            assert.equal(h.doc.activeElement, h.composer());
        });
    });
}

k.test('user-focus-moved', S, 'a focus the user moved during the check is not taken back at the timeout', async () => {
    await scenario(ctx, { extendedCheck: true, model: 'gpt-6', selected: 'Other' }, async h => {
        await h.send();
        await h.advance(100);
        h.composer().focus();
        await h.advance(14900);
        assert.equal(h.warningShown(), true);
        assert.equal(h.doc.activeElement, h.composer());
    });
});

k.test('manual-keeps-user-menu', S, 'the manual button leaves alone a menu the user reopened after the timeout', async () => {
    await scenario(ctx, { extendedCheck: true, model: 'gpt-6', selected: 'Other' }, async h => {
        await h.send();
        await h.advance(15000);
        assert.equal(h.events.closes, 1, 'the check did not close its own menu');
        h.openMenu();
        await h.clickManual();
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
        assert.equal(h.events.closes, 1, 'the user\'s menu was closed');
        assert.ok(h.menu(), 'the user\'s menu is gone');
    });
});

k.test('stacking', S, 'the model menu and its portal are raised above the bar; another menu keeps its z-index', async () => {
    await scenario(ctx, { model: '' }, async h => {
        await h.send();
        assert.ok(h.$('.mzta-header-fixed'), 'the bar is not shown');
        h.openMenu();
        const menu = h.menu();
        const portal = h.doc.createElement('div');
        portal.setAttribute('data-radix-popper-content-wrapper', '');
        portal.style.cssText = 'position:fixed;z-index:50';
        menu.style.cssText = 'position:relative;z-index:50';
        h.doc.body.append(portal);
        portal.append(menu);
        const other = h.doc.createElement('div');
        other.setAttribute('data-radix-popper-content-wrapper', '');
        other.style.cssText = 'position:fixed;z-index:50';
        other.innerHTML = '<div role="menu" style="z-index:50">Other menu</div>';
        h.doc.body.append(other);
        const z = el => h.win.getComputedStyle(el).zIndex;
        assert.equal(z(portal), '1001');
        assert.equal(z(menu), '1001');
        assert.equal(z(other), '50');
        assert.equal(z(other.firstElementChild), '50');
        assert.equal(z(h.$('.mzta-header-fixed')), '1000');
    });
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
