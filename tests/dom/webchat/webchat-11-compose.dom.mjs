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
const S_ACT = 'spec 01 "Actions on an answer"';

const msg = key => ctx.ctl.browser.i18n.getMessage(key);
const norm = html => new ctx.window.DOMParser().parseFromString(html, 'text/html').body.innerHTML.replace(/>\s+</g, '><').trim();
const turn = i => botTurns(ctx)[i];
/** What a compact toolbar holds, in order: each button by its label, the usage chip as "chip". */
const toolKinds = tools => [...tools.children].map(el => el.classList.contains('mzta-usage') ? 'chip' : el.getAttribute('aria-label'));

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

k.test('replace-target', S_ACT, 'chatgpt_replaceSelectedText names its target with the api_send fields: tabId (the compose tab) and mailMessageId (-1), besides the text, and nothing else', () => {
    const replace = sentCommands(ctx, 'chatgpt_replaceSelectedText')[0];
    assert.deepEqual(Object.keys(replace).sort(), ['command', 'mailMessageId', 'tabId', 'text']);
    assert.equal(replace.tabId, 4);
    assert.equal(replace.mailMessageId, -1);
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

k.test('toolbar-compose', S_ACT, 'the compact toolbar of a compose session holds Copy and Use this answer (no usage chip: the display is off), nothing else', () => {
    assert.deepEqual(toolKinds(toolbar(turn(0))), [msg('apiwebchat_copy'), msg('apiwebchat_use_this_answer')]);
});

/** Stream one more answer and click "use this answer" on it: the text sent to the background. */
async function useNewAnswer(answer) {
    await typeAndSend(ctx, 'Again');
    await worker.stream(ctx, [answer]);
    await ctx.click(sq(actionBar(botTurns(ctx).at(-1)), 'split-button', '.action_btn'));
    return sentCommands(ctx, 'chatgpt_replaceSelectedText').at(-1).text;
}

k.test('quotes-stripped', S_ACT, 'an answer the model wrapped in quotation marks is used without them', async () => {
    // Source newlines (markdown-it's "<br>\n") are not what this checks.
    assert.equal(norm(await useNewAnswer('"Dear Sir,\nkind regards."')).replace(/\n/g, ''), '<p>Dear Sir,<br>kind regards.</p>');
});

k.test('quotes-one-end', S_ACT, 'a quotation mark at one end only is part of the text, and stays', async () => {
    assert.equal(norm(await useNewAnswer('As he said, "yes"')), '<p>As he said, "yes"</p>');
});

k.test('quotes-two-quotations', S_ACT, 'with other quotation marks inside, the two ends are left alone: they may open and close two different quotations', async () => {
    assert.equal(norm(await useNewAnswer('"Yes," he said, "fine"')), '<p>"Yes," he said, "fine"</p>');
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
