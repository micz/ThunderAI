// An Ollama API window whose worker reports the redirect outcome of its requests.
//
// Spec 04 "Redirects": a worker has no browser.storage, so the Ollama and OpenAI Comp workers post
// {type: 'endpoint_redirect', payload: {host, info}} after each request, and the window that owns
// the worker (api_webchat/controller.js) saves it with saveEndpointRedirect() into storage.local
// _endpoint_redirects, for the note under the host field of the connection panels. Nothing is
// shown in the transcript: a redirect that failed also comes as an 'error'.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { webchatTests } from '../../helpers/known-issues/webchat.mjs';
import {
    openWebchat,
    turns,
} from '../../webchat/webchat-page.mjs';

const HOST = 'http://localhost:11434';
const { ctx, worker } = await openWebchat({
    llm: 'ollama_api',
    call_id: 'c21',
    local: { ollama_model: 'llama3.2', ollama_host: HOST + '/', chat_show_usage_data: false },
});
after(() => ctx.close());
const k = webchatTests('21');
const S = 'spec 04 "Redirects"';

const stored = async () => (await ctx.ctl.browser.storage.local.get('_endpoint_redirects'))._endpoint_redirects ?? {};
const redirectWrites = since => ctx.localWrites(since).filter(w => '_endpoint_redirects' in w.items).length;
const report = info => worker.deliver(ctx, { type: 'endpoint_redirect', payload: { host: HOST, info } });

k.test('saved', S, 'a followed redirect posted by the worker is saved under its host, with the origin of the destination', async () => {
    const before = turns(ctx).length;
    await report({ redirected: true, url: 'https://ollama.example.test/api/chat', failed: false });
    const entry = (await stored())[HOST];
    assert.equal(entry.to, 'https://ollama.example.test');
    assert.equal(entry.failed, false);
    assert.equal(turns(ctx).length, before, 'nothing shown in the transcript');
});

k.test('same-outcome-no-write', S, 'the same outcome again (the next message of the chat) writes nothing', async () => {
    const since = ctx.ctl.calls.length;
    await report({ redirected: true, url: 'https://ollama.example.test/api/chat', failed: false });
    assert.equal(redirectWrites(since), 0);
});

k.test('failed', S, 'a redirect that failed is saved as failed', async () => {
    await report({ redirected: true, url: '', failed: true });
    assert.deepEqual({ ...(await stored())[HOST], at: 0 }, { to: '', failed: true, at: 0 });
});

k.test('removed', S, 'a success with no redirect removes the entry', async () => {
    await report({ redirected: false });
    assert.equal(HOST in await stored(), false);
});

k.coverage();

test('the window ran on modelled APIs only', () => assertHarnessClean(ctx));
