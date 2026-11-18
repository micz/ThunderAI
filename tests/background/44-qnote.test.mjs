// The QNote placeholders on the automatic paths [#980]: spam filter, add tags and translation on
// receive, with qnote_integration on and the three special prompts using {%qnote_text%} /
// {%qnote_datetime%}.
//
// Spec 03 "The QNote placeholders": the background only ever reads the notes (getNotes, by the
// message's headerMessageId); it never asks QNote's status and never calls requestAccess, whose
// dialog is modal and would open at a random moment; a QNote that is missing, refuses or answers
// nothing is no note, and the prompt is sent all the same. Spec 01 "Per-message pipelines in
// processEmails()": each feature resolves the placeholders of its own message.
//
// QNote is the `external` answer of bgContext() for its id; `qnote` below is replaced by a test.
// The summary on receive is not here: buildSummaryPrompt() is a stand-in in this area (its body
// read needs a DOM), and its prefetch is tested in the prompts area.

import assert from 'node:assert/strict';
import { bgContext, flush } from './context.mjs';
import {
    API,
    featureResponder,
    featureOf,
    receive,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const QNOTE_ID = 'qnote@dqdp.net';
const TS = Date.UTC(2026, 10, 18, 9, 30);
const NOT_THERE = () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
const granted = (message) => {
    if (message.command !== 'getNotes') return { apiVersion: 1, access: 'granted' };
    return {
        apiVersion: 1,
        notes: Object.fromEntries(message.headerMessageIds.map(id => [id, id === 'q1@x' ? { text: 'Call Bob back', ts: TS } : null])),
    };
};
let qnote = granted;
const toQNote = [];

const special = (id, text) => ({
    id, name: `__MSG_${id}__`, text, type: '1', action: '0', need_selected: '0', need_signature: '0',
    need_custom_text: '0', define_response_lang: '0', use_diff_viewer: '0', api_type: '',
    is_default: '1', is_special: '1', allow_multi: true, show_in: 'both',
});

const H = {};
const ctx = await bgContext({
    local: {
        ...API,
        qnote_integration: true,
        spamfilter: true,
        spamfilter_skip_addressbook: false,
        add_tags: true,
        add_tags_auto: true,
        translate: true,
        translate_auto: 3,
        default_chatgpt_lang: 'Italian',
        summarize: false,
        _special_prompts: [
            special('prompt_spamfilter', 'Analyze the email and determine if it is spam. [{%mail_subject%}] Note: [{%qnote_text%}] at [{%qnote_datetime%}]'),
            special('prompt_add_tags', 'Please generate a JSON array of tags. [{%mail_subject%}] Note: [{%qnote_text%}]'),
            special('prompt_translate_this', 'Translate the email below. [{%mail_subject%}] Note: [{%qnote_text%}] {%mail_html_body%}'),
        ],
    },
    external: async (id, message) => {
        if (id !== QNOTE_ID) return null;
        toQNote.push(structuredClone(message));
        return qnote(message);
    },
    setup(m) {
        H.q1 = m.addMessage({ headerMessageId: 'q1@x', subject: 'Subject one' });
        H.q2 = m.addMessage({ headerMessageId: 'q2@x', subject: 'Subject two' });
        H.q3 = m.addMessage({ headerMessageId: 'q3@x', subject: 'Subject three' });
    },
});
ctx.workers.respond = featureResponder();
const k = caseTests('44-qnote');

// The prompts sent for the message whose subject is `subject`, by feature.
const promptsFor = subject => Object.fromEntries(ctx.workers.prompts()
    .filter(p => String(p).includes('[' + subject + ']'))
    .map(p => [featureOf(p), String(p)]));

await receive(ctx, [H.q1, H.q2]);
await flush();

k.test('note-in-prompts', 'a message with a note: spam filter, add tags and translation all get its text, the spam filter its date too', () => {
    const p = promptsFor('Subject one');
    assert.deepEqual(Object.keys(p).sort(), ['add_tags', 'spam', 'translation']);
    for (const prompt of Object.values(p)) assert.match(prompt, /Note: \[Call Bob back\]/);
    assert.ok(p.spam.includes('at [' + new Date(TS).toString() + ']'), p.spam);
});

k.test('no-note', 'a message with no note: the placeholders are empty, never the literal token, and the prompt is sent', () => {
    const p = promptsFor('Subject two');
    assert.deepEqual(Object.keys(p).sort(), ['add_tags', 'spam', 'translation']);
    for (const prompt of Object.values(p)) {
        assert.match(prompt, /Note: \[\]/);
        assert.ok(!prompt.includes('{%qnote'), prompt);
    }
});

k.test('only-getnotes', 'the background only reads notes: getNotes by headerMessageId, never getStatus nor requestAccess', () => {
    assert.ok(toQNote.length > 0, 'QNote was asked');
    assert.deepEqual([...new Set(toQNote.map(m => m.command))], ['getNotes']);
    for (const m of toQNote) {
        assert.equal(m.headerMessageIds.length, 1);
        assert.ok(['q1@x', 'q2@x'].includes(m.headerMessageIds[0]), m.headerMessageIds[0]);
    }
});

k.test('qnote-missing', 'QNote missing: the prompts are still sent, with empty placeholders, and nothing but getNotes is tried', async () => {
    qnote = NOT_THERE;
    toQNote.length = 0;
    await receive(ctx, [H.q3]);
    await flush();
    const p = promptsFor('Subject three');
    assert.deepEqual(Object.keys(p).sort(), ['add_tags', 'spam', 'translation']);
    for (const prompt of Object.values(p)) assert.match(prompt, /Note: \[\]/);
    assert.deepEqual([...new Set(toQNote.map(m => m.command))], ['getNotes']);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
