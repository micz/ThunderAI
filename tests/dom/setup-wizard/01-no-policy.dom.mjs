// Spec 08 Overview ("with no policy installed the behaviour is byte-for-byte what it was
// before this existed") and "UI", on the setup-wizard page: the managed code leaves no trace -
// nothing disabled or marked, no banner, no padlock - and the wizard runs normally.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noPolicyScenario } from '../../helpers/dom-no-policy.mjs';

const ctx = await noPolicyScenario('setup-wizard');

test('the wizard is not blocked', () => {
    assert.equal(ctx.$('#wiz_blocked').classList.contains('hidden'), true);
    assert.equal(ctx.$('#wiz_nav').classList.contains('hidden'), false);
    assert.ok(ctx.$('#connection_type'), 'the connection panel was injected');
});

test('every provider card is enabled and selectable', async () => {
    const cards = ctx.$$('.wiz_provider_card');
    assert.ok(cards.length > 0);
    for (const c of cards) {
        assert.equal(c.disabled, false, c.dataset.provider);
        assert.equal(c.classList.contains('wiz_provider_card_managed'), false, c.dataset.provider);
    }
    await ctx.click(ctx.$('.wiz_provider_card[data-provider="anthropic_api"]'));
    assert.equal(ctx.$('#connection_type').value, 'anthropic_api');
    assert.equal(ctx.ctl.localData().connection_type, 'anthropic_api');
});
