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
//    case the plan runs compose last, whatever the router's order (runLast).
// The model's actual answers are not tested here (no model at level 1): the file is also a manual
// check of a router connection.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { smartbarContext } from './context.mjs';
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
    }
});

k.test('operations-valid', 'every expected operation is known, available, valid and at most once', () => {
    for (const c of cases) {
        const available = c.available ?? ALL_IDS;
        const { lines, reports } = R.planOperations(reg, available, c.expected.operations);
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
        if (c.expected.operations.length === 0) assert.notEqual(c.expected.unrecognized, '', c.instruction);
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
});

const composeOf = c => c.expected.operations.find(op => op.id === 'compose');

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
        const { lines } = R.planOperations(reg, c.available ?? ALL_IDS, c.expected.operations);
        assert.equal(lines.at(-1).id, 'compose', c.instruction);
        assert.deepEqual(lines.map(l => l.index), lines.map((_, i) => i), c.instruction);
    }
});

k.coverage();
