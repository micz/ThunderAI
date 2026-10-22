// The chat window opened with a connection type it has no worker for ("foo_api": a stale or
// mistyped value). The fake Worker is installed expecting NO worker: any construction throws.
//
// Spec 01 "Component structure" ("Unknown connection type": no worker, an error turn naming the
// value, the error pill, the input locked for good, no ready message, the background's commands
// ignored, Close still closing the window).

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { webchatTests } from '../../helpers/known-issues/webchat.mjs';
import {
    openWebchat,
    apiSend,
    botTurns,
    turns,
    actionBar,
    commandNames,
    sentCommands,
    field,
    sendButton,
    stopButton,
    statusPill,
} from '../../webchat/webchat-page.mjs';

const { ctx, worker } = await openWebchat({
    llm: 'foo_api',
    commands: { chatgpt_close: () => true },
});
after(() => ctx.close());
const k = webchatTests('16');

const S_COMP = 'spec 01 "Component structure"';

k.test('no-worker', S_COMP, 'no worker is created for a connection type the window does not know', () => {
    assert.equal(worker.instance, null);
    assert.deepEqual(worker.unexpected, []);
});

k.test('error-turn', S_COMP, 'the transcript shows an error naming the unknown value', () => {
    const bots = botTurns(ctx);
    assert.equal(bots.length, 1);
    assert.equal(bots[0].querySelector('.message').textContent,
        ctx.ctl.browser.i18n.getMessage('apiwebchat_unknown_connection', ['foo_api']));
    assert.ok(statusPill(ctx).classList.contains('status-error'));
});

k.test('input-locked', S_COMP, 'nothing can ever be sent: the field, Send and Stop are disabled', () => {
    assert.equal(field(ctx).disabled, true);
    assert.equal(sendButton(ctx).disabled, true);
    assert.equal(stopButton(ctx).disabled, true);
    assert.equal(stopButton(ctx).style.display, 'none');
});

k.test('no-ready', S_COMP, 'no ready message reaches the background', () => {
    assert.deepEqual(commandNames(ctx), []);
});

k.test('commands-ignored', S_COMP, 'a command from the background is ignored: no user turn, nothing sent', async () => {
    const before = turns(ctx).length;
    await apiSend(ctx, { prompt: 'Hello' });
    assert.equal(turns(ctx).length, before);
    assert.deepEqual(worker.posted, []);
});

k.test('close', S_COMP, 'the error turn\'s Close still closes the window', async () => {
    await ctx.click(actionBar(botTurns(ctx)[0]).querySelector('button'));
    assert.deepEqual(sentCommands(ctx, 'chatgpt_close'), [{ command: 'chatgpt_close', window_id: 1 }]);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
