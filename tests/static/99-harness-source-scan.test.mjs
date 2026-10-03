// The harness itself, not the spec: the source scan of the static area (./source-scan.mjs). Pins
// down, on small cases, what it resolves and what it reports as dynamic, and on the real files
// that the tokens stay in step with the source (a regex or a quote read wrongly would shift every
// string after it, and the checks would then pass on noise).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    lex,
    calls,
    argumentKeys,
    cutLiteral,
    literalEntries,
    sourceFiles,
    tokensOf,
    VENDORED
} from './source-scan.mjs';

const keysOf = (src, path, opts) => {
    const tokens = lex(src);
    return [...calls(tokens, path, opts)].map(i => argumentKeys(tokens, i));
};

test('comments, strings and regex literals are not code', () => {
    const src = [
        "// browser.i18n.getMessage('in_a_comment')",
        "/* mztaPrefs.getPref('in_a_block_comment') */",
        "const s = \"mztaPrefs.getPref('in_a_string')\";",
        "const re = /['\"`]/g; mztaPrefs.getPref('after_a_regex');",
    ].join('\n');
    const found = keysOf(src, ['mztaPrefs', 'getPref']);
    assert.deepEqual(found.map(f => f.keys.map(k => k.v)), [['after_a_regex']]);
    assert.equal(found[0].keys[0].line, 4);
});

test('argumentKeys(): static strings resolve, everything else is dynamic', () => {
    const [str, arr, obj, tpl, sub, variable] = keysOf([
        "mztaPrefs.getPrefs('a');",
        "mztaPrefs.getPrefs(['b', `c`, x, 'd' + y, 'e']);",
        "mztaPrefs.getPrefs({f: 1, 'g': 2, h, [k]: 3, ...rest, m() {}});",
        "mztaPrefs.getPrefs(`n`);",
        "mztaPrefs.getPrefs(`o_${p}`);",
        "mztaPrefs.getPrefs(list);",
    ].join('\n'), ['mztaPrefs', 'getPrefs']);
    assert.deepEqual(str.keys.map(k => k.v), ['a']);
    assert.deepEqual(arr.keys.map(k => k.v), ['b', 'c', 'e']);
    assert.equal(arr.dynamic.length, 2, 'x and the concatenation');
    assert.deepEqual(obj.keys.map(k => k.v), ['f', 'g', 'h']);
    assert.equal(obj.dynamic.length, 3, 'computed, spread, method');
    assert.deepEqual(tpl.keys.map(k => k.v), ['n']);
    assert.deepEqual([sub.keys, sub.dynamic.length], [[], 1]);
    assert.deepEqual([variable.keys, variable.dynamic.length], [[], 1]);
});

test('calls(): a dotted receiver only with anyReceiver', () => {
    const src = "browser.i18n.getMessage('a'); i18n.getMessage('b'); other.mztaPrefs.getPref('c');";
    assert.equal(keysOf(src, ['i18n', 'getMessage']).length, 1);
    assert.equal(keysOf(src, ['i18n', 'getMessage'], { anyReceiver: true }).length, 2);
    assert.equal(keysOf(src, ['mztaPrefs', 'getPref']).length, 0);
});

test('a template literal holding injected code is scanned as code', () => {
    const src = 'export const s = `\nlet a = 1;\nx.textContent = browser.i18n.getMessage("injected_key");\n`;';
    const found = keysOf(src, ['i18n', 'getMessage'], { anyReceiver: true });
    assert.deepEqual(found.map(f => f.keys.map(k => [k.v, k.line])), [[['injected_key', 3]]]);
    const withSubst = 'const s = `browser.i18n.getMessage("k") ${x}`;';
    assert.equal(keysOf(withSubst, ['i18n', 'getMessage'], { anyReceiver: true }).length, 0,
        'a template with ${...} is a string, not code');
});

test('cutLiteral() and literalEntries() see every top-level entry, duplicates included', () => {
    const src = "const before = 1;\nexport const t = {\n  ...gen,\n  a: '}', // }\n  b: { c: 1 },\n  a: 2,\n  [k]: 3,\n};\n";
    const text = cutLiteral(src, 'export const t');
    assert.ok(text.startsWith('{') && text.endsWith('}'));
    const entries = literalEntries(text);
    assert.deepEqual(entries.map(e => e.name ?? (e.spread ? '...' + e.spread : '[]')), ['...gen', 'a', 'b', 'a', '[]']);
    assert.throws(() => cutLiteral(src, 'const missing'), /not found/);
});

test('the real files: brackets balance in the token stream of every scanned file', () => {
    const files = sourceFiles().filter(f => f.kind === 'js');
    assert.ok(files.length > 50, 'scanned files: ' + files.length);
    assert.ok(!files.some(f => VENDORED.has(f.path)), 'no vendored file');
    for (const file of files) {
        const depth = { '(': 0, '[': 0, '{': 0 };
        const close = { ')': '(', ']': '[', '}': '{' };
        for (const tok of tokensOf(file)) {
            if (tok.injected || tok.t !== 'p') continue;
            if (tok.v in depth) depth[tok.v]++;
            else if (tok.v in close) depth[close[tok.v]]--;
        }
        assert.deepEqual(depth, { '(': 0, '[': 0, '{': 0 }, file.path);
    }
});
