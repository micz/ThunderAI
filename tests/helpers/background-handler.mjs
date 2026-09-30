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

/** Index just past the ")" that closes the "(" at `open`, skipping strings and comments. */
function matchParen(src, open) {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        const n = src[i + 1];
        if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
        if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
        if (c === '"' || c === "'" || c === '`') {
            for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
            continue;
        }
        if (c === '(' || c === '{' || c === '[') depth++;
        else if (c === ')' || c === '}' || c === ']') {
            depth--;
            if (depth === 0) return i + 1;
        }
    }
    throw new Error('background-handler: unbalanced source');
}

/** The source with // and /* *\/ comments blanked out (strings kept), offsets preserved. */
export function stripComments(src) {
    let out = '';
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        const n = src[i + 1];
        if (c === '/' && n === '/') {
            const end = src.indexOf('\n', i);
            const stop = end === -1 ? src.length : end;
            out += ' '.repeat(stop - i);
            i = stop - 1;
            continue;
        }
        if (c === '/' && n === '*') {
            const stop = src.indexOf('*/', i + 2) + 2;
            out += src.slice(i, stop).replace(/[^\n]/g, ' ');
            i = stop - 1;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            let j = i + 1;
            for (; j < src.length && src[j] !== c; j++) if (src[j] === '\\') j++;
            out += src.slice(i, j + 1);
            i = j;
            continue;
        }
        out += c;
    }
    return out;
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
