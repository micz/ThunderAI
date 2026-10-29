// Spec 09: visible busy rejection and active response buffering in the real chat UI.
import assert from 'node:assert/strict';
import {
    test,
    after
} from 'node:test';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import {
    openWebchat,
    apiSend,
    statusText,
    lastBotTurn,
    answerHtml
} from '../../webchat/webchat-page.mjs';

const { ctx, worker } = await openWebchat({ commands: {
    ai_processing: ({ operation, data }) => {
        if (operation === 'createSession') return { active: true };
        if (operation === 'before') return { input: { ...data.input, message: data.input.message.replaceAll('Alice', '[PRIVATE]') }, context: {} };
        if (operation === 'after') return { output: { ...data.output, content: data.output.content.replaceAll('[PRIVATE]', 'Alice') } };
        return {};
    },
} });
after(() => ctx.close());

test('active processing sends only the prepared prompt', async () => {
    await apiSend(ctx, { prompt: 'Hello Alice' });
    assert.deepEqual(worker.chatMessages(), ['Hello [PRIVATE]']);
});
test('an additional active send is visibly rejected, not silently dropped', async () => {
    await apiSend(ctx, { prompt: 'Again Alice' });
    assert.deepEqual(worker.chatMessages(), ['Hello [PRIVATE]']);
    assert.equal(statusText(ctx), ctx.ctl.browser.i18n.getMessage('ai_processing_busy'));
});
test('buffered text is restored before it reaches the transcript', async () => {
    await worker.token(ctx, 'Hi [PRIVATE]');
    assert.ok(!ctx.document.querySelector('messages-area').shadowRoot.textContent.includes('[PRIVATE]'));
    await worker.done(ctx);
    assert.ok(answerHtml(lastBotTurn(ctx)).includes('Hi Alice'));
});
test('the page used only declared APIs', () => assertHarnessClean(ctx));
