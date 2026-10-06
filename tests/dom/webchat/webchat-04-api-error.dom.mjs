// A Claude API window whose background answers api_error instead of api_send (the request could
// not even start). The error text carries markup. The background's chatgpt_close rejects, as it
// does in Thunderbird when it closes the very window waiting for the answer.
//
// Spec 01 "Streaming data flow" (api_error -> an error bot message), "Transcript DOM contract" (an
// error turn takes the full-bar slot with a Close-only .action-bar; "Self-closing chatgpt_close
// must be fire-and-forget": `{command: "chatgpt_close", window_id}`, its rejection swallowed).
// Spec 04 "Live "Thinking…" indicator" (the status pill's static error state, the in-flight
// classes cleared), "Anthropic / Claude (`anthropic_api`)" (the four anthropic_err_hint_* strings
// filled for the anthropic integration, their model placeholder resolved with the literal
// `$MODEL$`).

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { webchatTests } from '../../helpers/known-issues/webchat.mjs';
import {
    openWebchat,
    fromBackground,
    sentCommands,
    botTurns,
    actionBar,
    statusPill,
    statusText,
    statusIcon,
} from '../../webchat/webchat-page.mjs';
import { executableProblems } from '../../webchat/safety.mjs';

const { ctx, worker } = await openWebchat({
    llm: 'anthropic_api',
    local: { anthropic_model: 'claude-test', anthropic_api_key: 'k' },
    commands: {
        chatgpt_close: () => { throw new Error("Actor 'Conduits' destroyed before query 'RuntimeMessage' was resolved"); },
    },
});
after(() => ctx.close());
const k = webchatTests('04');

const S_FLOW = 'spec 01 "Streaming data flow"';
const S_DOM = 'spec 01 "Transcript DOM contract"';
const S_PILL = 'spec 04 "Live "Thinking…" indicator"';
const S_CLAUDE = 'spec 04 "Anthropic / Claude (`anthropic_api`)"';

const HINTS = ['anthropic_err_hint_temperature', 'anthropic_err_hint_budget_tokens',
    'anthropic_err_hint_thinking_type', 'anthropic_err_hint_effort'];

k.test('claude-hints', S_CLAUDE, 'the init message carries the four anthropic_err_hint_* strings, each with the literal $MODEL$ for the worker to fill', () => {
    const init = worker.posted.find(m => m.type === 'init');
    for (const key of HINTS) {
        assert.equal(typeof init.i18nStrings[key], 'string', key);
        assert.ok(init.i18nStrings[key].includes('$MODEL$'), key + ': ' + init.i18nStrings[key]);
    }
});

const ERROR = 'Invalid API key <img src=x onerror="window.__pwned=1"> <b>401</b>';

k.test('error-turn', S_FLOW, 'api_error: the error is shown in a bot turn of its own', async () => {
    await fromBackground(ctx, { command: 'api_error', error: ERROR });
    const bots = botTurns(ctx);
    assert.equal(bots.length, 1);
    assert.ok(bots[0].textContent.includes(ERROR), bots[0].textContent);
});

k.test('error-as-text', S_FLOW, 'the error is text: its markup is not parsed, nothing executable reaches the transcript', () => {
    const turn = botTurns(ctx)[0];
    assert.equal(turn.querySelector('.turn-body img, .turn-body b'), null);
    assert.deepEqual(executableProblems(turn), []);
});

k.test('nothing-sent', S_FLOW, 'nothing is sent to the worker', () => {
    assert.deepEqual(worker.chatMessages(), []);
});

k.test('error-pill', S_PILL, 'the pill is in its error state with the alert icon, and no in-flight class left', () => {
    const pill = statusPill(ctx);
    assert.ok(pill.classList.contains('status-error'));
    for (const cls of ['status-waiting', 'status-working', 'status-done']) assert.equal(pill.classList.contains(cls), false, cls);
    assert.notEqual(pill.style.display, 'none');
    assert.equal(statusText(ctx), 'Error');
    assert.ok(statusIcon(ctx).querySelector('svg'), 'the inline alert icon');
    assert.equal(statusIcon(ctx).querySelector('img'), null);
});

k.test('close-only-bar', S_DOM, 'the error turn has a Close-only .action-bar', () => {
    const bar = actionBar(botTurns(ctx)[0]);
    assert.ok(bar);
    const buttons = [...bar.querySelectorAll('button, split-button')];
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].textContent.trim(), 'Close');
});

k.test('close-fire-and-forget', S_DOM, 'Close sends {command: "chatgpt_close", window_id} for its own window, and its rejection is swallowed', async () => {
    await ctx.click(actionBar(botTurns(ctx)[0]).querySelector('button'));
    const closes = sentCommands(ctx, 'chatgpt_close');
    assert.equal(closes.length, 1);
    assert.deepEqual(closes[0], { command: 'chatgpt_close', window_id: 1 });
    assert.deepEqual(ctx.rejections, []);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
