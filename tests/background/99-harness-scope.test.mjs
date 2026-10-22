// The harness itself, not the spec: the cut of mzta-background.js (./scope.mjs), the fake Worker
// (./fake-worker.mjs) and the strictness of the API models (./apis.mjs). Small synthetic cases
// first, then the real file: every root and every startup statement the area relies on exists, so
// a function moved or renamed in the background fails here, by name, before any flow test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    topLevelStatements,
    classify,
    references,
    cutScope,
    runScope,
    importedNames
} from './scope.mjs';
import {
    ROOTS,
    STARTUP
} from './context.mjs';
import { installFakeWorker, MODEL_WORKERS } from './fake-worker.mjs';
import { mailModel, installApis } from './apis.mjs';
import {
    backgroundSource,
    stripComments
} from '../helpers/core/background-source.mjs';

const SRC = `import { a, b as bee } from './js/x.js';
// a comment with function fake() {}
const K = { x: 1 };
let state = 0;
function one() { return K.x + two(); }
export function two() { return 2; }
const arrow = () => {
    state++;
}
browser.thing.addListener(arrow, true);
if (state) { one(); } else { two(); }
const later = await start();
const str = "function three() {}";
async function usesProp() { return browser.K.y + \`\${one()}\`; }
`;

test('statements: declarations, ASI after an arrow body, if/else, comments and strings', () => {
    const st = topLevelStatements(SRC);
    const starts = ['import { a, b as bee }', 'const K = { x: 1 };', 'let state = 0;', 'function one()',
        'export function two()', 'const arrow = () => {', 'browser.thing.addListener(arrow, true);',
        'if (state) { one(); } else { two(); }', 'const later = await start();', 'const str = "function three() {}";',
        'async function usesProp()'];
    assert.equal(st.length, starts.length, st.map(x => x.text.slice(0, 30)).join(' | '));
    st.forEach((x, i) => {
        const code = x.text.split(/\n/).filter(l => !l.startsWith('//')).join(' ');
        assert.ok(code.startsWith(starts[i]), i + ': ' + code.slice(0, 40));
    });
});

test('classify: kind, names, top-level await', () => {
    const st = topLevelStatements(SRC).map(s => classify(s.text));
    assert.deepEqual(st.map(s => s.kind), ['import', 'var', 'var', 'function', 'function', 'var', 'expr', 'expr', 'var', 'var', 'function']);
    assert.deepEqual(st[4].names, ['two']);
    assert.equal(st[8].awaits, true);
    assert.equal(st[5].awaits, false, 'an arrow body is not the top level');
});

test('references: property names, strings and comments excluded; template substitutions included', () => {
    const refs = references('async function usesProp() { return browser.K.y + `${one()}` + "two()"; } // three()');
    assert.ok(refs.has('browser') && refs.has('one'));
    assert.equal(refs.has('K'), false);
    assert.equal(refs.has('two'), false);
    assert.equal(refs.has('three'), false);
});

test('imports: named, aliased, multi-line', () => {
    assert.deepEqual(importedNames(SRC), [
        { local: 'a', imported: 'a', module: 'js/x.js' },
        { local: 'bee', imported: 'b', module: 'js/x.js' },
    ]);
});

test('cutScope: the roots pull what they reference, to a fixed point, and nothing else', () => {
    const cut = cutScope({ roots: ['one'] }, SRC);
    assert.deepEqual(cut.declared.sort(), ['K', 'one', 'two']);
    assert.deepEqual(cut.deps, []);
});

test('cutScope: a guard picks one statement (not a declaration), and what it references', () => {
    const cut = cutScope({ statements: ['browser.thing.addListener('] }, SRC);
    assert.deepEqual(cut.declared.sort(), ['arrow', 'state']);
    assert.throws(() => cutScope({ statements: ['const K'] }, SRC), /matches 0/);
    assert.throws(() => cutScope({ statements: ['nothing like this'] }, SRC), /matches 0/);
});

test('cutScope: a top-level await is refused unless the name is injected', () => {
    assert.throws(() => cutScope({ roots: ['later'] }, SRC), /awaits a startup step/);
    const cut = cutScope({ roots: ['one'], statements: ['if (state)'], overrides: ['state'] }, SRC);
    assert.deepEqual(cut.injected, ['state']);
    assert.equal(cut.declared.includes('state'), false);
});

test('cutScope: an unknown root fails by name', () => {
    assert.throws(() => cutScope({ roots: ['nope'] }, SRC), /no top-level declaration named nope/);
});

test('runScope: statements run in file order; $eval reads and sets the scope\'s own bindings', async () => {
    const src = 'let n = 1;\nfunction inc() { n++; return n; }\nconst seen = [];\nseen.push(n);\n';
    const cut = cutScope({ roots: ['inc', 'seen'], statements: ['seen.push(n);'] }, src);
    const s = await runScope(cut, {}, ['inc', 'seen']);
    assert.deepEqual(s.seen, [1]);
    assert.equal(s.inc(), 2);
    s.$eval('n = 10');
    assert.equal(s.inc(), 11);
});

test('runScope: an injected value replaces the name; an injection the code does not use is an error', async () => {
    const src = 'function f() { return dep() + 1; }\n';
    const cut = cutScope({ roots: ['f'], overrides: ['dep'] }, src);
    const s = await runScope(cut, { dep: () => 41 }, ['f']);
    assert.equal(s.f(), 42);
    await assert.rejects(runScope(cut, { dep: () => 1, other: 1 }, ['f']), /not used/);
});

test('the real file: every root and every startup statement the area relies on is there, once', () => {
    const cut = cutScope({ roots: ROOTS, statements: STARTUP, overrides: ['window', 'sanitizeBlockHtml', 'htmlBodyToPlainText', 'taPromptUtils'] });
    for (const r of ROOTS) assert.ok(cut.declared.includes(r), r);
    assert.equal(cut.statements.filter(s => s.kind === 'expr').length, STARTUP.length);
    assert.deepEqual(cut.injected.sort(), ['htmlBodyToPlainText', 'sanitizeBlockHtml', 'taPromptUtils', 'window']);
});

test('the real file: no migration and no policy warning is cut', () => {
    const cut = cutScope({ roots: ROOTS, statements: STARTUP, overrides: ['window', 'sanitizeBlockHtml', 'htmlBodyToPlainText', 'taPromptUtils'] });
    assert.equal(cut.declared.includes('_prefs_migration_ok'), false);
    assert.equal(cut.deps.some(d => /^migrate|isSyncDrained/.test(d.local)), false, cut.deps.map(d => d.local).join(' '));
    assert.equal(cut.statements.some(s => /getIgnoredProviderOverrides|getEnforcedTextPlaceholderProblems/.test(s.text)), false);
});

test('the real file splits into statements that cover all its code, in order (only comments between them)', () => {
    const src = stripComments(backgroundSource());
    const st = topLevelStatements(src);
    assert.ok(st.length > 80);
    let at = 0;
    for (const x of st) {
        assert.equal(src.slice(at, x.start).trim(), '', 'nothing but whitespace between statements (line ' + x.line + ')');
        at = x.end;
    }
    assert.equal(src.slice(at).trim(), '');
});

test('fake Worker: the five model workers only, as modules; anything else throws and is recorded', () => {
    const ctl = installFakeWorker();
    for (const f of MODEL_WORKERS) new Worker(new URL('../../js/workers/' + f, import.meta.url), { type: 'module' });
    assert.equal(ctl.created.length, 5);
    assert.throws(() => new Worker(new URL('../../js/workers/other.js', import.meta.url), { type: 'module' }), /unexpected worker/);
    assert.throws(() => new Worker(new URL('../../js/workers/' + MODEL_WORKERS[0], import.meta.url)), /unexpected worker/);
    assert.equal(ctl.unexpected.length, 2);
});

test('fake Worker: posts recorded and cloned; delivered in order; nothing after terminate()', () => {
    const ctl = installFakeWorker();
    const w = new Worker(new URL('../../js/workers/' + MODEL_WORKERS[2], import.meta.url), { type: 'module' });
    const msg = { type: 'chatMessage', message: 'hi' };
    w.postMessage(msg);
    msg.message = 'changed';
    assert.equal(w.prompt, 'hi');
    const got = [];
    w.onmessage = e => got.push(e.data.type);
    w.deliver({ type: 'a' }, { type: 'b' });
    assert.deepEqual(got, ['a', 'b']);
    w.terminate();
    assert.throws(() => w.postMessage({ type: 'x' }), /after terminate/);
    assert.throws(() => w.deliver({ type: 'c' }), /after terminate/);
    assert.deepEqual(ctl.live(), []);
});

test('API models: an unmodelled API throws and is recorded', () => {
    const m = mailModel();
    const browser = {};
    installApis(browser, m);
    assert.throws(() => browser.tabs.executeScript, /unmodelled API browser\.tabs\.executeScript/);
    assert.throws(() => browser.messages.archive, /unmodelled/);
    assert.deepEqual(m.unmodelled, ['browser.tabs.executeScript', 'browser.messages.archive']);
    assert.equal(browser.tabs.then, undefined, 'awaiting a namespace does not throw');
});

test('API models: a moved message gets a new id; a send to an unreachable pane rejects like #901', async () => {
    const m = mailModel();
    const browser = {};
    installApis(browser, m);
    const h = m.addMessage({ headerMessageId: 'h@x' });
    await browser.messages.move([h.id], 'f-junk');
    await assert.rejects(browser.messages.get(h.id));
    assert.equal(m.byHeaderId('h@x').folder.id, 'f-junk');
    m.addTab({ id: 5, reachable: false });
    await assert.rejects(browser.tabs.sendMessage(5, { command: 'x' }), /getAttribute is not a function/);
    await assert.rejects(browser.tabs.sendMessage(6, { command: 'x' }), /Invalid tab ID/);
});
