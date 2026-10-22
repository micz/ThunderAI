/*
 *  Real background code cut out of mzta-background.js, for any test area.
 *
 *  The background script cannot be imported under test: its top level awaits every startup
 *  step (menus, content scripts, migrations) against the whole Thunderbird API. Rather than
 *  keep a copy of a handler in the tests - which would test the copy - a listener is located
 *  by a guard string it contains, cut out with a small tokenizer that respects strings,
 *  comments and regex literals, and evaluated against the dependencies the caller injects.
 *
 *  An area names its own listeners (guard, label, dependencies) in its own helper; nothing
 *  here knows which listeners exist.
 */

import { readFileSync } from 'node:fs';
import { repoPath } from './load.mjs';

const REGISTRATION = 'browser.runtime.onMessage.addListener(';

// After one of these, a "/" starts a regular expression literal rather than a division.
const REGEX_AFTER_PUNCT = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
    'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/**
 * Split JavaScript source into segments {type, start, end}: 'code', 'comment', 'string'
 * (quotes and template literals, as one segment each) and 'regex'. Enough of a tokenizer to find
 * comments and brackets reliably: a regex literal is told from a division by the token before it,
 * so a quote or backtick inside a regex (/[\*#_~`]/g) does not open a string. Template literal
 * substitutions (${...}) stay inside the string segment, which is fine for both callers.
 */
export function segments(src) {
    const out = [];
    let codeStart = 0;
    let prev = '';      // the last significant code character
    let prevWord = '';  // the identifier it ends, if any
    const push = (type, start, end) => {
        if (start > codeStart) out.push({ type: 'code', start: codeStart, end: start });
        out.push({ type, start, end });
        codeStart = end;
    };
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        const n = src[i + 1];
        if (c === '/' && n === '/') {
            const nl = src.indexOf('\n', i);
            const end = nl === -1 ? src.length : nl;
            push('comment', i, end); i = end - 1; continue;
        }
        if (c === '/' && n === '*') {
            const close = src.indexOf('*/', i + 2);
            const end = close === -1 ? src.length : close + 2;
            push('comment', i, end); i = end - 1; continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            let j = i + 1;
            for (; j < src.length && src[j] !== c; j++) if (src[j] === '\\') j++;
            push('string', i, j + 1); i = j; prev = c; prevWord = ''; continue;
        }
        if (c === '/' && (prev === '' || REGEX_AFTER_PUNCT.has(prev) || REGEX_AFTER_WORD.has(prevWord))) {
            let j = i + 1;
            let inClass = false;
            for (; j < src.length; j++) {
                const d = src[j];
                if (d === '\\') { j++; continue; }
                if (d === '\n') break;            // not a regex after all: give up on this line
                if (inClass) { if (d === ']') inClass = false; continue; }
                if (d === '[') inClass = true;
                else if (d === '/') break;
            }
            if (src[j] === '/') {
                j++;
                while (j < src.length && /[a-z]/i.test(src[j])) j++;  // flags
                push('regex', i, j); i = j - 1; prev = '/'; prevWord = ''; continue;
            }
        }
        if (/\s/.test(c)) continue;
        if (/[\w$]/.test(c)) {
            prevWord = /[\w$]/.test(prev) ? prevWord + c : c;
        } else {
            prevWord = '';
        }
        prev = c;
    }
    if (codeStart < src.length) out.push({ type: 'code', start: codeStart, end: src.length });
    return out;
}

/** Index just past the ")" that closes the "(" at `open`, skipping strings, comments, regexes. */
function matchParen(src, open, label) {
    let depth = 0;
    for (const s of segments(src)) {
        if (s.end <= open || s.type !== 'code') continue;
        for (let i = Math.max(s.start, open); i < s.end; i++) {
            const c = src[i];
            if (c === '(' || c === '{' || c === '[') depth++;
            else if (c === ')' || c === '}' || c === ']') {
                depth--;
                if (depth === 0) return i + 1;
            }
        }
    }
    throw new Error(label + ': unbalanced source');
}

/** The source with // and /* *\/ comments blanked out (strings kept), offsets preserved. */
export function stripComments(src) {
    return segments(src).map(s => s.type === 'comment'
        ? src.slice(s.start, s.end).replace(/[^\n]/g, ' ')
        : src.slice(s.start, s.end)).join('');
}

export function backgroundSource() {
    return readFileSync(repoPath('mzta-background.js'), 'utf8');
}

/**
 * The runtime.onMessage listener whose source contains `guard`: its text,
 * "(message, sender) => { ... }", and where its registration sits.
 *
 * @param {string} guard   a string only that listener contains (typically its command check)
 * @param {object} o
 *   src    the source to search (default: mzta-background.js)
 *   label  prefix of the error messages (default 'background-source')
 *   what   what the guard identifies, for the "not found" message (default: the guard)
 */
export function locateListener(guard, { src = backgroundSource(), label = 'background-source', what = guard } = {}) {
    const at = src.indexOf(guard);
    if (at === -1) throw new Error(label + ': ' + what + ' not found');
    const reg = src.lastIndexOf(REGISTRATION, at);
    if (reg === -1) throw new Error(label + ': listener registration not found');
    const open = reg + REGISTRATION.length - 1;
    const close = matchParen(src, open, label);
    return { start: reg, end: close, text: src.slice(open + 1, close - 1).trim() };
}

/**
 * Evaluate a listener's source text with `deps` ({name: value}) as the free names it uses, and
 * return the resulting function.
 */
export function evalListener(text, deps) {
    const names = Object.keys(deps);
    // eslint-disable-next-line no-new-func
    const factory = new Function(...names, '"use strict"; return (' + text + ');');
    return factory(...names.map(n => deps[n]));
}
