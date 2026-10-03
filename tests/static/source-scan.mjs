/*
 *  The source scan of the static area: which files are scanned, read once per process, and a
 *  token stream over each JavaScript file built on the core tokenizer (segments() in
 *  ../helpers/core/background-source.mjs), so a check never matches inside a comment, and tells
 *  a string from a regex literal.
 *
 *  What the scan sees, and what it does not (tests/static/README.md, "What the scan can see"):
 *   - a key is resolved only when it is a static string: a quoted string, or a template literal
 *     without ${...}. A variable, a concatenation or a template with substitutions is reported
 *     as unresolvable, never guessed;
 *   - a template literal without substitutions that contains `i18n.getMessage(` is source code
 *     injected into another page (js/mzta-chatgpt.js exports the ChatGPT Web content script as
 *     one): its body is unescaped and scanned as JavaScript too;
 *   - a template literal nested inside another one's ${...} is beyond the core tokenizer;
 *   - the HTML files are scanned as text, with their <!-- comments --> blanked out.
 *
 *  Not a test file (no .test.mjs suffix): the level-1 glob never runs it. Imports only the core,
 *  never jsdom.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { segments } from '../helpers/core/background-source.mjs';
import { repoPath } from '../helpers/core/load.mjs';

/** The directories scanned recursively, and the single files at the root. */
export const SCAN_DIRS = ['js', 'options', 'pages', 'popup', 'api_webchat'];
export const SCAN_ROOT_FILES = ['mzta-background.js', 'mzta-background.html', 'manifest.json'];

/** Vendored third-party code: not ours, and minified or bundled beyond what the tokenizer reads. */
export const VENDORED = new Set([
    'js/lib/diff.js',
    'pages/_lib/tom-select.base.js',
    'pages/_lib/list.js',               // List.js, a webpack bundle
    'api_webchat/markdown-it.min.js',
]);

let files = null;

/** Every scanned file, {path, kind: 'js' | 'html' | 'json', text}, read once per process. */
export function sourceFiles() {
    if (files) return files;
    const paths = [];
    const walk = dir => {
        for (const name of readdirSync(repoPath(dir)).sort()) {
            const path = dir + '/' + name;
            if (statSync(repoPath(path)).isDirectory()) walk(path);
            else if (/\.(js|html)$/.test(name) && !VENDORED.has(path)) paths.push(path);
        }
    };
    SCAN_DIRS.forEach(walk);
    paths.push(...SCAN_ROOT_FILES);
    files = paths.map(path => ({
        path,
        kind: path.endsWith('.js') ? 'js' : path.endsWith('.html') ? 'html' : 'json',
        text: readFileSync(repoPath(path), 'utf8'),
    }));
    return files;
}

/** A function giving the 1-based line of an offset in `src`, plus `base - 1`. */
export function lineCounter(src, base = 1) {
    const starts = [0];
    for (let i = src.indexOf('\n'); i !== -1; i = src.indexOf('\n', i + 1)) starts.push(i + 1);
    return offset => {
        let lo = 0, hi = starts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
        }
        return lo + base;
    };
}

/** The value of a string literal's body: the common escapes, enough for keys and for code. */
export function cook(body) {
    return body.replace(/\\(\r?\n|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, e) => {
        if (e[0] === '\n' || e[0] === '\r') return '';
        if (e[0] === 'u' || e[0] === 'x') return String.fromCodePoint(parseInt(e.replace(/[ux{}]/g, ''), 16));
        return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[e] ?? e;
    });
}

/**
 * Tokens of a JavaScript source, comments dropped:
 *   {t: 'str', q (the quote), v (the cooked value), subst (a template with ${...}), line}
 *   {t: 'id', v, line}, {t: 'p', v, line} (punctuation, '...' as one), {t: 're', line}
 * An injected script (see the header) is expanded in place: its own tokens follow its string
 * token, marked `injected: true`.
 */
export function lex(src, base = 1) {
    const lineOf = lineCounter(src, base);
    const out = [];
    for (const s of segments(src)) {
        if (s.type === 'comment') continue;
        const line = lineOf(s.start);
        if (s.type === 'regex') { out.push({ t: 're', line }); continue; }
        const text = src.slice(s.start, s.end);
        if (s.type === 'string') {
            const q = text[0];
            const body = text.length > 1 && text[text.length - 1] === q ? text.slice(1, -1) : text.slice(1);
            const subst = q === '`' && /(^|[^\\])\$\{/.test(body);
            const v = cook(body);
            out.push({ t: 'str', q, v, subst, line });
            if (q === '`' && !subst && v.includes('i18n.getMessage(')) {
                for (const tok of lex(v, line)) out.push({ ...tok, injected: true });
            }
            continue;
        }
        for (const m of text.matchAll(/[A-Za-z_$][\w$]*|\d[\w.]*|\.\.\.|\S/g)) {
            out.push({ t: /^[A-Za-z_$]/.test(m[0]) ? 'id' : 'p', v: m[0], line: lineOf(s.start + m.index) });
        }
    }
    return out;
}

const tokenCache = new Map();

/** lex() of a scanned file, once per process. */
export function tokensOf(file) {
    if (!tokenCache.has(file.path)) tokenCache.set(file.path, lex(file.text));
    return tokenCache.get(file.path);
}

/** A string token whose value is known statically: quoted, or a template without ${...}. */
export const isStatic = tok => !!tok && tok.t === 'str' && !tok.subst;

const OPEN = { '(': ')', '[': ']', '{': '}' };

/** Index of the first token at depth 0 from `j` whose value is in `stops` (or tokens.length). */
function skipTo(tokens, j, stops) {
    let depth = 0;
    for (; j < tokens.length; j++) {
        const v = tokens[j].t === 'p' ? tokens[j].v : null;
        if (depth === 0 && stops.includes(v)) return j;
        if (v && OPEN[v]) depth++;
        else if (v === ')' || v === ']' || v === '}') {
            if (depth === 0) return j;
            depth--;
        }
    }
    return j;
}

/**
 * The statically known keys of the argument starting at tokens[i]: a string, an array of strings,
 * or the property names of an object literal. Everything else, and every element or property
 * that is not static (a variable, a spread, a computed name), is `dynamic` (the line numbers).
 */
export function argumentKeys(tokens, i) {
    const keys = [];
    const dynamic = [];
    const a = tokens[i];
    const after = tokens[i + 1];
    if (isStatic(a) && after && after.t === 'p' && [',', ')'].includes(after.v)) {
        keys.push({ v: a.v, line: a.line });
    } else if (a && a.t === 'p' && a.v === '[') {
        let j = i + 1;
        while (j < tokens.length && !(tokens[j].t === 'p' && tokens[j].v === ']')) {
            const end = skipTo(tokens, j, [',', ']']);
            if (end === j + 1 && isStatic(tokens[j])) keys.push({ v: tokens[j].v, line: tokens[j].line });
            else if (end > j) dynamic.push(tokens[j].line);
            j = tokens[end] && tokens[end].v === ',' ? end + 1 : end;
        }
    } else if (a && a.t === 'p' && a.v === '{') {
        let j = i + 1;
        while (j < tokens.length && !(tokens[j].t === 'p' && tokens[j].v === '}')) {
            const end = skipTo(tokens, j, [',', '}']);
            const k = tokens[j];
            const n = tokens[j + 1];
            if ((k.t === 'id' || isStatic(k)) && n && n.t === 'p' && n.v === ':') keys.push({ v: k.v, line: k.line });
            else if (k.t === 'id' && end === j + 1) keys.push({ v: k.v, line: k.line });   // shorthand
            else if (end > j) dynamic.push(k.line);
            j = tokens[end] && tokens[end].v === ',' ? end + 1 : end;
        }
    } else if (a) {
        dynamic.push(a.line);
    }
    return { keys, dynamic };
}

/**
 * Every call `<path>(` in the tokens, where `path` is a list of identifiers joined by dots
 * (['mztaPrefs', 'getPrefs']), not itself preceded by a dot (so `x.mztaPrefs.getPrefs` is not it)
 * unless `anyReceiver` (['i18n', 'getMessage'] on browser., messenger. or anything else).
 * Yields the index of the token after "(".
 */
export function* calls(tokens, path, { anyReceiver = false } = {}) {
    const n = path.length * 2 - 1;
    for (let i = 0; i + n < tokens.length; i++) {
        let ok = anyReceiver || !(i > 0 && tokens[i - 1].t === 'p' && tokens[i - 1].v === '.');
        for (let k = 0; ok && k < n; k++) {
            const tok = tokens[i + k];
            ok = k % 2 === 0 ? (tok.t === 'id' && tok.v === path[k / 2]) : (tok.t === 'p' && tok.v === '.');
        }
        if (ok && tokens[i + n].t === 'p' && tokens[i + n].v === '(') yield i + n + 1;
    }
}

/**
 * The source text of the object literal a declaration assigns: cutLiteral(src, 'const PREF_ENUMS')
 * returns "{ ... }", braces matched over code segments only. Throws when the declaration is not
 * found: a renamed constant must fail the check that reads it, never pass silently.
 */
export function cutLiteral(src, declaration, label = declaration) {
    const at = src.indexOf(declaration);
    if (at === -1) throw new Error('source-scan: "' + declaration + '" not found (' + label + ')');
    const open = src.indexOf('{', at);
    let depth = 0;
    for (const s of segments(src)) {
        if (s.end <= open || s.type !== 'code') continue;
        for (let i = Math.max(s.start, open); i < s.end; i++) {
            if (src[i] === '{' || src[i] === '(' || src[i] === '[') depth++;
            else if (src[i] === '}' || src[i] === ')' || src[i] === ']') {
                depth--;
                if (depth === 0) return src.slice(open, i + 1);
            }
        }
    }
    throw new Error('source-scan: "' + declaration + '" is unbalanced (' + label + ')');
}

/** Evaluate an object literal's source with `deps` ({name: value}) as its free names. */
export function evalLiteral(text, deps = {}) {
    const names = Object.keys(deps);
    // eslint-disable-next-line no-new-func
    return new Function(...names, '"use strict"; return (' + text + ');')(...names.map(n => deps[n]));
}

/**
 * The top-level entries of an object literal's source: {name} for `name: value` and shorthand,
 * {spread} for `...expr`, {computed: true} for `[expr]: value`.
 */
export function literalEntries(text) {
    const tokens = lex(text);
    const out = [];
    let j = 1;   // tokens[0] is "{"
    while (j < tokens.length && !(tokens[j].t === 'p' && tokens[j].v === '}')) {
        const end = skipTo(tokens, j, [',', '}']);
        const k = tokens[j];
        const n = tokens[j + 1];
        if (k.t === 'p' && k.v === '...') out.push({ spread: tokens.slice(j + 1, end).map(t => t.v).join('') });
        else if (k.t === 'p' && k.v === '[') out.push({ computed: true });
        else if ((k.t === 'id' || isStatic(k)) && n && n.t === 'p' && (n.v === ':' || n.v === ',' || n.v === '}')) out.push({ name: k.v, line: k.line });
        else if (end > j) out.push({ computed: true });
        j = tokens[end] && tokens[end].v === ',' ? end + 1 : end;
    }
    return out;
}

/** "a.js:3, a.js:9, b.js:4": where a key is used, for a failure message. */
export function where(sites, max = 5) {
    const s = sites.slice(0, max).join(', ');
    return sites.length > max ? s + ` (+${sites.length - max} more)` : s;
}
