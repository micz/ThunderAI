// The Translate settings page with its own Claude connection stored in the special prompt (the
// global connection is the OpenAI API, so the override is a choice, not mandatory) and five
// custom data placeholders, no policy. One feature page proves the wiring the six share.
//
// Spec 03 "Placeholder Autocomplete" (the constant reading type of the six settings pages,
// additional_text not offered, custom placeholders offered or not, case-insensitive matching, the
// list opened only by the token before the caret, insertion in the middle of the text, a click in
// the textarea not closing the list) and "Invalid placeholder feedback" (the states the editor
// shows: the validation list is the unfiltered one, so additional_text is not flagged; a disabled
// custom placeholder is missing; one with no type counts as type 0), spec 03 "Custom
// Placeholders" (a disabled one is treated as if it did not exist).
// Spec 05 "Connection Settings Panel — Connection Test Status Strip" (the strip of a stored
// override; each failure the test tells apart, read from the prefixed fields; the ~10 s time-out,
// with fake time) and "Connection Settings Panel — 'Update list' Model Fetch Buttons" (the
// prefixed row: success, HTTP error, unreachable host, an answer that is not JSON, a refused
// permission, the 20 s time-out with no retry left running).
//
// The network is scripted (tests/ui/dom-helpers.mjs, scriptFetch()), the time-outs run on held
// timers (holdLongTimers()), document.execCommand() is stubbed (tests/ui/page-stubs.mjs). The
// tests run in order on one page.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    scriptFetch,
    json,
    until,
    shown,
    userSets,
    holdLongTimers,
} from '../../ui/dom-helpers.mjs';
import { stubExecCommand } from '../../ui/page-stubs.mjs';
import { enText, storedPrompt } from '../../ui/feature-page.mjs';

const CUSTOM = [
    { id: 'thunderai_custom_sig', name: 'Signature', text: 'Ann', type: '0', enabled: 1, is_default: '0', is_dynamic: '0' },
    // no `enabled`: counts as enabled
    { id: 'thunderai_custom_reader', name: 'Reader note', text: 'r', type: '1', is_default: '0', is_dynamic: '0' },
    { id: 'thunderai_custom_writer', name: 'Writer note', text: 'w', type: '2', enabled: 1, is_default: '0', is_dynamic: '0' },
    { id: 'thunderai_custom_off', name: 'Switched off', text: 'o', type: '0', enabled: 0, is_default: '0', is_dynamic: '0' },
    // imported by hand: no type, no name
    { id: 'thunderai_custom_bare', text: 'b', enabled: 1, is_default: '0', is_dynamic: '0' },
];
const KEY = 'sk-ant-own';
const VERSION = '2023-06-01';

const permissions = {};
const ctx = await openPage('translate', {
    permissions,
    local: {
        connection_type: 'chatgpt_api',
        chatgpt_api_key: 'sk-global',
        _custom_placeholder: CUSTOM,
        _special_prompts: [{
            id: 'prompt_translate_this', text: enText('prompt_translate_this_full_text'),
            is_default: '1', is_special: '1', show_in: 'both', custom_icon: '',
            api_type: 'anthropic_api',
            anthropic_api_key: KEY,
            anthropic_model: 'claude-own-1',
            anthropic_version: VERSION,
        }],
    },
});
after(() => ctx.close());
const k = uiTests('translate', '03');
const $ = ctx.$;
const net = scriptFetch(ctx);
const execCalls = stubExecCommand(ctx);

const S_AUTO = 'spec 03 "Placeholder Autocomplete"';
const S_INVALID = 'spec 03 "Invalid placeholder feedback"';
const S_CUSTOM = 'spec 03 "Custom Placeholders"';
const S_TEST = 'spec 05 "Connection Settings Panel — Connection Test Status Strip"';
const S_FETCH = 'spec 05 "Connection Settings Panel — \'Update list\' Model Fetch Buttons"';

// ---- the prompt editor: autocomplete (spec 03) -----------------------------------------------

const ta = () => $('#translate_prompt_text');
const acList = () => ta().closest('.autocomplete-container').querySelector('.autocomplete-list');
const suggestions = () => acList().classList.contains('hidden') ? []
    : [...acList().querySelectorAll('.ac_cmd')].map(li => li.textContent);
const typeAt = async (text, caret = text.length) => {
    ta().value = text;
    ta().setSelectionRange(caret, caret);
    await ctx.fire(ta(), 'input');
};
const key = async name => ctx.fire(ta(), 'keydown', { key: name });

k.test('ac-reading-type', S_AUTO, 'the page offers reading and "always" placeholders, never composing-only ones', async () => {
    await typeAt('x {%folder');
    assert.deepEqual(suggestions(), ['{%mail_folder_name%}', '{%mail_folder_path%}']);
    await typeAt('x {%typed');
    assert.deepEqual(suggestions(), [], 'a composing-only placeholder offered');
    await typeAt('x {%current_date');
    assert.deepEqual(suggestions(), ['{%current_datetime%}']);
});

k.test('ac-no-additional-text', S_AUTO, 'additional_text is not offered by the settings pages', async () => {
    await typeAt('x {%additional');
    assert.deepEqual(suggestions(), []);
});

k.test('ac-dynamic', S_AUTO, 'a dynamic placeholder is offered as {%id:%}', async () => {
    await typeAt('x {%mail_head');
    assert.deepEqual(suggestions(), ['{%mail_headers:%}']);
});

k.test('ac-custom', S_CUSTOM, 'the enabled custom placeholders of a usable type are offered, the disabled one is not', async () => {
    await typeAt('x {%thunderai_custom');
    const offered = suggestions();
    assert.ok(offered.includes('{%thunderai_custom_sig%}'), offered.join());
    assert.ok(offered.includes('{%thunderai_custom_reader%}'), 'a custom placeholder with no `enabled` is enabled');
    assert.equal(offered.includes('{%thunderai_custom_writer%}'), false, 'a composing-only custom placeholder offered');
    assert.equal(offered.includes('{%thunderai_custom_off%}'), false, 'a disabled custom placeholder offered');
});

k.test('ac-custom-label', S_AUTO, 'a custom placeholder\'s name is its description line, as typed', () => {
    const li = [...acList().querySelectorAll('li')].find(l => l.querySelector('.ac_cmd').textContent === '{%thunderai_custom_sig%}');
    assert.equal(li.querySelector('.ac_desc')?.textContent, 'Signature');
});

k.test('ac-case-insensitive', S_AUTO, 'matching ignores case', async () => {
    await typeAt('x {%FOLDER_N');
    assert.deepEqual(suggestions(), ['{%mail_folder_name%}']);
});

k.test('ac-trigger', S_AUTO, 'only an open token right before the caret opens the list', async () => {
    await typeAt('{%mail_subject%} and ');
    assert.deepEqual(suggestions(), [], 'a closed token opened the list');
    await typeAt('a {%mail folder');
    assert.deepEqual(suggestions(), [], 'a space ends the token');
    await typeAt('x {%folder_n and more', 'x {%folder_n'.length);
    assert.deepEqual(suggestions(), ['{%mail_folder_name%}'], 'the token before a caret in the middle of the text');
});

k.test('ac-insert-mid-text', S_AUTO, 'accepting in the middle of the text replaces only the typed token, the text after it kept', async () => {
    await key('Enter');
    assert.equal(ta().value, 'x {%mail_folder_name%} and more');
    assert.equal(ta().selectionStart, 'x {%mail_folder_name%}'.length);
    assert.deepEqual(execCalls.at(-1), ['insertText', false, '{%mail_folder_name%}']);
    assert.deepEqual(suggestions(), []);
});

k.test('ac-click-inside-keeps', S_AUTO, 'a mousedown inside the textarea keeps the list; one outside closes it', async () => {
    await typeAt('x {%folder');
    await ctx.fire(ta(), 'mousedown');
    assert.deepEqual(suggestions(), ['{%mail_folder_name%}', '{%mail_folder_path%}'], 'closed by a click in its own textarea');
    await ctx.fire(ctx.document.body, 'mousedown');
    assert.deepEqual(suggestions(), []);
    assert.equal(ta().getAttribute('aria-expanded'), 'false');
});

// ---- the prompt editor: the highlight states (spec 03) ---------------------------------------

const mirrorChips = () => [...ta().closest('.editor-wrap').querySelectorAll('.editor-highlights [class*="ph_chip"]')];
const chipOf = token => mirrorChips().find(c => c.textContent === token);
const stateOf = token => {
    const c = chipOf(token);
    if (!c) return 'unmarked';
    if (c.classList.contains('ph_chip_error')) return 'error:' + c.title;
    if (c.classList.contains('ph_chip_warn')) return 'warn:' + c.title;
    return c.classList.contains('ph_chip_invalid') ? 'invalid?' : 'valid';
};

k.test('mirror-states', S_INVALID, 'the editor of a reading prompt: valid, unknown, composing-only, dynamic with a value', async () => {
    await typeAt('{%mail_subject%} {%mail_folder_name%} {%no_such_ph%} {%mail_typed_text%} {%mail_headers:x-spam%} {% mail_headers : x-spam %} {%mail_subject:x%}', 0);
    assert.equal(stateOf('{%mail_subject%}'), 'valid');
    assert.equal(stateOf('{%mail_folder_name%}'), 'valid');
    assert.equal(stateOf('{%no_such_ph%}'), 'error:' + msg('editor_placeholder_missing'));
    assert.equal(stateOf('{%mail_typed_text%}'), 'warn:' + msg('editor_placeholder_wrong_type'));
    assert.equal(stateOf('{%mail_headers:x-spam%}'), 'valid');
    assert.equal(stateOf('{% mail_headers : x-spam %}'), 'valid', 'spaces around the colon are the same token');
    assert.equal(stateOf('{%mail_subject:x%}'), 'error:' + msg('editor_placeholder_missing'), 'a fixed placeholder takes no parameter');
});

k.test('mirror-additional-text', S_INVALID, 'additional_text, not offered here, is still a valid token', async () => {
    await typeAt('{%additional_text%} {%additional_text:tone%}', 0);
    assert.equal(stateOf('{%additional_text%}'), 'valid');
    assert.equal(stateOf('{%additional_text:tone%}'), 'valid');
});

k.test('mirror-custom', S_CUSTOM, 'custom tokens: enabled valid, composing-only amber, disabled red as missing, with no type valid', async () => {
    await typeAt('{%thunderai_custom_sig%} {%thunderai_custom_reader%} {%thunderai_custom_writer%} {%thunderai_custom_off%} {%thunderai_custom_bare%}', 0);
    assert.equal(stateOf('{%thunderai_custom_sig%}'), 'valid');
    assert.equal(stateOf('{%thunderai_custom_reader%}'), 'valid');
    assert.equal(stateOf('{%thunderai_custom_writer%}'), 'warn:' + msg('editor_placeholder_wrong_type'));
    assert.equal(stateOf('{%thunderai_custom_off%}'), 'error:' + msg('editor_placeholder_missing'));
    assert.equal(stateOf('{%thunderai_custom_bare%}'), 'valid', 'a placeholder with no type counts as type 0');
});

// ---- the connection test of the override (spec 05) ------------------------------------------

const MODELS = 'https://api.anthropic.com/v1/models';
const strip = () => $('#mzta_conn_test');
const stripState = () => strip().getAttribute('data-state');
const stripText = () => strip().querySelector('.conn_test_text').textContent;
const stripLink = () => strip().querySelector('.conn_test_link');
const runTest = async () => {
    await ctx.click(stripLink());
    await until(ctx, () => stripState() !== 'loading', 'the test to end');
};
const errorText = detail => msg('connTest_error', [detail]);

k.test('strip-override-idle', S_TEST, 'with the override stored, the strip is shown and idle at load', () => {
    assert.equal($('#translate_connection_type').value, 'anthropic_api');
    assert.equal(shown(strip()), true);
    assert.equal(stripState(), 'idle');
    assert.equal(stripText(), msg('connTest_idle'));
    assert.equal(stripLink().textContent, msg('connTest_link_test'));
});

k.test('test-ok', S_TEST, 'a reachable provider: "Connected" with the provider\'s name, "Re-test"; the prefixed key and version sent', async () => {
    net.answer(MODELS, () => json({ data: [{ type: 'model', id: 'claude-own-1', display_name: 'Claude Own' }], has_more: false }));
    await runTest();
    assert.equal(stripState(), 'ok');
    assert.equal(stripText(), msg('connTest_ok', [msg('prefs_Connection_type_Anthropic_API')]));
    assert.equal(stripLink().textContent, msg('connTest_link_retest'));
    const h = new Headers(ctx.fetchCalls.findLast(c => c.url === MODELS).init.headers);
    assert.equal(h.get('x-api-key'), KEY);
    assert.equal(h.get('anthropic-version'), VERSION);
});

k.test('test-auth', S_TEST, 'a rejected key: red, the authentication message, "Retry"', async () => {
    net.answer(MODELS, () => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
        { status: 401, statusText: 'Unauthorized' }));
    await runTest();
    assert.equal(stripState(), 'error');
    assert.equal(stripText(), errorText(msg('connTest_error_auth')));
    assert.equal(stripLink().textContent, msg('connTest_link_retry'));
});

k.test('test-http-detail', S_TEST, 'any other HTTP error: red, with the provider\'s own message as the detail', async () => {
    net.answer(MODELS, () => json({ type: 'error', error: { type: 'not_found_error', message: 'model: claude-own-1 not found' } },
        { status: 404, statusText: 'Not Found' }));
    await runTest();
    assert.equal(stripState(), 'error');
    assert.equal(stripText(), errorText('model: claude-own-1 not found'));
});

k.test('test-forbidden', S_TEST, 'a 403 (a valid key without access): the provider\'s message, not "check your API key"', async () => {
    const message = 'Your API key does not have permission to use the specified resource.';
    net.answer(MODELS, () => json({ type: 'error', error: { type: 'permission_error', message } },
        { status: 403, statusText: 'Forbidden' }));
    await runTest();
    assert.equal(stripState(), 'error');
    assert.equal(stripText(), errorText(message));
});

k.test('test-empty-error', S_TEST, 'an HTTP error with no body: its status, never "unreachable"', async () => {
    net.answer(MODELS, () => new Response('', { status: 502, statusText: 'Bad Gateway' }));
    await runTest();
    assert.equal(stripState(), 'error');
    assert.equal(stripText(), errorText('HTTP 502 Bad Gateway'));
});

k.test('test-unreachable', S_TEST, 'an unreachable host: red, the network message', async () => {
    net.fail(MODELS);
    await runTest();
    assert.equal(stripState(), 'error');
    assert.equal(stripText(), errorText(msg('connTest_error_network')));
});

k.test('test-not-json', S_TEST, 'an answer that is not JSON (a proxy\'s HTML page): red, the network message', async () => {
    net.answer(MODELS, () => new Response('<html><body>Login required</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await runTest();
    assert.equal(stripState(), 'error');
    assert.equal(stripText(), errorText(msg('connTest_error_network')));
});

k.test('test-no-list', S_TEST, 'a 200 whose JSON is not the provider\'s answer (a proxy\'s {}): red, never "Connected"', async () => {
    net.answer(MODELS, () => json({}));
    await runTest();
    assert.equal(stripState(), 'error');
    assert.equal(stripText(), errorText(msg('connTest_error_network')));
});

k.test('test-timeout', S_TEST, 'no answer: "Testing…" with the link hidden until ~10 s, then the time-out message; the request is aborted', async () => {
    const req = net.hang(MODELS);
    const clock = holdLongTimers(ctx);
    try {
        await ctx.click(stripLink());
        assert.equal(req.called, true, 'no request sent');
        assert.equal(stripState(), 'loading');
        assert.equal(stripText(), msg('connTest_testing'));
        assert.equal(stripLink().style.display, 'none');
        await clock.advance(9999);
        assert.equal(stripState(), 'loading', 'ended before ~10 s');
        await clock.advance(1);
        await until(ctx, () => stripState() !== 'loading', 'the time-out');
        assert.equal(stripState(), 'error');
        assert.equal(stripText(), errorText(msg('connTest_error_timeout')));
        assert.equal(stripLink().textContent, msg('connTest_link_retry'));
        assert.notEqual(stripLink().style.display, 'none');
        assert.equal(req.aborted, true, 'the request outlived the test');
    } finally {
        clock.uninstall();
    }
});

k.test('test-saves-nothing', S_TEST, 'none of the tests wrote anything', () => {
    const p = storedPrompt(ctx, 'prompt_translate_this');
    assert.equal(p.anthropic_api_key, KEY);
    assert.equal(p.api_type, 'anthropic_api');
});

// ---- "Update list" on the feature page (spec 05) ---------------------------------------------

const btn = () => $('#translate_btnUpdateAnthropicModels');
const loading = () => $('#translate_anthropic_model_fetch_loading');
const status = () => $('#translate_anthropic_model_fetch_status');
const fetchError = detail => msg('Anthropic_Models_Error_fetching') + ': ' + detail;
const clickUpdate = async () => {
    await ctx.click(btn());
    await until(ctx, () => btn().style.display !== 'none', 'the button to come back');
};

k.test('fetch-ok', S_FETCH, 'success on the prefixed row: the models merged, the button back, the green "done"', async () => {
    net.answer(MODELS, () => json({ data: [{ type: 'model', id: 'claude-new-2', display_name: 'Claude New' }], has_more: false }));
    await clickUpdate();
    const opts = [...$('#translate_anthropic_model').options].map(o => o.value);
    assert.ok(opts.includes('claude-new-2'), opts.join());
    assert.equal(status().textContent, msg('Models_Fetch_Done'));
    assert.equal(status().classList.contains('is_ok'), true);
    assert.equal(loading().style.display, 'none');
    const h = new Headers(ctx.fetchCalls.findLast(c => c.url === MODELS).init.headers);
    assert.equal(h.get('x-api-key'), KEY, 'not the feature\'s key');
});

k.test('fetch-http-error', S_FETCH, 'an HTTP error: the button back at once, the provider\'s message in red, no "done"', async () => {
    net.answer(MODELS, () => json({ type: 'error', error: { type: 'permission_error', message: 'Your API key does not have permission to use the specified resource.' } },
        { status: 403, statusText: 'Forbidden' }));
    await clickUpdate();
    assert.equal(status().hidden, false);
    assert.equal(status().textContent, fetchError('Your API key does not have permission to use the specified resource.'));
    assert.equal(status().classList.contains('is_ok'), false);
    assert.equal(loading().style.display, 'none');
});

k.test('fetch-unreachable', S_FETCH, 'an unreachable host: the reason in red', async () => {
    net.fail(MODELS);
    await clickUpdate();
    assert.ok(status().textContent.startsWith(fetchError('')), status().textContent);
    assert.notEqual(status().textContent, fetchError(''), 'no reason given');
    assert.equal(status().classList.contains('is_ok'), false);
});

k.test('fetch-not-json', S_FETCH, 'an answer that is not JSON: an error in red, the button back', async () => {
    net.answer(MODELS, () => new Response('<html>Gateway</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await clickUpdate();
    assert.ok(status().textContent.startsWith(fetchError('')), status().textContent);
    assert.equal(status().classList.contains('is_ok'), false);
    assert.equal(loading().style.display, 'none');
});

k.test('fetch-no-list', S_FETCH, 'a 200 with no model list: an error in red, the button back, the models kept', async () => {
    const before = [...$('#translate_anthropic_model').options].map(o => o.value);
    net.answer(MODELS, () => json({}));
    await clickUpdate();
    assert.ok(status().textContent.startsWith(fetchError('')), status().textContent);
    assert.equal(status().classList.contains('is_ok'), false);
    assert.equal(loading().style.display, 'none');
    assert.deepEqual([...$('#translate_anthropic_model').options].map(o => o.value), before);
});

k.test('fetch-denied', S_FETCH, 'a refused permission: no request, the permission message', async () => {
    const fetches = ctx.fetchCalls.length;
    permissions.request = () => false;
    try {
        await clickUpdate();
    } finally {
        delete permissions.request;
    }
    assert.equal(ctx.fetchCalls.length, fetches);
    assert.equal(status().textContent, msg('Optional_Permission_Denied_Model_Fetching'));
});

k.test('fetch-timeout', S_FETCH, 'no answer: the loading label instead of the button until 20 s, then the time-out in red, and no retry', async () => {
    const req = net.hang(MODELS);
    const clock = holdLongTimers(ctx);
    const from = ctx.fetchCalls.length;
    try {
        await ctx.click(btn());
        assert.equal(btn().style.display, 'none');
        assert.notEqual(loading().style.display, 'none');
        assert.equal(status().hidden, true, 'the previous message not cleared');
        await clock.advance(19999);
        assert.equal(btn().style.display, 'none', 'ended before 20 s');
        await clock.advance(1);
        await until(ctx, () => btn().style.display !== 'none', 'the time-out');
        assert.equal(status().textContent, fetchError(msg('connTest_error_timeout')));
        assert.equal(status().classList.contains('is_ok'), false);
        assert.equal(loading().style.display, 'none');
        assert.equal(req.aborted, true, 'the request outlived the button');
        await clock.advance(120000);
        assert.equal(ctx.fetchCalls.length - from, 1, 'retried in the background');
        assert.deepEqual(clock.pending(), [], 'a timer left behind');
    } finally {
        clock.uninstall();
    }
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
