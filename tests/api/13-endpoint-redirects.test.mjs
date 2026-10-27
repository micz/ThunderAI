// Spec 04 "Redirects" [#1000], the stored redirects of the custom endpoints
// (js/mzta-endpoint-redirects.js, storage.local _endpoint_redirects):
//  - one entry per configured host, normalized like the classes do (trimmed, trailing slashes
//    removed): {to, failed, at};
//  - `to` is the origin of the final address, or the whole final address when it stays on the
//    configured origin (a redirect of the path only), '' when unknown; never a user name or
//    password, and a host with credentials is never stored;
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
    await saveEndpointRedirect(HOST, { ...info, failed: true });
    assert.equal(writes() - before, 2, 'failed changed: written');
    assert.equal((await getEndpointRedirect(HOST)).failed, true);
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
