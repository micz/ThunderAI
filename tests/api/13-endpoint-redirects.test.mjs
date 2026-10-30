// Spec 04 "Redirects" [#1000], the stored redirects of the custom endpoints
// (js/mzta-endpoint-redirects.js, storage.local _endpoint_redirects):
//  - one entry per configured host, normalized like the classes do (trimmed, trailing slashes
//    removed): {to, failed, at};
//  - `to` is the address to enter instead: the origin of the final address for another server;
//    on the same server the new base, i.e. the final address without the API path the class
//    added to the host, the same whichever endpoint was called (the final address without its
//    query when it does not end with that path); '' when unknown or the host itself; never a
//    user name, a password or a query, and a host with credentials is never stored;
//  - `method` is the one of the request the entry comes from: a GET through the redirect only
//    tells where it goes (a 301/302 turns a POST into a GET, and the code is never visible), so
//    it never replaces a failure, nor a POST success to the same destination;
//  - {redirected: false} (a success with no redirect) removes the entry; null changes nothing;
//  - the storage is written only when the entry changes: every chat message reports an outcome;
//  - clearEndpointRedirect() removes the entry of a host (its field changed).
// The module runs in the pages and the background, so the core browser mock is installed: this
// is not a worker file.

import assert from 'node:assert/strict';
import { installBrowserMock } from '../helpers/core/browser-mock.mjs';
import { areaFile } from './harness.mjs';

const ctl = installBrowserMock({ policy: null });
const { k } = areaFile('13-endpoint-redirects');
const {
    ENDPOINT_REDIRECTS_KEY,
    clearEndpointRedirect,
    getEndpointRedirect,
    normalizeEndpointHost,
    redirectTarget,
    saveEndpointRedirect,
} = await import('../../js/mzta-endpoint-redirects.js');

const HOST = 'http://localhost:11434';
const stored = async () => (await browser.storage.local.get(ENDPOINT_REDIRECTS_KEY))[ENDPOINT_REDIRECTS_KEY] ?? {};
const writes = () => ctl.calls.filter(c => c.area === 'local' && c.op === 'set'
    && Object.prototype.hasOwnProperty.call(c.items, ENDPOINT_REDIRECTS_KEY)).length;
const reset = () => browser.storage.local.remove(ENDPOINT_REDIRECTS_KEY);

k.test('key', 'the storage key is _endpoint_redirects (a leading underscore: not a preference)', () => {
    assert.equal(ENDPOINT_REDIRECTS_KEY, '_endpoint_redirects');
});

k.test('normalize', 'a host is normalized like the classes do: trimmed, trailing slashes removed', () => {
    assert.equal(normalizeEndpointHost('  http://localhost:11434///  '), HOST);
    assert.equal(normalizeEndpointHost(undefined), '');
});

k.test('target', 'the destination: the origin of another server, the whole address on the same origin, never credentials', () => {
    assert.equal(redirectTarget(HOST, 'https://ollama.example.test/api/chat?x=1'), 'https://ollama.example.test');
    assert.equal(redirectTarget(HOST + '/', HOST + '/v2/api/chat'), HOST + '/v2/api/chat');
    assert.equal(redirectTarget(HOST, 'https://user:s3cr3t@ollama.example.test/api/chat'), 'https://ollama.example.test');
    assert.equal(redirectTarget('http://u:p@localhost:11434', 'http://localhost:11434/x'), 'http://localhost:11434',
        'an unusable configured host is never "the same origin"');
    assert.equal(redirectTarget(HOST, ''), '');
    assert.equal(redirectTarget(HOST, 'file:///etc/passwd'), '');
});

k.test('target-base', 'the same server: the new base, without the API path that was requested, whatever the endpoint', () => {
    for (const api of ['/api/version', '/api/show', '/api/chat', '/api/tags']) {
        assert.equal(redirectTarget(HOST, HOST + '/_redirected' + api, HOST + api), HOST + '/_redirected', api);
    }
    assert.equal(redirectTarget('https://llm.example.test/v1/', 'https://llm.example.test/new/v1/models', 'https://llm.example.test/v1/models'),
        'https://llm.example.test/new/v1', 'a host with a path keeps it');
    assert.equal(redirectTarget('https://llm.example.test', 'https://llm.example.test/other/?key=s3cr3t', 'https://llm.example.test/v1/models'),
        'https://llm.example.test/other', 'not ending with the API path: the final address, with no query');
    assert.equal(redirectTarget(HOST, HOST + '/api/chat?x=1', HOST + '/api/chat'), '', 'the host itself: nothing to enter');
    assert.equal(redirectTarget(HOST, 'https://ollama.example.test/_r/api/chat', HOST + '/api/chat'), 'https://ollama.example.test',
        'another server: its origin');
});

k.test('save-followed', 'a followed redirect is stored under the normalized host, with the destination', async () => {
    await reset();
    await saveEndpointRedirect(' http://localhost:11434/ ', { redirected: true, url: 'https://new.example.test/api/chat', failed: false });
    const all = await stored();
    assert.deepEqual(Object.keys(all), [HOST]);
    assert.equal(all[HOST].to, 'https://new.example.test');
    assert.equal(all[HOST].failed, false);
    assert.equal(typeof all[HOST].at, 'number');
    assert.deepEqual(await getEndpointRedirect(HOST + '/'), all[HOST]);
});

k.test('save-failed', 'a redirect found by the check is stored as failed, with no destination', async () => {
    await reset();
    await saveEndpointRedirect(HOST, { redirected: true, url: '', failed: true });
    const entry = await getEndpointRedirect(HOST);
    assert.equal(entry.to, '');
    assert.equal(entry.failed, true);
});

k.test('write-on-change', 'the storage is written only when the entry changes', async () => {
    await reset();
    const info = { redirected: true, url: 'https://new.example.test/api/chat', failed: false };
    const before = writes();
    await saveEndpointRedirect(HOST, info);
    await saveEndpointRedirect(HOST, info);
    await saveEndpointRedirect(HOST, { ...info, url: 'https://new.example.test/api/tags' });
    assert.equal(writes() - before, 1, 'the same destination and state: no write');
    await saveEndpointRedirect(HOST, { ...info, url: HOST + '/v2/api/chat', from: HOST + '/api/chat' });
    await saveEndpointRedirect(HOST, { ...info, url: HOST + '/v2/api/version', from: HOST + '/api/version' });
    await saveEndpointRedirect(HOST, { ...info, url: HOST + '/v2/api/show', from: HOST + '/api/show' });
    assert.equal(writes() - before, 2, 'the same new base from another endpoint: no write');
    assert.equal((await getEndpointRedirect(HOST)).to, HOST + '/v2');
    await saveEndpointRedirect(HOST, info);
    assert.equal(writes() - before, 3);
    await saveEndpointRedirect(HOST, { ...info, failed: true });
    assert.equal(writes() - before, 4, 'failed changed: written');
    assert.equal((await getEndpointRedirect(HOST)).failed, true);
});

k.test('method-get', 'a GET through the redirect never replaces a failure nor a POST success; a POST success does', async () => {
    await reset();
    const base = HOST + '/v2';
    const get = { redirected: true, url: base + '/api/version', from: HOST + '/api/version', method: 'GET', failed: false };
    const post = { redirected: true, url: base + '/api/chat', from: HOST + '/api/chat', method: 'POST', failed: false };
    await saveEndpointRedirect(HOST, get);
    assert.deepEqual({ ...await getEndpointRedirect(HOST), at: 0 }, { to: base, failed: false, method: 'GET', at: 0 }, 'nothing known: stored');
    await saveEndpointRedirect(HOST, { ...post, method: 'POST', failed: true });
    assert.equal((await getEndpointRedirect(HOST)).failed, true, 'a POST that failed replaces it');
    const before = writes();
    await saveEndpointRedirect(HOST, get);
    await saveEndpointRedirect(HOST, { ...get, url: 'https://other.example.test/api/version' });
    assert.equal(writes(), before, 'a GET never replaces a failure');
    assert.equal((await getEndpointRedirect(HOST)).failed, true);
    await saveEndpointRedirect(HOST, post);
    assert.deepEqual({ ...await getEndpointRedirect(HOST), at: 0 }, { to: base, failed: false, method: 'POST', at: 0 }, 'a POST success replaces it');
    const after = writes();
    await saveEndpointRedirect(HOST, get);
    assert.equal(writes(), after, 'a GET to the same destination keeps the POST success');
    await saveEndpointRedirect(HOST, { ...get, url: 'https://other.example.test/api/version' });
    assert.deepEqual({ ...await getEndpointRedirect(HOST), at: 0 }, { to: 'https://other.example.test', failed: false, method: 'GET', at: 0 },
        'a GET to another destination: the server moved');
    await saveEndpointRedirect(HOST, { ...get, failed: true });
    assert.equal((await getEndpointRedirect(HOST)).failed, true, 'a GET that failed is a failure too');
});

k.test('remove-on-success', 'a success with no redirect removes the entry; with none stored, nothing is written', async () => {
    await reset();
    await saveEndpointRedirect(HOST, { redirected: true, url: 'https://new.example.test/', failed: false });
    await saveEndpointRedirect(HOST, { redirected: false });
    assert.equal(await getEndpointRedirect(HOST), null);
    assert.deepEqual(await stored(), {});
    const before = writes();
    await saveEndpointRedirect(HOST, { redirected: false });
    assert.equal(writes(), before);
});

k.test('nothing-known', 'an outcome that says nothing (null, malformed) changes nothing', async () => {
    await reset();
    await saveEndpointRedirect(HOST, { redirected: true, url: 'https://new.example.test/', failed: false });
    const before = writes();
    await saveEndpointRedirect(HOST, null);
    await saveEndpointRedirect(HOST, undefined);
    await saveEndpointRedirect(HOST, { url: 'x' });
    assert.equal(writes(), before);
    assert.notEqual(await getEndpointRedirect(HOST), null);
});

k.test('other-hosts-kept', 'each host has its own entry: removing one keeps the others', async () => {
    await reset();
    await saveEndpointRedirect(HOST, { redirected: true, url: 'https://a.example.test/', failed: false });
    await saveEndpointRedirect('https://llm.example.test/v1', { redirected: true, url: '', failed: true });
    await saveEndpointRedirect(HOST, { redirected: false });
    assert.deepEqual(Object.keys(await stored()), ['https://llm.example.test/v1']);
});

k.test('clear-on-field-change', 'clearEndpointRedirect() removes the entry of the previous address; nothing to remove, no write', async () => {
    await reset();
    await saveEndpointRedirect(HOST, { redirected: true, url: 'https://a.example.test/', failed: false });
    await clearEndpointRedirect(HOST + '/');
    assert.equal(await getEndpointRedirect(HOST), null);
    const before = writes();
    await clearEndpointRedirect(HOST);
    assert.equal(writes(), before);
});

k.test('no-credentials', 'nothing stored ever holds a user name or a password', async () => {
    await reset();
    await saveEndpointRedirect('https://user:s3cr3t@llm.example.test', { redirected: true, url: 'https://new.example.test/', failed: false });
    assert.deepEqual(await stored(), {}, 'a host with credentials is never stored');
    await saveEndpointRedirect(HOST, { redirected: true, url: 'https://admin:s3cr3t@new.example.test/v1', failed: true });
    const text = JSON.stringify(await stored());
    assert.equal(text.includes('s3cr3t'), false, text);
    assert.equal(text.includes('admin'), false, text);
    assert.equal((await getEndpointRedirect(HOST)).to, 'https://new.example.test');
});

k.coverage();
