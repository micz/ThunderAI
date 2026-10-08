// The startup notice under attack: an Ollama API window whose prompt name, model and host each hold
// every sanitizer payload of fixtures/webchat/sanitizer-payloads.json. The prompt name comes from the
// URL and can come from an imported prompts file; the model and the host from the stored settings.
//
// Spec 01 "Component structure" ("Startup notice": built by getAPIsInitMessageString() and parsed as
// HTML by the window, so every value is escaped with mztaEscapeHtml(): a value holding markup is shown
// as text and never becomes an element). webchat-01 checks one name and one text setting; this file
// is the regression test of the three values that are always there, against the whole payload list.
//
// One window: the three values hold the payloads one after the other, so a payload that escaped its
// value would also change how every later one parses, which the checks below would see.

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
    turns,
} from '../../webchat/webchat-page.mjs';
import { executableProblems } from '../../webchat/safety.mjs';

const { payloads } = loadFixture('sanitizer-payloads.json', 'webchat');
const all = payloads.map(p => p.html).join(' ');
const NAME = 'Name ' + all;
const MODEL = 'model ' + all;
const HOST = 'http://localhost:11434/ ' + all;

const { ctx } = await openWebchat({
    llm: 'ollama_api',
    call_id: 'c17',
    prompt_id: 'prompt_evil',
    prompt_name: NAME,
    local: { ollama_model: MODEL, ollama_host: HOST, chat_show_usage_data: false },
});
after(() => ctx.close());
const k = webchatTests('17');

const S_COMP = 'spec 01 "Component structure"';

const notice = () => turns(ctx)[0].querySelector('.message.info');
// The notice parses its own newlines into <br>, so a value is compared with its newlines removed.
const asShown = value => value.replace(/\n/g, '');

k.test('values-as-text', S_COMP, 'the notice shows the prompt name, the model and the host as written, as text', () => {
    const text = notice().textContent;
    assert.ok(text.includes('[prompt_evil] ' + asShown(NAME)), 'the prompt name');
    assert.ok(text.includes(asShown(MODEL)), 'the model');
    assert.ok(text.includes(asShown(HOST)), 'the host');
});

k.test('only-own-elements', S_COMP, 'the only elements in the notice are its own labels and line breaks: <i>, <span class="info_obj">, <br>', () => {
    const foreign = [...notice().querySelectorAll('*')].filter(el =>
        !(['i', 'span'].includes(el.localName) && el.attributes.length === 1 && el.getAttribute('class') === 'info_obj')
        && !(el.localName === 'br' && el.attributes.length === 0));
    assert.deepEqual(foreign.map(el => el.outerHTML), []);
});

k.test('nothing-executable', S_COMP, 'nothing executable reaches the notice, nor the header showing the same name and model', () => {
    assert.deepEqual(executableProblems(turns(ctx)[0]), []);
    assert.deepEqual(executableProblems(ctx.$('#appHeader')), []);
    assert.equal(ctx.window.__pwned, undefined);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
