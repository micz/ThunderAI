/*
 *  The startup migration sequence, cut out of mzta-background.js.
 *
 *  The order of the migrations and the guards between them (_prefs_migration_ok,
 *  isSyncDrained()) live at the TOP LEVEL of the background script, which cannot be imported.
 *  Rather than keep a copy of that order in the tests - which would test the copy - the top level
 *  is split into statements (on the core tokenizer, segments() in
 *  ../helpers/core/background-source.mjs, so nothing is matched inside a comment, a string or a
 *  regex), and the statements of the sequence are picked by what they reference:
 *
 *   - every name the background imports from a migration module (a path containing
 *     "migration") or whose name is migrate<Something>;
 *   - every name a picked statement declares (`const _prefs_migration_ok = ...`), so a later
 *     statement guarded by it is picked too, to a fixed point;
 *   - the policy load, `mztaManaged.loadManaged()`: spec 08 places it after the migration block
 *     and before migrateMenuOrderAlphabetic(), and the code that runs after it (the prompt views
 *     the menu order migration reads) awaits it. With no policy installed it changes nothing.
 *
 *  The picked statements run verbatim, in file order, in one async function whose free names are
 *  resolved from the background's own import statements. Nothing here names a migration or its
 *  place in the order: a migration added, moved or re-guarded in mzta-background.js is run as it
 *  now stands.
 *
 *  What runs between the picked statements in the real file is skipped (the listeners, the
 *  preference snapshot, _reconcileFeatureFlags(), the menus): see README "What is not covered".
 *
 *  Not a test file (no .test.mjs suffix). Imports only the core, never jsdom.
 */

import {
    segments,
    stripComments,
    backgroundSource
} from '../helpers/core/background-source.mjs';

// A statement that starts with one of these ends with its closing brace, not with a semicolon.
const BLOCK_HEAD = /^(?:if|for|while|function|async\s+function|class|try|switch)\b/;
// ...unless the brace is followed by one of these, which continue the same statement.
const CONTINUATION = /^\s*(?:else|catch|finally)\b/;
// The names that make a top-level statement part of the sequence, besides the imported ones.
const POLICY_LOAD = 'loadManaged';

/**
 * Split the top level of `src` into statements {start, end, text}. Enough for a script written
 * with semicolons: a statement ends at a top-level ";" or, for a block statement (if, function,
 * try...), at the "}" that closes it when no else / catch / finally follows. Comments, strings and
 * regex literals never count (the core tokenizer).
 */
export function topLevelStatements(src) {
    const code = stripComments(src);
    const out = [];
    let depth = 0;
    let start = -1;
    const close = end => { out.push({ start, end, text: src.slice(start, end).trim() }); start = -1; };
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
                if (depth < 0) throw new Error('sequence: unbalanced source at offset ' + i);
                if (depth === 0 && c === '}' && BLOCK_HEAD.test(code.slice(start, start + 20))
                    && !CONTINUATION.test(code.slice(i + 1, i + 40))) {
                    close(i + 1);
                }
            } else if (c === ';' && depth === 0) {
                close(i + 1);
            }
        }
    }
    if (start >= 0 && code.slice(start).trim() !== '') {
        throw new Error('sequence: the source ends inside a statement (offset ' + start + ')');
    }
    return out;
}

/** The identifiers of a statement's code (strings, regexes, comments excluded). */
export function identifiers(text) {
    const code = stripComments(text);
    const names = new Set();
    for (const s of segments(code)) {
        if (s.type !== 'code') continue;
        for (const m of code.slice(s.start, s.end).matchAll(/[A-Za-z_$][\w$]*/g)) names.add(m[0]);
    }
    return names;
}

/** The import declarations of `src`: [{local, imported, module}], module relative to the repo. */
export function importedNames(src) {
    const out = [];
    for (const st of topLevelStatements(src)) {
        const code = stripComments(st.text);
        if (!/^import\b/.test(code)) continue;
        const m = /^import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/.exec(code);
        if (!m) {
            const d = /^import\s+([A-Za-z_$][\w$]*)\s+from\s*(['"])([^'"]+)\2/.exec(code);
            if (d) out.push({ local: d[1], imported: 'default', module: d[3].replace(/^\.\//, '') });
            continue;
        }
        for (const part of m[1].split(',').map(p => p.trim()).filter(Boolean)) {
            const [imported, local = imported] = part.split(/\s+as\s+/).map(p => p.trim());
            out.push({ local, imported, module: m[3].replace(/^\.\//, '') });
        }
    }
    return out;
}

/** The names a statement declares at its head (const / let / var, simple or destructured). */
function declaredNames(text) {
    const m = /^(?:const|let|var)\s+([\s\S]*?)=/.exec(stripComments(text));
    if (!m) return [];
    return [...m[1].matchAll(/[A-Za-z_$][\w$]*/g)].map(x => x[0]);
}

/**
 * The migration sequence of `src` (default: mzta-background.js).
 *
 * @returns {{statements: {start, end, line, text}[], deps: {local, imported, module}[], declared: string[]}}
 *   statements  the picked top-level statements, in file order, with their 1-based line
 *   deps        the imported names they use, with the module each comes from
 *   declared    the names they declare (returned by runSequence())
 */
export function cutSequence(src = backgroundSource()) {
    const imports = importedNames(src);
    const seeds = new Set(imports
        .filter(i => /migration/.test(i.module) || /^migrate[A-Z]/.test(i.local))
        .map(i => i.local));
    seeds.add(POLICY_LOAD);
    const all = topLevelStatements(src).filter(st => !/^import\b/.test(st.text));
    const ids = new Map(all.map(st => [st, identifiers(st.text)]));
    const picked = new Set();
    let grew = true;
    while (grew) {
        grew = false;
        for (const st of all) {
            if (picked.has(st)) continue;
            if (![...ids.get(st)].some(n => seeds.has(n))) continue;
            picked.add(st);
            for (const n of declaredNames(st.text)) seeds.add(n);
            grew = true;
        }
    }
    const kept = all.filter(st => picked.has(st));
    const statements = kept.map(st => ({ ...st, line: src.slice(0, st.start).split('\n').length }));
    const used = new Set(kept.flatMap(st => [...ids.get(st)]));
    const deps = imports.filter(i => used.has(i.local));
    const declared = [...new Set(statements.flatMap(st => declaredNames(st.text)))];
    return { statements, deps, declared };
}

/**
 * Build the sequence as a function: (deps {local: value}) => Promise<{declared name: value}>.
 * The statements run verbatim, in file order, as the body of one async function.
 */
export function compileSequence(seq) {
    const names = seq.deps.map(d => d.local);
    const body = seq.statements.map(st => st.text).join('\n');
    // eslint-disable-next-line no-new-func
    const factory = new Function(...names,
        '"use strict";\nreturn (async () => {\n' + body + '\nreturn { ' + seq.declared.join(', ') + ' };\n})();');
    return deps => factory(...names.map(n => {
        if (!(n in deps)) throw new Error('sequence: no value for the dependency ' + n);
        return deps[n];
    }));
}
