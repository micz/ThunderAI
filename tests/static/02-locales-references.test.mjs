// Spec 06 "Using Strings in Code": a string reaches the UI as
// browser.i18n.getMessage('key') in JavaScript, and __MSG_key__ in HTML, in manifest.json and
// in JavaScript strings (the prompt and placeholder names, the HTML the
// connection panel builds). The scan also reads the older i18n('key') and data-i18n="key"
// forms, which the code no longer uses (see ./README.md, "What is not covered").
// Every key referenced that way exists in _locales/en/messages.json.
// A key built at run time (a variable, a concatenation, a template with ${...}) cannot be checked
// statically: it is listed by the "unresolvable" test, never failed.
//
// Spec 06 "Removing a String": a key no longer referenced from the code is removed from en, so no
// key of en is referenced nowhere. "Referenced" is deliberately generous here, so the check under-reports rather than
// cries wolf: a key counts as used when any static string in the scanned code equals it, or when
// it starts with a prefix ('prompt_' + id, `prompt_${id}`) or ends with a suffix (id + '_info')
// the code builds keys from.
//
// Message names are matched ignoring case, as the WebExtension i18n API does. The scope (the
// scanned directories, the vendored files left out) is in ./source-scan.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repoPath } from '../helpers/core/load.mjs';
import { declareCheck } from '../helpers/known-issues/static.mjs';
import {
    sourceFiles,
    tokensOf,
    calls,
    isStatic,
    lineCounter,
    where
} from './source-scan.mjs';

const en = JSON.parse(readFileSync(repoPath('_locales/en/messages.json'), 'utf8'));
const enLower = new Set(Object.keys(en).map(k => k.toLowerCase()));

// The same pattern js/mzta-i18n.js substitutes at run time, so a key with a stray character is
// read exactly as the page would read it.
const MSG = /__MSG_(.+?)__/g;

const refs = new Map();      // key -> ["file:line", ...]
const unresolvable = [];     // "file:line form"
const mentioned = new Set(); // lowercased static strings anywhere: the generous "used" of dead keys
const prefixes = new Set();
const suffixes = new Set();
const KEYLIKE = /^[A-Za-z][A-Za-z0-9_]{2,}$/;

const addRef = (key, site) => {
    if (!refs.has(key)) refs.set(key, []);
    refs.get(key).push(site);
};
const msgRefs = (text, site) => {
    for (const m of text.matchAll(MSG)) {
        if (m[1].includes('${')) unresolvable.push(site + ' __MSG_${...}__');
        else addRef(m[1], site);
    }
};

for (const file of sourceFiles()) {
    if (file.kind !== 'js') {
        // HTML comments are not rendered: blank them, keeping the line numbers.
        const text = file.kind === 'html' ? file.text.replace(/<!--[\s\S]*?-->/g, c => c.replace(/[^\n]/g, ' ')) : file.text;
        const lineOf = lineCounter(text);
        for (const m of text.matchAll(MSG)) addRef(m[1], file.path + ':' + lineOf(m.index));
        for (const m of text.matchAll(/\bdata-i18n\s*=\s*["']([^"']*)["']/g)) addRef(m[1], file.path + ':' + lineOf(m.index));
        for (const m of text.matchAll(/=\s*["']([^"'\s]+)["']/g)) mentioned.add(m[1].toLowerCase());
        continue;
    }
    const tokens = tokensOf(file);
    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok.t !== 'str') continue;
        const site = file.path + ':' + tok.line;
        msgRefs(tok.v, site);
        const prev = tokens[i - 1];
        const next = tokens[i + 1];
        if (!tok.subst) {
            mentioned.add(tok.v.toLowerCase());
            if (next && next.v === '+' && KEYLIKE.test(tok.v)) prefixes.add(tok.v.toLowerCase());
            if (prev && prev.v === '+' && /^_[A-Za-z0-9_]{2,}$/.test(tok.v)) suffixes.add(tok.v.toLowerCase());
        } else {
            const parts = tok.v.split(/\$\{[^}]*\}/);
            const head = parts[0].replace(/^__MSG_/, '');
            const tail = parts[parts.length - 1].replace(/__$/, '');
            if (KEYLIKE.test(head)) prefixes.add(head.toLowerCase());
            if (/^_[A-Za-z0-9_]{2,}$/.test(tail)) suffixes.add(tail.toLowerCase());
        }
    }
    // i18n.getMessage(...) on any receiver (browser., messenger.), and a bare i18n(...) call.
    const sites = [...calls(tokens, ['i18n', 'getMessage'], { anyReceiver: true })].map(i => ({ i, form: 'getMessage' }));
    for (let i = 0; i + 1 < tokens.length; i++) {
        const t = tokens[i];
        if (t.t === 'id' && t.v === 'i18n' && tokens[i + 1].v === '(' && !(i > 0 && tokens[i - 1].v === '.')) {
            sites.push({ i: i + 2, form: 'i18n' });
        }
    }
    for (const { i, form } of sites) {
        const arg = tokens[i];
        const after = tokens[i + 1];
        const site = file.path + ':' + (arg ? arg.line : '?');
        if (isStatic(arg) && after && (after.v === ',' || after.v === ')')) addRef(arg.v, site);
        else unresolvable.push(site + ' ' + form + '(' + (arg ? (arg.t === 'str' ? '`...${}`' : arg.v) : '') + ' ...)');
    }
}

const missing = new Map();
for (const [key, sites] of refs) {
    if (!enLower.has(key.toLowerCase())) missing.set(key, 'referenced at ' + where(sites));
}

const refLower = new Set([...refs.keys()].map(k => k.toLowerCase()));
const dead = new Map();
for (const key of Object.keys(en)) {
    const k = key.toLowerCase();
    if (refLower.has(k) || mentioned.has(k)) continue;
    if ([...prefixes].some(p => k.startsWith(p)) || [...suffixes].some(s => k.endsWith(s))) continue;
    dead.set(key, '');
}

test('the scan sees every reference form in use', () => {
    const fromFile = f => [...refs.values()].flat().some(s => s.startsWith(f + ':'));
    assert.ok(refs.size > 100, 'found references at all (' + refs.size + ')');
    assert.ok(fromFile('manifest.json'), '__MSG_ in manifest.json');
    assert.ok(fromFile('options/mzta-options.html'), '__MSG_ in HTML');
    assert.ok(fromFile('js/mzta-chatgpt.js'), 'getMessage() inside the injected ChatGPT Web script');
    assert.ok(fromFile('js/mzta-prompts.js'), '__MSG_ inside JavaScript strings');
});

test('unresolvable references, listed and not checked', (t) => {
    t.diagnostic(unresolvable.length + ' key(s) built at run time: ' + unresolvable.join('; '));
});

declareCheck('missing-key', 'every key referenced from the code exists in _locales/en/messages.json', missing);
declareCheck('dead-key', 'every key of _locales/en/messages.json is referenced from the code', dead);
