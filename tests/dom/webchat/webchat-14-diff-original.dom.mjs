// The diff picker's original when there is no selection and the body's HTML twin carries no line
// structure (a plain text compose window, whose newlines were collapsed on the way into the
// payload), with diff_granularity stored as a value the picker does not know.
//
// Spec 07 "Where the original's HTML comes from" (selection_text empty -> body_text / body_html;
// "The html twin is only trusted when it carries line structure": otherwise the original is rebuilt
// with textToBlockHtml(), one <p> per line of the text field), "Where the initial value comes from"
// (anything unrecognised falls back to "words").

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
    actionBar,
    turnBody,
} from '../../webchat/webchat-page.mjs';

const { ctx, worker } = await openWebchat({
    local: { chat_show_usage_data: false, diff_granularity: 'paragraphs' },
});
after(() => ctx.close());
const k = webchatTests('14');

const S_ORIG = "spec 07 \"Where the original's HTML comes from\"";
const S_INIT = 'spec 07 "Where the initial value comes from"';

await apiSend(ctx, {
    prompt: 'Proofread', action: '0', tabId: 3, mailMessageId: 7,
    prompt_info: {
        use_diff_viewer: '1',
        selection_text: '', selection_html: '',
        body_text: 'Hello there\nSecond line here',
        body_html: 'Hello there Second line here',
    },
});
await worker.stream(ctx, ['Hello there\n\nSecond line changed']);
await ctx.click(actionBar(botTurns(ctx)[0]).querySelector('.diffv_btn'));
const picker = () => turnBody(botTurns(ctx)[1]).querySelector('diff-picker');
const pqa = sel => [...picker().shadowRoot.querySelectorAll(sel)];

k.test('rebuilt-from-text', S_ORIG, 'no selection, a structure-less body twin: the original is rebuilt from body_text, one block per line', () => {
    const blocks = [...picker().shadowRoot.querySelector('.picker-body').children];
    assert.deepEqual(blocks.map(b => b.localName), ['p', 'p']);
    const hunks = pqa('.hunk');
    assert.equal(hunks.length, 1, 'only the second line changed: ' + hunks.map(h => h.textContent).join(' | '));
    assert.match(hunks[0].querySelector('.hunk-side-old').textContent, /here/);
});

k.test('reject-all-original', S_ORIG, 'reject all gives the original, one <p> per line of the text', async () => {
    await ctx.click(picker().shadowRoot.querySelector('.picker-reject-btn'));
    assert.equal(picker().composeResultHTML(), '<p>Hello there</p><p>Second line here</p>');
});

k.test('granularity-fallback', S_INIT, 'an unknown diff_granularity falls back to Words', () => {
    const [words, sentences] = pqa('.picker-gran [role="radio"]');
    assert.equal(words.getAttribute('aria-checked'), 'true');
    assert.equal(sentences.getAttribute('aria-checked'), 'false');
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
