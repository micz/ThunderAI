// Spec 08 "Hydration in every other context", background side, and "Load ordering":
//  - get_managed_values is the one channel a page gets the policy through: values and locks,
//    texts, connections, org prompts, restrictions, banner state; other commands return false;
//  - it is answered by a dedicated runtime.onMessage listener registered before the first
//    startup await (the migrations), and answers only once loadManaged() has settled;
//  - only extension pages are answered (sender.url under runtime.getURL('')); anything
//    else gets an empty payload;
//  - the API chat window (api_webchat/index.html) gets the real API key, every other page MANAGED_SECRET_MARKER;
//  - loadManaged() is called in exactly one place, before _reconcileFeatureFlags().
// The listener is the real one, cut out of mzta-background.js (see helpers/background-handler.mjs).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SENDERS, EXT_ORIGIN } from '../helpers/browser-mock.mjs';
import { startBackground, loadFixture, repoPath } from '../helpers/load.mjs';
import {
    extractManagedValuesListener, locateManagedValuesListener, backgroundSource, stripComments,
} from '../helpers/background-handler.mjs';

const POLICY = loadFixture('hydration.json');
const EMPTY = {
    values: {}, lockedKeys: [], specialPromptsText: {}, specialPromptsConnection: {},
    orgPrompts: [], orgName: '', active: false,
    disablePromptManagement: false, disableDefaultPrompts: false, disableSetupWizard: false,
};

let ctx, listener;

before(async () => {
    ctx = await startBackground({ policy: POLICY });
    listener = extractManagedValuesListener({
        browser: ctx.ctl.browser,
        mztaManaged: ctx.mztaManaged,
        MANAGED_SECRET_MARKER: ctx.MANAGED_SECRET_MARKER,
        prefs_default: ctx.prefs_default,
    });
});

const ask = sender => listener({ command: 'get_managed_values' }, sender);

test('a settings page gets every policy value, the lock list and the texts; keys as the marker', async () => {
    const reply = await ask(SENDERS.options);
    assert.deepEqual(reply.values, {
        connection_type: 'chatgpt_api',
        chatgpt_api_key: ctx.MANAGED_SECRET_MARKER,
        chatgpt_model: 'gpt-org',
        google_gemini_api_key: ctx.MANAGED_SECRET_MARKER,
        default_sign_name: 'ACME Staff',
    });
    assert.deepEqual([...reply.lockedKeys].sort(), ['chatgpt_api_key', 'chatgpt_model', 'connection_type']);
    assert.deepEqual(reply.specialPromptsText, POLICY._special_prompts_text);
});

test('the same reply carries the page state: active, org name, org prompts, restrictions', async () => {
    const reply = await ask(SENDERS.options);
    assert.equal(reply.active, true);
    assert.equal(reply.orgName, ctx.mztaManaged.getOrgName());
    assert.deepEqual(reply.orgPrompts, ctx.mztaManaged.getOrgPrompts());
    assert.equal(reply.disablePromptManagement, false);
    assert.equal(reply.disableDefaultPrompts, false);
    assert.equal(reply.disableSetupWizard, false);
});

test('the reply to any non-webchat page never contains a policy key', async () => {
    for (const sender of [SENDERS.options, SENDERS.featurePage, SENDERS.popup]) {
        const raw = JSON.stringify(await ask(sender));
        assert.equal(raw.includes('sk-org-SECRET-hydration'), false, sender.url);
        assert.equal(raw.includes('AIza-org-UNLOCKED-hydration'), false, sender.url);
    }
});

test('the API chat window gets the real keys', async () => {
    const reply = await ask(SENDERS.webchat);
    assert.equal(reply.values.chatgpt_api_key, 'sk-org-SECRET-hydration');
    assert.equal(reply.values.google_gemini_api_key, 'AIza-org-UNLOCKED-hydration');
});

test('non-extension senders get an empty payload', async () => {
    assert.deepEqual(await ask(SENDERS.contentScript), EMPTY);
    assert.deepEqual(await ask(SENDERS.noUrl), EMPTY);
    assert.deepEqual(await ask(undefined), EMPTY);
    assert.deepEqual(await ask({ url: 'moz-extension://another-extension/page.html' }), EMPTY);
    assert.deepEqual(await ask({ url: 'https://evil.example/' + EXT_ORIGIN }), EMPTY);
});

test('other commands are not answered, so the main listener is not competed with', () => {
    assert.equal(listener({ command: 'get_managed_state' }, SENDERS.options), false);
    assert.equal(listener({ command: 'get_org_prompts' }, SENDERS.options), false);
    assert.equal(listener(null, SENDERS.options), false);
});

test('the reply is structured-cloneable (it crosses runtime.sendMessage)', async () => {
    const reply = await ask(SENDERS.options);
    assert.deepEqual(structuredClone(reply), reply);
});

// --- Load ordering, checked on the source ----------------------------------------------

const code = stripComments(backgroundSource());

test('the listener is registered before the first startup await, so a page opened during startup is answered', () => {
    const { start } = locateManagedValuesListener();
    const firstAwait = code.search(/^\S.*\bawait\b/m); // the first top-level await
    const load = code.indexOf('await mztaManaged.loadManaged();');
    assert.ok(firstAwait !== -1 && load !== -1);
    assert.ok(start < firstAwait, 'listener registered after a startup await');
    assert.ok(start < load);
});

test('loadManaged() is called in exactly one place in the shipped code', () => {
    const files = [];
    const walk = dir => {
        for (const name of readdirSync(dir)) {
            if (['.git', 'node_modules', 'tests', '_locales', 'images', '.claude'].includes(name)) continue;
            const full = join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else if (name.endsWith('.js')) files.push(full);
        }
    };
    walk(repoPath('.'));
    const callers = [];
    for (const f of files) {
        const src = stripComments(readFileSync(f, 'utf8'));
        const n = (src.match(/\.loadManaged\(\)/g) || []).length;
        if (n > 0) callers.push([relative(repoPath('.'), f).replace(/\\/g, '/'), n]);
    }
    assert.deepEqual(callers, [['mzta-background.js', 1]]);
});
