// Spec 08 "Hydration in every other context" and "Policy-supplied API keys", for
// _special_prompts_connection: the get_managed_values reply (the real listener, cut out of
// mzta-background.js) carries the validated connections as specialPromptsConnection, with every
// *_api_key field as MANAGED_SECRET_MARKER except for the API chat window; a content script gets
// an empty one; the implied preference pair travels in values/lockedKeys like any preference.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SENDERS } from '../helpers/browser-mock.mjs';
import { startBackground, loadFixture } from '../helpers/load.mjs';
import { extractManagedValuesListener } from '../helpers/background-handler.mjs';

const POLICY = loadFixture('special-prompts-connection.json');
const SECRETS = ['sk-org-SECRET-spam', 'sk-ant-org-SECRET-sum'];

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

test('a settings page gets the connections with the marker in every key field', async () => {
    const reply = await ask(SENDERS.featurePage);
    const conn = reply.specialPromptsConnection;
    assert.deepEqual(Object.keys(conn).sort(), ['get_calendar_event', 'spamfilter', 'summarize']);
    assert.deepEqual(conn.spamfilter.fields.openai_comp_api_key, { value: ctx.MANAGED_SECRET_MARKER, locked: true });
    assert.deepEqual(conn.summarize.fields.anthropic_api_key, { value: ctx.MANAGED_SECRET_MARKER, locked: true });
    assert.deepEqual(conn.spamfilter.fields.openai_comp_model, { value: 'gpt-4o-mini', locked: false });
    assert.equal(conn.spamfilter.api_type, 'openai_comp_api');
});

test('no non-webchat page reply contains a real key', async () => {
    for (const sender of [SENDERS.options, SENDERS.featurePage, SENDERS.popup]) {
        const raw = JSON.stringify(await ask(sender));
        for (const s of SECRETS) assert.equal(raw.includes(s), false, s + ' sent to ' + sender.url);
    }
});

test('the API chat window gets the real keys', async () => {
    const conn = (await ask(SENDERS.webchat)).specialPromptsConnection;
    assert.equal(conn.spamfilter.fields.openai_comp_api_key.value, 'sk-org-SECRET-spam');
    assert.equal(conn.summarize.fields.anthropic_api_key.value, 'sk-ant-org-SECRET-sum');
});

test('asking twice never leaks the marker into the background\'s own copy', async () => {
    await ask(SENDERS.options);
    assert.equal(ctx.mztaManaged.getSpecialPromptConnection('spamfilter').fields.openai_comp_api_key.value,
        'sk-org-SECRET-spam');
});

test('a content script gets an empty connection set', async () => {
    assert.deepEqual((await ask(SENDERS.contentScript)).specialPromptsConnection, {});
});

test('the implied preference pair travels as ordinary locked preferences', async () => {
    const reply = await ask(SENDERS.featurePage);
    assert.equal(reply.values.spamfilter_use_specific_integration, true);
    assert.equal(reply.values.spamfilter_connection_type, 'openai_comp_api');
    assert.ok(reply.lockedKeys.includes('spamfilter_use_specific_integration'));
    assert.ok(reply.lockedKeys.includes('summarize_connection_type'));
});

test('the reply is structured-cloneable', async () => {
    const reply = await ask(SENDERS.featurePage);
    assert.deepEqual(structuredClone(reply), reply);
});
