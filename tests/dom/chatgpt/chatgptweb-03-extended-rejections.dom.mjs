// What the extended model check refuses (the option ON, the newer UI, a model it knows).
//
// Spec 04 "Model verification": the effort on the trigger must be the model's (`none` for gpt-6,
// `medium` for gpt-6-thinking), and with a wrong effort the menu is not even opened; in the open menu
// the trigger owns, exactly one visible row must be both checked and selected, outside any hidden or
// inert ancestor but the simple view's inactive model track; the full name must match (GPT-6.1 and
// GPT-6 Pro do not satisfy gpt-6); text elsewhere in the page does not count. Each refusal runs to
// the 15 s deadline - not the legacy 2 s - then shows the warning and the manual button, sends
// nothing, closes the menu it opened and leaves no observer or timer. With no trigger at all but
// other Radix elements, the page is not a free account: the legacy check, 2 s.
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
const k = chatgptwebTests('03');
const S = 'spec 04 "Model verification"';
const ON = { extendedCheck: true, model: 'gpt-6' };

/** The verification runs to its 15 s deadline: no warning before, the warning and button then, nothing sent. */
async function refusedAtDeadline(h) {
    await h.send();
    await h.advance(2000);
    assert.equal(h.warningShown(), false, 'the legacy 2 s applied to the extended verification');
    await h.advance(12999);
    assert.equal(h.warningShown(), false, 'warning before 15 s');
    await h.advance(1);
    assert.equal(h.warningShown(), true, 'no warning at 15 s');
    assert.equal(h.manualButtonShown(), true);
    assert.equal(h.events.sends, 0, 'sent although the model was not verified');
    h.assertVerifierClean();
    await h.advance(5000);
    assert.equal(h.events.sends, 0);
}

for (const label of ['GPT-6.1', 'GPT-6 Pro', 'GPT-5.6 Sol']) {
    k.test(`name-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, S, `gpt-6 refuses the selected model "${label}"`, async () => {
        await scenario(ctx, { ...ON, selected: label }, refusedAtDeadline);
    });
}

for (const effort of ['medium', 'high', 'unknown']) {
    k.test(`effort-${effort}`, S, `gpt-6 (Instant) refuses the effort "${effort}" without opening the menu`, async () => {
        await scenario(ctx, { ...ON, effort }, async h => {
            await refusedAtDeadline(h);
            assert.equal(h.events.opens, 0, 'the menu was opened with the wrong effort');
        });
    });
}

k.test('thinking-refuses-instant', S, 'gpt-6-thinking (Medium) refuses the effort "none"', async () => {
    await scenario(ctx, { ...ON, model: 'gpt-6-thinking', effort: 'none' }, refusedAtDeadline);
});

k.test('unselected-and-body-text', S, 'the GPT-6 row not selected, "GPT-6 Instant" written in the page: refused', async () => {
    await scenario(ctx, ON, async h => {
        const rows = h.template.querySelectorAll('[role="menuitemradio"]');
        rows[0].setAttribute('aria-checked', 'false');
        rows[0].removeAttribute('data-model-selected');
        rows[1].setAttribute('aria-checked', 'true');
        rows[1].setAttribute('data-model-selected', 'true');
        const text = h.doc.createElement('p');
        text.textContent = 'GPT-6 Instant';
        h.doc.body.append(text);
        await refusedAtDeadline(h);
    });
});

k.test('unrelated-menu', S, 'an open menu the trigger does not own is not read', async () => {
    await scenario(ctx, ON, async h => {
        h.openMenu();
        h.menu().setAttribute('aria-labelledby', 'other');
        await refusedAtDeadline(h);
    });
});

k.test('hidden-row', S, 'a selected row that is hidden is refused', async () => {
    await scenario(ctx, ON, async h => {
        h.template.querySelector('[data-model-selected]').hidden = true;
        await refusedAtDeadline(h);
    });
});

k.test('checked-not-selected', S, 'a row checked but not marked selected is refused', async () => {
    await scenario(ctx, ON, async h => {
        h.template.querySelector('[data-model-selected]').removeAttribute('data-model-selected');
        await refusedAtDeadline(h);
    });
});

k.test('unexpected-track', S, 'a selected row in a hidden track that is not the simple view\'s model track is refused', async () => {
    await scenario(ctx, ON, async h => {
        h.template.querySelector('[data-model-selected]').parentElement.removeAttribute('data-active');
        await refusedAtDeadline(h);
    });
});

k.test('nested-hidden', S, 'a selected row itself aria-hidden is refused', async () => {
    await scenario(ctx, ON, async h => {
        h.template.querySelector('[data-model-selected]').setAttribute('aria-hidden', 'true');
        await refusedAtDeadline(h);
    });
});

k.test('duplicate-selection', S, 'two selected rows are refused', async () => {
    await scenario(ctx, ON, async h => {
        const row = h.template.querySelector('[data-model-selected]');
        row.parentElement.append(row.cloneNode(true));
        await refusedAtDeadline(h);
    });
});

k.test('closes-own-menu', S, 'on a refusal the menu it opened is closed at the deadline', async () => {
    await scenario(ctx, { ...ON, selected: 'Other' }, async h => {
        await h.send();
        assert.equal(h.events.opens, 1);
        assert.ok(h.menu(), 'the menu was not opened');
        await h.advance(15000);
        assert.equal(h.events.closes, 1);
        assert.equal(h.menu(), null);
    });
});

k.test('missing-trigger', S, 'no trigger but other Radix elements: not a free account, the legacy check, the warning at 2 s', async () => {
    await scenario(ctx, ON, async h => {
        h.trigger.remove();
        h.addOtherRadixElement();
        await h.send();
        await h.advance(1999);
        assert.equal(h.warningShown(), false);
        await h.advance(1);
        assert.equal(h.warningShown(), true);
        assert.equal(h.events.sends, 0);
        h.assertVerifierClean();
    });
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
