// The extended model check preference, and how it reaches the ChatGPT page.
//
// Spec 05 "UI & Feature Preferences" (`chatgpt_web_model_extended_check`, default false) and spec 04
// "Model verification" (the background passes it to the content script in the pre-script as
// `mztaGPTExtendedCheck`, "1" or "0", next to `mztaGPTModel`; a Custom GPT empties the model, so
// nothing is checked whatever the option).
//
// The pre-script is the real one, cut out of handleChatGptWeb() in mzta-background.js and built
// for each case (./pre-script.mjs); its declarations are then run as the page runs them, and read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installBrowserMock } from '../helpers/core/browser-mock.mjs';
import {
    captureConsole,
    loadModules
} from '../helpers/core/load.mjs';
import {
    buildPreScript,
    preScriptSource
} from './pre-script.mjs';

const S_PREF = 'spec 05 "UI & Feature Preferences"';
const S_CHECK = 'spec 04 "Model verification"';

const ctl = installBrowserMock();
captureConsole();
const { utils, prefs_default } = await loadModules();

/** The values the pre-script declares, as the page sees them. */
function injected(opts) {
    const prefs = { ...prefs_default, ...opts.prefs };
    const code = buildPreScript({ browser: ctl.browser, utils, prefs, customGpt: opts.customGpt });
    const values = vm.runInNewContext(code + '; ({ mztaGPTModel, mztaGPTExtendedCheck })');
    return { ...values };   // out of the vm's realm, for deepEqual
}

test(`${S_PREF}: chatgpt_web_model_extended_check is a preference, false by default, next to chatgpt_web_tempchat`, () => {
    assert.equal(prefs_default.chatgpt_web_model_extended_check, false);
    const keys = Object.keys(prefs_default);
    assert.equal(keys.indexOf('chatgpt_web_model_extended_check'), keys.indexOf('chatgpt_web_tempchat') + 1);
});

test(`${S_CHECK}: the pre-script is found once in mzta-background.js`, () => {
    assert.match(preScriptSource(), /mztaGPTModel/);
});

test(`${S_CHECK}: the default injects mztaGPTExtendedCheck "0"`, () => {
    assert.deepEqual(injected({ prefs: { chatgpt_web_model: 'gpt-6' } }), { mztaGPTModel: 'gpt-6', mztaGPTExtendedCheck: '0' });
});

test(`${S_CHECK}: the option on injects "1", off injects "0"`, () => {
    assert.equal(injected({ prefs: { chatgpt_web_model: 'gpt-6', chatgpt_web_model_extended_check: true } }).mztaGPTExtendedCheck, '1');
    assert.equal(injected({ prefs: { chatgpt_web_model: 'gpt-6', chatgpt_web_model_extended_check: false } }).mztaGPTExtendedCheck, '0');
});

test(`${S_CHECK}: the option is injected with an empty model too (a prompt's own model can still ask for one)`, () => {
    assert.deepEqual(injected({ prefs: { chatgpt_web_model: '', chatgpt_web_model_extended_check: true } }),
        { mztaGPTModel: '', mztaGPTExtendedCheck: '1' });
});

test(`${S_CHECK}: a legacy model id is injected as its display name`, () => {
    assert.equal(injected({ prefs: { chatgpt_web_model: 'gpt-5-thinking' } }).mztaGPTModel, '5 Thinking');
});

test(`${S_CHECK}: a Custom GPT injects no model, so nothing is checked`, () => {
    assert.deepEqual(injected({ prefs: { chatgpt_web_model: 'gpt-6', chatgpt_web_model_extended_check: true }, customGpt: true }),
        { mztaGPTModel: '', mztaGPTExtendedCheck: '1' });
});
