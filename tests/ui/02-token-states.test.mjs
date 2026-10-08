// Spec 03 "Invalid placeholder feedback": the token states the prompt editors show, computed by
// makeTokenStateResolver() / classifyPlaceholderType() (js/mzta-editor-highlight.js) on the list the
// pages really pass them, getPlaceholders(true), with custom placeholders stored. Spec 03 "Custom
// Placeholders" (a disabled one is treated as if it did not exist; a missing `enabled` counts as
// enabled), "Dynamic Placeholders" (an id:value token, spaces around the colon), and the resolver's
// own rules: the type-less question asked first and the type one only on an existing id, the type
// read through the getter on every token, no filtering when there is no type.
//
// The tier matrix on a synthetic list is the prompts area's (tests/prompts/01-find-placeholder);
// the editor that paints these states is tested in the DOM files (customprompts/ui-01, ui-03,
// translate/ui-03).
//
// Level 1: nothing imported here reaches jsdom.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, startBackground } from '../helpers/core/load.mjs';

const CUSTOM = [
    { id: 'thunderai_custom_sig', name: 'Signature', text: 'Ann', type: '0', enabled: 1, is_default: '0', is_dynamic: '0' },
    { id: 'thunderai_custom_reader', name: 'Reader', text: 'r', type: '1', is_default: '0', is_dynamic: '0' },
    { id: 'thunderai_custom_writer', name: 'Writer', text: 'w', type: '2', enabled: '1', is_default: '0', is_dynamic: '0' },
    { id: 'thunderai_custom_off', name: 'Off', text: 'o', type: '0', enabled: 0, is_default: '0', is_dynamic: '0' },
    { id: 'thunderai_custom_off_str', name: 'Off', text: 'o', type: '1', enabled: '0', is_default: '0', is_dynamic: '0' },
    { id: 'thunderai_custom_bare', text: 'b', enabled: 1, is_default: '0', is_dynamic: '0' },
];
const TYPES = ['0', '1', '2'];

let ctx, list, find, hl;
before(async () => {
    ctx = await startBackground({ local: { _custom_placeholder: CUSTOM } });
    const ph = await import(new URL('js/mzta-placeholders.js', REPO).href);
    hl = await import(new URL('js/mzta-editor-highlight.js', REPO).href);
    list = await ph.getPlaceholders(true);
    find = ph.placeholdersUtils.findPlaceholder;
});

const msg = key => ctx.ctl.browser.i18n.getMessage(key);
/** The state of `inner` in a prompt of `type`, as 'valid' | 'error:<key>' | 'warn:<key>'. */
function stateOf(inner, type) {
    const s = hl.makeTokenStateResolver(find, list, () => type)(inner);
    if (s === null || s === undefined) return 'valid';
    assert.equal(s.invalid, true, JSON.stringify(s));
    const key = ['missing', 'unterminated', 'wrong_type', 'partial_type']
        .find(k => s.title === msg('editor_placeholder_' + k));
    assert.ok(key, 'an unknown title: ' + s.title);
    return s.severity + ':' + key;
}

// ---- custom placeholders -------------------------------------------------------------------

test('spec 03 "Custom Placeholders": a disabled custom placeholder (enabled 0 or "0") is red "missing" in every prompt type', () => {
    for (const type of TYPES) {
        assert.equal(stateOf('thunderai_custom_off', type), 'error:missing', type);
        assert.equal(stateOf('thunderai_custom_off_str', type), 'error:missing', type);
    }
});

test('spec 03 "Custom Placeholders": with no `enabled` a custom placeholder is enabled', () => {
    assert.equal(stateOf('thunderai_custom_reader', '1'), 'valid');
});

test('spec 03 "Invalid placeholder feedback": a typed custom placeholder follows the highlight matrix like a built-in', () => {
    assert.deepEqual(TYPES.map(t => stateOf('thunderai_custom_sig', t)), ['valid', 'valid', 'valid']);
    assert.deepEqual(TYPES.map(t => stateOf('thunderai_custom_reader', t)), ['warn:partial_type', 'valid', 'warn:wrong_type']);
    assert.deepEqual(TYPES.map(t => stateOf('thunderai_custom_writer', t)), ['warn:partial_type', 'warn:wrong_type', 'valid']);
});

test('spec 03 "Invalid placeholder feedback": a custom placeholder with no type counts as type 0, valid everywhere', () => {
    assert.deepEqual(TYPES.map(t => stateOf('thunderai_custom_bare', t)), ['valid', 'valid', 'valid']);
});

test('spec 03 "Custom Placeholders": only the prefixed id is the custom placeholder; the bare name is unknown', () => {
    assert.equal(stateOf('sig', '1'), 'error:missing');
});

// ---- built-ins and dynamic tokens on the shipped list ----------------------------------------

test('spec 03 "Invalid placeholder feedback": the shipped list, one placeholder per type, in each prompt type', () => {
    // mail_subject is type 0, mail_folder_name type 1, mail_typed_text type 2 (spec 03 "Built-in Placeholders")
    assert.deepEqual(TYPES.map(t => stateOf('mail_subject', t)), ['valid', 'valid', 'valid']);
    assert.deepEqual(TYPES.map(t => stateOf('mail_folder_name', t)), ['warn:partial_type', 'valid', 'warn:wrong_type']);
    assert.deepEqual(TYPES.map(t => stateOf('mail_typed_text', t)), ['warn:partial_type', 'warn:wrong_type', 'valid']);
});

test('spec 03 "Dynamic Placeholders": a dynamic token with a value is valid where its id is, whatever the spaces around the colon', () => {
    for (const inner of ['mail_headers:x-spam-score', 'mail_headers :x-spam-score', 'mail_headers: x-spam-score', 'mail_headers : x-spam-score']) {
        assert.equal(stateOf(inner, '1'), 'valid', JSON.stringify(inner));
        assert.equal(stateOf(inner, '2'), 'warn:wrong_type', JSON.stringify(inner));
    }
    assert.deepEqual(TYPES.map(t => stateOf('additional_text:tone', t)), ['valid', 'valid', 'valid']);
});

test('spec 03 "Dynamic Placeholders": a fixed placeholder given a value is red "missing"', () => {
    for (const type of TYPES) assert.equal(stateOf('mail_subject:x', type), 'error:missing', type);
});

test('spec 03 "Invalid placeholder feedback": an unterminated token is red, whatever the type', () => {
    for (const type of [...TYPES, null]) assert.equal(stateOf(null, type), 'error:unterminated', String(type));
});

// ---- the resolver's rules ----------------------------------------------------------------------

/** find() wrapped to record the type each question was asked with. */
function spyFind() {
    const asked = [];
    const spy = (inner, l, type) => { asked.push(type); return find(inner, l, type); };
    return { spy, asked };
}

test('spec 03 "Invalid placeholder feedback": the type-less question is asked first; an unknown id costs one question', () => {
    const { spy, asked } = spyFind();
    hl.makeTokenStateResolver(spy, list, () => '1')('no_such_ph');
    assert.deepEqual(asked, [null]);
});

test('spec 03 "Invalid placeholder feedback": an existing id is asked a second time, with the prompt type', () => {
    const { spy, asked } = spyFind();
    const s = hl.makeTokenStateResolver(spy, list, () => '2')('mail_folder_name');
    assert.equal(s?.severity, 'warn');
    assert.deepEqual(asked, [null, '2']);
});

test('spec 03 "Invalid placeholder feedback": the type getter is read on every token, so a type change applies at the next repaint', () => {
    let type = '1';
    let reads = 0;
    const resolve = hl.makeTokenStateResolver(find, list, () => { reads++; return type; });
    assert.equal(resolve('mail_typed_text')?.severity, 'warn');
    type = '2';
    assert.equal(resolve('mail_typed_text'), null);
    assert.equal(reads, 2);
});

test('spec 03 "Invalid placeholder feedback": with no getter, or a getter yielding null / undefined, nothing existing is flagged', () => {
    for (const resolve of [
        hl.makeTokenStateResolver(find, list),
        hl.makeTokenStateResolver(find, list, () => null),
        hl.makeTokenStateResolver(find, list, () => undefined),
    ]) {
        assert.equal(resolve('mail_typed_text'), null);
        assert.equal(resolve('mail_folder_name'), null);
        assert.equal(resolve('no_such_ph')?.severity, 'error', 'an unknown id is red even with no type');
    }
});

test('spec 03 "Invalid placeholder feedback": classifyPlaceholderType() with no type is null, and never red', () => {
    for (const type of [null, undefined]) {
        assert.equal(hl.classifyPlaceholderType(find, list, 'mail_typed_text', type), null);
    }
    for (const type of TYPES) {
        for (const inner of ['mail_subject', 'mail_folder_name', 'mail_typed_text', 'thunderai_custom_bare']) {
            assert.notEqual(hl.classifyPlaceholderType(find, list, inner, type)?.severity, 'error', `${inner} in ${type}`);
        }
    }
});

test('spec 03 "Invalid placeholder feedback": classifyPlaceholderType() decides the type-0 case by the placeholder\'s own type, not by find()', () => {
    // find() accepts every type in a type-0 prompt (the runtime rule); the editor still warns
    assert.ok(find('mail_typed_text', list, '0'));
    assert.equal(hl.classifyPlaceholderType(find, list, 'mail_typed_text', '0')?.title, msg('editor_placeholder_partial_type'));
    assert.equal(hl.classifyPlaceholderType(find, list, 'mail_typed_text', 0)?.title, msg('editor_placeholder_partial_type'), 'a numeric 0');
    assert.equal(hl.classifyPlaceholderType(find, list, 'mail_typed_text', 1)?.title, msg('editor_placeholder_wrong_type'), 'a numeric 1');
});
