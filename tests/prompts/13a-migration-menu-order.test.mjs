// Spec 02 "Alphabetic-to-Position Migration": with dynamic_menu_order_alphabet unset (it defaults to
// true), migrateMenuOrderAlphabetic() sorts every visible prompt - special prompts first,
// alphabetically, then the rest, alphabetically - assigns sequential position_display =
// position_compose = position_context, leaves the hidden special prompts untouched, persists through
// setDefaultPromptsProperties() / setCustomPrompts() / setSpecialPrompts(), and sets the flag to
// false so it never runs again. The flag lives in the same area as PREFS_AREA (spec 05
// "dynamic_menu_order_alphabet", "Preference access"), storage.local.
//
// It runs once on a real user's data and cannot be retried: so beyond the order, nothing the user
// owns may be lost or altered - custom prompt texts and overrides, special prompt texts, show_in.
// The unmanaged half only: organization prompts are spec 08a (tests/managed/12).

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('13a-migration-menu-order');

const HIDDEN = ['prompt_summarize_email_template', 'prompt_summarize_email_separator'];

// An older profile: hand-set positions, a custom prompt hidden from every menu, overrides, a user
// text on a special prompt, and a hidden special prompt that already carries a position.
const STORED = {
    _default_prompts_properties: {
        prompt_reply: { position_display: 9, position_compose: 9, position_context: 9, need_custom_text: '0', show_in: 'popup' },
        prompt_this: { position_display: 2, position_compose: 2, position_context: 2, need_custom_text: '0', show_in: 'none',
                       api_type: 'ollama_api', custom_icon: 'star.png' },
    },
    _custom_prompt: [
        { id: 'prompt_zeta', name: 'Zeta summary', text: 'Zeta {%mail_text_body%}', type: '1', action: '0',
          is_default: '0', is_special: '0', show_in: 'both', position_display: 1, position_compose: 1, position_context: 1,
          api_type: 'ollama_api', ollama_model: 'llama3', need_signature: '1' },
        { id: 'prompt_alpha', name: 'alpha draft', text: 'Alpha', type: '2', action: '2',
          is_default: '0', is_special: '0', show_in: 'none' },
    ],
    _special_prompts: [
        { id: 'prompt_spamfilter', name: '__MSG_prompt_spamfilter__', text: 'My spam text {%mail_text_body%} spamValue explanation',
          type: '1', action: '0', is_default: '1', is_special: '1', show_in: 'context', custom_icon: 'shield.png' },
        { id: 'prompt_summarize_email_template', name: '__MSG_prompt_summarize_email_template__', text: 'My template {%mail_text_body%}',
          type: '1', action: '0', is_default: '1', is_special: '1', show_in: 'none',
          position_display: 77, position_compose: 77, position_context: 77 },
    ],
};

let ctx, p, expectedOrder, before_;

const resolveName = name => {
    const m = /^__MSG_(.+)__$/.exec(name || '');
    return m ? ctx.ctl.browser.i18n.getMessage(m[1]) : (name || '');
};

before(async () => {
    ctx = await startBackground({ policy: null, local: structuredClone(STORED) });
    p = ctx.prompts;
    // The expected order, from the spec rule applied to the prompts as they are before the run.
    before_ = await p.getPromptsForMenuOrder();
    const visible = before_.filter(x => !HIDDEN.includes(x.id));
    const alpha = list => [...list].sort((a, b) => resolveName(a.name).localeCompare(resolveName(b.name)));
    expectedOrder = [
        ...alpha(visible.filter(x => String(x.is_special) === '1')),
        ...alpha(visible.filter(x => String(x.is_special) !== '1')),
    ].map(x => x.id);
    await p.migrateMenuOrderAlphabetic();
});

const local = key => ctx.ctl.localData()[key];
const positionsOf = id => {
    const sources = [
        local('_default_prompts_properties')?.[id],
        (local('_custom_prompt') || []).find(x => x.id === id),
        (local('_special_prompts') || []).find(x => x.id === id),
    ].filter(Boolean);
    assert.equal(sources.length, 1, `${id} is stored in exactly one store`);
    const s = sources[0];
    return [s.position_display, s.position_compose, s.position_context];
};

k.test('flag-cleared', 'the flag is set to false, in storage.local (the PREFS_AREA)', () => {
    assert.equal(local('dynamic_menu_order_alphabet'), false);
});

k.test('expected-order-sanity', 'the scenario has special prompts, built-ins and custom prompts to sort', () => {
    assert.ok(expectedOrder.length >= 7 + 8 + 2, expectedOrder.join(', '));
    assert.ok(expectedOrder.indexOf('prompt_zeta') > expectedOrder.indexOf('prompt_spamfilter'));
});

k.test('positions-sequential', 'every visible prompt gets 1..N in the spec order, the three positions equal', () => {
    expectedOrder.forEach((id, i) => assert.deepEqual(positionsOf(id), [i + 1, i + 1, i + 1], id));
});

k.test('specials-first', 'the special prompts take the first positions', () => {
    const specials = expectedOrder.filter(id => before_.find(x => x.id === id).is_special === '1');
    assert.equal(specials.length, 7);
    specials.forEach(id => assert.ok(positionsOf(id)[0] <= 7, id));
});

k.test('hidden-specials-untouched', 'the hidden special prompts are not repositioned', () => {
    const template = local('_special_prompts').find(x => x.id === 'prompt_summarize_email_template');
    assert.deepEqual([template.position_display, template.position_compose, template.position_context], [77, 77, 77]);
    assert.equal(template.text, 'My template {%mail_text_body%}');
    const separator = local('_special_prompts').find(x => x.id === 'prompt_summarize_email_separator');
    assert.ok(separator, 'still stored');
    assert.equal(separator.position_display, undefined);
});

k.test('custom-prompts-kept', 'no custom prompt is lost, and none is added', () => {
    assert.deepEqual(local('_custom_prompt').map(x => x.id).sort(), ['prompt_alpha', 'prompt_zeta']);
});

k.test('custom-fields-kept', 'a custom prompt keeps its text, its override and its show_in', () => {
    const zeta = local('_custom_prompt').find(x => x.id === 'prompt_zeta');
    assert.equal(zeta.text, 'Zeta {%mail_text_body%}');
    assert.equal(zeta.api_type, 'ollama_api');
    assert.equal(zeta.ollama_model, 'llama3');
    assert.equal(zeta.show_in, 'both');
    assert.equal(zeta.need_signature, '1');
    assert.equal(local('_custom_prompt').find(x => x.id === 'prompt_alpha').show_in, 'none', 'an unreachable prompt stays unreachable');
});

k.test('default-props-kept', 'a built-in prompt keeps its show_in, override and icon', () => {
    const props = local('_default_prompts_properties');
    assert.equal(props.prompt_this.show_in, 'none');
    assert.equal(props.prompt_this.api_type, 'ollama_api');
    assert.equal(props.prompt_this.custom_icon, 'star.png');
    assert.equal(Object.keys(props).length, 8, 'one entry per built-in prompt');
    for (const entry of Object.values(props)) assert.equal('text' in entry, false);
});

k.test('special-texts-kept', 'a special prompt keeps the user text and icon', () => {
    const spam = local('_special_prompts').find(x => x.id === 'prompt_spamfilter');
    assert.equal(spam.text, 'My spam text {%mail_text_body%} spamValue explanation');
    assert.equal(spam.custom_icon, 'shield.png');
    assert.equal(spam.show_in, 'context');
    assert.equal(local('_special_prompts').length, 9, 'every special prompt is stored');
});

k.test('menus-follow', 'getPrompts() reads the new positions back', async () => {
    const list = await p.getPrompts(false, [], true);
    for (const [i, id] of expectedOrder.entries()) {
        assert.equal(list.find(x => x.id === id).position_display, i + 1, id);
    }
});

k.test('runs-once', 'a second run (the next startup) changes nothing', async () => {
    const snapshot = ctx.ctl.localData();
    const writes = ctx.ctl.calls.filter(c => c.op === 'set').length;
    await p.migrateMenuOrderAlphabetic();
    assert.equal(ctx.ctl.calls.filter(c => c.op === 'set').length, writes);
    assert.deepEqual(ctx.ctl.localData(), snapshot);
});

k.coverage();
