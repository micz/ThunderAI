// The model check of the ChatGPT page with the extended model check OFF (the default).
//
// Spec 04 "Model verification": the behaviour table, column "Option off" - the newer UI (the
// composer trigger present) proceeds at once, unverified, with no menu interaction, the detected
// effort logged; the older UI (or no trigger) runs the legacy check, the warning and the manual
// button after 2 s; a free account (no model selector) proceeds; the trigger rendering late is
// detected within the legacy window; an empty model and a Custom GPT skip the check. And what
// every path keeps: no automatic send after a timeout, one send, the check's observer and timers
// gone once it ends.
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
    scenario,
    SEND_MESSAGE
} from '../../chatgptweb/chatgpt-page.mjs';

const ctx = await openChatGPTHost();
after(() => ctx.close());
const k = chatgptwebTests('01');
const S = 'spec 04 "Model verification"';

/** The model check ended, and how (its last log line). */
const finished = h => h.logs().filter(l => l.includes('checkGPTModel finished: ')).map(l => l.split('checkGPTModel finished: ')[1]);

k.test('default-new-ui-gpt6', S, 'newer UI, gpt-6: proceeds at once, unverified, no menu opened, one send', async () => {
    await scenario(ctx, { model: 'gpt-6' }, async h => {
        assert.match(h.preScript, /mztaGPTExtendedCheck="0"/);
        await h.send();
        assert.equal(h.clock.now(), 0);
        assert.deepEqual(finished(h), ['not-verified'], 'the check did not end at once');
        h.assertVerifierClean();
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
        assert.deepEqual(h.events.sentTexts, [SEND_MESSAGE.prompt]);
        assert.equal(h.events.opens, 0, 'the model menu was opened');
        assert.equal(h.warningShown(), false);
    });
});

k.test('default-new-ui-effort-logged', S, 'newer UI: the effort the trigger shows is logged, the model not verified', async () => {
    await scenario(ctx, { model: 'gpt-6', effort: 'high' }, async h => {
        await h.send();
        assert.ok(h.logs().some(l => l.includes('selected reasoning effort high') && l.includes('not verified')), h.logs().join('\n'));
    });
});

k.test('default-new-ui-mismatch', S, 'newer UI: a model and effort that do not match are not checked, the prompt is sent', async () => {
    await scenario(ctx, { model: 'gpt-6', effort: 'high', selected: 'GPT-5.6 Sol' }, async h => {
        await h.send();
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
        assert.equal(h.events.opens, 0);
        assert.equal(h.warningShown(), false);
        h.assertVerifierClean();
    });
});

k.test('default-new-ui-thinking', S, 'newer UI, gpt-6-thinking: proceeds at once, unverified', async () => {
    await scenario(ctx, { model: 'gpt-6-thinking', effort: 'none' }, async h => {
        await h.send();
        assert.deepEqual(finished(h), ['not-verified']);
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
        assert.equal(h.events.opens, 0);
    });
});

k.test('default-new-ui-other-model', S, 'newer UI, a model the extended check does not know: proceeds at once too', async () => {
    await scenario(ctx, { model: 'gpt-5-thinking' }, async h => {
        await h.send();
        assert.deepEqual(finished(h), ['not-verified']);
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
        assert.equal(h.warningShown(), false);
    });
});

k.test('explicit-off', S, 'the option set to false behaves as the default', async () => {
    await scenario(ctx, { model: 'gpt-6', extendedCheck: false }, async h => {
        assert.match(h.preScript, /mztaGPTExtendedCheck="0"/);
        await h.send();
        assert.deepEqual(finished(h), ['not-verified']);
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
        assert.equal(h.events.opens, 0);
    });
});

k.test('old-ui-match', S, 'older UI: the legacy display-name check passes at once and sends', async () => {
    await scenario(ctx, { ui: 'old', model: 'gpt-5-thinking' }, async h => {
        await h.send();
        assert.deepEqual(finished(h), ['legacy']);
        h.assertVerifierClean();
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
        assert.equal(h.warningShown(), false);
    });
});

k.test('old-ui-mismatch-2s', S, 'older UI, another model: the warning and the manual button at 2 s, not before; nothing sent', async () => {
    await scenario(ctx, { ui: 'old', model: 'gpt-6' }, async h => {
        await h.send();
        await h.advance(1999);
        assert.equal(h.warningShown(), false, 'warning before 2 s');
        assert.equal(h.manualButtonShown(), false);
        await h.advance(1);
        assert.equal(h.warningShown(), true, 'no warning at 2 s');
        assert.equal(h.manualButtonShown(), true);
        h.assertVerifierClean();
        await h.advance(20000);
        assert.equal(h.events.sends, 0);
    });
});

k.test('old-ui-late-match', S, 'older UI: the model shown after the 2 s warning does not send by itself', async () => {
    await scenario(ctx, { ui: 'old', model: 'gpt-6' }, async h => {
        await h.send();
        await h.advance(2000);
        h.$('[id*=radix] span').textContent = 'gpt-6';
        await h.advance(5000);
        assert.equal(h.events.sends, 0, 'sent automatically after the timeout');
        assert.equal(h.warningShown(), true);
    });
});

k.test('old-ui-manual', S, 'older UI: the manual button resumes once, the warning hidden, one send', async () => {
    await scenario(ctx, { ui: 'old', model: 'gpt-6' }, async h => {
        await h.send();
        await h.advance(2000);
        await h.clickManual();
        await h.clickManual();
        await h.send();
        await h.advance(1000);
        await h.clickManual();
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
        assert.equal(h.warningShown(), false);
        h.assertVerifierClean();
    });
});

k.test('free-account', S, 'no model selector at all (free account): proceeds at once', async () => {
    await scenario(ctx, { ui: 'free', model: 'gpt-6' }, async h => {
        await h.send();
        assert.deepEqual(finished(h), ['free']);
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
        assert.equal(h.warningShown(), false);
    });
});

k.test('late-trigger', S, 'the trigger rendered late, within 2 s: detected then, proceeds unverified, no warning', async () => {
    await scenario(ctx, { model: 'gpt-6' }, async h => {
        h.trigger.remove();
        h.addOtherRadixElement();
        await h.send();
        await h.advance(500);
        assert.deepEqual(finished(h), []);
        h.$('main').append(h.trigger);
        await h.flush();
        assert.deepEqual(finished(h), ['not-verified']);
        assert.equal(h.clock.now(), 500);
        h.assertVerifierClean();
        await h.advance(3000);
        assert.equal(h.events.sends, 1);
        assert.equal(h.events.opens, 0);
        assert.equal(h.warningShown(), false);
    });
});

k.test('trigger-after-window', S, 'the trigger rendered after 2 s: the legacy timeout stands, nothing sent until the button', async () => {
    await scenario(ctx, { model: 'gpt-6' }, async h => {
        h.trigger.remove();
        h.addOtherRadixElement();
        await h.send();
        await h.advance(2000);
        assert.equal(h.warningShown(), true);
        h.$('main').append(h.trigger);
        await h.advance(3000);
        assert.equal(h.events.sends, 0);
        await h.clickManual();
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
    });
});

k.test('empty-model', S, 'no model requested: no check at all, sent', async () => {
    await scenario(ctx, { model: '' }, async h => {
        await h.send();
        assert.equal(h.logs().some(l => l.includes('checkGPTModel')), false, 'the model was checked');
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
        assert.equal(h.events.opens, 0);
    });
});

k.test('custom-gpt', S, 'a Custom GPT: no check at all, sent', async () => {
    await scenario(ctx, { model: 'gpt-6', customGpt: true }, async h => {
        await h.send();
        assert.equal(h.logs().some(l => l.includes('checkGPTModel')), false, 'the model was checked');
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
    });
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
