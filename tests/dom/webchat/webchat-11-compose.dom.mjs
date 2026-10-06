// The actions on an answer when the prompt was run from a compose window: api_send carries action
// "1" with mailMessageId -1, so "use this answer" replaces the text instead of replying. Usage
// display off. Two answers.
//
// Spec 07 "Scope" (the compose-window case: `promptData.mailMessageId == -1`, where `action` is
// forced to "2"). Spec 01 "Transcript DOM contract" ("Self-closing chatgpt_close must be
// fire-and-forget": the action call, then chatgpt_close; the compact toolbar of an earlier answer
// bound to that answer's own text), "Files" (`<split-button>`: the reply-type dropdown is
// optional - a replace has no reply type), "The rich-text layer" closing paragraphs (the snapshot
// the button closes over).
//
// The tests run in order on one window.

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
    typeAndSend,
    botTurns,
    answerEls,
    actionBar,
    toolbar,
    turnBody,
    commandNames,
    sentCommands,
    sq,
} from '../../webchat/webchat-page.mjs';

const { ctx, worker } = await openWebchat({
    local: { chat_show_usage_data: false },
    commands: {
        chatgpt_replaceSelectedText: () => true,
        chatgpt_close: () => true,
    },
});
after(() => ctx.close());
const k = webchatTests('11');

const S_SCOPE = 'spec 07 "Scope"';
const S_DOM = 'spec 01 "Transcript DOM contract"';
const S_FILES = 'spec 01 "Files"';

const msg = key => ctx.ctl.browser.i18n.getMessage(key);
const norm = html => new ctx.window.DOMParser().parseFromString(html, 'text/html').body.innerHTML.replace(/>\s+</g, '><').trim();
const turn = i => botTurns(ctx)[i];

await apiSend(ctx, { prompt: 'Make it formal', action: '1', tabId: 4, mailMessageId: -1 });
await worker.stream(ctx, ['Dear Sir,\nkind regards.']);

k.test('standalone', S_FILES, 'no reply type to choose: the split button stands alone, one line, no dropdown', () => {
    const split = actionBar(turn(0)).querySelector('split-button');
    assert.ok(split.hasAttribute('standalone'));
    assert.equal(sq(actionBar(turn(0)), 'split-button', '.dropdown-toggle'), null);
    const lines = [...sq(actionBar(turn(0)), 'split-button', '.action_btn').querySelectorAll('span')].map(s => s.textContent);
    assert.deepEqual(lines, [msg('apiwebchat_use_this_answer')]);
});

k.test('sel-info', S_DOM, 'the .sel_info hint is shown beside the full bar', () => {
    assert.equal(turnBody(turn(0)).querySelector('.sel_info').style.display, 'block');
});

k.test('replace', S_SCOPE, 'compose window: "Use this answer" replaces the text (chatgpt_replaceSelectedText, not a reply) with the answer, then closes', async () => {
    const since = ctx.ctl.sent.length;
    await ctx.click(sq(actionBar(turn(0)), 'split-button', '.action_btn'));
    assert.deepEqual(commandNames(ctx, since), ['chatgpt_replaceSelectedText', 'chatgpt_close']);
    assert.equal(norm(sentCommands(ctx, 'chatgpt_replaceSelectedText').at(-1).text), norm(answerEls(turn(0))[0].innerHTML));
    assert.deepEqual(sentCommands(ctx, 'chatgpt_replyMessage'), []);
});

k.test('toolbar-replace', S_DOM, 'an earlier answer\'s toolbar button replaces with ITS answer too', async () => {
    await typeAndSend(ctx, 'Shorter');
    await worker.stream(ctx, ['Dear Sir.']);
    const use = [...toolbar(turn(0)).querySelectorAll('button')]
        .find(b => b.getAttribute('aria-label') === msg('apiwebchat_use_this_answer'));
    assert.ok(use);
    const since = ctx.ctl.sent.length;
    await ctx.click(use);
    assert.deepEqual(commandNames(ctx, since), ['chatgpt_replaceSelectedText', 'chatgpt_close']);
    assert.equal(norm(sentCommands(ctx, 'chatgpt_replaceSelectedText').at(-1).text), norm(answerEls(turn(0))[0].innerHTML));
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
