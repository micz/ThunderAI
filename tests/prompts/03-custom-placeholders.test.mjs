// Spec 03 "Custom Placeholders" (is_default "0", a `text`, stored in browser.storage.local under
// _custom_placeholder, merged with the built-ins at runtime), "Built-in Placeholders" (the
// defaultPlaceholders array, in source order), "Placeholder Resolution Order" step 2 (custom
// placeholders are expanded first, by replaceCustomPlaceholders()), "A placeholder with no type
// counts as type `0`" (custom placeholders carry a type from the form; an import may not), the
// "Known quirks" (getPlaceholders(true) is unsorted, in declaration order), and spec 05 "Custom
// Data Placeholders" (the thunderai_custom_ id prefix).

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('03-custom-placeholders');

let ctx, m, ph;

// The built-in ids of spec 03 "Built-in Placeholders", in the table's (source) order.
const BUILT_IN_IDS = [
    'mail_text_body', 'mail_html_body', 'mail_typed_text', 'mail_quoted_text', 'mail_subject',
    'mail_folder_name', 'mail_folder_path', 'mail_headers', 'mail_full_headers', 'selected_text',
    'selected_html', 'additional_text', 'junk_score', 'recipients', 'cc_list', 'author',
    'mail_datetime', 'current_datetime', 'account_email_address', 'tags_current_email',
    'tags_full_list', 'thunderai_def_sign', 'thunderai_def_lang', 'thunderai_translate_lang',
    'thunderai_translate_exclude_lang', 'empty', 'mail_attachments_info',
    'mail_text_body_or_selected', 'mail_html_body_or_selected', 'mail_plain_text_part',
];
// The Dyn column of the same table.
const DYNAMIC_IDS = ['mail_headers', 'additional_text'];
// The Type column of the same table: every id not listed here is type 0.
const TYPE_1 = ['mail_folder_name', 'mail_folder_path', 'mail_headers', 'mail_full_headers', 'junk_score',
    'mail_datetime', 'mail_attachments_info', 'mail_plain_text_part'];
const TYPE_2 = ['mail_typed_text', 'mail_quoted_text'];

before(async () => {
    ctx = await startBackground({ policy: null });
    m = await import(new URL('js/mzta-placeholders.js', REPO).href);
    ph = m.placeholdersUtils;
});

// --- The id prefix ----------------------------------------------------------------------------

k.test('prefix-added', 'validateCustomDataPH_ID() gives an id the thunderai_custom_ prefix', () => {
    assert.equal(ph.validateCustomDataPH_ID('sig'), 'thunderai_custom_sig');
});

k.test('prefix-not-doubled', 'an id that already has the prefix is left as it is', () => {
    assert.equal(ph.validateCustomDataPH_ID('thunderai_custom_sig'), 'thunderai_custom_sig');
});

k.test('prefix-stripped', 'stripCustomDataPH_ID_Prefix() removes the prefix, and only the prefix', () => {
    assert.equal(ph.stripCustomDataPH_ID_Prefix('thunderai_custom_sig'), 'sig');
    assert.equal(ph.stripCustomDataPH_ID_Prefix('sig'), 'sig');
    assert.equal(ph.stripCustomDataPH_ID_Prefix('my_thunderai_custom_sig'), 'my_thunderai_custom_sig');
});

k.test('prefix-round-trips', 'add then strip, and strip then add, give back the input', () => {
    for (const id of ['sig', 'a_b', 'thunderai_custom']) {
        assert.equal(ph.stripCustomDataPH_ID_Prefix(ph.validateCustomDataPH_ID(id)), id, id);
    }
    for (const id of ['thunderai_custom_sig', 'thunderai_custom_a_b']) {
        assert.equal(ph.validateCustomDataPH_ID(ph.stripCustomDataPH_ID_Prefix(id)), id, id);
    }
    assert.equal(ph.validateCustomDataPH_ID(ph.validateCustomDataPH_ID('sig')), 'thunderai_custom_sig', 'idempotent');
});

// --- The built-ins ------------------------------------------------------------------------------

k.test('built-ins-in-source-order', 'getPlaceholders(true) lists the 30 built-ins in declaration order, first', async () => {
    const list = await m.getPlaceholders(true);
    assert.deepEqual(list.slice(0, BUILT_IN_IDS.length).map(p => p.id), BUILT_IN_IDS);
});

k.test('built-ins-properties', 'every built-in has is_default "1", its table type and its Dyn flag', async () => {
    const list = (await m.getPlaceholders(true)).filter(p => BUILT_IN_IDS.includes(p.id));
    assert.equal(list.length, 30);
    for (const p of list) {
        assert.equal(p.is_default, '1', p.id);
        const type = TYPE_1.includes(p.id) ? 1 : TYPE_2.includes(p.id) ? 2 : 0;
        assert.equal(Number(p.type), type, p.id + ' type');
        assert.equal(p.is_dynamic, DYNAMIC_IDS.includes(p.id) ? '1' : '0', p.id + ' is_dynamic');
        assert.equal(typeof p.default_value, 'string', p.id + ' default_value');
    }
});

// --- Storage ----------------------------------------------------------------------------------

k.test('none-stored', 'with nothing stored there are no custom placeholders', async () => {
    assert.deepEqual(await m.getCustomPlaceholders(), []);
    assert.equal((await m.getPlaceholders()).length, 30);
});

k.test('set-stores', 'setCustomPlaceholders() stores under _custom_placeholder, prefixed, is_default "0"', async () => {
    await m.setCustomPlaceholders([
        { id: 'sig', name: 'Signature', text: 'Best, Mic', type: '0', enabled: 1 },
        { id: 'thunderai_custom_team', name: 'Team', text: 'The team', type: '2', enabled: 0 },
    ]);
    const stored = ctx.ctl.localData()._custom_placeholder;
    assert.deepEqual(stored.map(p => p.id), ['thunderai_custom_sig', 'thunderai_custom_team']);
    for (const p of stored) {
        assert.equal(p.is_default, '0', p.id);
        assert.equal(p.is_dynamic, '0', p.id + ': a custom placeholder takes no parameter');
    }
    assert.equal(stored[0].text, 'Best, Mic');
    assert.equal(stored[1].type, '2', 'the type from the form is stored as it came');
});

k.test('get-reads-back', 'getCustomPlaceholders() reads back what was stored', async () => {
    const list = await m.getCustomPlaceholders();
    assert.deepEqual(list.map(p => [p.id, p.text]), [['thunderai_custom_sig', 'Best, Mic'], ['thunderai_custom_team', 'The team']]);
});

k.test('merged-sorted', 'getPlaceholders() merges built-ins and customs, sorted by id', async () => {
    const ids = (await m.getPlaceholders()).map(p => p.id);
    assert.equal(ids.length, 32);
    assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));
    assert.ok(ids.includes('thunderai_custom_sig') && ids.includes('thunderai_custom_team'));
});

k.test('only-enabled', 'getPlaceholders(true) drops a disabled placeholder and keeps declaration order', async () => {
    const ids = (await m.getPlaceholders(true)).map(p => p.id);
    assert.deepEqual(ids, [...BUILT_IN_IDS, 'thunderai_custom_sig']);
});

// --- Expansion (resolution order, step 2) -----------------------------------------------------

k.test('expand-custom', 'replaceCustomPlaceholders() puts the custom text in place of its token', async () => {
    assert.equal(await ph.replaceCustomPlaceholders('Regards. {%thunderai_custom_sig%}'), 'Regards. Best, Mic');
    assert.equal(await ph.replaceCustomPlaceholders('{% thunderai_custom_sig %}'), 'Best, Mic');
});

k.test('expand-disabled-custom', 'a disabled custom placeholder is not expanded: its token stays as written', async () => {
    // thunderai_custom_team was stored with enabled: 0 (set-stores above).
    assert.equal(await ph.replaceCustomPlaceholders('Team: {%thunderai_custom_team%}'), 'Team: {%thunderai_custom_team%}');
    assert.equal(await ph.replaceCustomPlaceholders('{%thunderai_custom_sig%} {%thunderai_custom_team%}'), 'Best, Mic {%thunderai_custom_team%}');
});

k.test('expand-enabled-missing', 'a custom placeholder with no enabled field counts as enabled', async () => {
    const stored = await m.getCustomPlaceholders();
    await ctx.ctl.browser.storage.local.set({ _custom_placeholder: [...stored,
        { id: 'thunderai_custom_legacy', name: 'Legacy', text: 'L', type: '0', is_default: '0', is_dynamic: '0' }] });
    assert.equal(await ph.replaceCustomPlaceholders('{%thunderai_custom_legacy%}'), 'L');
    await ctx.ctl.browser.storage.local.set({ _custom_placeholder: stored });
});

k.test('expand-unknown-custom', 'an unknown custom token stays as it is', async () => {
    assert.equal(await ph.replaceCustomPlaceholders('{%thunderai_custom_nope%}'), '{%thunderai_custom_nope%}');
});

k.test('expand-leaves-built-ins', 'built-in tokens, also inside a custom text, are left for the later steps', async () => {
    await m.setCustomPlaceholders([
        ...(await m.getCustomPlaceholders()),
        { id: 'about', name: 'About', text: 'About {%mail_subject%}', type: '0', enabled: 1 },
    ]);
    assert.equal(await ph.replaceCustomPlaceholders('{%thunderai_custom_about%} {%mail_text_body%}'),
        'About {%mail_subject%} {%mail_text_body%}');
});

// --- Export / import ----------------------------------------------------------------------------

k.test('export-import-round-trip', 'an export imported back gives the same placeholders', async () => {
    const before = await m.getCustomPlaceholders();
    const exported = JSON.parse(JSON.stringify(m.prepareCustomDataPHsForExport(structuredClone(before))));
    const imported = await m.prepareCustomDataPHsForImport(exported);
    const byId = list => Object.fromEntries(list.map(p => [p.id, p]));
    assert.deepEqual(byId(imported), byId(before));
});

k.test('export-no-idnum', 'the export carries no idnum (a view row number)', () => {
    const out = m.prepareCustomDataPHsForExport([{ id: 'thunderai_custom_x', is_default: '0', idnum: 3, text: 't' }]);
    assert.equal('idnum' in out[0], false);
    assert.equal(out[0].text, 't');
});

k.test('import-merges', 'an import updates a placeholder by id and adds a new one', async () => {
    const imported = await m.prepareCustomDataPHsForImport([
        { id: 'thunderai_custom_sig', text: 'Cheers' },
        { id: 'thunderai_custom_new', name: 'New', text: 'N', is_default: '0', enabled: 1 },
    ]);
    const sig = imported.find(p => p.id === 'thunderai_custom_sig');
    assert.equal(sig.text, 'Cheers');
    assert.equal(sig.name, 'Signature', 'the keys the import does not carry are kept');
    assert.ok(imported.some(p => p.id === 'thunderai_custom_new'));
    assert.equal(imported.length, 4);
});

k.test('import-unprefixed-id', 'an imported id without the prefix updates the existing placeholder, never duplicates it', async () => {
    const before = await m.getCustomPlaceholders();
    const imported = await m.prepareCustomDataPHsForImport([
        { id: 'sig', text: 'Ciao' },
        { id: 'brand_new', name: 'N', text: 'n', is_default: '0', enabled: 1 },
    ]);
    assert.equal(imported.filter(p => p.id === 'thunderai_custom_sig').length, 1);
    assert.equal(imported.find(p => p.id === 'thunderai_custom_sig').text, 'Ciao');
    assert.ok(imported.some(p => p.id === 'thunderai_custom_brand_new'), 'a new one is prefixed too');
    assert.equal(imported.some(p => p.id === 'sig' || p.id === 'brand_new'), false);
    assert.equal(imported.length, before.length + 1);
});

k.test('import-no-id-skipped', 'an imported entry without a usable id is skipped, never an error', async () => {
    const before = await m.getCustomPlaceholders();
    const imported = await m.prepareCustomDataPHsForImport([{ text: 'no id' }, { id: '  ', text: 'blank' }, { id: 7, text: 'number' }, null]);
    assert.equal(imported.length, before.length);
});

k.test('import-without-type-usable', 'an imported placeholder with no type is usable in every prompt type', async () => {
    const imported = await m.prepareCustomDataPHsForImport([
        { id: 'thunderai_custom_untyped', name: 'U', text: 'u', is_default: '0', enabled: 1 },
    ]);
    await m.setCustomPlaceholders(imported);
    const list = await m.getPlaceholders(true);
    for (const type of [null, '0', '1', '2']) {
        assert.equal(ph.findPlaceholder('thunderai_custom_untyped', list, type)?.id, 'thunderai_custom_untyped', String(type));
    }
});

k.coverage();
