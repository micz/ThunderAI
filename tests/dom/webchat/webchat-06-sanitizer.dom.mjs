// The sanitizer as a security boundary, on the streaming path. A ChatGPT API window replacing the
// selection in a compose window (action "2"), hide_thinking off, usage display off. Every payload of
// fixtures/webchat/sanitizer-payloads.json is answered twice: in ONE token, and split across two
// tokens after 2 KB of padding, so that the first flush renders the payload cut in half mid-stream.
// After each answer "Use this answer" is clicked, and the HTML sent to the background is checked too.
//
// Spec 01 "One render path, no router" (html:true makes markdown-it's output untrusted model HTML,
// which MUST cross sanitize(..., {allowBlocks: true}); `img` stays stripped; code fences show markup
// as text), "Streaming: re-render the whole accumulated raw each time" (a flush lands mid-tag; the
// whole raw is re-rendered), "API WebChat" answer snapshot (what "use this answer" sends is the
// rendered snapshot). Spec 07 "The sanitizer is a security boundary" (the allowlist, `href` only on
// <a> and only ^(https?:|mailto:), javascript: and data: do not survive). Spec 04 "Thinking output
// in the webchat UI" (the reasoning is shown as text; hide_thinking off -> the block starts open).
//
// The tests run in order on one window, one turn per answer.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { loadFixture } from '../../helpers/core/load.mjs';
import { webchatTests } from '../../helpers/known-issues/webchat.mjs';
import {
    openWebchat,
    apiSend,
    typeAndSend,
    lastBotTurn,
    answerEls,
    sentCommands,
    sq,
} from '../../webchat/webchat-page.mjs';
import {
    allowlistProblems,
    executableProblems,
    htmlProblems,
} from '../../webchat/safety.mjs';

const { payloads } = loadFixture('sanitizer-payloads.json', 'webchat');

const { ctx, worker } = await openWebchat({
    local: { chat_show_usage_data: false, hide_thinking: false },
    commands: {
        chatgpt_replaceSelectedText: () => true,
        chatgpt_close: () => true,
    },
});
after(() => ctx.close());
const k = webchatTests('06');

const S_RENDER = 'spec 01 "One render path, no router"';
const S_CUMUL = 'spec 01 "Streaming: re-render the whole accumulated raw each time"';
const S_SAN = 'spec 07 "The sanitizer is a security boundary"';
const S_THINK = 'spec 04 "Thinking output in the webchat UI"';

const notThinking = el => el.matches('details.thinking-block');
/** Every problem with the newest answer: its model region against the allowlist, the whole turn
 *  for anything executable. */
function answerProblems({ streaming = false } = {}) {
    const turn = lastBotTurn(ctx);
    const problems = [];
    for (const m of answerEls(turn)) problems.push(...allowlistProblems(m, { skip: notThinking, tokenSpans: streaming }));
    problems.push(...executableProblems(turn));
    return problems;
}
/** Click the newest answer's "Use this answer", return the HTML it sent to the background. */
async function useAnswer() {
    const before = sentCommands(ctx, 'chatgpt_replaceSelectedText').length;
    const main = sq(lastBotTurn(ctx).querySelector('.action-bar'), 'split-button', '.action_btn');
    await ctx.click(main);
    const sent = sentCommands(ctx, 'chatgpt_replaceSelectedText');
    assert.equal(sent.length, before + 1, 'Use this answer sent nothing');
    return sent.at(-1).text;
}

await apiSend(ctx, { prompt: 'Start', action: '2', mailMessageId: 7 });
await worker.stream(ctx, ['Ready.']);

const PAD = 'a '.repeat(1100);

for (const p of payloads) {
    k.test('one-' + p.id, S_SAN, `${p.id} in one token: nothing outside the allowlist, nothing executable (${p.why})`, async () => {
        await typeAndSend(ctx, 'one ' + p.id);
        await worker.stream(ctx, [p.html]);
        assert.deepEqual(answerProblems(), []);
    });

    k.test('one-sent-' + p.id, S_SAN, `${p.id} in one token: the HTML "Use this answer" sends is clean too`, async () => {
        assert.deepEqual(htmlProblems(ctx.window, await useAnswer()), []);
    });

    const cut = Math.floor(p.html.length / 2);
    k.test('split-mid-' + p.id, S_CUMUL, `${p.id} cut in half: the mid-stream render of the partial payload is clean`, async () => {
        await typeAndSend(ctx, 'split ' + p.id);
        await worker.stream(ctx, [PAD + '\n\n' + p.html.slice(0, cut)], { done: false });
        assert.ok(answerEls(lastBotTurn(ctx))[0].querySelector('p'), 'no mid-stream render happened');
        assert.deepEqual(answerProblems({ streaming: true }), []);
    });

    k.test('split-' + p.id, S_SAN, `${p.id} split across two tokens: the final render and the HTML sent are clean`, async () => {
        await worker.stream(ctx, [p.html.slice(cut) + '\n']);
        assert.deepEqual(answerProblems(), []);
        assert.deepEqual(htmlProblems(ctx.window, await useAnswer()), []);
    });
}

k.test('img-stripped', S_RENDER, 'img stays stripped: no <img> in any answer', () => {
    const box = sq(ctx.document, 'messages-area', '#messages');
    const imgs = [...box.querySelectorAll('.message.bot img')];
    assert.deepEqual(imgs.map(i => i.outerHTML), []);
});

k.test('fence-text', S_RENDER, 'the code-fence payload shows its markup as text inside <pre>', async () => {
    await typeAndSend(ctx, 'fence again');
    await worker.stream(ctx, [payloads.find(p => p.id === 'code-fence').html]);
    const pre = answerEls(lastBotTurn(ctx))[0].querySelector('pre');
    assert.ok(pre);
    assert.match(pre.textContent, /<script>window\.__pwned=1<\/script>/);
    assert.equal(pre.querySelector('script, img'), null);
});

k.test('safe-link-kept', S_SAN, 'an https: link survives with its href, and only that attribute', async () => {
    await typeAndSend(ctx, 'link');
    await worker.stream(ctx, ['See <a href="https://example.com/x" title="t" target="_blank">here</a>.']);
    const a = answerEls(lastBotTurn(ctx))[0].querySelector('a');
    assert.ok(a);
    assert.deepEqual([...a.attributes].map(x => [x.name, x.value]), [['href', 'https://example.com/x']]);
});

k.test('thinking-text', S_THINK, 'reasoning holding every payload is shown as text: no element inside the thinking content', async () => {
    const all = payloads.map(p => p.html).join('\n');
    await typeAndSend(ctx, 'think');
    await worker.thinking(ctx, all);
    await worker.stream(ctx, ['Answer.']);
    const block = answerEls(lastBotTurn(ctx))[0].querySelector('details.thinking-block');
    assert.ok(block);
    assert.equal(block.open, true, 'hide_thinking off: the block starts open');
    const content = block.querySelector('.thinking-content');
    assert.equal(content.textContent, all);
    assert.equal(content.children.length, 0);
    assert.deepEqual(executableProblems(lastBotTurn(ctx)), []);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
