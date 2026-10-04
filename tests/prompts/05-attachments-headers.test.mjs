// Spec 03 "Built-in Placeholders" (mail_attachments_info, mail_headers, mail_full_headers),
// "Dynamic Placeholders" ({%mail_headers:x-spam-score%} fetches the X-Spam-Score header value) and
// "Placeholder Resolution Order" step 3 (demand-driven: the message APIs are asked only for a token
// that is present).
//
// The two message APIs these placeholders read (messages.listAttachments, messages.getFull) are not
// modelled by the core mock, and no plugin adds them: modelling them in a plugin would add them to
// every context the suite starts, including the managed area's strict DOM pages. They are added
// here, for this file only, through startPage({decorate}) - the one core entry point that takes it.
// A page context is what the popup and the menus run these placeholders in.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, startPage } from '../helpers/core/load.mjs';
import { SENDERS } from '../helpers/core/browser-mock.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('05-attachments-headers');

const ATTACHMENTS = {
    7: [
        { name: 'invoice.pdf', contentType: 'application/pdf', size: 204800, partName: '1.2' },
        { name: 'photo.jpg', contentType: 'image/jpeg', size: 51200, partName: '1.3' },
    ],
    8: [],
};
const HEADERS = {
    7: { 'X-Spam-Score': ['4.2'], subject: ['Quarterly report'], received: ['by a', 'by b'] },
    9: { from: ['Mic <m@example.com> & "co"'] },
};

let ctx, ph;
const apiCalls = [];

before(async () => {
    ctx = await startPage({
        policy: null,
        sender: SENDERS.popup,
        decorate(ctl) {
            ctl.browser.messages.listAttachments = async (id) => {
                apiCalls.push({ api: 'listAttachments', id });
                return structuredClone(ATTACHMENTS[id] ?? []);
            };
            ctl.browser.messages.getFull = async (id) => {
                apiCalls.push({ api: 'getFull', id });
                return { headers: structuredClone(HEADERS[id] ?? {}), parts: [] };
            };
        },
    });
    ph = (await import(new URL('js/mzta-placeholders.js', REPO).href)).placeholdersUtils;
});

const resolve = async (text, args = {}) => ph.replacePlaceholders({
    text, replacements: await ph.getPlaceholdersValues({ prompt_text: text, ...args }), use_default_value: true,
});
const callsOf = api => apiCalls.filter(c => c.api === api).length;

k.test('no-token-no-api-call', 'a prompt without these tokens never asks the message APIs', async () => {
    await resolve('{%mail_subject%} {%mail_text_body%}', { curr_message: { id: 7 }, mail_subject: 'S', body_text: 'B' });
    assert.equal(apiCalls.length, 0);
});

k.test('attachments-named', '{%mail_attachments_info%} names every attachment of the message', async () => {
    const out = await resolve('{%mail_attachments_info%}', { curr_message: { id: 7 } });
    assert.ok(out.includes('invoice.pdf'), out);
    assert.ok(out.includes('photo.jpg'), out);
    assert.equal(callsOf('listAttachments'), 1);
    assert.deepEqual(apiCalls.at(-1), { api: 'listAttachments', id: 7 });
});

k.test('attachments-format', 'one line per attachment: "<name>" [<contentType>] (<KB, rounded> KB)', async () => {
    assert.equal(await resolve('{%mail_attachments_info%}', { curr_message: { id: 7 } }),
        '"invoice.pdf" [application/pdf] (200 KB)\n"photo.jpg" [image/jpeg] (50 KB)');
});

k.test('header-multi-value', 'a multi-valued header is joined with ", "; the full headers keep it on one line', async () => {
    assert.equal(await resolve('{%mail_headers:received%}', { curr_message: { id: 7 } }), 'by a, by b');
    const lines = (await resolve('{%mail_full_headers%}', { curr_message: { id: 7 } })).split('\n');
    assert.ok(lines.includes('received: by a, by b'), lines.join(' | '));
});

k.test('header-escaped', 'header values have < and > escaped, and nothing else', async () => {
    assert.equal(await resolve('{%mail_headers:from%}', { curr_message: { id: 9 } }), 'Mic &lt;m@example.com&gt; & "co"');
});

k.test('attachments-none', 'a message with no attachment gives an empty value', async () => {
    assert.equal(await resolve('[{%mail_attachments_info%}]', { curr_message: { id: 8 } }), '[]');
});

k.test('header-dynamic', '{%mail_headers:x-spam-score%} is the X-Spam-Score header (any case)', async () => {
    assert.equal(await resolve('{%mail_headers:x-spam-score%}', { curr_message: { id: 7 } }), '4.2');
    assert.equal(await resolve('{%mail_headers:X-Spam-Score%}', { curr_message: { id: 7 } }), '4.2');
});

k.test('header-two-dynamic', 'two mail_headers tokens get one value each', async () => {
    assert.equal(await resolve('{%mail_headers:subject%} / {%mail_headers:x-spam-score%}', { curr_message: { id: 7 } }),
        'Quarterly report / 4.2');
});

k.test('header-missing', 'a header the message does not have gives an empty value', async () => {
    assert.equal(await resolve('[{%mail_headers:x-not-there%}]', { curr_message: { id: 7 } }), '[]');
});

k.test('full-headers', '{%mail_full_headers%} holds every header as "key: value", one per line', async () => {
    const lines = (await resolve('{%mail_full_headers%}', { curr_message: { id: 7 } })).split('\n');
    assert.ok(lines.includes('X-Spam-Score: 4.2'), lines.join(' | '));
    assert.ok(lines.includes('subject: Quarterly report'), lines.join(' | '));
    assert.ok(lines.some(l => l.startsWith('received: ')), lines.join(' | '));
});

k.coverage();
