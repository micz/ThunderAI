/*
 *  The get_managed_values listener, taken verbatim from mzta-background.js.
 *
 *  It is registered inline in the background script, which cannot be imported under test:
 *  its top level awaits every startup step (menus, content scripts, migrations) against the
 *  whole Thunderbird API. Rather than keep a copy of the handler here - which would test the
 *  copy - the source is located by its command guard, cut out with a small tokenizer that
 *  respects strings and comments, and evaluated against the injected dependencies.
 *
 *  If this throws "not found", the handler was moved or restructured: update the locator
 *  below, not the assertions.
 */

import { readFileSync } from 'node:fs';
import { repoPath } from './load.mjs';

const GUARD = "message.command !== 'get_managed_values'";
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
function matchParen(src, open) {
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
    throw new Error('background-handler: unbalanced source');
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

/** The listener's source text, "(message, sender) => { ... }", and where it sits. */
export function locateManagedValuesListener(src = backgroundSource()) {
    const guard = src.indexOf(GUARD);
    if (guard === -1) throw new Error('background-handler: get_managed_values listener not found');
    const reg = src.lastIndexOf(REGISTRATION, guard);
    if (reg === -1) throw new Error('background-handler: listener registration not found');
    const open = reg + REGISTRATION.length - 1;
    const close = matchParen(src, open);
    return { start: reg, end: close, text: src.slice(open + 1, close - 1).trim() };
}

/** Build the real listener, bound to the given background-side dependencies. */
export function extractManagedValuesListener({ browser, mztaManaged, MANAGED_SECRET_MARKER, prefs_default }) {
    const { text } = locateManagedValuesListener();
    // eslint-disable-next-line no-new-func
    const factory = new Function('browser', 'mztaManaged', 'MANAGED_SECRET_MARKER', 'prefs_default',
        '"use strict"; return (' + text + ');');
    return factory(browser, mztaManaged, MANAGED_SECRET_MARKER, prefs_default);
}
