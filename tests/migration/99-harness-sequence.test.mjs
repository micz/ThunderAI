// The harness itself, not the spec: the statement splitter and the cut of the migration sequence
// (./sequence.mjs), and the fresh-context starts with their injected faults (./context.mjs).
// The sequence files trust both; this pins them down on small cases and on the real background.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    topLevelStatements,
    importedNames,
    identifiers,
    topLevelIdentifiers,
    cutSequence,
    compileSequence
} from './sequence.mjs';
import { startup } from './context.mjs';

const texts = src => topLevelStatements(src).map(s => s.text);

// --- The splitter --------------------------------------------------------------------------------

test('statements end at a top-level semicolon, not at one nested or quoted', () => {
    assert.deepEqual(texts('a(); for (let i = 0; i < 2; i++) b(";"); const s = "x;y"; f({ a: 1; });'),
        ['a();', 'for (let i = 0; i < 2; i++) b(";");', 'const s = "x;y";', 'f({ a: 1; });']);
});

test('a block statement ends at its brace, unless else / catch / finally follows', () => {
    const src = 'if (a) { b(); }\nif (c) { d(); } else { e(); }\ntry { f(); } catch (x) { g(); } finally { h(); }\n'
        + 'async function k() { return 1; }\nl();';
    assert.deepEqual(texts(src), ['if (a) { b(); }', 'if (c) { d(); } else { e(); }',
        'try { f(); } catch (x) { g(); } finally { h(); }', 'async function k() { return 1; }', 'l();']);
});

test('comments, strings and regex literals never count, and a leading comment is not part of a statement', () => {
    const src = '// a; { b\nconst r = /[;{]/g; /* } ; */ const t = `${"}"};`;\nif (x) { y("}"); }';
    assert.deepEqual(texts(src), ['const r = /[;{]/g;', 'const t = `${"}"};`;', 'if (x) { y("}"); }']);
});

test('a source ending inside a statement is an error', () => {
    assert.throws(() => topLevelStatements('a(); b('), /unbalanced|ends inside/);
});

test('identifiers() skips strings and comments', () => {
    assert.deepEqual([...identifiers('if (ok) await run("notMe"); // nor me')].sort(), ['await', 'if', 'ok', 'run']);
});

test('topLevelIdentifiers() leaves out the bodies of the functions a statement only defines', () => {
    const ids = s => [...topLevelIdentifiers(s)].sort();
    assert.deepEqual(ids('browser.runtime.onMessage.addListener((m, s) => { return storage.get(await x()); });'),
        ['addListener', 'browser', 'm', 'onMessage', 'runtime', 's']);
    assert.deepEqual(ids('function f() { await storage.get(); }'), ['f', 'function']);
    assert.deepEqual(ids('async function g(a) { if (a) { await h(); } }'), ['a', 'async', 'function', 'g']);
    // A block that runs at the top level is kept: an if body, an object literal.
    assert.deepEqual(ids('if (ok) { await browser.storage.local.get(); }'),
        ['await', 'browser', 'get', 'if', 'local', 'ok', 'storage']);
    assert.deepEqual(ids('const o = { a: storage, b: () => { hidden(); } };'), ['a', 'b', 'const', 'o', 'storage']);
});

test('importedNames() reads named, aliased and default imports', () => {
    const src = "import { a, b as c } from './js/x.js';\nimport {\n    d\n} from './js/mzta-prefs-migration.js';\nimport e from './js/y.js';";
    assert.deepEqual(importedNames(src), [
        { local: 'a', imported: 'a', module: 'js/x.js' },
        { local: 'c', imported: 'b', module: 'js/x.js' },
        { local: 'd', imported: 'd', module: 'js/mzta-prefs-migration.js' },
        { local: 'e', imported: 'default', module: 'js/y.js' },
    ]);
});

// --- The cut -------------------------------------------------------------------------------------

const SYNTHETIC = `
import { migrateA, isDrained } from './js/mzta-prefs-migration.js';
import { migrateB } from './js/other.js';
import { helper } from './js/helper.js';
import { mztaManaged } from './js/mzta-managed.js';
browser.runtime.onMessage.addListener(() => false);
const ok = await migrateA();
if (!await isDrained()) {
    await helper();
}
const unrelated = 1;
await mztaManaged.loadManaged();
// if (ok) await migrateB();  (a comment is not a statement)
function later() { return unrelated; }
if (ok) await migrateB();
`;

test('cutSequence() picks the migration statements, the guarded ones and the policy load, in file order', () => {
    const seq = cutSequence(SYNTHETIC);
    assert.deepEqual(seq.statements.map(s => s.text), [
        'const ok = await migrateA();',
        'if (!await isDrained()) {\n    await helper();\n}',
        'await mztaManaged.loadManaged();',
        'if (ok) await migrateB();',
    ]);
    assert.deepEqual(seq.declared, ['ok']);
    assert.deepEqual(seq.deps.map(d => d.local).sort(), ['helper', 'isDrained', 'migrateA', 'migrateB', 'mztaManaged']);
    assert.deepEqual(seq.statements.map(s => s.line), [7, 8, 12, 15]);
});

test('compileSequence() runs the statements in order with the injected names', async () => {
    const seq = cutSequence(SYNTHETIC);
    const log = [];
    const out = await compileSequence(seq)({
        migrateA: async () => { log.push('A'); return false; },
        isDrained: async () => { log.push('drained?'); return false; },
        helper: async () => { log.push('helper'); },
        migrateB: async () => { log.push('B'); },
        mztaManaged: { loadManaged: async () => { log.push('policy'); } },
    });
    assert.deepEqual(log, ['A', 'drained?', 'helper', 'policy'], 'migrateB is guarded by ok === false');
    assert.deepEqual(out, { ok: false });
});

test('on mzta-background.js: the cut is the migration block plus the guarded menu order migration', () => {
    const seq = cutSequence();
    const calls = seq.statements.map(s => s.text.match(/\b(migrate\w+|isSyncDrained|loadManaged)\(/g) || []);
    // Every picked statement calls something of the sequence; together they call each migration once.
    calls.forEach((c, i) => assert.ok(c.length > 0, 'statement at line ' + seq.statements[i].line + ' calls nothing'));
    const all = calls.flat().map(c => c.slice(0, -1)).sort();
    assert.deepEqual(all, ['isSyncDrained', 'loadManaged', 'migrateCalendarNoSelection', 'migrateCustomPromptsStorage',
        'migrateDefaultPromptsPropStorage', 'migrateEnabledToShowIn', 'migrateMenuOrderAlphabetic',
        'migrateOllamaThinkLevel', 'migratePrefsToLocal']);
    assert.deepEqual(seq.declared, ['_prefs_migration_ok']);
    for (const st of seq.statements) assert.doesNotThrow(() => compileSequence({ ...seq, statements: [st] }), st.text);
});

// --- The starts ----------------------------------------------------------------------------------

test('a fault rejects the nth matching call with no effect, and only for count calls', async () => {
    const r = await startup({
        run: 'migrateCustomPromptsStorage', sync: { _custom_prompt: [1] }, local: {},
        faults: [{ area: 'local', op: 'set', nth: 1, count: 1 }],
    });
    assert.match(r.error, /injected: storage\.local\.set failed/);
    assert.deepEqual(r.local, {});
    assert.deepEqual(r.sync, { _custom_prompt: [1] }, 'the remove after the failed set never ran');
    assert.equal(r.calls.find(c => c.op === 'set').failed, true);
});

test('a crash stops every write from that point, whatever the area', async () => {
    const r = await startup({ run: 'migrateCustomPromptsStorage', sync: { _custom_prompt: [1] }, local: {}, crashAtWrite: 2 });
    assert.equal(r.crashed, true);
    assert.deepEqual(r.local, { _custom_prompt: [1] }, 'the first write landed');
    assert.deepEqual(r.sync, { _custom_prompt: [1] }, 'the second (the remove) did not');
});

test('the reads after the run are not part of the storage snapshot', async () => {
    const r = await startup({ run: null, local: { connection_type: 'ollama_api' }, read: { prefs: ['connection_type'], specialPrompts: true } });
    assert.deepEqual(r.local, { connection_type: 'ollama_api' });
    assert.equal(r.read.prefs.connection_type, 'ollama_api');
    assert.ok(Array.isArray(r.read.specialPrompts));
});

test('every start is a fresh context: nothing carries over but the storage handed in', async () => {
    const a = await startup({ run: 'sequence', local: {}, sync: {} });
    const b = await startup({ run: 'sequence', local: {}, sync: {} });
    assert.deepEqual(a.calls, b.calls, 'the same storage gives the same calls');
    assert.deepEqual(a.local, b.local);
});
