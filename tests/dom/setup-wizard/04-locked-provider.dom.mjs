// Spec 08 "The setup wizard": the provider cards are <button>s, out of applyManagedUI()'s
// reach, so a locked connection_type needs two guards of its own:
//  - selectProvider() returns early when the requested provider differs from the current one
//    (the boot call still selects the enforced provider);
//  - buildProviderCards() disables every card and adds .wiz_provider_card_managed; the
//    selected card keeps full opacity so the administrator's choice stays readable.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/dom-page.mjs';

const ctx = await openPage('setup-wizard', {
    policy: { connection_type: 'anthropic_api' },
    local: { connection_type: 'ollama_api' },
});
after(() => ctx.close());

const card = p => ctx.$(`.wiz_provider_card[data-provider="${p}"]`);

test('the enforced provider is the selected one', () => {
    assert.equal(ctx.$('#connection_type').value, 'anthropic_api');
    assert.equal(card('anthropic_api').classList.contains('wiz_selected'), true);
    assert.equal(card('ollama_api').classList.contains('wiz_selected'), false);
});

test('every card is disabled and marked managed, the enforced one included', () => {
    const cards = ctx.$$('.wiz_provider_card');
    assert.ok(cards.length > 1);
    for (const c of cards) {
        assert.equal(c.disabled, true, c.dataset.provider);
        assert.equal(c.classList.contains('wiz_provider_card_managed'), true, c.dataset.provider);
    }
});

test('a card clicked - even re-enabled by hand - does not switch the provider', async () => {
    const c = card('google_gemini_api');
    c.disabled = false;
    await ctx.click(c);
    assert.equal(ctx.$('#connection_type').value, 'anthropic_api');
    assert.equal(card('google_gemini_api').classList.contains('wiz_selected'), false);
    assert.equal(ctx.ctl.localData().connection_type, 'ollama_api', 'the stored user value changed');
});

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
