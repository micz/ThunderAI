// .github/scripts/policy-keys-diff.mjs, the report behind .github/workflows/policy-docs-issue.yml
// (spec 08 "Adding a policy-settable preference": the administrator key reference on micz.it is
// updated by hand, the workflow tracks that it has to be). Run as the workflow runs it, a child
// process with GITHUB_OUTPUT set, on the fixtures of tests/fixtures/ci/ (cut-down copies of the
// two files, never the real ones): base and head differ by one case of each category.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { repoPath } from '../helpers/core/load.mjs';

const SCRIPT = repoPath('.github/scripts/policy-keys-diff.mjs');
const BASE = repoPath('tests/fixtures/ci/base');
const HEAD = repoPath('tests/fixtures/ci/head');

function run(oldDir, newDir) {
    const tmp = mkdtempSync(join(tmpdir(), 'ci-policy-'));
    try {
        const out = join(tmp, 'out.md');
        const gho = join(tmp, 'github_output');
        writeFileSync(gho, '');
        const stdout = execFileSync(process.execPath, [SCRIPT, oldDir, newDir, out], {
            env: { ...process.env, GITHUB_OUTPUT: gho }, encoding: 'utf8',
        });
        return { report: readFileSync(out, 'utf8'), stdout, output: readFileSync(gho, 'utf8') };
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// A revision built in a temporary dir from the fixtures, edited by edit(relPath, text).
function variant(from, files, edit = (p, t) => t) {
    const dir = mkdtempSync(join(tmpdir(), 'ci-policy-rev-'));
    for (const rel of files) {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), edit(rel, readFileSync(join(from, rel), 'utf8')));
    }
    return dir;
}

const changed = run(BASE, HEAD);
const section = title => {
    const start = changed.report.indexOf('## ' + title + '\n');
    assert.notEqual(start, -1, 'no section "' + title + '"');
    const next = changed.report.indexOf('\n## ', start + 1);
    return changed.report.slice(start, next === -1 ? undefined : next);
};

test('a change sets changed=true, and the report is printed as written', () => {
    assert.equal(changed.output, 'changed=true\n');
    assert.equal(changed.stdout, changed.report);
    assert.ok(changed.report.startsWith('`prefs_default`: 6 → 9 keys, 6 of 9 policy-settable'));
});

test('an added key, with its default as JSON and policy-settable', () => {
    assert.ok(section('Preferences added').includes('| `new_option` | `"x"` | policy-settable |'));
});

test('an added generated key (a new integration_options_config field)', () => {
    assert.ok(section('Preferences added').includes('| `openai_comp_model` | `"gpt"` | policy-settable |'));
});

test('an added key matched by an exclusion rule is marked excluded, by an old or a new rule', () => {
    const added = section('Preferences added');
    assert.ok(added.includes('| `chatgpt_win_height` | `500` | excluded |'));
    assert.ok(added.includes('| `api_webchat_font_scale` | `1` | excluded |'));
});

test('a removed key, with its old default', () => {
    assert.ok(section('Preferences removed').includes('| `old_option` | `true` |'));
});

test('a changed default, flagged for _lock_unlisted', () => {
    const s = section('Defaults changed');
    assert.ok(s.includes('| `reply_type` | `"reply_all"` | `"reply_sender"` |'));
    assert.ok(s.includes('`_lock_unlisted`'));
    assert.ok(!s.includes('`do_debug`'), 'an unchanged default is reported');
});

test('structural policy keys added and removed', () => {
    const s = section('Structural policy keys');
    assert.ok(s.includes('| `_new_switch` | added |'));
    assert.ok(s.includes('| `_old_switch` | removed |'));
    assert.ok(!s.includes('`_org_name`'), 'an unchanged policy key is reported');
});

test('a changed exclusion rule, only the declaration that changed', () => {
    const s = section('Exclusion rules changed');
    assert.ok(s.includes('### `EXCLUDED_KEYS`'));
    assert.ok(!s.includes('### `EXCLUDED_KEY_PATTERNS`'));
    assert.ok(s.includes("'api_webchat_font_scale',"));
    assert.ok(!s.includes('local UI zoom'), 'comments are not part of the rule');
});

test('no change: empty report, changed=false', () => {
    const r = run(BASE, BASE);
    assert.equal(r.report, '');
    assert.equal(r.output, 'changed=false\n');
});

test('comments and whitespace in the exclusion rules are not a change', () => {
    const edits = [
        ['// window geometry, per machine', '// window position and size, per machine'],
        ['const EXCLUDED_KEYS = new Set([\n]);', '/* none yet */\nconst EXCLUDED_KEYS = new Set([  ]);'],
        ['    /^chatgpt_win_/,', '  /^chatgpt_win_/ ,'],
    ];
    const dir = variant(BASE, ['options/mzta-options-default.js', 'js/mzta-managed.js'], (rel, text) => {
        if (!rel.startsWith('js')) return text;
        text = text.replace(/\r\n/g, '\n');   // a Windows checkout
        for (const [from, to] of edits) {
            assert.ok(text.includes(from), 'fixture changed, edit not applied: ' + from);
            text = text.replace(from, to);
        }
        return text;
    });
    try {
        const r = run(BASE, dir);
        assert.equal(r.report, '');
        assert.equal(r.output, 'changed=false\n');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a base without js/mzta-managed.js has no policy keys and no exclusions', () => {
    const dir = variant(BASE, ['options/mzta-options-default.js']);
    try {
        const r = run(dir, HEAD);
        assert.equal(r.output, 'changed=true\n');
        assert.ok(r.report.includes('| `_org_name` | added |'));
        assert.ok(!r.report.includes('removed |\n'), 'a policy key reported as removed');
        assert.ok(r.report.includes('Before:\n\n```js\n(not declared)\n```'));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('an options file with an import fails with a clear message', () => {
    const dir = variant(BASE, ['options/mzta-options-default.js'], (rel, text) =>
        "import { x } from './x.js';\n" + text);
    try {
        const r = spawnSync(process.execPath, [SCRIPT, dir, HEAD, join(dir, 'out.md')], { encoding: 'utf8' });
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /has an import/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
