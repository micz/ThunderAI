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

// Deterministic side of the translate-locales skill: finds the strings of _locales/en/messages.json
// that the locales listed in LANG_AUTO.md lack or translate from an older English text, hands them
// to Claude as work files, and merges the translations back. Node built-ins only, run from anywhere:
//   node .claude/skills/translate-locales/scripts/i18n.mjs <init|status|extract|apply> [options]
//
//   init                          record the baseline (baseline.json, next to SKILL.md) for the languages it lacks
//   status  [--langs a,b]         counts per language; exit 1 if anything needs work, 2 on setup errors
//   extract [--langs a,b] [--limit N]   write .claude/i18n-work/<folder>.json
//   apply   [--langs a,b] [--prune]     validate and merge the work files; --prune drops obsolete keys
//
// Baseline: for each locale folder and each key, the hash of the English message (and of its
// placeholders block) at the time its translation was produced or confirmed. A key is missing when
// absent or empty in the locale, modified when translated but its English hash differs from the
// baseline (no baseline entry counts as a difference), obsolete when en no longer has it.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const localesDir = join(root, '_locales');
const enRelPath = '_locales/en/messages.json';
const langListPath = join(root, 'LANG_AUTO.md');
const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(skillDir, 'baseline.json');
const workDir = join(root, '.claude', 'i18n-work');

const HASH_LENGTH = 12;
const REFERENCE_COUNT = 15;
const GIT_HISTORY_LIMIT = 300;

// ---------------------------------------------------------------- hashing

const sha = text => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, HASH_LENGTH);

// Key order does not change a placeholders block's meaning; names are case-insensitive in WebExtensions.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).map(k => [k.toLowerCase(), k]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([lk, k]) => `${JSON.stringify(lk)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function entryHash(entry) {
  const m = sha(entry.message);
  return entry.placeholders ? `${m}:${sha(canonical(entry.placeholders))}` : m;
}

// ---------------------------------------------------------------- files

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

const readEn = () => readJson(join(localesDir, 'en', 'messages.json'));
const localePath = folder => join(localesDir, folder, 'messages.json');
const workPath = folder => join(workDir, `${folder}.json`);

const isTranslated = entry => !!entry && typeof entry.message === 'string' && entry.message.trim() !== '';

function readBaseline() {
  if (!existsSync(baselinePath)) return null;
  const baseline = readJson(baselinePath);
  baseline.langs ??= {};
  return baseline;
}

function writeBaseline(baseline) {
  const langs = {};
  for (const folder of Object.keys(baseline.langs).sort()) {
    langs[folder] = {};
    for (const key of Object.keys(baseline.langs[folder]).sort()) langs[folder][key] = baseline.langs[folder][key];
  }
  writeJson(baselinePath, {
    _comment: 'Written by .claude/skills/translate-locales/scripts/i18n.mjs, do not edit by hand. Per locale folder and key: sha256 of the English message (and :placeholders) the translation matches.',
    version: 1,
    langs,
  });
}

// ---------------------------------------------------------------- languages

// LANG_AUTO.md: one locale per line, blank lines and '#' lines ignored. An entry maps to the folder of
// the same name, else to the one equal ignoring case and '-' vs '_'; an entry with no folder is reported.
function resolveLanguages(requested) {
  if (!existsSync(langListPath)) fail('LANG_AUTO.md not found at the repository root.');
  const entries = readFileSync(langListPath, 'utf8').split(/\r?\n/).map(l => l.trim())
    .filter(l => l !== '' && !l.startsWith('#'));
  const folders = readdirSync(localesDir).filter(d => statSync(join(localesDir, d)).isDirectory());
  const norm = s => s.toLowerCase().replace(/-/g, '_');
  const langs = [];
  const unmatched = [];
  for (const entry of entries) {
    if (norm(entry) === 'en') continue;
    let folder = folders.includes(entry) ? entry : null;
    if (!folder) {
      const candidates = folders.filter(f => norm(f) === norm(entry));
      if (candidates.length === 1) folder = candidates[0];
    }
    if (folder && existsSync(localePath(folder))) {
      if (!langs.some(l => l.folder === folder)) langs.push({ entry, folder });
    } else {
      unmatched.push(entry);
    }
  }
  for (const entry of unmatched) console.error(`LANG_AUTO.md: "${entry}" has no matching folder with a messages.json under _locales/ (not created).`);
  if (!requested) return { langs, unmatched };
  const selected = [];
  for (const name of requested) {
    const lang = langs.find(l => l.folder === name || norm(l.entry) === norm(name) || norm(l.folder) === norm(name));
    if (!lang) fail(`--langs: "${name}" is not a language of LANG_AUTO.md with a locale folder.`);
    if (!selected.includes(lang)) selected.push(lang);
  }
  return { langs: selected, unmatched };
}

// ---------------------------------------------------------------- analysis

function analyse(en, locale, baselineLang) {
  const missing = [];
  const modified = [];
  for (const key of Object.keys(en)) {
    if (!isTranslated(locale[key])) missing.push(key);
    else if (baselineLang?.[key] !== entryHash(en[key])) modified.push(key);
  }
  const obsolete = Object.keys(locale).filter(key => !Object.hasOwn(en, key));
  return { missing, modified, obsolete };
}

// ---------------------------------------------------------------- locale file editing

// Splits a messages.json into its top-level members as raw text, so an edit touches only the
// members it rewrites: text = head + m0.text + m0.sep + m1.text + ... + mN.text + tail.
function segment(text) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const string = () => {
    if (text[i] !== '"') throw new Error(`expected a string at offset ${i}`);
    const start = i++;
    while (text[i] !== '"') { if (text[i] === '\\') i++; i++; if (i >= text.length) throw new Error('unterminated string'); }
    i++;
    return JSON.parse(text.slice(start, i));
  };
  const value = () => {
    if (text[i] === '"') return string();
    if (text[i] !== '{' && text[i] !== '[') throw new Error(`unexpected value at offset ${i}`);
    let depth = 0;
    do {
      if (text[i] === '"') { string(); continue; }
      if (text[i] === '{' || text[i] === '[') depth++;
      else if (text[i] === '}' || text[i] === ']') depth--;
      i++;
    } while (depth > 0 && i < text.length);
  };
  ws();
  if (text[i] !== '{') throw new Error('not a JSON object');
  i++;
  const headEnd = i;
  ws();
  const members = [];
  if (text[i] === '}') return { head: text.slice(0, headEnd), members, tail: text.slice(headEnd), empty: true };
  let head = null;
  for (;;) {
    const start = i;
    if (head === null) head = text.slice(0, start);
    else members[members.length - 1].sep = text.slice(members[members.length - 1].end, start);
    const key = string();
    ws();
    if (text[i++] !== ':') throw new Error(`expected ':' after "${key}"`);
    ws();
    value();
    if (members.some(m => m.key === key)) throw new Error(`duplicate key "${key}"`);
    members.push({ key, text: text.slice(start, i), end: i, sep: '' });
    ws();
    if (text[i] === ',') { i++; ws(); continue; }
    if (text[i] === '}') break;
    throw new Error(`expected ',' or '}' at offset ${i}`);
  }
  return { head, members, tail: text.slice(members[members.length - 1].end), empty: false };
}

function rebuild(doc) {
  return doc.head + doc.members.map((m, n) => m.text + (n < doc.members.length - 1 ? m.sep : '')).join('') + doc.tail;
}

// The file's own layout: the indentation of its members and the step of each nesting level.
function layout(doc, originalText) {
  const first = doc.members[0];
  if (!first) return { indent: '    ', unit: '    ', sep: ',\n    ' };
  const indent = doc.head.slice(doc.head.lastIndexOf('\n') + 1);
  const inner = first.text.split('\n')[1]?.match(/^\s*/)[0] ?? indent + '    ';
  const unit = inner.length > indent.length ? inner.slice(indent.length) : '    ';
  const sep = doc.members.length > 1 ? doc.members[0].sep : `,${originalText.includes('\r\n') ? '\r\n' : '\n'}${indent}`;
  return { indent, unit, sep };
}

function memberText(key, entry, { indent, unit }, eol) {
  return `${JSON.stringify(key)}: ${JSON.stringify(entry, null, unit).split('\n').join(eol + indent)}`;
}

// edits: Map key -> new entry object (written in place, or inserted after the nearest earlier en key
// present in the file); prune: keys to remove. Returns the new text, checked against the old one.
function editLocale(text, en, edits, prune) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let doc = segment(text);
  const fmt = layout(doc, text);
  if (doc.empty && edits.size > 0) {
    const finalNewline = /\r?\n$/.test(text) ? eol : '';
    doc = { head: `{${eol}${fmt.indent}`, members: [], tail: `${eol}}${finalNewline}`, empty: false };
  }
  const enKeys = Object.keys(en);
  for (const key of enKeys) {
    if (!edits.has(key)) continue;
    const newText = memberText(key, edits.get(key), fmt, eol);
    const existing = doc.members.find(m => m.key === key);
    if (existing) { existing.text = newText; continue; }
    const member = { key, text: newText, sep: fmt.sep };
    const position = enKeys.indexOf(key);
    let anchor = -1;
    for (let p = position - 1; p >= 0 && anchor < 0; p--) anchor = doc.members.findIndex(m => m.key === enKeys[p]);
    if (anchor < 0) {
      doc.members.unshift(member);
    } else {
      doc.members[anchor].sep = doc.members[anchor].sep || fmt.sep;
      doc.members.splice(anchor + 1, 0, member);
    }
    member.sep = member.sep || fmt.sep;
  }
  for (const key of prune) {
    const index = doc.members.findIndex(m => m.key === key);
    if (index >= 0) doc.members.splice(index, 1);
  }
  const result = doc.members.length > 0 ? rebuild(doc) : `{}${/\r?\n$/.test(text) ? eol : ''}`;

  const before = JSON.parse(text.replace(/^﻿/, ''));
  const after = JSON.parse(result.replace(/^﻿/, ''));
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const expected = edits.has(key) ? edits.get(key) : prune.includes(key) ? undefined : before[key];
    if (!isDeepStrictEqual(after[key], expected)) throw new Error(`self-check failed on "${key}", file not written`);
  }
  return result;
}

// ---------------------------------------------------------------- validation

const namedTokens = s => s.replace(/\$\$/g, '').match(/\$[A-Za-z0-9_@]+\$/g)?.map(t => t.toLowerCase()) ?? [];
const positionalTokens = s => s.replace(/\$\$/g, '').replace(/\$[A-Za-z0-9_@]+\$/g, '').match(/\$\d+/g) ?? [];
// Real HTML elements only: prompt texts sent to the model use <words like these> as plain text.
const HTML_ELEMENTS = new Set(['a', 'abbr', 'b', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i',
  'img', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'td', 'th', 'tr', 'u', 'ul']);
const htmlTags = s => (s.match(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g) ?? [])
  .filter(t => HTML_ELEMENTS.has(t.match(/^<\/?([A-Za-z0-9-]+)/)[1].toLowerCase()))
  .map(t => t.replace(/\s+/g, ' '));
const sortedSet = list => [...new Set(list)].sort();
const sortedBag = list => [...list].sort();

function validate(source, translation) {
  if (typeof translation !== 'string' || translation.trim() === '') return 'empty translation';
  const problems = [];
  const compare = (label, a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${label}: expected [${a.join(' ')}], found [${b.join(' ')}]`);
  };
  compare('$name$ placeholders', sortedSet(namedTokens(source)), sortedSet(namedTokens(translation)));
  compare('$n substitutions', sortedSet(positionalTokens(source)), sortedSet(positionalTokens(translation)));
  compare('HTML tags', sortedBag(htmlTags(source)), sortedBag(htmlTags(translation)));
  return problems.length ? problems.join('; ') : null;
}

// ---------------------------------------------------------------- git history of en

let enHistory = null;
// The English message whose hash is `hash`, from the history of en/messages.json, or null.
function previousEnglish(key, hash) {
  if (!hash) return null;
  const messageHash = hash.split(':')[0];
  if (enHistory === null) {
    enHistory = { commits: [], loaded: [] };
    try {
      enHistory.commits = execFileSync('git', ['log', '--format=%H', `-${GIT_HISTORY_LIMIT}`, '--', enRelPath],
        { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    } catch {}
  }
  for (let n = 0; n < enHistory.commits.length; n++) {
    if (enHistory.loaded[n] === undefined) {
      try {
        enHistory.loaded[n] = JSON.parse(execFileSync('git', ['show', `${enHistory.commits[n]}:${enRelPath}`],
          { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
      } catch { enHistory.loaded[n] = {}; }
    }
    const old = enHistory.loaded[n][key];
    if (typeof old?.message === 'string' && sha(old.message) === messageHash) return old.message;
  }
  return null;
}

// ---------------------------------------------------------------- commands

function cmdInit() {
  const { langs } = resolveLanguages(null);
  const en = readEn();
  const baseline = readBaseline() ?? { langs: {} };
  const added = [];
  for (const { folder } of langs) {
    if (baseline.langs[folder]) continue;
    const locale = readJson(localePath(folder));
    baseline.langs[folder] = {};
    for (const key of Object.keys(en)) {
      if (isTranslated(locale[key])) baseline.langs[folder][key] = entryHash(en[key]);
    }
    added.push(`${folder} (${Object.keys(baseline.langs[folder]).length} keys)`);
  }
  if (added.length === 0) {
    console.log('init: every language of LANG_AUTO.md already has a baseline, nothing written.');
    return 0;
  }
  writeBaseline(baseline);
  console.log(`init: baseline recorded in .claude/skills/translate-locales/baseline.json for ${added.join(', ')}.`);
  return 0;
}

function requireBaseline() {
  const baseline = readBaseline();
  if (!baseline) {
    console.error('No .claude/skills/translate-locales/baseline.json: run "init" first.');
    process.exit(2);
  }
  return baseline;
}

function cmdStatus(opts) {
  const baseline = requireBaseline();
  const { langs, unmatched } = resolveLanguages(opts.langs);
  const en = readEn();
  let needsWork = unmatched.length > 0;
  console.log(`${'locale'.padEnd(10)}${'missing'.padStart(9)}${'modified'.padStart(10)}${'obsolete'.padStart(10)}${'work file'.padStart(11)}`);
  for (const { folder } of langs) {
    if (!baseline.langs[folder]) {
      console.log(`${folder.padEnd(10)}  no baseline for this language: run "init"`);
      needsWork = true;
      continue;
    }
    const { missing, modified, obsolete } = analyse(en, readJson(localePath(folder)), baseline.langs[folder]);
    if (missing.length + modified.length + obsolete.length > 0) needsWork = true;
    const work = existsSync(workPath(folder)) ? 'pending' : '-';
    console.log(`${folder.padEnd(10)}${String(missing.length).padStart(9)}${String(modified.length).padStart(10)}${String(obsolete.length).padStart(10)}${work.padStart(11)}`);
  }
  return needsWork ? 1 : 0;
}

function pickReferences(en, locale, baselineLang, exclude) {
  const candidates = Object.keys(en).filter(key => !exclude.has(key) && isTranslated(locale[key])
    && baselineLang[key] === entryHash(en[key]) && en[key].message.length >= 15 && en[key].message.length <= 300);
  const picked = [];
  // A few with placeholders or markup first, then evenly spread over the file (one area each).
  for (const key of candidates.filter(k => /\$|</.test(en[k].message)).slice(0, 3)) picked.push(key);
  const step = Math.max(1, Math.floor(candidates.length / (REFERENCE_COUNT - picked.length)));
  for (let n = 0; n < candidates.length && picked.length < REFERENCE_COUNT; n += step) {
    if (!picked.includes(candidates[n])) picked.push(candidates[n]);
  }
  return Object.fromEntries(picked.map(key => [key, { en: en[key].message, translation: locale[key].message }]));
}

function cmdExtract(opts) {
  const baseline = requireBaseline();
  const { langs } = resolveLanguages(opts.langs);
  const en = readEn();
  for (const { folder } of langs) {
    const baselineLang = baseline.langs[folder];
    if (!baselineLang) { console.log(`${folder}: no baseline for this language, run "init" first.`); continue; }
    const locale = readJson(localePath(folder));
    const { missing, modified } = analyse(en, locale, baselineLang);
    const todo = new Set([...missing, ...modified]);
    // A previous work file keeps the translations already written for the same English text, and
    // its keys come first when --limit cuts the list.
    const previous = existsSync(workPath(folder)) ? readJson(workPath(folder)).entries ?? {} : {};
    let keys = Object.keys(en).filter(key => todo.has(key));
    if (opts.limit) {
      keys = [...keys.filter(key => Object.hasOwn(previous, key)), ...keys.filter(key => !Object.hasOwn(previous, key))]
        .slice(0, opts.limit);
      keys = Object.keys(en).filter(key => keys.includes(key));
    }
    if (keys.length === 0) {
      console.log(`${folder}: nothing to translate.`);
      continue;
    }
    const entries = {};
    for (const key of keys) {
      const hash = entryHash(en[key]);
      const entry = { status: missing.includes(key) ? 'missing' : 'modified', en: en[key].message };
      if (en[key].description) entry.description = en[key].description;
      if (en[key].placeholders) entry.placeholders = en[key].placeholders;
      if (entry.status === 'modified') {
        entry.previous_en = previousEnglish(key, baselineLang[key]);
        entry.current_translation = locale[key].message;
      }
      entry.en_hash = hash;
      entry.translation = previous[key]?.en_hash === hash ? previous[key].translation ?? '' : '';
      entries[key] = entry;
    }
    writeJson(workPath(folder), {
      lang: folder,
      instructions: 'Fill "translation" of every entry; leave everything else as it is. "reference" holds existing translations of this locale, for terminology and tone.',
      entries,
      reference: pickReferences(en, locale, baselineLang, todo),
    });
    const counts = Object.values(entries).reduce((c, e) => (c[e.status]++, c), { missing: 0, modified: 0 });
    const left = todo.size - keys.length;
    console.log(`${folder}: .claude/i18n-work/${folder}.json, ${counts.missing} missing + ${counts.modified} modified${left ? ` (${left} more left for a later extract)` : ''}.`);
  }
  return 0;
}

function cmdApply(opts) {
  const baseline = requireBaseline();
  const { langs } = resolveLanguages(opts.langs);
  const en = readEn();
  let failures = 0;
  for (const { folder } of langs) {
    const baselineLang = baseline.langs[folder];
    if (!baselineLang) { console.log(`${folder}: no baseline for this language, run "init" first.`); continue; }
    const hasWork = existsSync(workPath(folder));
    if (!hasWork && !opts.prune) { console.log(`${folder}: no work file.`); continue; }
    const work = hasWork ? readJson(workPath(folder)) : { entries: {} };
    const text = readFileSync(localePath(folder), 'utf8');
    const locale = JSON.parse(text.replace(/^﻿/, ''));
    const edits = new Map();
    const remaining = {};
    const invalid = [];
    let pending = 0;
    for (const [key, entry] of Object.entries(work.entries)) {
      if (!Object.hasOwn(en, key)) { invalid.push(`${key}: no longer in en, dropped`); continue; }
      if (typeof entry.translation !== 'string' || entry.translation.trim() === '') { pending++; remaining[key] = entry; continue; }
      if (entry.en_hash !== entryHash(en[key])) {
        invalid.push(`${key}: the English text changed after extract, run extract again`);
        remaining[key] = { ...entry, error: 'stale: English changed after extract' };
        continue;
      }
      const problem = validate(en[key].message, entry.translation);
      if (problem) {
        invalid.push(`${key}: ${problem}`);
        remaining[key] = { ...entry, error: problem };
        continue;
      }
      // Keeps the locale's own fields (a description Weblate wrote); placeholders always come from en.
      const updated = { ...(locale[key] ?? {}), message: entry.translation };
      if (en[key].placeholders) updated.placeholders = en[key].placeholders;
      else delete updated.placeholders;
      edits.set(key, updated);
    }
    const prune = opts.prune ? Object.keys(locale).filter(key => !Object.hasOwn(en, key)) : [];
    if (edits.size > 0 || prune.length > 0) {
      try {
        writeFileSync(localePath(folder), editLocale(text, en, edits, prune), 'utf8');
      } catch (e) {
        console.error(`${folder}: ${e.message}`);
        failures++;
        continue;
      }
      for (const key of edits.keys()) baselineLang[key] = entryHash(en[key]);
    }
    if (opts.prune) for (const key of Object.keys(baselineLang)) if (!Object.hasOwn(en, key)) delete baselineLang[key];
    if (hasWork) {
      if (Object.keys(remaining).length === 0) unlinkSync(workPath(folder));
      else writeJson(workPath(folder), { ...work, entries: remaining });
    }
    const parts = [`${edits.size} written`];
    if (prune.length) parts.push(`${prune.length} obsolete pruned`);
    if (invalid.length) parts.push(`${invalid.length} invalid`);
    if (pending) parts.push(`${pending} still untranslated`);
    console.log(`${folder}: ${parts.join(', ')}${hasWork && Object.keys(remaining).length === 0 ? ', work file removed' : ''}.`);
    for (const line of invalid) console.log(`  invalid ${line}`);
    failures += invalid.length;
  }
  writeBaseline(baseline);
  return failures > 0 ? 1 : 0;
}

// ---------------------------------------------------------------- main

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { command: argv[0], langs: null, limit: 0, prune: false };
  for (let n = 1; n < argv.length; n++) {
    const arg = argv[n];
    if (arg === '--langs') {
      opts.langs = [];
      while (n + 1 < argv.length && !argv[n + 1].startsWith('--')) opts.langs.push(...argv[++n].split(',').filter(Boolean));
      if (opts.langs.length === 0) fail('--langs needs at least one language.');
    } else if (arg === '--limit') {
      opts.limit = Number(argv[++n]);
      if (!Number.isInteger(opts.limit) || opts.limit <= 0) fail('--limit needs a positive integer.');
    } else if (arg === '--prune') {
      opts.prune = true;
    } else {
      fail(`Unknown option "${arg}".`);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const commands = { init: cmdInit, status: cmdStatus, extract: cmdExtract, apply: cmdApply };
if (!commands[opts.command]) fail('Usage: node .claude/skills/translate-locales/scripts/i18n.mjs <init|status|extract|apply> [--langs a,b] [--limit N] [--prune]');
process.exitCode = commands[opts.command](opts);
