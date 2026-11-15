// claude-spec/10-smartbar-router-tests.md: the reference instructions of the router stay
// consistent with the operation registry and the placeholder allow list of spec 10 "Router" and
// "Placeholders". For every case of its JSON block:
//  - the case is well formed (instruction, expected with the three fields of the locked format);
//  - every expected operation is known, available in the case, valid for its parameter schema,
//    and a single-instance one appears at most once: planOperations() reports nothing and keeps
//    every line out of error;
//  - every context id is one the router may pick (the allow list), never selected_text (added by
//    the add-on with a selection) nor an excluded id;
//  - the set covers every operation of the registry and both languages it is written in;
//  - compose: every type, a forward naming a recipient (never unrecognized), and in every mixed
//    case the plan runs compose last, whatever the router's order (runLast), but for the lines that
//    wait for it;
//  - the chat (spec 10 "Chat"): a case's source and draft decide what is available (deliver_draft
//    only in the chat with a draft); refinements are compose of the draft's type, approvals
//    deliver_draft, a free question nothing at all; deliver_draft runs after a compose of the same
//    instruction;
//  - the deletions: delete_summary / delete_translation / delete_spam_report run before a
//    summarize / translate / spam_check of the same instruction (their dependsOn), and "cancella la mail" is none of them; calendar_event /
//    task run last (runLast);
//  - the compose window (claude-spec/10-smartbar-compose.md "Router"): a case's context decides the
//    operations offered (plainText takes select away); a combination of changes is one rewrite, at
//    most one change of the body per instruction (exclusive), a change asked with select runs after
//    it, a question is nothing at all, an operation of the message is unrecognized, and the
//    context is always [].
// The model's actual answers are not tested here (no model at level 1): the file is also a manual
// check of a router connection.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    smartbarContext,
    ALL_AVAILABLE
} from './context.mjs';
import { repoPath } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/smartbar.mjs';

const { router: X, registry: R, placeholders: P } = await smartbarContext();
const k = caseTests('04-router-test-set');
const reg = R.createSmartbarRegistry();
const ALL_IDS = reg.all().map(op => op.id);

const doc = readFileSync(repoPath('claude-spec/10-smartbar-router-tests.md'), 'utf8');
const blocks = [...doc.matchAll(/```json\r?\n([\s\S]*?)```/g)].map(m => m[1]);
const builtIn = (await P.getPlaceholders(true)).filter(ph => String(ph.is_default) === '1');
const allowIds = X.routerPlaceholderAllowList(builtIn).map(ph => ph.id);

k.test('one-block', 'the document holds one JSON block, an array of cases', () => {
    assert.equal(blocks.length, 1);
    const cases = JSON.parse(blocks[0]);
    assert.ok(Array.isArray(cases));
    assert.ok(cases.length >= 20, 'about twenty cases');
});

const cases = blocks.length === 1 ? JSON.parse(blocks[0]) : [];

/** The context of a case: 'message' unless it says 'compose'. */
const contextOf = c => c.context ?? 'message';

/** The operations available in a case: its own list, else those of its context, source and draft. */
const availableIn = c => c.available ?? reg.listAvailable(contextOf(c) === 'compose'
    ? { ...ALL_AVAILABLE, context: 'compose', source: 'compose', compose: { isPlainText: c.plainText === true } }
    : { ...ALL_AVAILABLE, source: c.source ?? 'bar', draft: c.draft ? { type: c.draft } : null },
).map(op => op.id);

/** The plan of a case's expected operations, in its context. */
const planOf = c => R.planOperations(reg, availableIn(c), c.expected.operations, { context: contextOf(c) });

k.test('well-formed', 'each case has an instruction and the three fields of the locked format', () => {
    for (const c of cases) {
        assert.equal(typeof c.instruction, 'string', JSON.stringify(c));
        assert.ok(c.instruction.trim() !== '');
        assert.deepEqual(Object.keys(c.expected).sort(), ['context', 'operations', 'unrecognized'], c.instruction);
        assert.ok(Array.isArray(c.expected.operations), c.instruction);
        assert.ok(Array.isArray(c.expected.context), c.instruction);
        assert.equal(typeof c.expected.unrecognized, 'string', c.instruction);
        if ('available' in c) assert.ok(c.available.every(id => ALL_IDS.includes(id)), c.instruction);
        if ('hasSelection' in c) assert.equal(typeof c.hasSelection, 'boolean', c.instruction);
        if ('source' in c) assert.ok(['bar', 'chat'].includes(c.source), c.instruction);
        if ('context' in c) assert.ok(['message', 'compose'].includes(c.context), c.instruction);
        if ('plainText' in c) assert.equal(c.context, 'compose', c.instruction + ': plainText is a compose case\'s');
        if (c.context === 'compose') assert.ok(!('source' in c) && !('draft' in c), c.instruction + ': no source nor draft in a compose case');
        if ('draft' in c) {
            assert.equal(c.source, 'chat', c.instruction + ': a draft exists in the chat only');
            assert.ok(['reply', 'reply_all', 'forward', 'new'].includes(c.draft), c.instruction);
        }
    }
});

k.test('operations-valid', 'every expected operation is known, available, valid and at most once', () => {
    for (const c of cases) {
        const { lines, reports } = planOf(c);
        assert.deepEqual(reports, [], c.instruction);
        assert.deepEqual(lines.filter(l => l.state === 'error').map(l => l.error), [], c.instruction);
        assert.equal(lines.length, c.expected.operations.length, c.instruction);
        // The parameters are already in their normalized form: nothing for validateParams() to change.
        for (const line of lines) {
            const expected = c.expected.operations.find(op => op.id === line.id);
            assert.deepEqual(line.params, expected.params, c.instruction);
        }
    }
});

k.test('context-allowed', 'every context id is one the router may pick, never selected_text', () => {
    for (const c of cases) {
        for (const id of c.expected.context) {
            assert.ok(allowIds.includes(id), c.instruction + ': ' + id);
            assert.notEqual(id, 'selected_text', c.instruction);
            assert.ok(!X.ROUTER_EXCLUDED_PLACEHOLDERS.includes(id), c.instruction + ': ' + id);
        }
        // What the add-on keeps of the router's context is exactly the expected one.
        assert.deepEqual(X.resolveContext(c.expected.context, X.routerPlaceholderAllowList(builtIn)), c.expected.context, c.instruction);
    }
});

k.test('unrecognized-words', 'an unrecognized part is taken word for word from the instruction', () => {
    for (const c of cases) {
        if (c.expected.unrecognized !== '') {
            assert.ok(c.instruction.includes(c.expected.unrecognized), c.instruction);
        }
        // From the bar, nothing recognized is something unrecognized; in the chat a question is
        // neither (the free answer covers it).
        // The chat of a compose window answers a question too.
        if (c.expected.operations.length === 0 && c.source !== 'chat' && contextOf(c) !== 'compose') {
            assert.notEqual(c.expected.unrecognized, '', c.instruction);
        }
    }
});

k.test('coverage', 'the set covers every operation, a selection, an unavailable operation, both languages', () => {
    const used = new Set(cases.flatMap(c => c.expected.operations.map(op => op.id)));
    assert.deepEqual([...used].sort(), [...ALL_IDS].sort());
    assert.ok(cases.some(c => c.hasSelection === true));
    assert.ok(cases.some(c => Array.isArray(c.available)));
    assert.ok(cases.some(c => c.expected.context.length > 0));
    assert.ok(cases.some(c => /\b(riassumi|traduci|tagga)\b/.test(c.instruction)), 'Italian');
    assert.ok(cases.some(c => /\b(summarize|translate|tag)\b/.test(c.instruction)), 'English');
    assert.ok(cases.some(c => c.source === 'chat' && !c.draft), 'the chat without a draft');
    assert.ok(cases.some(c => c.source === 'chat' && c.draft), 'the chat with a draft');
});

k.test('chat-cases', 'the chat: refinements are compose of the draft\'s type, approvals deliver_draft, a question nothing', () => {
    const chat = cases.filter(c => c.source === 'chat');
    for (const c of chat.filter(c => c.draft)) {
        for (const op of c.expected.operations.filter(op => op.id === 'compose')) assert.equal(op.params.type, c.draft, c.instruction);
    }
    const ids = instruction => cases.filter(c => c.instruction === instruction).map(c => c.expected.operations.map(op => op.id));
    assert.deepEqual(ids('più breve'), [['compose']]);
    assert.deepEqual(ids('ok vai'), [['deliver_draft']]);
    // Without a draft the approval is not covered.
    assert.deepEqual(ids('crea l\'email'), [['deliver_draft'], []]);
    assert.deepEqual(ids('ok go'), [[]]);
    for (const q of ['chi è il mittente?', 'what is he asking me?']) {
        const c = cases.find(x => x.instruction === q);
        assert.deepEqual([c.expected.operations, c.expected.unrecognized], [[], ''], q);
    }
    // "Make it shorter and create it", in either order: compose, then deliver_draft waiting for it.
    const both = chat.filter(c => c.expected.operations.length === 2 && c.expected.operations.some(op => op.id === 'deliver_draft'));
    assert.equal(both.length, 2);
    for (const c of both) {
        const { lines } = planOf(c);
        assert.deepEqual(lines.map(l => [l.id, l.dependsOn]), [['compose', []], ['deliver_draft', [0]]], c.instruction);
    }
});

const composeOf = c => c.expected.operations.find(op => op.id === 'compose');

k.test('compose-window', 'the compose window: one change of the body, select first, questions answered, the message\'s operations unrecognized', () => {
    const compose = cases.filter(c => contextOf(c) === 'compose');
    const ids = instruction => compose.find(c => c.instruction === instruction).expected.operations.map(op => op.id);
    assert.ok(compose.length >= 10);
    for (const c of compose) {
        assert.deepEqual(c.expected.context, [], c.instruction + ': no context in a compose window');
        const body = c.expected.operations.filter(op => reg.get(op.id).exclusive === 'body');
        assert.ok(body.length <= 1, c.instruction + ': one change of the body');
    }
    assert.deepEqual(ids('correggila e rendila più formale'), ['rewrite'], 'a combination is one rewrite');
    assert.deepEqual(ids('correggi'), ['proofread']);
    // A change asked with select runs after it, whatever the user's order.
    const withSelect = compose.filter(c => c.expected.operations.length > 1 && c.expected.operations.some(op => op.id === 'select'));
    assert.ok(withSelect.some(c => c.expected.operations[0].id !== 'select'), 'one case where the user asks the change first');
    for (const c of withSelect) {
        const { lines } = planOf(c);
        assert.equal(lines[0].id, 'select', c.instruction);
        assert.ok(lines.slice(1).every(l => l.dependsOn.includes(0)), c.instruction);
    }
    // The scope against the default: the whole email with a selection, the selection named.
    const scopes = compose.flatMap(c => c.expected.operations).map(op => op.params.scope).filter(Boolean);
    assert.deepEqual([...new Set(scopes)].sort(), ['all', 'selection']);
    // A plain text window has no select; a question is nothing; the message's operations are not offered.
    assert.ok(compose.some(c => c.plainText === true && c.expected.unrecognized !== ''));
    const question = compose.find(c => c.instruction === 'cosa mi chiedono nel messaggio citato?');
    assert.deepEqual([question.expected.operations, question.expected.unrecognized], [[], '']);
    const reply = compose.find(c => c.instruction === 'rispondi a tutti');
    assert.deepEqual([reply.expected.operations, reply.expected.unrecognized], [[], 'rispondi a tutti']);
    assert.ok(!availableIn(reply).includes('compose'));
});

k.test('compose-types', 'compose: every type, reply vs reply to all, a forward naming a recipient, a new email', () => {
    const types = new Set(cases.map(composeOf).filter(Boolean).map(op => op.params.type));
    assert.deepEqual([...types].sort(), ['forward', 'new', 'reply', 'reply_all']);
    const typeOf = instruction => composeOf(cases.find(c => c.instruction === instruction))?.params.type;
    assert.equal(typeOf('rispondi'), 'reply');
    assert.equal(typeOf('rispondi a tutti che arrivo alle 10'), 'reply_all');
    assert.equal(typeOf('rispondi ringraziando tutti per il lavoro'), 'reply', '"tutti" alone is not a reply to all');
    // A recipient is never a parameter, and never unrecognized: the compose step reminds it.
    const forwards = cases.filter(c => composeOf(c)?.params.type === 'forward');
    assert.ok(forwards.some(c => /\bMarco\b|@/.test(c.instruction)));
    for (const c of cases.filter(composeOf)) {
        assert.deepEqual(Object.keys(composeOf(c).params), ['type'], c.instruction);
        assert.equal(c.expected.unrecognized, '', c.instruction);
    }
});

k.test('compose-last', 'in every mixed case the plan runs compose last, whatever the router\'s order', () => {
    const mixed = cases.filter(c => composeOf(c) && c.expected.operations.length > 1);
    assert.ok(mixed.length >= 2);
    assert.ok(mixed.some(c => c.expected.operations[0].id === 'compose'), 'one case where the user asks compose first');
    for (const c of mixed) {
        const { lines } = planOf(c);
        // Last, but for the lines that wait for it (deliver_draft).
        const at = lines.findIndex(l => l.id === 'compose');
        assert.ok(lines.slice(at + 1).every(l => l.dependsOn.includes(at)), c.instruction);
        assert.ok(lines.slice(0, at).every(l => !l.runLast), c.instruction);
        assert.deepEqual(lines.map(l => l.index), lines.map((_, i) => i), c.instruction);
    }
});

k.test('delete-first', 'a deletion asked with a new summary, translation or spam check runs first, whatever the router\'s order', () => {
    const pairs = [['delete_summary', 'summarize'], ['delete_translation', 'translate'], ['delete_spam_report', 'spam_check']];
    for (const [del, gen] of pairs) {
        const both = cases.filter(c => [del, gen].every(id => c.expected.operations.some(op => op.id === id)));
        assert.ok(both.length >= 1, del);
        for (const c of both) {
            const { lines } = planOf(c);
            const d = lines.findIndex(l => l.id === del);
            const g = lines.findIndex(l => l.id === gen);
            assert.ok(d < g && lines[g].dependsOn.includes(d), c.instruction);
        }
    }
    assert.ok(cases.some(c => c.expected.operations[0]?.id === 'translate' && c.expected.operations.some(op => op.id === 'delete_translation')),
        'one case where the user asks the new translation first');
    // "Delete the email" is no deletion of a stored result.
    const mail = cases.find(c => c.instruction === 'riassumi e cancella la mail');
    assert.deepEqual(mail.expected.operations.map(op => op.id), ['summarize']);
});

k.test('sparks-last', 'calendar_event / task run after the other lines, whatever the router\'s order', () => {
    const sparks = cases.filter(c => c.expected.operations.length > 1 && c.expected.operations.some(op => ['calendar_event', 'task'].includes(op.id)));
    assert.ok(sparks.some(c => ['calendar_event', 'task'].includes(c.expected.operations[0].id)), 'one case where the user asks it first');
    for (const c of sparks) {
        const { lines } = planOf(c);
        const first = lines.findIndex(l => l.runLast);
        assert.ok(lines.slice(first).every(l => l.runLast), c.instruction);
    }
});

k.coverage();
