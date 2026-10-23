// The model check of the ChatGPT page with the extended model check ON: what passes, and which
// check each page gets.
//
// Spec 04 "Model verification": the behaviour table, column "Option on" - the newer UI with a model
// the extended check knows (gpt-6, gpt-6-thinking) is verified, with its own 15 s deadline; any
// other model gets the legacy check and its 2 s; the older UI and a free account as with the option
// off. The extended verification: the effort on the trigger, the selected row of the menu the
// trigger owns, the model's name compared trimmed and lower case; a fresh DOM read on every check
// (a late or replaced trigger); a match just before the deadline still sends; the menu it opened is
// closed (its focus: chatgptweb-05); one send through the page's own send function. The option
// reaching the retry path: a second attempt checks the model again the same way.
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
const k = chatgptwebTests('02');
const S = 'spec 04 "Model verification"';
const ON = { extendedCheck: true };

const finished = h => h.logs().filter(l => l.includes('checkGPTModel finished: ')).map(l => l.split('checkGPTModel finished: ')[1]);

for (const [model, effort] of [['gpt-6', 'none'], ['gpt-6-thinking', 'medium']]) {
    k.test(`${model}-sends`, S, `${model}: verified, then sent once through the page's send function; the menu it opened closed`, async () => {
        await scenario(ctx, { ...ON, model, effort }, async h => {
            assert.match(h.preScript, /mztaGPTExtendedCheck="1"/);
            await h.send();
            assert.deepEqual(finished(h), ['matched']);
            assert.equal(h.events.opens, 1, 'the menu was not opened once');
            assert.equal(h.events.closes, 1, 'the menu it opened was not closed');
            assert.equal(h.events.viewClicks, 0, 'the simple view was expanded');
            assert.equal(h.menu(), null);
            h.assertVerifierClean();
            await h.advance(1000);
            assert.equal(h.events.sends, 1);
            assert.deepEqual(h.events.sentTexts, [SEND_MESSAGE.prompt]);
            assert.equal(h.warningShown(), false);
        });
    });
}

k.test('name-normalized', S, 'the selected name is compared trimmed and in lower case', async () => {
    await scenario(ctx, { ...ON, model: 'gpt-6', selected: '  gpt-6  ' }, async h => {
        await h.send();
        assert.deepEqual(finished(h), ['matched']);
    });
});

k.test('trigger-replaced', S, 'a trigger replaced during the check is read afresh; a second chatgpt_send is ignored; one send', async () => {
    await scenario(ctx, { ...ON, model: 'gpt-6', effort: 'high' }, async h => {
        await h.send();
        await h.send();
        await h.advance(100);
        const replacement = h.trigger.cloneNode(true);
        replacement.setAttribute('data-selected-reasoning-effort', 'none');
        h.wirePicker(replacement);
        h.trigger.replaceWith(replacement);
        await h.advance(1000);
        assert.deepEqual(finished(h), ['matched']);
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
        h.assertVerifierClean();
    });
});

k.test('match-before-deadline', S, 'a match at the last poll before 15 s sends, with no warning', async () => {
    await scenario(ctx, { ...ON, model: 'gpt-6', effort: 'high' }, async h => {
        await h.send();
        await h.advance(14999);
        assert.equal(h.warningShown(), false);
        h.trigger.setAttribute('data-selected-reasoning-effort', 'none');
        await h.advance(1001);
        assert.equal(h.events.sends, 1);
        assert.equal(h.warningShown(), false);
        h.assertVerifierClean();
    });
});

k.test('late-trigger', S, 'the trigger rendered late, within 2 s: the extended verification starts then and sends', async () => {
    await scenario(ctx, { ...ON, model: 'gpt-6' }, async h => {
        h.trigger.remove();
        h.addOtherRadixElement();
        await h.send();
        await h.advance(500);
        assert.equal(h.events.opens, 0);
        h.$('main').append(h.trigger);
        await h.flush();
        assert.deepEqual(finished(h), ['matched']);
        assert.equal(h.events.opens, 1);
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
    });
});

k.test('late-trigger-deadline', S, 'the extended deadline runs 15 s from the moment the trigger was seen, not from 2 s', async () => {
    await scenario(ctx, { ...ON, model: 'gpt-6', effort: 'high' }, async h => {
        h.trigger.remove();
        h.addOtherRadixElement();
        await h.send();
        await h.advance(500);
        h.$('main').append(h.trigger);
        await h.flush();
        await h.advance(14999);
        assert.equal(h.clock.now(), 15499);
        assert.equal(h.warningShown(), false, 'the legacy 2 s, or the 15 s from the start, still applied');
        await h.advance(1);
        assert.equal(h.warningShown(), true);
        assert.equal(h.manualButtonShown(), true);
        assert.equal(h.events.sends, 0);
        h.assertVerifierClean();
    });
});

k.test('other-model-legacy-2s', S, 'newer UI, a model the extended check does not know: the legacy check, the manual button at 2 s, no menu', async () => {
    await scenario(ctx, { ...ON, model: 'gpt-5-thinking' }, async h => {
        await h.send();
        await h.advance(1999);
        assert.equal(h.warningShown(), false);
        await h.advance(1);
        assert.equal(h.warningShown(), true);
        assert.equal(h.manualButtonShown(), true);
        assert.equal(h.events.opens, 0, 'the menu was opened for a model the extended check does not know');
        assert.equal(h.events.sends, 0);
        h.assertVerifierClean();
        await h.clickManual();
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
    });
});

k.test('old-ui-match', S, 'older UI: the legacy display-name check passes at once and sends', async () => {
    await scenario(ctx, { ...ON, ui: 'old', model: 'gpt-5-thinking' }, async h => {
        await h.send();
        assert.deepEqual(finished(h), ['legacy']);
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
    });
});

k.test('old-ui-gpt6-2s', S, 'older UI, gpt-6 (no trigger): the legacy check, the manual button at 2 s', async () => {
    await scenario(ctx, { ...ON, ui: 'old', model: 'gpt-6' }, async h => {
        await h.send();
        await h.advance(1999);
        assert.equal(h.warningShown(), false);
        await h.advance(1);
        assert.equal(h.warningShown(), true);
        assert.equal(h.events.sends, 0);
        h.assertVerifierClean();
    });
});

k.test('free-account', S, 'no model selector at all (free account): proceeds at once', async () => {
    await scenario(ctx, { ...ON, ui: 'free', model: 'gpt-6' }, async h => {
        await h.send();
        assert.deepEqual(finished(h), ['free']);
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
    });
});

k.test('retry-path', S, 'no composer: the retry checks the model again with the option, then sends once', async () => {
    await scenario(ctx, { ...ON, model: 'gpt-6', composer: false }, async h => {
        const composer = h.doc.createElement('div');
        composer.id = 'prompt-textarea';
        composer.className = 'ProseMirror';
        composer.setAttribute('contenteditable', 'true');
        await h.send();
        assert.deepEqual(finished(h), ['matched']);
        // findPromptInput() (15 s), then the wait for the user to click into a composer (60 s)
        await h.advance(75000);
        const retry = h.$('#mzta-btn_retry');
        assert.ok(retry, 'no retry button');
        assert.equal(h.events.sends, 0);
        h.$('main').prepend(composer);
        retry.click();
        await h.advance(800);
        assert.deepEqual(finished(h), ['matched', 'matched']);
        assert.equal(h.events.opens, 2, 'the retry did not run the extended verification');
        await h.advance(1000);
        assert.equal(h.events.sends, 1);
        h.assertVerifierClean();
    });
});

k.coverage();
test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
