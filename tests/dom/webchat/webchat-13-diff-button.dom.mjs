// The diff picker opened from the chat window: a proofreading prompt (use_diff_viewer "1") run on
// a selection whose HTML twin has block structure and markup, replacing it in the mail (action
// "2"), with diff_granularity stored as "sentences". Two answers.
//
// Spec 07 "Overview" (the Show differences button opens <diff-picker>), "Where the original's HTML
// comes from" (the original resolved on the text fields, the html twin of the winning side used
// when it has block structure), "The result indirection" (the picker in a turn of its own;
// ownerTurn._mztaPicker read at click time by "use this answer" and Copy; the picker's own "Use this
// answer"; the indirection surviving the degrade to the compact toolbar), "Two things the picker
// deliberately bypasses" (the .sel_info hint hidden), "Where the initial value comes from" (the
// diff_granularity preference), "`composeResultText()` is mode-aware" (Copy goes through it).
// Spec 01 "Transcript DOM contract" (appendDiffPicker does not hijack the turn being built nor the
// full action bar).
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
    actionBar,
    toolbar,
    turnBody,
    commandNames,
    sentCommands,
    sq,
} from '../../webchat/webchat-page.mjs';

const { ctx, worker } = await openWebchat({
    local: { chat_show_usage_data: false, diff_granularity: 'sentences' },
    commands: {
        chatgpt_replaceSelectedText: () => true,
        chatgpt_close: () => true,
    },
});
after(() => ctx.close());
const k = webchatTests('13');

const S_OVER = 'spec 07 "Overview"';
const S_ORIG = "spec 07 \"Where the original's HTML comes from\"";
const S_IND = 'spec 07 "The result indirection"';
const S_BYPASS = 'spec 07 "Two things the picker deliberately bypasses"';
const S_INIT = 'spec 07 "Where the initial value comes from"';
const S_TEXT = 'spec 07 "`composeResultText()` is mode-aware"';
const S_DOM = 'spec 01 "Transcript DOM contract"';
const S_ACT = 'spec 01 "Actions on an answer"';

const msg = (key, subs) => ctx.ctl.browser.i18n.getMessage(key, subs);
const owner = () => botTurns(ctx)[0];
const pickerTurn = () => botTurns(ctx)[1];
const picker = () => turnBody(pickerTurn()).querySelector('diff-picker');
const pq = sel => picker().shadowRoot.querySelector(sel);
const pqa = sel => [...picker().shadowRoot.querySelectorAll(sel)];
const diffBtn = () => actionBar(owner()).querySelector('.diffv_btn');
const lastReplace = () => sentCommands(ctx, 'chatgpt_replaceSelectedText').at(-1).text;

const ORIGINAL_HTML = '<p>Dear <b>Sir</b>,</p><p>I hope you are fine. We meet today.</p>';
await apiSend(ctx, {
    prompt: 'Proofread', action: '2', tabId: 3, mailMessageId: 7,
    prompt_info: {
        use_diff_viewer: '1',
        selection_text: 'Dear Sir,\nI hope you are fine. We meet today.',
        selection_html: ORIGINAL_HTML,
        body_text: 'unrelated body', body_html: '<p>unrelated body</p>',
    },
});
// The answer marks "Sir" up as the selection does, so its first block matches the original's only
// if the picker took the selection's HTML twin: rebuilt from the text, "Dear Sir," would differ from
// it in markup alone, which is a change of its own (spec 07 "The `composeResult` invariant").
await worker.stream(ctx, ['Dear <b>Sir</b>,\n\nI hope you are well. We meet today.']);

k.test('button', S_OVER, 'a prompt with use_diff_viewer "1": its answer offers "Show differences"', () => {
    assert.ok(diffBtn());
    assert.equal(diffBtn().getAttribute('aria-label'), msg('btn_show_differences'));
});

k.test('own-turn', S_IND, 'Show differences opens the picker in a bot turn of its own, titled, below the answer', async () => {
    await ctx.click(diffBtn());
    assert.equal(botTurns(ctx).length, 2);
    assert.ok(picker());
    assert.equal(pickerTurn().querySelector('.turn-name').textContent, msg('apiwebchat_picker_title'));
    assert.equal(diffBtn().disabled, true);
});

k.test('sel-info-hidden', S_BYPASS, 'the owner turn\'s "select part of the answer" hint is hidden: the picker is the explicit mechanism', () => {
    assert.equal(turnBody(owner()).querySelector('.sel_info').style.display, 'none');
});

k.test('no-hijack', S_DOM, 'the picker turn takes no action bar: the answer above keeps the full bar', () => {
    assert.equal(actionBar(pickerTurn()), null);
    assert.ok(actionBar(owner()));
});

k.test('granularity-pref', S_INIT, 'the picker starts at the stored diff_granularity: Sentences checked', () => {
    const [words, sentences] = pqa('.picker-gran [role="radio"]');
    assert.equal(words.getAttribute('aria-checked'), 'false');
    assert.equal(sentences.getAttribute('aria-checked'), 'true');
});

k.test('original-from-selection', S_ORIG, 'the original is the selection (not the body), through its HTML twin: one change, fine -> well', () => {
    const hunks = pqa('.hunk');
    assert.equal(hunks.length, 1);
    assert.match(hunks[0].querySelector('.hunk-side-old').textContent, /fine/);
    assert.match(hunks[0].querySelector('.hunk-side-new').textContent, /well/);
    assert.doesNotMatch(pq('.picker-body').textContent, /unrelated/);
});

k.test('use-reads-picker', S_IND, '"Use this answer" in the answer\'s bar reads the picker at click time: a rejected change sends the original\'s text', async () => {
    await ctx.click(pq('.hunk-side-old'));
    await ctx.click(sq(actionBar(owner()), 'split-button', '.action_btn'));
    const sent = lastReplace();
    assert.match(sent, /fine/);
    assert.doesNotMatch(sent, /well/);
    assert.equal(sent, picker().composeResultHTML());
});

k.test('copy-reads-picker', S_TEXT, 'Copy in the answer\'s bar copies the picker\'s plain-text result, one line per block', async () => {
    await ctx.click(actionBar(owner()).querySelector('.copy_btn'));
    assert.equal(ctx.clipboard.at(-1), 'Dear Sir,\nI hope you are fine. We meet today.');
});

k.test('picker-use', S_IND, 'the picker\'s own "Use this answer" sends the same result, without scrolling back up', async () => {
    const since = ctx.ctl.sent.length;
    await ctx.click(pq('.picker-use-btn'));
    assert.deepEqual(commandNames(ctx, since), ['chatgpt_replaceSelectedText', 'chatgpt_close']);
    assert.equal(lastReplace(), picker().composeResultHTML());
});

k.test('degraded-keeps-picker', S_IND, 'after a newer answer, the compact toolbar of the first one still hands back the picker\'s current state', async () => {
    await typeAndSend(ctx, 'Again');
    await worker.stream(ctx, ['Another answer.']);
    assert.equal(actionBar(owner()), null);
    const use = [...toolbar(owner()).querySelectorAll('button')]
        .find(b => b.getAttribute('aria-label') === msg('apiwebchat_use_this_answer'));
    await ctx.click(use);
    assert.match(lastReplace(), /fine/);
    assert.doesNotMatch(lastReplace(), /well|Another/);
});

k.test('toolbar-picker', S_ACT, 'the compact toolbar of a picker answer holds Copy and Use this answer, nothing else: no Show differences', () => {
    const kinds = [...toolbar(owner()).children].map(el => el.classList.contains('mzta-usage') ? 'chip' : el.getAttribute('aria-label'));
    assert.deepEqual(kinds, [msg('apiwebchat_copy'), msg('apiwebchat_use_this_answer')]);
});

k.test('newer-answer-own-turn', S_DOM, 'the newer answer streamed into a turn of its own, after the picker\'s', () => {
    assert.equal(botTurns(ctx).length, 3);
    assert.match(botTurns(ctx)[2].textContent, /Another answer\./);
    assert.doesNotMatch(pickerTurn().textContent, /Another answer/);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
