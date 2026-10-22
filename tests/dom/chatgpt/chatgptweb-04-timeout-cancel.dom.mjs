// After the model check gives up, and when the page goes away.
//
// Spec 04 "Model verification": a timeout stops the observation and the polling and shows the
// warning and the "Use the current model" button; a DOM change after it never sends by itself; the
// button resumes the flow once (repeated clicks, a second chatgpt_send: one send) and hides the
// warning; an approval is not reused by the next check (a retry checks again); leaving the page
// (pagehide) cancels the check, or the wait for the button, without sending. Whichever way the check
// ends, it leaves no observer, no poll and no deadline behind - on the extended and the legacy path.
//
// Every scenario is a fresh ChatGPT page with the real pre-script and content script, driven by the
// background's `chatgpt_send` on a controlled clock (tests/chatgptweb/chatgpt-page.mjs).

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import {
    assertHarnessClean,
    msg
} from '../../helpers/core/dom-harness.mjs';
import { chatgptwebTests } from '../../helpers/known-issues/chatgptweb.mjs';
import {
    openChatGPTHost,
    scenario
} from '../../chatgptweb/chatgpt-page.mjs';

const ctx = await openChatGPTHost();
after(() => ctx.close());
const k = chatgptwebTests('04');
const S = 'spec 04 "Model verification"';
// A check that cannot pass: the extended one (wrong effort), the legacy one (another model shown).
const PATHS = {
    extended: { opts: { extendedCheck: true, model: 'gpt-6', effort: 'high' }, deadline: 15000 },
    legacy: { opts: { ui: 'old', model: 'gpt-6' }, deadline: 2000 },
};
// Make the page match the requested model, after the fact.
const MATCH = {
    extended: h => h.trigger.setAttribute('data-selected-reasoning-effort', 'none'),
    legacy: h => { h.$('[id*=radix] span').textContent = 'gpt-6'; },
};

for (const [path, { opts, deadline }] of Object.entries(PATHS)) {
    k.test(`${path}-probe-live`, S, `${path}: while it runs, the check holds its observer, its poll and its deadline`, async () => {
        await scenario(ctx, opts, async h => {
            await h.send();
            await h.advance(deadline - 1);
            assert.deepEqual(h.verifierResources(), { observers: 1, timers: 2 });
            await h.advance(1);
            assert.deepEqual(h.verifierResources(), { observers: 0, timers: 0 });
        });
    });

    k.test(`${path}-no-send-after-timeout`, S, `${path}: the page matching after the timeout sends nothing by itself`, async () => {
        await scenario(ctx, opts, async h => {
            await h.send();
            await h.advance(deadline);
            assert.equal(h.warningShown(), true);
            MATCH[path](h);
            await h.advance(20000);
            assert.equal(h.events.sends, 0, 'sent automatically after the timeout');
            h.assertVerifierClean();
        });
    });

    k.test(`${path}-manual-once`, S, `${path}: repeated clicks and a second chatgpt_send resume once: one send, the warning hidden`, async () => {
        await scenario(ctx, opts, async h => {
            await h.send();
            await h.advance(deadline);
            await h.clickManual();
            await h.clickManual();
            await h.send();
            await h.advance(1000);
            await h.clickManual();
            await h.send();
            await h.advance(1000);
            assert.equal(h.events.sends, 1);
            assert.equal(h.warningShown(), false);
            h.assertVerifierClean();
        });
    });

    k.test(`${path}-pagehide-during`, S, `${path}: leaving the page during the check cancels it, nothing sent, nothing left`, async () => {
        await scenario(ctx, opts, async h => {
            await h.send();
            await h.advance(100);
            await h.pagehide();
            h.assertVerifierClean();
            await h.advance(deadline + 5000);
            assert.equal(h.events.sends, 0);
            assert.equal(h.warningShown(), false);
        });
    });

    k.test(`${path}-pagehide-after-timeout`, S, `${path}: leaving the page after the timeout cancels the wait for the button`, async () => {
        await scenario(ctx, opts, async h => {
            await h.send();
            await h.advance(deadline);
            await h.pagehide();
            await h.clickManual();
            await h.advance(1000);
            assert.equal(h.events.sends, 0, 'sent after the page was left');
            h.assertVerifierClean();
        });
    });
}

k.test('approval-not-reused', S, 'the manual approval of one check does not pass the next (the retry after a missing composer)', async () => {
    await scenario(ctx, { ...PATHS.extended.opts, composer: false }, async h => {
        await h.send();
        await h.advance(15000);
        await h.clickManual();
        // findPromptInput() (15 s), then the wait for the user to click into a composer (60 s)
        await h.advance(75000);
        const retry = h.$('#mzta-btn_retry');
        assert.ok(retry, 'no retry button');
        const composer = h.doc.createElement('div');
        composer.id = 'prompt-textarea';
        composer.className = 'ProseMirror';
        composer.setAttribute('contenteditable', 'true');
        h.$('main').prepend(composer);
        retry.click();
        await h.advance(800 + 14999);
        assert.equal(h.events.sends, 0, 'the earlier approval passed the second check');
        assert.equal(h.warningShown(), false);
        await h.advance(1);
        assert.equal(h.warningShown(), true, 'the second check did not time out on its own');
        await h.pagehide();
        h.assertVerifierClean();
    });
});

k.test('retry-timeout-button', S, 'a check timing out on the retry shows the model warning and its button again, and the button resumes', async () => {
    await scenario(ctx, { ...PATHS.extended.opts, composer: false }, async h => {
        await h.send();
        await h.advance(15000);
        await h.clickManual();
        await h.advance(75000);
        const composer = h.doc.createElement('div');
        composer.id = 'prompt-textarea';
        composer.className = 'ProseMirror';
        composer.setAttribute('contenteditable', 'true');
        h.$('main').prepend(composer);
        h.$('#mzta-btn_retry').click();
        await h.advance(800 + 15000);
        assert.equal(h.warningShown(), true);
        assert.ok(h.$('#mzta-model_warn').textContent.startsWith(msg('chatgpt_win_model_warning')),
            'the warning does not say the model could not be verified: ' + h.$('#mzta-model_warn').textContent);
        assert.equal(h.manualButtonShown(), true, 'no "Use the current model" button');
        await h.clickManual();
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
    });
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
