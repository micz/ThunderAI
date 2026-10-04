// Spec 03 "Invalid placeholder feedback": placeholdersUtils.findPlaceholder(inner, list, type), the
// one resolution predicate shared by the runtime (extractPlaceholders()), the live editor and the
// read mode; "A placeholder with no type counts as type `0`"; "Dynamic Placeholders" (`id:value`
// matches only an is_dynamic placeholder). Then the editor's two tiers built on it, as far as they
// are level-1 functions: makeTokenStateResolver() / classifyPlaceholderType() in
// js/mzta-editor-highlight.js, against the spec's state table and highlight matrix. Their DOM side
// (chips, tooltips, the mirror) is out of scope.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('01-find-placeholder');

let ctx, ph, hl;

// A small placeholder list, one per kind the spec distinguishes. The type is a number on the
// built-ins (spec 03 "Placeholder Properties") and may be a string or missing on a custom one.
const LIST = [
    { id: 'always', type: 0, is_dynamic: '0' },
    { id: 'reading', type: 1, is_dynamic: '0' },
    { id: 'composing', type: 2, is_dynamic: '0' },
    { id: 'notype_missing', is_dynamic: '0' },
    { id: 'notype_null', type: null, is_dynamic: '0' },
    { id: 'notype_blank', type: ' ', is_dynamic: '0' },
    { id: 'dyn_reading', type: 1, is_dynamic: '1' },
    { id: 'dyn_always', type: 0, is_dynamic: '1' },
    { id: 'string_reading', type: '1', is_dynamic: '0' },
];

before(async () => {
    ctx = await startBackground({ policy: null });
    const mod = await import(new URL('js/mzta-placeholders.js', REPO).href);
    ph = mod.placeholdersUtils;
    hl = await import(new URL('js/mzta-editor-highlight.js', REPO).href);
});

const find = (inner, type = null) => {
    const found = ph.findPlaceholder(inner, LIST, type);
    return found ? found.id : null;
};

// --- The type matrix --------------------------------------------------------------------
// Spec: with no type the type is ignored entirely (extractPlaceholders()); a prompt of type '0'
// accepts placeholders of ANY type ("such a prompt runs in both contexts"); a type '1'/'2' prompt
// accepts a placeholder of its own type or of type '0'; a placeholder with no type counts as '0'.
// One row per (prompt type, placeholder kind); the expected value is the matched id or null.

const MATRIX = [
    // inner             null         '0'          '1'          '2'
    ['always',          'always',    'always',    'always',    'always'],
    ['reading',         'reading',   'reading',   'reading',   null],
    ['composing',       'composing', 'composing', null,        'composing'],
    ['notype_missing',  'notype_missing', 'notype_missing', 'notype_missing', 'notype_missing'],
    ['notype_null',     'notype_null',    'notype_null',    'notype_null',    'notype_null'],
    ['notype_blank',    'notype_blank',   'notype_blank',   'notype_blank',   'notype_blank'],
    ['string_reading',  'string_reading', 'string_reading', 'string_reading', null],
    ['dyn_reading:x',   'dyn_reading', 'dyn_reading', 'dyn_reading', null],
    ['dyn_always:x',    'dyn_always',  'dyn_always',  'dyn_always',  'dyn_always'],
    ['unknown',         null,        null,        null,        null],
];
const TYPES = [null, '0', '1', '2'];

for (const [inner, ...expected] of MATRIX) {
    TYPES.forEach((type, i) => {
        k.test(`matrix-${inner.replace(/[^a-z0-9]+/g, '-')}-${type ?? 'none'}`,
            `findPlaceholder("${inner}", list, ${JSON.stringify(type)}) -> ${JSON.stringify(expected[i])}`, () => {
                assert.equal(find(inner, type), expected[i]);
            });
    });
}

k.test('prompt-type-as-number', 'a prompt type given as a number decides like its string', () => {
    assert.equal(find('composing', 1), null);
    assert.equal(find('reading', 1), 'reading');
    assert.equal(find('composing', 0), 'composing');
});

// --- Dynamic placeholders -----------------------------------------------------------------

k.test('dynamic-bare-id', 'a dynamic placeholder also matches by its bare id', () => {
    assert.equal(find('dyn_reading'), 'dyn_reading');
});

k.test('fixed-takes-no-parameter', 'a fixed placeholder (is_dynamic "0") does not match id:value', () => {
    assert.equal(find('always:x'), null);
    assert.equal(find('reading:x', '1'), null);
});

k.test('dynamic-needs-colon', 'a dynamic id is matched as id:..., never as a prefix of a longer id', () => {
    assert.equal(find('dyn_readingX'), null);
    assert.equal(find('dyn_reading_more:x'), null);
});

k.test('dynamic-built-ins', 'the built-in dynamic placeholders take a parameter (spec examples)', async () => {
    const { getPlaceholders } = await import(new URL('js/mzta-placeholders.js', REPO).href);
    const list = await getPlaceholders(true);
    assert.equal(ph.findPlaceholder('additional_text:my_field_id', list)?.id, 'additional_text');
    assert.equal(ph.findPlaceholder('mail_headers:x-spam-score', list)?.id, 'mail_headers');
    assert.equal(ph.findPlaceholder('mail_subject:x', list), null);
});

// --- The token forms ------------------------------------------------------------------------

k.test('inner-whitespace', 'surrounding spaces of the inner text are ignored, like the token regex', () => {
    assert.equal(find(' always '), 'always');
});

k.test('no-inner-no-list', 'an empty inner text or a missing list matches nothing', () => {
    assert.equal(ph.findPlaceholder('', LIST), null);
    assert.equal(ph.findPlaceholder(null, LIST), null);
    assert.equal(ph.findPlaceholder('always', null), null);
    assert.equal(ph.findPlaceholder('always', undefined), null);
});

k.test('returns-the-entry', 'a match returns the list entry itself', () => {
    assert.equal(ph.findPlaceholder('reading', LIST, '1'), LIST[1]);
});

// --- extractPlaceholders(): the runtime caller ------------------------------------------------
// Spec: it omits the type, so it ignores type entirely; a dynamic token comes back as a copy
// carrying the value.

k.test('extract-ignores-type', 'extractPlaceholders() finds placeholders of every type', async () => {
    const found = await ph.extractPlaceholders('{%mail_typed_text%} {%mail_folder_name%} {%mail_subject%} {%nope%}');
    assert.deepEqual(found.map(p => p.id), ['mail_typed_text', 'mail_folder_name', 'mail_subject']);
});

k.test('extract-dynamic-copy', 'extractPlaceholders() returns a dynamic token as a copy with its value', async () => {
    const { getPlaceholders } = await import(new URL('js/mzta-placeholders.js', REPO).href);
    const found = await ph.extractPlaceholders('{% mail_headers:X-Spam %}');
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'mail_headers');
    assert.equal(found[0].custom_value, 'X-Spam');
    const original = (await getPlaceholders(true)).find(p => p.id === 'mail_headers');
    assert.equal('custom_value' in original, false, 'the shipped definition is not modified');
});

// --- The two tiers (makeTokenStateResolver / classifyPlaceholderType) -----------------------------
// Spec state table: valid -> nothing; unknown id -> error (red); unterminated -> error (red);
// exists but not for this type at all -> warn (amber, wrong_type); exists but resolves in one of a
// type-0 prompt's two contexts -> warn (amber, partial_type). Highlight matrix: rows are the prompt
// type, columns the placeholder's own type; "no type" is normal everywhere.

const msg = id => ctx.ctl.browser.i18n.getMessage(id);
const stateOf = (inner, type) => hl.makeTokenStateResolver(
    (i, l, t) => ph.findPlaceholder(i, l, t), LIST, () => type)(inner);

k.test('tier-unknown-red', 'an id that does not exist is red, whatever the prompt type', () => {
    for (const type of TYPES) {
        const s = stateOf('unknown', type);
        assert.equal(s?.invalid, true, String(type));
        assert.equal(s.severity, 'error', String(type));
        assert.equal(s.title, msg('editor_placeholder_missing'));
    }
});

k.test('tier-unterminated-red', 'an unterminated token (inner === null) is red', () => {
    const s = stateOf(null, '1');
    assert.equal(s?.severity, 'error');
    assert.equal(s.title, msg('editor_placeholder_unterminated'));
});

const HIGHLIGHT = [
    // prompt type, placeholder -> null (normal) | 'wrong_type' | 'partial_type'
    ['0', 'always', null], ['0', 'reading', 'partial_type'], ['0', 'composing', 'partial_type'], ['0', 'notype_missing', null],
    ['1', 'always', null], ['1', 'reading', null], ['1', 'composing', 'wrong_type'], ['1', 'notype_missing', null],
    ['2', 'always', null], ['2', 'reading', 'wrong_type'], ['2', 'composing', null], ['2', 'notype_missing', null],
    ['0', 'dyn_reading:x', 'partial_type'], ['2', 'dyn_reading:x', 'wrong_type'], ['1', 'notype_blank', null],
];

for (const [type, inner, expected] of HIGHLIGHT) {
    k.test(`highlight-${type}-${inner.replace(/[^a-z0-9]+/g, '-')}`,
        `prompt type ${type}, placeholder "${inner}" -> ${expected ?? 'normal'}`, () => {
            const s = stateOf(inner, type);
            if (expected === null) { assert.equal(s, null); return; }
            assert.equal(s?.invalid, true);
            assert.equal(s.severity, 'warn', 'amber, never red: the placeholder exists');
            assert.equal(s.title, msg('editor_placeholder_' + expected));
        });
}

k.test('highlight-no-type', 'with no prompt type nothing existing is flagged (read mode with a null type)', () => {
    for (const inner of ['always', 'reading', 'composing', 'notype_missing']) assert.equal(stateOf(inner, null), null, inner);
});

k.coverage();
