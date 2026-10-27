// The notes under the two custom endpoint host fields of the options page, no policy [#1000].
//
// Spec 05 "Connection Settings Panel — Custom Endpoint Address":
//  - the red note (#{integration}_host_endpoint_note) is filled at load for the restored address,
//    with no question: a remote http:// Ollama not yet allowed shows endpoint_insecure_note at
//    once; a change of the field checks again without any confirm(); it goes away when the server
//    is allowed (a storage.onChanged of _approved_insecure_origins);
//  - the amber note (#{integration}_host_redirect_note) shows the stored redirect of the address
//    in the field (_endpoint_redirects, spec 04 "Redirects"): endpoint_redirect_note naming the
//    destination, endpoint_redirect_failed_note / _to for a failed one; it follows the storage,
//    and stays until the field changes: then the entry of the previous address is removed and
//    the note hidden;
//  - spec 05 "Connection Test Status Strip": a test answered through a redirect is amber and names
//    the destination; a GET only tells where the server redirects, so the note says the chat may
//    not work through it (endpoint_redirect_note_unverified), and never replaces a failure.
// Initial state: Ollama on a LAN http:// address not allowed, an OpenAI Comp host known to
// redirect. The tests run in order on one page; each builds on the previous one's field values.

import {
    test,
    after
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    json,
    scriptFetch,
    shown,
    userSets,
    until
} from '../../ui/dom-helpers.mjs';

const LAN = 'http://192.168.1.10:11434';
const COMP = 'https://llm.example.test';
const NEW = 'https://new.example.test';

const ctx = await openPage('options', {
    local: {
        connection_type: 'ollama_api',
        ollama_host: LAN,
        ollama_model: 'llama3.2',
        openai_comp_host: COMP + '/',
        openai_comp_model: 'm',
        _endpoint_redirects: { [COMP]: { to: NEW, failed: false, method: 'POST', at: 1 } },
    },
});
after(() => ctx.close());
const k = uiTests('options', '06');
const S = 'spec 05 "Connection Settings Panel — Custom Endpoint Address"';
const $ = ctx.$;
const msg = (name, subs) => ctx.ctl.browser.i18n.getMessage(name, subs);
const confirms = () => ctx.dialogs.filter(d => d.kind === 'confirm').length;
// The OpenAI Comp rows are hidden (the connection is Ollama): their notes are read by their own flag.
const visible = note => note.hidden === false && note.textContent !== '';
const redirects = async () => (await ctx.ctl.browser.storage.local.get('_endpoint_redirects'))._endpoint_redirects ?? {};
const net = scriptFetch(ctx);

k.test('red-at-load', S, 'a remote http:// host not yet allowed shows the red note at load, with no question', () => {
    const note = $('#ollama_host_endpoint_note');
    assert.equal(shown(note), true);
    assert.equal(note.textContent, msg('endpoint_insecure_note'));
    assert.equal(confirms(), 0);
    assert.equal(visible($('#openai_comp_host_endpoint_note')), false, 'an https:// host has no red note');
});

k.test('amber-at-load', S, 'a stored redirect of the address in the field shows the amber note at load, naming the destination', () => {
    const note = $('#openai_comp_host_redirect_note');
    assert.equal(visible(note), true);
    assert.ok(note.classList.contains('endpoint_note_warning'));
    assert.equal(note.textContent, msg('endpoint_redirect_note', [NEW]));
    assert.equal(visible($('#ollama_host_redirect_note')), false, 'no entry: hidden');
});

k.test('amber-failed', S, 'a failed redirect: endpoint_redirect_failed_note, or its _to variant when the destination is known', async () => {
    const note = $('#openai_comp_host_redirect_note');
    await ctx.ctl.browser.storage.local.set({ _endpoint_redirects: { [COMP]: { to: '', failed: true, at: 2 } } });
    await until(ctx, () => note.textContent === msg('endpoint_redirect_failed_note'), 'the failed note');
    assert.equal(visible(note), true);
    await ctx.ctl.browser.storage.local.set({ _endpoint_redirects: { [COMP]: { to: NEW, failed: true, at: 3 } } });
    await until(ctx, () => note.textContent === msg('endpoint_redirect_failed_note_to', [NEW]), 'the failed note with its destination');
    await ctx.ctl.browser.storage.local.set({ _endpoint_redirects: {} });
    await until(ctx, () => !visible(note), 'the note hidden once the entry is gone');
    await ctx.ctl.browser.storage.local.set({ _endpoint_redirects: { [COMP]: { to: NEW, failed: false, method: 'POST', at: 4 } } });
    await until(ctx, () => visible(note), 'the note back');
});

k.test('red-on-change-no-confirm', S, 'a change of the field checks the new address without any confirm()', async () => {
    await userSets(ctx, $('#ollama_host'), 'http://192.168.1.20:11434');
    assert.equal(confirms(), 0);
    assert.equal($('#ollama_host_endpoint_note').textContent, msg('endpoint_insecure_note'));
    await userSets(ctx, $('#ollama_host'), 'http://user:pass@localhost:11434');
    assert.equal($('#ollama_host_endpoint_note').textContent, msg('endpoint_error_credentials'));
    await userSets(ctx, $('#ollama_host'), 'http://192.168.1.20:11434');
    assert.equal(confirms(), 0);
    assert.equal((await ctx.ctl.browser.storage.local.get('_approved_insecure_origins'))._approved_insecure_origins,
        undefined, 'nothing approved by the field');
});

k.test('no-credentials-logged', 'spec 04 "Custom endpoint policy"', 'saving a host with a user name and password never logs them', async () => {
    const from = ctx.con.entries.length;
    await userSets(ctx, $('#ollama_host'), 'http://admin:s3cr3t@localhost:11434');
    const lines = ctx.con.entries.slice(from).map(e => e.msg);
    assert.ok(lines.some(l => l.includes('Saving option: ollama_host')), 'the save is logged: ' + lines.join(' | '));
    assert.equal(lines.some(l => l.includes('s3cr3t') || l.includes('admin')), false, lines.join(' | '));
    await userSets(ctx, $('#ollama_host'), 'http://192.168.1.20:11434');
});

k.test('red-gone-on-approval', S, 'the red note goes away when the server is allowed (storage.onChanged)', async () => {
    const note = $('#ollama_host_endpoint_note');
    await ctx.ctl.browser.storage.local.set({ _approved_insecure_origins: ['http://192.168.1.20:11434'] });
    await until(ctx, () => !shown(note), 'the red note hidden');
    assert.equal(note.textContent, '');
});

k.test('amber-gone-on-change', S, 'a change of the field hides the amber note and removes the entry of the previous address', async () => {
    const note = $('#openai_comp_host_redirect_note');
    assert.equal(visible(note), true);
    await userSets(ctx, $('#openai_comp_host'), COMP + '///');
    assert.equal(visible(note), true, 'the same host with trailing slashes: kept');
    assert.ok(COMP in await redirects());
    await userSets(ctx, $('#openai_comp_host'), NEW);
    await until(ctx, () => !visible(note), 'the amber note hidden');
    assert.equal(COMP in await redirects(), false, 'the entry of the previous address removed');
});

const LOCAL = 'http://localhost:11434';
const strip = () => $('#mzta_conn_test');
const runTest = async () => {
    await ctx.click($('#mzta_conn_test_link'));
    await until(ctx, () => strip().getAttribute('data-state') !== 'loading', 'the test to end');
};
// /api/version answered from /v2/api/version: a redirect the test (a GET) went through.
const versionThroughRedirect = () => {
    net.answer(LOCAL + '/api/version', () => Object.defineProperties(json({ version: '0.6.0' }), {
        redirected: { value: true },
        url: { value: LOCAL + '/v2/api/version' },
    }));
};

k.test('test-redirect-amber', 'spec 05 "Connection Settings Panel — Connection Test Status Strip"', 'a test answered through a redirect is amber and names the new base address', async () => {
    await userSets(ctx, $('#ollama_host'), LOCAL);
    versionThroughRedirect();
    await runTest();
    assert.equal(strip().getAttribute('data-state'), 'warning');
    assert.equal($('#mzta_conn_test_text').textContent,
        msg('connTest_ok_redirect', [msg('prefs_Connection_type_Ollama_API'), LOCAL + '/v2']));
    const note = $('#ollama_host_redirect_note');
    await until(ctx, () => note.textContent === msg('endpoint_redirect_note_unverified', [LOCAL + '/v2']), 'the unverified amber note');
    assert.equal((await redirects())[LOCAL].method, 'GET');
});

k.test('get-keeps-failure', S, 'a GET through the redirect never replaces a failure a POST recorded', async () => {
    const note = $('#ollama_host_redirect_note');
    await ctx.ctl.browser.storage.local.set({ _endpoint_redirects: { [LOCAL]: { to: LOCAL + '/v2', failed: true, method: 'POST', at: 5 } } });
    await until(ctx, () => note.textContent === msg('endpoint_redirect_failed_note_to', [LOCAL + '/v2']), 'the failed note');
    versionThroughRedirect();
    await runTest();
    assert.equal(strip().getAttribute('data-state'), 'warning', 'the test still says it went through a redirect');
    assert.equal((await redirects())[LOCAL].failed, true);
    assert.equal(note.textContent, msg('endpoint_redirect_failed_note_to', [LOCAL + '/v2']));
    assert.deepEqual(net.pending(), []);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
