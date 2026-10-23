/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// Reports how the enterprise policy surface changed between two revisions, as Markdown, so the
// administrator key reference on micz.it (written by hand from prefs_default, see
// claude-spec/08-managed-configuration.md "Adding a policy-settable preference") can be updated.
// Node built-ins only:
//   node .github/scripts/policy-keys-diff.mjs <old_dir> <new_dir> <out.md>
// Each dir holds options/mzta-options-default.js and, when the revision has it,
// js/mzta-managed.js, at their repository paths. <new_dir> must be a full tree (the HEAD
// checkout): its js/mzta-managed.js is imported to tell excluded keys from policy-settable ones.
// The report is empty when nothing changed. Writes it to <out.md>, prints it, and appends
// changed=true|false to $GITHUB_OUTPUT when set. Run by .github/workflows/policy-docs-issue.yml.
//
// What it compares:
//   - prefs_default as an evaluated object, so the keys generated from integration_options_config
//     and special_prompts_with_integration count too: keys added, removed, defaults changed;
//   - the '_...' values of the POLICY_* constants of js/mzta-managed.js (the structural keys);
//   - EXCLUDED_KEY_PATTERNS / EXCLUDED_KEYS, comments and whitespace ignored.
// js/mzta-managed.js is read as text for the last two; a revision without it has neither.

import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULTS_PATH = join('options', 'mzta-options-default.js');
const MANAGED_PATH = join('js', 'mzta-managed.js');

/**
 * prefs_default of a revision. The file is copied to a temporary .mjs and imported from there,
 * so it loads as a module whatever surrounds <dir>; that only works because it imports nothing.
 */
async function loadPrefsDefault(dir) {
    const source = readFileSync(join(dir, DEFAULTS_PATH), 'utf8');
    if (/^\s*import\b/m.test(source)) {
        throw new Error(`${join(dir, DEFAULTS_PATH)} has an import: it can no longer be loaded on its own, update this script`);
    }
    const tmp = mkdtempSync(join(tmpdir(), 'policy-keys-'));
    try {
        const file = join(tmp, 'mzta-options-default.mjs');
        writeFileSync(file, source);
        const { prefs_default } = await import(pathToFileURL(file).href);
        if (!prefs_default || typeof prefs_default !== 'object') {
            throw new Error(`${join(dir, DEFAULTS_PATH)} does not export prefs_default`);
        }
        return prefs_default;
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

function readManagedSource(dir) {
    const path = join(dir, MANAGED_PATH);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

// Line and block comments. A // counts only at the start of a line or after whitespace, so the
// slashes of a regex literal (/^chatgpt_win_/) are never taken for one.
function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

function policyKeys(source) {
    if (source === null) return new Set();
    const re = /^\s*(?:export\s+)?const\s+POLICY_\w+\s*=\s*(['"])(_[^'"]*)\1/gm;
    return new Set([...source.matchAll(re)].map(m => m[2]));
}

/** The exclusion declarations, comments removed: { NAME: text without comments, or null }. */
function exclusionRules(source) {
    const rules = { EXCLUDED_KEY_PATTERNS: null, EXCLUDED_KEYS: null };
    if (source === null) return rules;
    const code = stripComments(source);
    for (const name of Object.keys(rules)) {
        const m = code.match(new RegExp(`const\\s+${name}\\s*=\\s*([\\s\\S]*?);`));
        if (m) {
            rules[name] = m[1].split('\n').map(l => l.trim()).filter(Boolean).join('\n');
        }
    }
    return rules;
}

const normalize = text => (text === null ? null : text.replace(/\s+/g, ''));

// Key order of nested objects does not make a default different.
function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
    }
    return value;
}
const sameValue = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

function cell(value) {
    const json = value === undefined ? 'undefined' : JSON.stringify(value);
    return '`' + json.replace(/\|/g, '\\|') + '`';
}

function table(header, rows) {
    return [
        '| ' + header.join(' | ') + ' |',
        '|' + header.map(() => '---').join('|') + '|',
        ...rows.map(r => '| ' + r.join(' | ') + ' |'),
    ].join('\n');
}

async function buildReport(oldDir, newDir) {
    const oldPrefs = await loadPrefsDefault(oldDir);
    const newPrefs = await loadPrefsDefault(newDir);
    const oldManaged = readManagedSource(oldDir);
    const newManaged = readManagedSource(newDir);

    let isExcluded = null;
    if (newManaged !== null) {
        const mod = await import(pathToFileURL(resolve(newDir, MANAGED_PATH)).href);
        if (typeof mod.isPolicyExcludedKey !== 'function') {
            throw new Error(`${join(newDir, MANAGED_PATH)} does not export isPolicyExcludedKey()`);
        }
        isExcluded = mod.isPolicyExcludedKey;
    }

    const oldKeys = Object.keys(oldPrefs);
    const newKeys = Object.keys(newPrefs);
    const added = newKeys.filter(k => !(k in oldPrefs)).sort();
    const removed = oldKeys.filter(k => !(k in newPrefs)).sort();
    const changedDefaults = newKeys.filter(k => k in oldPrefs && !sameValue(oldPrefs[k], newPrefs[k])).sort();

    const oldPolicy = policyKeys(oldManaged);
    const newPolicy = policyKeys(newManaged);
    const policyAdded = [...newPolicy].filter(k => !oldPolicy.has(k)).sort();
    const policyRemoved = [...oldPolicy].filter(k => !newPolicy.has(k)).sort();

    const oldRules = exclusionRules(oldManaged);
    const newRules = exclusionRules(newManaged);
    const rulesChanged = Object.keys(newRules).filter(n => normalize(oldRules[n]) !== normalize(newRules[n]));

    const sections = [];
    if (added.length) {
        sections.push('## Preferences added\n\n' + table(
            ['Key', 'Default', 'Policy'],
            added.map(k => ['`' + k + '`', cell(newPrefs[k]),
                isExcluded === null ? '-' : (isExcluded(k) ? 'excluded' : 'policy-settable')])));
    }
    if (removed.length) {
        sections.push('## Preferences removed\n\n' + table(
            ['Key', 'Old default'],
            removed.map(k => ['`' + k + '`', cell(oldPrefs[k])])));
    }
    if (changedDefaults.length) {
        sections.push('## Defaults changed\n\n' +
            'Relevant to organizations using `_lock_unlisted`: every preference their policy does ' +
            'not name is locked at its default, so these values change for their whole fleet.\n\n' +
            table(['Key', 'Old default', 'New default'],
                changedDefaults.map(k => ['`' + k + '`', cell(oldPrefs[k]), cell(newPrefs[k])])));
    }
    if (policyAdded.length || policyRemoved.length) {
        sections.push('## Structural policy keys\n\n' + table(
            ['Key', 'Change'],
            [...policyAdded.map(k => ['`' + k + '`', 'added']),
             ...policyRemoved.map(k => ['`' + k + '`', 'removed'])]));
    }
    if (rulesChanged.length) {
        const block = text => '```js\n' + (text ?? '(not declared)') + '\n```';
        sections.push('## Exclusion rules changed\n\n' + rulesChanged.map(n =>
            `### \`${n}\`\n\nBefore:\n\n${block(oldRules[n])}\n\nAfter:\n\n${block(newRules[n])}`
        ).join('\n\n'));
    }

    if (!sections.length) return '';
    const settable = isExcluded === null ? null : newKeys.filter(k => !isExcluded(k)).length;
    const counts = `\`prefs_default\`: ${oldKeys.length} → ${newKeys.length} keys` +
        (settable === null ? '' : `, ${settable} of ${newKeys.length} policy-settable at the new revision`) + '.';
    return counts + '\n\n' + sections.join('\n\n') + '\n';
}

const [oldDir, newDir, outPath] = process.argv.slice(2);
if (!oldDir || !newDir || !outPath) {
    console.error('Usage: node .github/scripts/policy-keys-diff.mjs <old_dir> <new_dir> <out.md>');
    process.exit(2);
}
const report = await buildReport(oldDir, newDir);
writeFileSync(outPath, report);
process.stdout.write(report || 'No change to the policy surface.\n');
if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${report ? 'true' : 'false'}\n`);
}
