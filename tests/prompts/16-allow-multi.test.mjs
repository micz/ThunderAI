// Spec 02 "Built-in-only fields" [#979]: allow_multi exists only in the shipped definitions of the
// four multi-message prompts (add tags, spam filter, summarize, translate) and is read from them by
// id (isMultiMessagePrompt()). It is not a prompt property: no prompt object carries it - shipped,
// stored, imported or supplied by the policy - storage never holds it, an export never contains it,
// and a value injected anywhere is dropped and never makes a prompt multi-message.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('16-allow-multi');

let ctx, p;

const CUSTOM = {
    id: 'prompt_user', name: 'Mine', text: 'Mine {%mail_subject%}', type: '1', action: '0',
    need_selected: '0', need_signature: '0', need_custom_text: '0', define_response_lang: '0', use_diff_viewer: '0',
    is_default: '0', is_special: '0', show_in: 'context', allow_multi: true,
};

before(async () => {
    ctx = await startBackground({
        policy: {
            _org_id: 'acme',
            _org_prompts: [{ id: 'multi', name: 'Org multi', text: 'Org {%mail_text_body%}', type: '1', action: '0', allow_multi: true }],
        },
        local: { _custom_prompt: [structuredClone(CUSTOM)] },
    });
    p = ctx.prompts;
});

const hasFlag = list => list.filter(x => 'allow_multi' in x).map(x => x.id);
const stored = key => ctx.ctl.localData()[key] || [];

k.test('helper', 'isMultiMessagePrompt() is true for the four shipped multi-message prompts only', () => {
    for (const id of ['prompt_add_tags', 'prompt_spamfilter', 'prompt_summarize', 'prompt_translate_this']) {
        assert.equal(p.isMultiMessagePrompt(id), true, id);
    }
    for (const id of ['prompt_reply', 'prompt_get_task', 'prompt_summarize_email_template', 'prompt_user', 'org_acme_multi']) {
        assert.equal(p.isMultiMessagePrompt(id), false, id);
    }
});

k.test('no-object-carries-it', 'no prompt object of any view carries allow_multi, custom and policy prompts included', async () => {
    assert.deepEqual(hasFlag(await p.getSpecialPrompts()), [], 'fresh special prompts');
    assert.deepEqual(hasFlag(await p.getPrompts(false, [], true)), [], 'invocation view');
    assert.deepEqual(hasFlag(await p.getPromptsForMenuOrder()), [], 'menu order view');
    const org = (await p.getPrompts(false, [], true)).find(x => x.id === 'org_acme_multi');
    assert.ok(org, 'the policy prompt is loaded');
});

k.test('storage-special', 'saving the special prompts stores no allow_multi, even one injected', async () => {
    const specials = await p.getSpecialPrompts();
    specials.find(x => x.id === 'prompt_get_task').allow_multi = true;
    await p.setSpecialPrompts(specials);
    assert.ok(stored('_special_prompts').length > 0);
    assert.deepEqual(hasFlag(stored('_special_prompts')), []);
});

k.test('stored-special-read', 'a stored special prompt carrying allow_multi is read without it', async () => {
    const raw = structuredClone(stored('_special_prompts'));
    raw.find(x => x.id === 'prompt_get_task').allow_multi = true;
    await ctx.ctl.browser.storage.local.set({ _special_prompts: raw });
    assert.deepEqual(hasFlag(await p.getSpecialPrompts()), []);
    assert.equal(p.isMultiMessagePrompt('prompt_get_task'), false);
});

k.test('storage-custom', 'saving from the options page (savePrompt, setCustomPrompts) stores no allow_multi', async () => {
    await p.savePrompt({ ...structuredClone(CUSTOM), allow_multi: true });
    assert.deepEqual(hasFlag(stored('_custom_prompt')), []);
    await p.setCustomPrompts([{ ...structuredClone(CUSTOM), allow_multi: true }]);
    assert.deepEqual(hasFlag(stored('_custom_prompt')), []);
});

k.test('export', 'an export contains no allow_multi, with or without the API settings, even on an object carrying it', async () => {
    const list = await p.getPromptsForMenuOrder();
    list.forEach(x => { x.allow_multi = true; });
    for (const include of [false, true]) {
        const out = JSON.parse(JSON.stringify(p.preparePromptsForExport(list, include)));
        assert.deepEqual(hasFlag(out), [], 'include_api_settings ' + include);
    }
});

k.test('import', 'an imported file carrying allow_multi gives prompts without it', async () => {
    const file = [
        { ...structuredClone(CUSTOM), id: 'prompt_imported', allow_multi: true },
        { id: 'prompt_reply', show_in: 'both', allow_multi: true },
    ];
    const out = await p.preparePromptsForImport(file);
    assert.ok(out.some(x => x.id === 'prompt_imported'));
    assert.deepEqual(hasFlag(out), []);
});

k.coverage();
