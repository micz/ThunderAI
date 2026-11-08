// Spec 06 "Message File Format": every _locales/*/messages.json is a WebExtension message file
// (an object of entries, each an object with a string `message`), and every entry of the source
// file, _locales/en/messages.json, also has a `description` for the Weblate translators.
// Spec 06 "Golden Rule": the translations are Weblate's copies of en, so a translated entry carries
// the same $PLACEHOLDERS$ as en's (else the runtime string silently loses a substitution).
// Spec 06 "Removing a String": a key removed from en leaves the translations when Weblate syncs
// from en, so a translated key en no longer has is a state the spec expects for a while: it is
// reported (stale-key, informational), never failed.
// Spec 06 "Supported Languages" and CLAUDE.md rule 2: LANG.md, the release allowlist, names only
// locales that exist under _locales/. The other direction (a locale absent from LANG.md) is
// deliberate and never reported.
//
// Spec 06 "Message File Format": a name appears once per object. JSON.parse keeps the last of two
// equal names without a word, so the duplicates are found on the raw text (duplicateKeys()).
//
// Message names are matched ignoring case, as the WebExtension i18n API does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { repoPath } from '../helpers/core/load.mjs';
import {
    declareCheck,
    reportCheck
} from '../helpers/known-issues/static.mjs';

const NAME = /^[A-Za-z0-9_@]+$/;   // the characters a WebExtension message name may use

// The names that appear more than once in the same object of a JSON text that parses, at any depth,
// as [{path, key, lines}]: path is the names leading to that object ([] for the top level).
function duplicateKeys(text) {
    const found = [];
    const stack = [];   // {isObject, path, keys: Map name -> lines, expectKey, lastKey}
    let line = 1;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\n') line++;
        else if (ch === '{' || ch === '[') {
            const top = stack[stack.length - 1];
            const path = top ? (top.isObject ? [...top.path, top.lastKey] : top.path) : [];
            stack.push({ isObject: ch === '{', path, keys: new Map(), expectKey: ch === '{', lastKey: null });
        } else if (ch === '}' || ch === ']') {
            const frame = stack.pop();
            for (const [key, lines] of frame.keys) if (lines.length > 1) found.push({ path: frame.path, key, lines });
        } else if (ch === ',') {
            const top = stack[stack.length - 1];
            if (top && top.isObject) top.expectKey = true;
        } else if (ch === ':') {
            stack[stack.length - 1].expectKey = false;
        } else if (ch === '"') {
            let j = i + 1;
            while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
            const top = stack[stack.length - 1];
            if (top && top.isObject && top.expectKey) {
                const key = JSON.parse(text.slice(i, j + 1));
                if (!top.keys.has(key)) top.keys.set(key, []);
                top.keys.get(key).push(line);
                top.lastKey = key;
            }
            i = j;
        }
    }
    return found;
}

const localeDirs = readdirSync(repoPath('_locales')).filter(d => statSync(repoPath('_locales/' + d)).isDirectory()).sort();
const locales = {};       // {locale: {key: entry}} for the files that parse
const shape = new Map();  // subject -> detail

for (const loc of localeDirs) {
    const file = '_locales/' + loc + '/messages.json';
    if (!existsSync(repoPath(file))) { shape.set(loc, 'no messages.json'); continue; }
    const text = readFileSync(repoPath(file), 'utf8');
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        shape.set(loc, 'does not parse: ' + e.message);
        continue;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { shape.set(loc, 'not an object of entries'); continue; }
    locales[loc] = data;
    const duplicates = new Map();   // entry name -> problems
    for (const { path, key, lines } of duplicateKeys(text)) {
        const entry = path.length ? path[0] : key;
        const where = path.length > 1 ? '"' + path.slice(1).concat(key).join('.') + '"' : 'the name';
        if (!duplicates.has(entry)) duplicates.set(entry, []);
        duplicates.get(entry).push(where + ' appears ' + lines.length + ' times (lines ' + lines.join(', ') + ')');
    }
    const byLower = new Map();
    for (const [key, entry] of Object.entries(data)) {
        const subject = loc + ':' + key;
        const problems = [...(duplicates.get(key) || [])];
        if (!NAME.test(key)) problems.push('the name uses characters outside [A-Za-z0-9_@]');
        if (byLower.has(key.toLowerCase())) problems.push('same name as "' + byLower.get(key.toLowerCase()) + '" ignoring case');
        byLower.set(key.toLowerCase(), key);
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) problems.push('not an object');
        else {
            if (typeof entry.message !== 'string') problems.push('no string "message"');
            if ('description' in entry && typeof entry.description !== 'string') problems.push('"description" is not a string');
            if ('placeholders' in entry) {
                const ph = entry.placeholders;
                if (!ph || typeof ph !== 'object' || Array.isArray(ph)) problems.push('"placeholders" is not an object');
                else for (const [n, p] of Object.entries(ph)) {
                    if (!p || typeof p.content !== 'string') problems.push('placeholder "' + n + '" has no string "content"');
                }
            }
        }
        if (problems.length) shape.set(subject, problems.join('; '));
    }
}

const en = locales.en || {};
const enLower = new Map(Object.keys(en).map(k => [k.toLowerCase(), k]));

// The named placeholders a message uses, lowercased like the API does ($$ is a literal dollar).
const placeholdersOf = message => [...new Set([...String(message).replace(/\$\$/g, '')
    .matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map(m => m[1].toLowerCase()))].sort();

const noDescription = new Map();
for (const [key, entry] of Object.entries(en)) {
    if (!entry || typeof entry.description !== 'string' || entry.description.trim() === '') noDescription.set(key, '');
}

const placeholders = new Map();
const stale = new Map();
for (const [loc, data] of Object.entries(locales)) {
    if (loc === 'en') continue;
    for (const [key, entry] of Object.entries(data)) {
        const enKey = enLower.get(key.toLowerCase());
        if (enKey === undefined) { stale.set(loc + ':' + key, ''); continue; }
        if (!entry || typeof entry.message !== 'string') continue;   // reported by locale-shape
        const want = placeholdersOf(en[enKey].message).join(', ');
        const got = placeholdersOf(entry.message).join(', ');
        if (want !== got) placeholders.set(loc + ':' + key, `en uses [${want}], ${loc} uses [${got}]`);
    }
}

const langMd = readFileSync(repoPath('LANG.md'), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const langMissing = new Map(langMd.filter(code => !localeDirs.includes(code))
    .map(code => [code, 'listed in LANG.md, no _locales/' + code + '/ directory']));

test('the source locale exists and the scan found the locales', () => {
    assert.ok(localeDirs.includes('en'), '_locales/en/ exists');
    assert.ok(Object.keys(en).length > 0, '_locales/en/messages.json has entries');
    assert.ok(localeDirs.length > 1, 'there are translated locales');
});

declareCheck('locale-shape', 'every messages.json parses and every entry has the WebExtension shape', shape);
declareCheck('en-description', 'every en entry has a non-empty description', noDescription);
declareCheck('placeholders', 'a translated entry uses the same $placeholders$ as en', placeholders);
reportCheck('stale-key', 'translated keys en no longer has, until Weblate syncs from en', stale);
declareCheck('lang-md', 'LANG.md lists only locales that exist under _locales/', langMissing);
