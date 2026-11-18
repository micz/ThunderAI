// Spec 03 "The QNote placeholders" [#980]: js/mzta-qnote.js (getQNoteStatus(), requestQNoteAccess(),
// getQNoteNotes(), prefetchQNoteNotes()) and the {%qnote_text%} / {%qnote_datetime%} arms of
// getPlaceholdersValues(): read only with qnote_integration on, by the message's headerMessageId,
// once per message even with both tokens, never with no token, '' on every failure (never the
// literal token, whatever placeholders_use_default_value says), and never a getStatus or a
// requestAccess on the placeholder path.
//
// QNote is the other end of the two-argument runtime.sendMessage(QNOTE_ID, message), answered by
// startPage({external}) with `qnote` below, which a test replaces. Every message sent to it is in
// `sent`. A page context: the popup and the menus resolve the placeholders there.

import {
    before,
    beforeEach,
} from 'node:test';
import assert from 'node:assert/strict';
import { REPO, startPage } from '../helpers/core/load.mjs';
import { SENDERS } from '../helpers/core/browser-mock.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('06-qnote');

const QNOTE_ID = 'qnote@dqdp.net';
const NOT_THERE = () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
const TS = Date.UTC(2026, 10, 18, 9, 30);
const NOTES = { 'a@x': { text: 'Call Bob back', ts: TS }, 'b@x': null };

// QNote with the external API, access granted, the notes above.
const granted = (message) => {
    switch (message.command) {
        case 'getStatus':
        case 'requestAccess': return { apiVersion: 1, access: 'granted' };
        case 'getNotes': return {
            apiVersion: 1,
            notes: Object.fromEntries(message.headerMessageIds.map(id => [id, NOTES[id] ?? null])),
        };
        default: return { apiVersion: 1, error: 'unknown-command' };
    }
};

let qnote = granted;
const sent = [];
let ctx, q, ph;

before(async () => {
    ctx = await startPage({
        policy: null,
        sender: SENDERS.popup,
        local: { qnote_integration: true },
        external: async (id, message) => {
            if (id !== QNOTE_ID) return null;
            sent.push(structuredClone(message));
            return qnote(message);
        },
    });
    q = await import(new URL('js/mzta-qnote.js', REPO).href);
    ph = (await import(new URL('js/mzta-placeholders.js', REPO).href)).placeholdersUtils;
});

beforeEach(async () => {
    qnote = granted;
    sent.length = 0;
    await ctx.ctl.browser.storage.local.set({ qnote_integration: true });
});

const commands = () => sent.map(m => m.command);
// A never answering QNote: the promise stays pending.
const hanging = () => new Promise(() => {});
// The resolved text, as preparePrompt() substitutes it.
const resolve = async (text, args = {}, use_default_value = false) => ph.replacePlaceholders({
    text, replacements: await ph.getPlaceholdersValues({ prompt_text: text, ...args }), use_default_value,
});
const message = hid => ({ id: 1, headerMessageId: hid });

// --- The helper module ------------------------------------------------------------------------

k.test('status-states', 'getQNoteStatus() returns every access state QNote reports', async () => {
    for (const access of ['unknown', 'pending', 'granted', 'denied']) {
        qnote = () => ({ apiVersion: 1, access });
        assert.deepEqual(await q.getQNoteStatus(), { ok: true, apiVersion: 1, access });
    }
    assert.deepEqual(commands(), ['getStatus', 'getStatus', 'getStatus', 'getStatus']);
});

k.test('request-states', 'requestQNoteAccess() sends requestAccess and returns the state', async () => {
    for (const access of ['pending', 'granted', 'denied']) {
        qnote = () => ({ apiVersion: 1, access });
        assert.deepEqual(await q.requestQNoteAccess(), { ok: true, apiVersion: 1, access });
    }
    assert.deepEqual(commands(), ['requestAccess', 'requestAccess', 'requestAccess']);
});

k.test('not-installed', 'QNote missing (sendMessage rejects): not_reachable, never a throw', async () => {
    qnote = NOT_THERE;
    assert.deepEqual(await q.getQNoteStatus(), { ok: false, reason: 'not_reachable' });
    assert.deepEqual(await q.requestQNoteAccess(), { ok: false, reason: 'not_reachable' });
    assert.deepEqual(await q.getQNoteNotes(['a@x']), { ok: false, reason: 'not_reachable', notes: {} });
});

k.test('status-timeout', 'getStatus with no answer gives up after the time-out: not_reachable', async () => {
    qnote = hanging;
    assert.deepEqual(await q.getQNoteStatus({ timeoutMs: 20 }), { ok: false, reason: 'not_reachable' });
});

k.test('notes-timeout', 'getNotes with no answer gives up after the time-out: not_reachable, no notes', async () => {
    qnote = hanging;
    assert.deepEqual(await q.getQNoteNotes(['a@x'], { timeoutMs: 20 }), { ok: false, reason: 'not_reachable', notes: {} });
});

k.test('default-timeout', 'getStatus and getNotes have a short default time-out; requestAccess has none', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    qnote = hanging;
    let status, notes, request;
    q.getQNoteStatus().then(r => { status = r; });
    q.getQNoteNotes(['a@x']).then(r => { notes = r; });
    q.requestQNoteAccess().then(r => { request = r; });
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
    t.mock.timers.tick(q.QNOTE_TIMEOUT_MS);
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
    assert.equal(status?.reason, 'not_reachable');
    assert.equal(notes?.reason, 'not_reachable');
    t.mock.timers.tick(10 * 60 * 1000);
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
    assert.equal(request, undefined, 'requestAccess still waits for the user');
    assert.ok(q.QNOTE_TIMEOUT_MS > 0 && q.QNOTE_TIMEOUT_MS <= 5000);
});

k.test('unsupported', 'a reply with no apiVersion, or one below 1, or no reply at all: unsupported', async () => {
    for (const reply of [{ access: 'granted' }, { apiVersion: 0, access: 'granted' }, undefined, null, 'ok']) {
        qnote = () => reply;
        assert.equal((await q.getQNoteStatus()).reason, 'unsupported', JSON.stringify(reply));
        assert.equal((await q.requestQNoteAccess()).reason, 'unsupported', JSON.stringify(reply));
        assert.equal((await q.getQNoteNotes(['a@x'])).reason, 'unsupported', JSON.stringify(reply));
    }
});

k.test('error-reply', 'an error reply other than access-denied, or an unknown access state: error', async () => {
    qnote = () => ({ apiVersion: 1, error: 'invalid-request' });
    assert.deepEqual(await q.getQNoteStatus(), { ok: false, reason: 'error', error: 'invalid-request' });
    assert.equal((await q.getQNoteNotes(['a@x'])).reason, 'error');
    qnote = () => ({ apiVersion: 1, error: 'unknown-command' });
    assert.equal((await q.requestQNoteAccess()).reason, 'error');
    qnote = () => ({ apiVersion: 1, access: 'maybe' });
    assert.equal((await q.getQNoteStatus()).reason, 'error');
    qnote = () => ({ apiVersion: 1, notes: 'none' });
    assert.equal((await q.getQNoteNotes(['a@x'])).reason, 'error', 'notes is not an object');
});

k.test('notes-access-denied', 'getNotes refused with access-denied: access_not_granted', async () => {
    qnote = () => ({ apiVersion: 1, error: 'access-denied' });
    assert.deepEqual(await q.getQNoteNotes(['a@x']), { ok: false, reason: 'access_not_granted', error: 'access-denied', notes: {} });
});

k.test('notes-read', 'granted: each id maps to its { text, ts }, or null with no note', async () => {
    assert.deepEqual(await q.getQNoteNotes(['a@x', 'b@x', 'c@x']), {
        ok: true, notes: { 'a@x': { text: 'Call Bob back', ts: TS }, 'b@x': null, 'c@x': null },
    });
    assert.deepEqual(sent, [{ command: 'getNotes', headerMessageIds: ['a@x', 'b@x', 'c@x'] }]);
});

k.test('notes-no-ids', 'no valid id: no call at all', async () => {
    assert.deepEqual(await q.getQNoteNotes([undefined, '', null]), { ok: true, notes: {} });
    assert.deepEqual(sent, []);
});

k.test('notes-chunked', 'more than 1000 ids: one getNotes per 1000, duplicates sent once', async () => {
    const ids = Array.from({ length: 2001 }, (_, i) => 'm' + i + '@x');
    const result = await q.getQNoteNotes([...ids, 'm0@x']);
    assert.equal(result.ok, true);
    assert.deepEqual(sent.map(m => m.headerMessageIds.length), [1000, 1000, 1]);
    assert.equal(Object.keys(result.notes).length, 2001);
});

k.test('prefetch', 'prefetchQNoteNotes(): one call for the batch, every id present even after a failure, null with the integration off', async () => {
    assert.deepEqual(await q.prefetchQNoteNotes(['a@x', 'b@x']), { 'a@x': { text: 'Call Bob back', ts: TS }, 'b@x': null });
    assert.equal(sent.length, 1);
    qnote = NOT_THERE;
    assert.deepEqual(await q.prefetchQNoteNotes(['a@x', 'b@x']), { 'a@x': null, 'b@x': null });
    await ctx.ctl.browser.storage.local.set({ qnote_integration: false });
    sent.length = 0;
    assert.equal(await q.prefetchQNoteNotes(['a@x']), null);
    assert.deepEqual(sent, []);
});

// --- The placeholders -------------------------------------------------------------------------

k.test('ph-granted', 'granted with a note: {%qnote_text%} is the text, {%qnote_datetime%} the timestamp as a Date string', async () => {
    assert.equal(await resolve('Note: {%qnote_text%} ({%qnote_datetime%})', { curr_message: message('a@x') }),
        `Note: Call Bob back (${new Date(TS).toString()})`);
});

k.test('ph-one-call', 'both placeholders, each twice: one getNotes, by headerMessageId, and no getStatus first', async () => {
    await resolve('{%qnote_text%} {%qnote_datetime%} {% qnote_text %} {%qnote_datetime%}', { curr_message: message('a@x') });
    assert.deepEqual(sent, [{ command: 'getNotes', headerMessageIds: ['a@x'] }]);
});

k.test('ph-no-token', 'a prompt without the QNote placeholders never calls QNote', async () => {
    await resolve('{%mail_subject%} {%mail_datetime%}', { curr_message: message('a@x'), mail_subject: 'S' });
    assert.deepEqual(sent, []);
});

k.test('ph-null-note', 'granted, no note (null): both resolve to "", not the literal token', async () => {
    assert.equal(await resolve('[{%qnote_text%}][{%qnote_datetime%}]', { curr_message: message('b@x') }), '[][]');
});

k.test('ph-failures', 'not installed, time-out, access-denied, unsupported, error reply: "" every time, never the token', async (t) => {
    const cases = {
        'not installed': NOT_THERE,
        'access-denied': () => ({ apiVersion: 1, error: 'access-denied' }),
        'unsupported': () => ({ notes: { 'a@x': { text: 'x', ts: TS } } }),
        'error reply': () => ({ apiVersion: 1, error: 'invalid-request' }),
    };
    for (const [name, answer] of Object.entries(cases)) {
        qnote = answer;
        for (const use_default_value of [false, true]) {
            assert.equal(await resolve('[{%qnote_text%}][{%qnote_datetime%}]', { curr_message: message('a@x') }, use_default_value), '[][]', name);
        }
    }
    assert.ok(!commands().some(c => c !== 'getNotes'), 'getNotes only: ' + commands().join(', '));
    // A hanging QNote: the default time-out, on the mock clock.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    qnote = hanging;
    let out;
    resolve('[{%qnote_text%}]', { curr_message: message('a@x') }).then(r => { out = r; });
    for (let i = 0; i < 50 && out === undefined; i++) {
        await new Promise(r => setImmediate(r));
        t.mock.timers.tick(1000);
    }
    assert.equal(out, '[]');
});

k.test('ph-pref-off', 'qnote_integration off: "" with no call to QNote', async () => {
    await ctx.ctl.browser.storage.local.set({ qnote_integration: false });
    assert.equal(await resolve('[{%qnote_text%}][{%qnote_datetime%}]', { curr_message: message('a@x') }), '[][]');
    assert.deepEqual(sent, []);
});

k.test('ph-compose', 'no headerMessageId (a compose window\'s ComposeDetails): "" with no call', async () => {
    assert.equal(await resolve('[{%qnote_text%}]', { curr_message: { to: ['a@b.c'], subject: 'S' } }), '[]');
    assert.deepEqual(sent, []);
});

k.test('ph-header-message-id', 'header_message_id names the message when there is no curr_message (translation)', async () => {
    assert.equal(await resolve('{%qnote_text%}', { header_message_id: 'a@x' }), 'Call Bob back');
    assert.deepEqual(sent, [{ command: 'getNotes', headerMessageIds: ['a@x'] }]);
});

k.test('ph-prefetched', 'with the notes a batch prefetched, no call: the map is used, a null in it included', async () => {
    const qnote_notes = { 'a@x': { text: 'From the batch', ts: TS }, 'b@x': null };
    assert.equal(await resolve('{%qnote_text%}', { curr_message: message('a@x'), qnote_notes }), 'From the batch');
    assert.equal(await resolve('[{%qnote_text%}]', { curr_message: message('b@x'), qnote_notes }), '[]');
    assert.deepEqual(sent, []);
});

k.test('ph-type', 'both are reading-only built-ins (type 1), with no default value and no parameter', async () => {
    const { getPlaceholders } = await import(new URL('js/mzta-placeholders.js', REPO).href);
    for (const id of ['qnote_text', 'qnote_datetime']) {
        const p = (await getPlaceholders(true)).find(x => x.id === id);
        assert.equal(Number(p.type), 1, id);
        assert.equal(p.is_default, '1', id);
        assert.equal(p.is_dynamic, '0', id);
        assert.equal(p.default_value, '', id);
        assert.equal(p.name, '__MSG_placeholder_' + id + '__', id);
    }
});

k.test('ph-no-empty-elsewhere', 'the empty-is-a-value rule is the QNote placeholders\' only: an empty subject still follows the || chain', async () => {
    assert.equal(ph.replacePlaceholders({ text: '{%mail_subject%}', replacements: { mail_subject: '' } }), '{%mail_subject%}');
    assert.equal(ph.replacePlaceholders({ text: '{%qnote_text%}', replacements: {} }), '{%qnote_text%}',
        'a QNote token with no value supplied at all is still left as written');
});

k.coverage();
