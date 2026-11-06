// claude-spec/10-smartbar.md "Operation registry" (js/mzta-smartbar-registry.js):
//  - three operations in this version, tag / summarize / translate, each a valid entry (id,
//    description, params schema, requirements, multiple false, risk, dependsOn, run);
//  - listAvailable(env): an operation only when its requirements hold (feature on, permission,
//    usable connection); a throwing requirement counts as unavailable;
//  - validateParams(): unknown parameters refused, lossless coercions only, empty = absent, enum;
//  - planOperations(): the user's order kept; unknown / unavailable / duplicate ids dropped and
//    reported; invalid params keep the line in error (errorType params) while the others run;
//    dependsOn only names earlier lines (a static rule, never the model's);
//  - runPlanned(): at most `limit` at once, first come first served; a line waits for its
//    dependencies and is cancelled when one did not end done; a confirm line waits for confirm()
//    without holding a slot; an aborted signal cancels the lines not started; a rejection of
//    start() is an error.

import assert from 'node:assert/strict';
import {
    smartbarContext,
    ALL_AVAILABLE
} from './context.mjs';
import { caseTests } from '../helpers/known-issues/smartbar.mjs';

const { registry: R } = await smartbarContext();
const k = caseTests('01-registry');
const reg = R.createSmartbarRegistry();

/** A test operation: a valid entry with the given overrides. */
const fake = (id, over = {}) => ({
    id, description: 'test ' + id, params: {}, requirements: () => true, multiple: false,
    risk: 'direct', dependsOn: () => [], run: async () => ({ state: 'done' }), ...over,
});
/** A deferred promise. */
function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}
const tick = () => new Promise(r => setImmediate(r));
const plan = (ops, ids, routed = ids.map(id => ({ id }))) => R.planOperations(R.createSmartbarRegistry(ops), ids, routed);

k.test('default-ops', 'the three operations of this version, valid, single-instance', () => {
    assert.deepEqual(reg.all().map(op => op.id), ['tag', 'summarize', 'translate']);
    for (const op of R.DEFAULT_OPERATIONS) {
        assert.deepEqual(R.operationProblems(op), [], op.id);
        assert.equal(op.multiple, false, op.id);
        assert.equal(op.risk, 'direct', op.id);
    }
    assert.deepEqual(Object.keys(reg.get('tag').params), ['tags']);
    assert.equal(reg.get('tag').params.tags.type, 'string[]');
    assert.deepEqual(reg.get('summarize').params, {});
    assert.equal(reg.get('translate').params.language.type, 'string');
    assert.equal(reg.get('nope'), null);
});

k.test('run-executor', 'an operation runs through the executor of its id', async () => {
    const calls = [];
    const executors = Object.fromEntries(['tag', 'summarize', 'translate'].map(id => [id, async ctx => {
        calls.push([id, ctx.params]);
        return { state: 'done' };
    }]));
    for (const op of reg.all()) await op.run({ params: { p: op.id }, executors });
    assert.deepEqual(calls, [['tag', { p: 'tag' }], ['summarize', { p: 'summarize' }], ['translate', { p: 'translate' }]]);
});

k.test('invalid-entry', 'an invalid entry or a duplicated id is refused at creation', () => {
    assert.throws(() => R.createSmartbarRegistry([fake('a'), fake('a')]), /declared twice/);
    assert.throws(() => R.createSmartbarRegistry([fake('a', { risk: 'maybe' })]), /risk/);
    assert.throws(() => R.createSmartbarRegistry([fake('a', { params: { x: { type: 'number' } } })]), /unknown type/);
    assert.throws(() => R.createSmartbarRegistry([fake('A b')]), /lowercase identifier/);
    assert.throws(() => R.createSmartbarRegistry([fake('a', { multiple: 'no' })]), /multiple/);
});

k.test('availability', 'listAvailable() keeps only the operations whose requirements hold', () => {
    assert.deepEqual(reg.listAvailable(ALL_AVAILABLE).map(op => op.id), ['tag', 'summarize', 'translate']);
    assert.deepEqual(reg.listAvailable({}).map(op => op.id), []);
    assert.deepEqual(reg.listAvailable(null).map(op => op.id), []);
    const noTagPermission = { ...ALL_AVAILABLE, permissions: { add_tags: false } };
    assert.deepEqual(reg.listAvailable(noTagPermission).map(op => op.id), ['summarize', 'translate']);
    const translateOff = { ...ALL_AVAILABLE, features: { ...ALL_AVAILABLE.features, translate: false } };
    assert.deepEqual(reg.listAvailable(translateOff).map(op => op.id), ['tag', 'summarize']);
    const summaryUnusable = { ...ALL_AVAILABLE, usable: { ...ALL_AVAILABLE.usable, summarize: false } };
    assert.deepEqual(reg.listAvailable(summaryUnusable).map(op => op.id), ['tag', 'translate']);
    const throwing = R.createSmartbarRegistry([fake('a', { requirements: () => { throw new Error('x'); } }), fake('b')]);
    assert.deepEqual(throwing.listAvailable({}).map(op => op.id), ['b']);
});

k.test('validate-params', 'validateParams(): unknown refused, lossless coercion, empty is absent, enum', () => {
    const tag = reg.get('tag');
    const translate = reg.get('translate');
    assert.deepEqual(R.validateParams(tag, undefined), { ok: true, params: {} });
    assert.deepEqual(R.validateParams(tag, { tags: 'urgent' }), { ok: true, params: { tags: ['urgent'] } });
    assert.deepEqual(R.validateParams(tag, { tags: [' a ', 'a', '', 'b'] }), { ok: true, params: { tags: ['a', 'b'] } });
    assert.deepEqual(R.validateParams(tag, { tags: [] }), { ok: true, params: {} });
    assert.equal(R.validateParams(tag, { tags: [1] }).ok, false);
    assert.match(R.validateParams(tag, { colour: 'red' }).error, /unknown parameter "colour"/);
    assert.equal(R.validateParams(tag, ['x']).ok, false);
    assert.deepEqual(R.validateParams(translate, { language: '  German ' }), { ok: true, params: { language: 'German' } });
    assert.deepEqual(R.validateParams(translate, { language: '' }), { ok: true, params: {} });
    assert.deepEqual(R.validateParams(translate, { language: null }), { ok: true, params: {} });
    assert.equal(R.validateParams(translate, { language: {} }).ok, false);
    const op = fake('x', { params: { on: { type: 'boolean' }, size: { type: 'string', enum: ['s', 'm'] }, n: { type: 'string' } } });
    assert.deepEqual(R.validateParams(op, { on: 'true', size: 'm', n: 3 }), { ok: true, params: { on: true, size: 'm', n: '3' } });
    assert.equal(R.validateParams(op, { on: 'yes' }).ok, false);
    assert.match(R.validateParams(op, { size: 'xl' }).error, /one of s, m/);
});

k.test('describe', 'describeOperations() lists each id, its description and its parameters', () => {
    const text = R.describeOperations(reg.all());
    for (const op of reg.all()) {
        assert.ok(text.includes(`id: "${op.id}"`), op.id);
        assert.ok(text.includes(op.description), op.id);
    }
    assert.ok(text.includes('"tags": list of strings'));
    assert.ok(text.includes('"language": string'));
    assert.ok(text.includes('params: none ({})'));
});

k.test('plan-order-reports', 'planOperations(): user order kept, unknown / unavailable / duplicate reported', () => {
    const { lines, reports } = R.planOperations(reg, ['summarize', 'translate'], [
        { id: 'translate', params: { language: 'French' } },
        { id: 'archive' },
        { id: 'tag', params: {} },
        { id: 'summarize' },
        { id: 'translate' },
        null,
    ]);
    assert.deepEqual(lines.map(l => [l.index, l.id, l.state]), [[0, 'translate', 'queued'], [1, 'summarize', 'queued']]);
    assert.deepEqual(lines[0].params, { language: 'French' });
    assert.deepEqual(reports, [
        { kind: 'unknown', id: 'archive' },
        { kind: 'unavailable', id: 'tag' },
        { kind: 'duplicate', id: 'translate' },
        { kind: 'unknown', id: '' },
    ]);
    assert.deepEqual(R.planOperations(reg, ['tag'], 'not a list'), { lines: [], reports: [] });
});

k.test('plan-invalid-params', 'invalid params keep the line in error, the others still run', () => {
    const { lines, reports } = R.planOperations(reg, ['tag', 'summarize'], [
        { id: 'tag', params: { tags: 'x', colour: 'red' } },
        { id: 'summarize' },
    ]);
    assert.deepEqual(reports, []);
    assert.equal(lines[0].state, 'error');
    assert.equal(lines[0].errorType, 'params');
    assert.match(lines[0].error, /colour/);
    assert.equal(lines[1].state, 'queued');
});

k.test('plan-depends-on', 'dependsOn names only earlier lines, whatever the rule returns', () => {
    const { lines } = plan([
        fake('a'),
        fake('b', { dependsOn: () => [0, 1, 2, -1, 'x', 0] }),
        fake('c', { dependsOn: (ops, i) => ops.filter(o => o.id === 'a').map(o => o.index).concat([i]) }),
    ], ['a', 'b', 'c']);
    assert.deepEqual(lines.map(l => l.dependsOn), [[], [0], [0]]);
});

k.test('run-limit', 'runPlanned(): at most `limit` lines at once, in the user\'s order', async () => {
    const { lines } = plan([fake('a'), fake('b'), fake('c'), fake('d')], ['a', 'b', 'c', 'd']);
    const gates = lines.map(() => deferred());
    const started = [];
    let running = 0;
    let peak = 0;
    const run = R.runPlanned({
        lines, limit: 2,
        start: async (line) => {
            started.push(line.id);
            running++;
            peak = Math.max(peak, running);
            await gates[line.index].promise;
            running--;
            return { state: 'done', result: line.id };
        },
    });
    await tick();
    assert.deepEqual(started, ['a', 'b']);
    gates[1].resolve();
    await tick();
    assert.deepEqual(started, ['a', 'b', 'c']);
    gates[0].resolve();
    gates[2].resolve();
    gates[3].resolve();
    await run;
    assert.equal(peak, 2);
    assert.deepEqual(lines.map(l => [l.state, l.result]), [['done', 'a'], ['done', 'b'], ['done', 'c'], ['done', 'd']]);
});

k.test('run-depends', 'a line waits for its dependencies and is cancelled when one did not end done', async () => {
    const { lines } = plan([
        fake('a'), fake('b', { dependsOn: () => [0] }), fake('c'), fake('d', { dependsOn: () => [2] }),
    ], ['a', 'b', 'c', 'd']);
    const order = [];
    await R.runPlanned({
        lines, limit: 4,
        start: async (line) => {
            order.push(line.id);
            if (line.id === 'c') throw new Error('boom');
            await tick();
            return { state: 'done' };
        },
    });
    assert.deepEqual(lines.map(l => l.state), ['done', 'done', 'error', 'cancelled']);
    assert.ok(order.indexOf('b') > order.indexOf('a'));
    assert.ok(!order.includes('d'));
    assert.equal(lines[2].error, 'boom');
    assert.equal(lines[2].errorType, 'api');
});

k.test('run-confirm', 'a confirm line waits for the answer without holding a slot', async () => {
    const { lines } = plan([fake('risky', { risk: 'confirm' }), fake('safe'), fake('later', { risk: 'confirm' })],
        ['risky', 'safe', 'later']);
    const answers = { risky: deferred(), later: deferred() };
    const seen = [];
    const started = [];
    const run = R.runPlanned({
        lines, limit: 1,
        start: async (line) => { started.push(line.id); return { state: 'done' }; },
        confirm: (line) => answers[line.id].promise,
        onChange: (line) => seen.push(line.id + ':' + line.state),
    });
    await tick();
    // The slot is free while both wait: the direct one ran.
    assert.deepEqual(started, ['safe']);
    assert.equal(lines[0].state, 'pending_confirmation');
    answers.risky.resolve(true);
    answers.later.resolve(false);
    await run;
    assert.deepEqual(started, ['safe', 'risky']);
    assert.deepEqual(lines.map(l => l.state), ['done', 'done', 'cancelled']);
    assert.ok(seen.includes('risky:pending_confirmation'));
});

k.test('run-abort', 'an aborted signal cancels the lines not started yet; error lines stay', async () => {
    const { lines } = plan([fake('a'), fake('b'), fake('c', { params: { x: { type: 'boolean' } } })],
        ['a', 'b', 'c'], [{ id: 'a' }, { id: 'b' }, { id: 'c', params: { x: 'no' } }]);
    const ac = new AbortController();
    const gate = deferred();
    const run = R.runPlanned({
        lines, limit: 1, signal: ac.signal,
        start: async () => { await gate.promise; return { state: 'cancelled' }; },
    });
    await tick();
    ac.abort();
    gate.resolve();
    await run;
    assert.deepEqual(lines.map(l => l.state), ['cancelled', 'cancelled', 'error']);
    assert.equal(lines[2].errorType, 'params');
});

k.test('run-outcome', 'start()\'s outcome is copied on the line (error fields only for an error)', async () => {
    const { lines } = plan([fake('a'), fake('b')], ['a', 'b']);
    await R.runPlanned({
        lines,
        start: async (line) => line.id === 'a'
            ? { state: 'done', result: { n: 1 }, error: 'ignored' }
            : { state: 'error', error: 'rate', errorType: 'rate_limit', retryAt: 123, rawResponse: 'raw' },
    });
    assert.deepEqual([lines[0].state, lines[0].result, lines[0].error], ['done', { n: 1 }, null]);
    assert.deepEqual([lines[1].state, lines[1].errorType, lines[1].retryAt, lines[1].rawResponse], ['error', 'rate_limit', 123, 'raw']);
    assert.equal(typeof lines[1].finishedAt, 'number');
});

k.coverage();
