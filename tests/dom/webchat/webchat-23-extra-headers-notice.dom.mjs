// The startup notice of an OpenAI Comp API window whose connection has extra headers.
//
// Spec 01 "Component structure" ("Startup notice"): the extra headers are shown as a section, the
// label on a line of its own and one "name: value" line per header actually sent, never as the raw
// JSON; an entry parseExtraHeaders() drops (spec 04 "Extra headers") is not listed; the value of a
// header isCredentialHeader() flags is hidden; a value holding markup is shown as text, like every
// value of the notice.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { webchatTests } from '../../helpers/known-issues/webchat.mjs';
import {
    openWebchat,
    turns,
} from '../../webchat/webchat-page.mjs';
import { executableProblems } from '../../webchat/safety.mjs';

const EVIL = 'v <img src=x onerror="window.__pwned=1">';
const HEADERS = JSON.stringify({ 'x-opencode-session': 'thunderai-abc123', 'x-evil': EVIL, Host: 'dropped.example', 'x-n': 1,
    'api-key': 'azure-SECRET-1', Authorization: 'Bearer SECRET-2' });

const { ctx } = await openWebchat({
    llm: 'openai_comp_api',
    call_id: 'c23',
    prompt_id: 'prompt_headers',
    prompt_name: 'Headers',
    local: {
        openai_comp_host: 'https://api.example.test',
        openai_comp_model: 'm',
        openai_comp_extra_headers: HEADERS,
        chat_show_usage_data: false,
    },
});
after(() => ctx.close());
const k = webchatTests('23');

const S_COMP = 'spec 01 "Component structure"';

const notice = () => turns(ctx)[0].querySelector('.message.info');
const lines = () => notice().innerHTML.split('<br>').map(l => {
    const d = ctx.document.createElement('div');
    d.innerHTML = l;
    return d.textContent;
});

k.test('headers-section', S_COMP, 'the extra headers are a section: the label alone, then one indented "name: value" line per header sent', () => {
    const all = lines();
    const at = all.indexOf(msg('prefs_api_extra_headers') + ':');
    assert.notEqual(at, -1, all.join('\n'));
    assert.deepEqual(all.slice(at + 1, at + 5).map(l => l.replace(/^ +/, '')),
        ['x-opencode-session: thunderai-abc123', 'x-evil: ' + EVIL, 'api-key: ****************', 'Authorization: ****************']);
    assert.match(all[at + 1], /^ +x-opencode-session/, 'indented');
});

k.test('headers-credentials-hidden', S_COMP, 'the value of a header that looks like a credential is hidden, its name shown', () => {
    assert.equal(notice().textContent.includes('SECRET'), false, notice().textContent);
});

k.test('headers-dropped-not-listed', S_COMP, 'a header that is not sent is not listed, and the raw JSON never appears', () => {
    const text = notice().textContent;
    assert.equal(text.includes('dropped.example'), false, text);
    assert.equal(text.includes('x-n'), false, text);
    assert.equal(text.includes('{'), false, text);
});

k.test('headers-escaped', S_COMP, 'a header value holding markup is shown as text', () => {
    assert.equal(notice().querySelector('img'), null);
    assert.deepEqual(executableProblems(turns(ctx)[0]), []);
    assert.equal(ctx.window.__pwned, undefined);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
