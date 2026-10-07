/*
 *  The background's own code, cut out of mzta-background.js and run as one scope.
 *
 *  processEmails(), newEmailListener(), the preference snapshot (prefs_init, reload_pref_init(),
 *  the debounced storage.onChanged handling), _computeActiveSpecialIds() and the generators they
 *  call all live at the TOP LEVEL of the background script, which cannot be imported: its top
 *  level awaits every startup step against the whole Thunderbird API. Rather than keep a copy of
 *  any of it in the tests - which would test the copy - the top level is split into statements
 *  (on the core tokenizer, segments() in ../helpers/core/background-source.mjs, so nothing is
 *  matched inside a comment, a string or a regex), and a scope is assembled from them:
 *
 *   - the ROOTS a test names (function or variable names), and every top-level declaration they
 *     reference, to a fixed point. A function declaration, a `const` / `let` / `var` and an
 *     `export function` are declarations; a reference is an identifier of the code, not a
 *     property name (`browser.menus` does not pull the `menus` constant in);
 *   - the top-level STATEMENTS a test names by a guard (the text the statement starts with), e.g.
 *     the registration of the main runtime.onMessage listener or `await reload_pref_init();`,
 *     and what they reference;
 *   - the names the picked code takes from the background's own imports, imported from the real
 *     modules - unless the test OVERRIDES them (explicit dependency injection).
 *
 *  The picked statements run verbatim, in file order, as the body of one async function; a
 *  top-level `await` in a picked declaration is refused unless its name is overridden. The scope
 *  hands back a few named bindings and `$eval(source)`, a direct eval inside it, to read or set a
 *  module-level `let` (prefs_init, _process_incoming) or to call anything it holds.
 *
 *  Not a test file (no .test.mjs suffix). Imports only the core, never jsdom.
 *
 *  The statement splitter duplicates the idea of tests/migration/sequence.mjs (an area never
 *  imports another area's helpers): this one also knows `export function` and template literal
 *  substitutions, which the migration cut never needed.
 */

import {
    segments,
    stripComments,
    backgroundSource
} from '../helpers/core/background-source.mjs';
import { REPO } from '../helpers/core/load.mjs';

// A statement that starts with one of these ends with its closing brace, not with a semicolon.
const BLOCK_HEAD = /^(?:if|for|while|function|async\s+function|export\s+(?:async\s+)?function|class|try|switch)\b/;
// ...unless the brace is followed by one of these, which continue the same statement.
const CONTINUATION = /^\s*(?:else|catch|finally)\b/;
const IDENT = /[A-Za-z_$][\w$]*/g;

/**
 * Split the top level of `src` into statements {start, end, text, line}. A statement ends at a
 * top-level ";" or, for a block statement, at the "}" that closes it when no else / catch /
 * finally follows. Comments, strings and regex literals never count.
 */
export function topLevelStatements(src) {
    const code = stripComments(src);
    const out = [];
    let depth = 0;
    let start = -1;
    const close = end => {
        out.push({ start, end, text: src.slice(start, end).trim(), line: src.slice(0, start).split('\n').length });
        start = -1;
    };
    for (const s of segments(code)) {
        if (s.type !== 'code') {
            if (start < 0) start = s.start;
            continue;
        }
        for (let i = s.start; i < s.end; i++) {
            const c = code[i];
            if (/\s/.test(c)) continue;
            if (start < 0) start = i;
            if (c === '(' || c === '[' || c === '{') {
                depth++;
            } else if (c === ')' || c === ']' || c === '}') {
                depth--;
                if (depth < 0) throw new Error('scope: unbalanced source at offset ' + i);
                if (depth === 0 && c === '}' && !CONTINUATION.test(code.slice(i + 1, i + 40))
                    && (BLOCK_HEAD.test(code.slice(start, start + 30)) || asiAfter(code, i + 1))) {
                    close(i + 1);
                }
            } else if (c === ';' && depth === 0) {
                close(i + 1);
            }
        }
    }
    if (start >= 0 && code.slice(start).trim() !== '') {
        throw new Error('scope: the source ends inside a statement (line ' + src.slice(0, start).split('\n').length + ')');
    }
    return out;
}

/**
 * True when a statement closed by a "}" at `at` (an arrow function assigned to a const, with no
 * semicolon after its body) ends there by automatic semicolon insertion: the next token is on a
 * later line and starts a new statement (a word), rather than continuing this one (".", "(", an
 * operator...). `code` has its comments blanked.
 */
function asiAfter(code, at) {
    const rest = code.slice(at);
    const m = /^(\s*)(\S)/.exec(rest);
    if (!m) return true;
    return m[1].includes('\n') && /[A-Za-z_$]/.test(m[2]);
}

/**
 * The identifiers a piece of code references: those of its code segments that are not a property
 * name (after "." or "?."), plus those of its template literal substitutions.
 */
export function references(text) {
    const code = stripComments(text);
    const names = new Set();
    const scan = (chunk) => {
        for (const m of chunk.matchAll(IDENT)) {
            const before = chunk.slice(0, m.index).trimEnd();
            if (before.endsWith('.') && !before.endsWith('..')) continue;
            names.add(m[0]);
        }
    };
    for (const s of segments(code)) {
        const chunk = code.slice(s.start, s.end);
        if (s.type === 'code') scan(chunk);
        else if (s.type === 'string' && chunk.startsWith('`')) {
            for (const m of chunk.matchAll(/\$\{([^}]*)\}/g)) scan(m[1]);
        }
    }
    return names;
}

/** What a top-level statement is: {kind: 'import' | 'function' | 'var' | 'expr', names, async}. */
export function classify(text) {
    const code = stripComments(text).trim();
    if (/^import\b/.test(code)) return { kind: 'import', names: [] };
    let m = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(code);
    if (m) return { kind: 'function', names: [m[1]] };
    m = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(=|;)/.exec(code);
    if (m) {
        // A top-level await in the initializer (not inside a function it defines): the value
        // only exists after a startup step, so the test must inject it.
        return { kind: 'var', names: [m[1]], awaits: topLevelAwait(code) };
    }
    if (/^(?:export\s+)?(?:const|let|var)\s*[[{]/.test(code)) {
        throw new Error('scope: destructuring at the top level is not supported: ' + code.slice(0, 60));
    }
    return { kind: 'expr', names: [] };
}

/**
 * True when `code` awaits outside every brace: `const x = await f();` does, a function or an
 * object literal holding an await does not (its body runs later, if at all). Good enough for a
 * declaration: the background has no top-level `await` inside a bare expression body.
 */
function topLevelAwait(code) {
    let depth = 0;
    for (const s of segments(code)) {
        if (s.type !== 'code') continue;
        for (let i = s.start; i < s.end; i++) {
            const c = code[i];
            if (c === '{') depth++;
            else if (c === '}') depth--;
            else if (depth === 0 && code.startsWith('await', i)
                && !/[\w$]/.test(code[i - 1] || '') && !/[\w$]/.test(code[i + 5] || '')) {
                return true;
            }
        }
    }
    return false;
}

/** The import declarations of `src`: [{local, imported, module}], module relative to the repo. */
export function importedNames(src) {
    const out = [];
    for (const st of topLevelStatements(src)) {
        const code = stripComments(st.text);
        if (!/^import\b/.test(code)) continue;
        const m = /^import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/.exec(code);
        if (!m) throw new Error('scope: an import form the cut does not know: ' + code.slice(0, 80));
        for (const part of m[1].split(',').map(p => p.trim()).filter(Boolean)) {
            const [imported, local = imported] = part.split(/\s+as\s+/).map(p => p.trim());
            out.push({ local, imported, module: m[3].replace(/^\.\//, '') });
        }
    }
    return out;
}

/**
 * Cut a scope out of `src` (default: mzta-background.js).
 *
 * @param {object} o
 *   roots       names of top-level declarations to include (each must exist)
 *   statements  guards: each picks the ONE top-level statement (not a declaration) that starts
 *               with it, e.g. 'await reload_pref_init();' (must be unique)
 *   overrides   names supplied by the test: an import or a top-level declaration of that name is
 *               not taken from the background, the value is injected instead
 * @returns {{statements, deps, injected, declared}}
 *   statements  the picked statements, in file order ({text, line, kind, names})
 *   deps        the imported names the picked code uses and the test does not override
 *   injected    the overridden names the picked code uses
 *   declared    every name the picked declarations define
 */
export function cutScope({ roots = [], statements = [], overrides = [] } = {}, src = backgroundSource()) {
    const imports = importedNames(src);
    const importByLocal = new Map(imports.map(i => [i.local, i]));
    const overridden = new Set(overrides);
    const all = topLevelStatements(src).map(st => ({ ...st, ...classify(st.text) }));
    const declByName = new Map();
    for (const st of all) for (const n of st.names) {
        if (declByName.has(n)) throw new Error('scope: ' + n + ' is declared twice at the top level');
        declByName.set(n, st);
    }
    const picked = new Set();
    const queue = [];
    const pick = st => { if (!picked.has(st)) { picked.add(st); queue.push(st); } };
    for (const r of roots) {
        if (overridden.has(r)) throw new Error('scope: root ' + r + ' is also overridden');
        const st = declByName.get(r);
        if (!st) throw new Error('scope: no top-level declaration named ' + r + ' in mzta-background.js');
        pick(st);
    }
    for (const guard of statements) {
        const found = all.filter(st => st.kind === 'expr' && stripComments(st.text).trim().startsWith(guard));
        if (found.length !== 1) {
            throw new Error('scope: the guard ' + JSON.stringify(guard) + ' matches ' + found.length + ' top-level statements, not one');
        }
        pick(found[0]);
    }
    const used = new Set();
    while (queue.length) {
        const st = queue.shift();
        for (const n of references(st.text)) {
            used.add(n);
            if (overridden.has(n)) continue;
            const decl = declByName.get(n);
            if (decl) pick(decl);
        }
    }
    const kept = all.filter(st => picked.has(st) && !(st.names.length && st.names.every(n => overridden.has(n))));
    for (const st of kept) {
        if (st.kind === 'import') throw new Error('scope: an import statement cannot be picked');
        if (st.awaits) {
            throw new Error('scope: ' + st.names[0] + ' (line ' + st.line + ') awaits a startup step at the top level: override it');
        }
    }
    const deps = imports.filter(i => used.has(i.local) && !overridden.has(i.local));
    const injected = [...overridden].filter(n => used.has(n));
    const declared = kept.flatMap(st => st.names);
    return { statements: kept, deps, injected, declared };
}

/**
 * Run a cut scope.
 *
 * @param cut         what cutScope() returned
 * @param overrides   {name: value} for every name in cut.injected (extra names are an error)
 * @param expose      the declared names to hand back (also readable later through $eval)
 * @returns Promise<{ [name]: value, $eval(source) }>: resolves once every picked statement ran
 */
export async function runScope(cut, overrides = {}, expose = []) {
    const imp = rel => import(new URL(rel, REPO).href);
    for (const n of Object.keys(overrides)) {
        if (!cut.injected.includes(n) && !cut.deps.some(d => d.local === n)) {
            throw new Error('scope: override ' + n + ' is not used by the picked code');
        }
    }
    for (const n of expose) {
        if (!cut.declared.includes(n)) throw new Error('scope: cannot expose ' + n + ': not declared by the picked code');
    }
    const params = [];
    const values = [];
    for (const d of cut.deps) {
        const mod = await imp(d.module);
        if (!(d.imported in mod)) throw new Error('scope: ' + d.module + ' exports no ' + d.imported);
        params.push(d.local);
        values.push(mod[d.imported]);
    }
    for (const n of cut.injected) {
        if (!(n in overrides)) throw new Error('scope: no value injected for ' + n);
        params.push(n);
        values.push(overrides[n]);
    }
    const body = cut.statements.map(st => st.text.replace(/^export\s+/, '')).join('\n');
    // eslint-disable-next-line no-new-func
    const factory = new Function(...params,
        '"use strict";\nreturn (async () => {\n' + body +
        '\nreturn { $eval: (__src) => eval(__src)' + expose.map(n => ', ' + n).join('') + ' };\n})();');
    return factory(...values);
}
