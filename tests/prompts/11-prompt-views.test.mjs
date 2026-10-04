// Spec 02 "Organization prompts (the fourth set)" - only its unmanaged half: the three getters
// (getPrompts() per its arguments, getPromptsForManagement() with no special prompts,
// getPromptsForMenuOrder() with them) and idnum as a view row number; "Reachability" (show_in
// "none" is unreachable, getPrompts(onlyReachable)); "The five boolean flags are normalized on read"
// (its table of producers and fallbacks, and "need_custom_text is the only one of the five
// persisted for default prompts"); "User Properties" (show_in defaults: "popup" for default and
// custom prompts, "both" for special ones; custom_icon); "Special Prompts" and "Special Prompt
// Visibility Dependencies" (need_selected of prompt_get_calendar_event derived from
// calendar_no_selection, the clipboard variant not overlaid, the shared get_calendar_event prefix);
// "Reset all" (getFactoryShowIn()); "Exclusions from the UI" (getHiddenSpecialPromptIds());
// "Missing special prompts" (a removed entry restored, the store written back once).
// No policy: the inactive-prompt flags and the overlays are spec 08a/08b, tested by the managed area.

import { before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('11-prompt-views');

// The eight built-in prompts and nine special prompts named across spec 02 (the picker table,
// "Special Prompts", "Summarize: Dual-Mode Prompt System", "Translate", "Icon Resolution": "All 8
// prompts in defaultPrompts", "specialPrompts holds 9 entries").
const SPECIAL_IDS = [
    'prompt_add_tags', 'prompt_get_calendar_event', 'prompt_get_calendar_event_from_clipboard',
    'prompt_get_task', 'prompt_spamfilter', 'prompt_summarize', 'prompt_summarize_email_template',
    'prompt_summarize_email_separator', 'prompt_translate_this',
];
const HIDDEN_SPECIAL_IDS = ['prompt_summarize_email_template', 'prompt_summarize_email_separator'];

const CUSTOM = [
    { id: 'prompt_user_a', name: 'A', text: 'Do A', type: '1', action: '0', is_default: '0', is_special: '0',
      need_signature: 1, need_custom_text: '', define_response_lang: '0', need_selected: 0 },
    { id: 'prompt_user_hidden', name: 'H', text: 'Do H', type: '0', action: '0', is_default: '0', is_special: '0',
      show_in: 'none' },
];

const STORED = {
    _default_prompts_properties: {
        // need_custom_text "" (what older versions wrote): reverts to the built-in "1".
        prompt_reply_custom_command: { position_display: 3, position_compose: 3, position_context: 3, need_custom_text: '', show_in: 'both' },
        // A stored need_signature is not one of the persisted keys: the built-in "1" wins.
        prompt_reply: { position_display: 1, position_compose: 1, position_context: 1, need_custom_text: 1,
                        need_signature: '0', use_diff_viewer: '1', show_in: 'none', custom_icon: 'star.png' },
        prompt_classify: { position_display: 2, position_compose: 2, position_context: 2, need_custom_text: 0 },
    },
    _custom_prompt: CUSTOM,
    _special_prompts: [
        { id: 'prompt_spamfilter', name: '__MSG_prompt_spamfilter__', text: 'Mine {%mail_text_body%} spamValue explanation',
          type: '1', action: '0', is_default: '1', is_special: '1', show_in: 'context',
          need_selected: '', define_response_lang: 1, use_diff_viewer: 'undefined' },
        // No show_in, no custom_icon: saved by an older version.
        { id: 'prompt_get_task', name: '__MSG_prompt_get_task__', text: 'Task {%selected_text%} summary',
          type: '1', action: '0', is_default: '1', is_special: '1', need_selected: '' },
        { id: 'prompt_get_calendar_event', name: '__MSG_prompt_get_calendar_event__', text: 'Cal startDate endDate summary',
          type: '1', action: '0', is_default: '1', is_special: '1', show_in: 'popup', need_selected: '0' },
        { id: 'prompt_get_calendar_event_from_clipboard', name: '__MSG_prompt_get_calendar_event_from_clipboard__',
          text: 'Clip startDate endDate summary', type: '1', action: '0', is_default: '1', is_special: '1', show_in: 'popup',
          need_selected: '0' },
    ],
};

let ctx, p;

before(async () => {
    ctx = await startBackground({ policy: null, local: structuredClone(STORED) });
    p = ctx.prompts;
});

const ids = list => list.map(x => x.id);
const byId = (list, id) => list.find(x => x.id === id);

// --- getPrompts() -----------------------------------------------------------------------------

k.test('get-prompts-no-specials', 'getPrompts(): the 8 built-ins and the custom prompts, no special prompt', async () => {
    const list = await p.getPrompts();
    assert.equal(list.filter(x => x.is_default === '1').length, 8);
    assert.deepEqual(ids(list).filter(id => id.startsWith('prompt_user')), ['prompt_user_a', 'prompt_user_hidden']);
    assert.equal(list.some(x => String(x.is_special) === '1'), false);
    assert.equal(list.some(x => SPECIAL_IDS.includes(x.id)), false);
});

k.test('get-prompts-sorted-idnum', 'getPrompts(): sorted by id, idnum the row number 1..n', async () => {
    const list = await p.getPrompts();
    assert.deepEqual(ids(list), [...ids(list)].sort((a, b) => a.localeCompare(b)));
    assert.deepEqual(list.map(x => x.idnum), list.map((_, i) => i + 1));
});

k.test('get-prompts-reachable', 'getPrompts(true): a prompt with show_in "none" is unreachable, so left out', async () => {
    const list = await p.getPrompts(true);
    assert.equal(byId(list, 'prompt_reply'), undefined);
    assert.equal(byId(list, 'prompt_user_hidden'), undefined);
    assert.ok(byId(list, 'prompt_user_a'));
    assert.ok(list.every(x => x.show_in !== 'none'));
});

k.test('get-prompts-include-special', 'getPrompts(false, ids): only the special prompts named', async () => {
    const list = await p.getPrompts(false, ['prompt_spamfilter', 'prompt_get_task']);
    assert.deepEqual(ids(list).filter(id => SPECIAL_IDS.includes(id)).sort(), ['prompt_get_task', 'prompt_spamfilter']);
});

k.test('get-prompts-all-special', 'getPrompts(false, [], true): every special prompt', async () => {
    const list = await p.getPrompts(false, [], true);
    for (const id of SPECIAL_IDS) assert.ok(byId(list, id), id);
    assert.ok(byId(list, 'prompt_user_a') && byId(list, 'prompt_reply'));
});

k.test('get-prompts-all-special-reachable', 'getPrompts(true, [], true): the show_in "none" special prompts are left out', async () => {
    const list = await p.getPrompts(true, [], true);
    for (const id of HIDDEN_SPECIAL_IDS) assert.equal(byId(list, id), undefined, id);
    assert.ok(byId(list, 'prompt_spamfilter'));
});

// --- The administration views ---------------------------------------------------------------

k.test('management-view', 'getPromptsForManagement(): built-ins and custom prompts, unreachable ones too, no special', async () => {
    const list = await p.getPromptsForManagement();
    assert.equal(list.length, 10);
    assert.ok(byId(list, 'prompt_user_hidden') && byId(list, 'prompt_reply'));
    assert.equal(list.some(x => SPECIAL_IDS.includes(x.id)), false);
    assert.deepEqual(list.map(x => x.idnum), list.map((_, i) => i + 1));
});

k.test('menu-order-view', 'getPromptsForMenuOrder(): the management view plus the special prompts', async () => {
    const list = await p.getPromptsForMenuOrder();
    for (const id of SPECIAL_IDS) assert.ok(byId(list, id), id);
    assert.ok(byId(list, 'prompt_user_hidden') && byId(list, 'prompt_reply'));
    assert.deepEqual(list.map(x => x.idnum), list.map((_, i) => i + 1));
});

// --- Built-in prompts read with their stored properties --------------------------------------

k.test('default-need-custom-text-fallback', 'a stored need_custom_text "" reverts to the built-in value', async () => {
    assert.equal(byId(await p.getPrompts(), 'prompt_reply_custom_command').need_custom_text, '1');
});

k.test('default-need-custom-text-stored', 'a stored need_custom_text in domain wins, in canonical form', async () => {
    const list = await p.getPrompts();
    assert.equal(byId(list, 'prompt_reply').need_custom_text, '1');
    assert.equal(byId(list, 'prompt_classify').need_custom_text, '0');
});

k.test('default-other-flags-built-in', 'the other four flags always come from the built-in definition', async () => {
    const reply = byId(await p.getPrompts(), 'prompt_reply');
    assert.equal(reply.need_signature, '1');
    assert.equal(reply.use_diff_viewer, '0');
});

k.test('default-flags-canonical', 'every flag of every built-in prompt reads as "0" or "1"', async () => {
    for (const prompt of (await p.getPrompts()).filter(x => x.is_default === '1')) {
        for (const f of p.promptBooleanFlags) assert.ok(prompt[f] === '0' || prompt[f] === '1', `${prompt.id}.${f} = ${prompt[f]}`);
    }
});

k.test('picker-need-selection', 'the three picker prompts always need a selection (they use {%selected_html%})', async () => {
    const list = await p.getPrompts();
    for (const id of ['prompt_rewrite_polite', 'prompt_rewrite_formal', 'prompt_proofread_this']) {
        assert.equal(byId(list, id).use_diff_viewer, '1', id);
        assert.equal(byId(list, id).need_selected, '1', id);
        assert.ok(byId(list, id).text.includes('{%selected_html%}'), id);
    }
});

k.test('default-user-properties', 'show_in and custom_icon are the stored ones; positions too', async () => {
    const list = await p.getPrompts();
    const reply = byId(list, 'prompt_reply');
    assert.equal(reply.show_in, 'none');
    assert.equal(reply.custom_icon, 'star.png');
    assert.deepEqual([reply.position_display, reply.position_compose, reply.position_context], [1, 1, 1]);
    assert.equal(byId(list, 'prompt_reply_custom_command').show_in, 'both');
});

k.test('positions-missing-entry', 'a built-in prompt with no stored entry goes to the end: 1000, 1001... in array order', async () => {
    // Stored: prompt_reply, prompt_reply_custom_command, prompt_classify. The others, in the order
    // of the defaultPrompts array:
    const missing = ['prompt_reply_advanced', 'prompt_rewrite_polite', 'prompt_rewrite_formal', 'prompt_proofread_this', 'prompt_this'];
    const list = await p.getPrompts();
    missing.forEach((id, i) => {
        const prompt = byId(list, id);
        assert.deepEqual([prompt.position_display, prompt.position_compose, prompt.position_context], [1000 + i, 1000 + i, 1000 + i], id);
    });
});

k.test('summarize-fragments-no-prefix', 'getSpecialPromptPrefix(): the summarize template and separator give null', () => {
    for (const id of HIDDEN_SPECIAL_IDS) assert.equal(p.getSpecialPromptPrefix(id), null, id);
});

k.test('default-show-in-default', 'a built-in prompt with no stored show_in shows in the popup', async () => {
    const list = await p.getPrompts();
    assert.equal(byId(list, 'prompt_classify').show_in, 'popup');
    assert.equal(byId(list, 'prompt_this').show_in, 'popup');
});

// --- Custom prompts -------------------------------------------------------------------------------

k.test('custom-flags', 'custom prompts: flags canonical, out of domain is off (no built-in)', async () => {
    const a = byId(await p.getPrompts(), 'prompt_user_a');
    assert.equal(a.need_signature, '1');
    assert.equal(a.need_custom_text, '0');
    assert.equal(a.need_selected, '0');
    assert.equal(a.use_diff_viewer, '0');
});

k.test('custom-show-in-default', 'a custom prompt with no show_in shows in the popup', async () => {
    assert.equal(byId(await p.getPrompts(), 'prompt_user_a').show_in, 'popup');
});

// --- Special prompts ------------------------------------------------------------------------------

k.test('special-flags-fallback', 'special prompts: an out-of-domain flag reverts to the shipped definition', async () => {
    const specials = await p.getSpecialPrompts();
    const spam = byId(specials, 'prompt_spamfilter');
    assert.equal(spam.need_selected, '0');
    assert.equal(spam.define_response_lang, '1', 'an in-domain number is kept, canonical');
    assert.equal(spam.use_diff_viewer, '0');
    assert.equal(byId(specials, 'prompt_get_task').need_selected, '1');
});

k.test('special-show-in-default', 'a special prompt saved with no show_in shows in both menus', async () => {
    assert.equal(byId(await p.getSpecialPrompts(), 'prompt_get_task').show_in, 'both');
});

k.test('special-custom-icon-default', 'a special prompt saved with no custom_icon reads custom_icon ""', async () => {
    assert.equal(byId(await p.getSpecialPrompts(), 'prompt_get_task').custom_icon, '');
});

k.test('special-text-kept', 'the stored text of a special prompt is what getSpecialPrompts() returns', async () => {
    assert.equal(byId(await p.getSpecialPrompts(), 'prompt_spamfilter').text, 'Mine {%mail_text_body%} spamValue explanation');
});

// Spec "Missing special prompts": a shipped special prompt missing from the store is appended as
// shipped and the store written back once; the entries the store has are kept.

k.test('special-restored', 'the special prompts missing from the store are restored, as shipped', async () => {
    await p.getSpecialPrompts();
    const stored = ctx.ctl.localData()._special_prompts;
    assert.deepEqual(stored.map(x => x.id).sort(), [...SPECIAL_IDS].sort());
    const translate = byId(stored, 'prompt_translate_this');
    assert.equal(translate.text, ctx.ctl.browser.i18n.getMessage('prompt_translate_this_full_text'));
    assert.equal(translate.show_in, 'context');
    assert.equal(byId(stored, 'prompt_spamfilter').text, 'Mine {%mail_text_body%} spamValue explanation', 'a stored entry is kept');
});

k.test('special-restore-written-once', 'a complete store is never rewritten by a read', async () => {
    const writes = () => ctx.ctl.calls.filter(c => c.op === 'set' && c.items && '_special_prompts' in c.items).length;
    const before = writes();
    await p.getSpecialPrompts();
    await p.getSpecialPrompts();
    assert.equal(writes(), before);
});

k.test('special-lookup-after-removal', 'a lookup helper finds a special prompt the user removed from storage', async () => {
    const translate = await p.getTranslatePrompt();
    assert.equal(translate?.id, 'prompt_translate_this');
    assert.equal(translate.text, ctx.ctl.browser.i18n.getMessage('prompt_translate_this_full_text'));
});

k.test('calendar-need-selected-pref-off', 'calendar_no_selection off: the calendar prompt needs a selection, whatever is stored', async () => {
    const specials = await p.getSpecialPrompts();
    assert.equal(byId(specials, 'prompt_get_calendar_event').need_selected, '1');
    assert.equal(byId(specials, 'prompt_get_calendar_event_from_clipboard').need_selected, '0', 'the clipboard variant is not overlaid');
});

k.test('calendar-need-selected-pref-on', 'calendar_no_selection on: no selection needed; the clipboard variant unchanged', async () => {
    await ctx.mztaPrefs.setPref('calendar_no_selection', true);
    const specials = await p.getSpecialPrompts();
    assert.equal(byId(specials, 'prompt_get_calendar_event').need_selected, '0');
    assert.equal(byId(specials, 'prompt_get_calendar_event_from_clipboard').need_selected, '0');
    await ctx.mztaPrefs.setPref('calendar_no_selection', false);
    assert.equal(byId(await p.getSpecialPrompts(), 'prompt_get_calendar_event').need_selected, '1', 'derived on every read');
});

// --- The special prompt catalogue ------------------------------------------------------------------

k.test('special-ids', 'getSpecialPromptIds(): the nine special prompts', () => {
    assert.deepEqual([...p.getSpecialPromptIds()].sort(), [...SPECIAL_IDS].sort());
});

k.test('hidden-special-ids', 'getHiddenSpecialPromptIds(): the summarize email template and separator', () => {
    assert.deepEqual([...p.getHiddenSpecialPromptIds()].sort(), [...HIDDEN_SPECIAL_IDS].sort());
});

k.test('special-prefix', 'getSpecialPromptPrefix(): each feature prompt to its feature prefix', () => {
    const expected = {
        prompt_add_tags: 'add_tags', prompt_spamfilter: 'spamfilter', prompt_summarize: 'summarize',
        prompt_get_calendar_event: 'get_calendar_event', prompt_get_calendar_event_from_clipboard: 'get_calendar_event',
        prompt_get_task: 'get_task', prompt_translate_this: 'translate',
    };
    for (const [id, prefix] of Object.entries(expected)) assert.equal(p.getSpecialPromptPrefix(id), prefix, id);
});

k.test('special-prefix-none', 'getSpecialPromptPrefix(): null for a prompt that is not a feature prompt', () => {
    for (const id of ['prompt_reply', 'prompt_user_a', 'nope']) assert.equal(p.getSpecialPromptPrefix(id), null, id);
});

// --- getActiveSpecialPromptsIDs() (js/mzta-utils.js) ------------------------------------------------
// Spec "Special Prompt Visibility Dependencies": a special prompt is active when its feature flag is
// on AND its own feature's connection can drive an API (judged per feature, never globally); the
// clipboard calendar prompt only when both calendar features are on, with the get_calendar_event prefix.

const ALL_FEATURES = { addtags: true, get_calendar_event: true, get_calendar_event_from_clipboard: true,
    get_task: true, spamfilter: true, summarize: true, translate: true };
const API_EVERYWHERE = Object.fromEntries(['add_tags', 'spamfilter', 'summarize', 'get_calendar_event', 'get_task', 'translate']
    .map(prefix => [prefix, 'chatgpt_api']));

k.test('active-all', 'every feature on, every connection an API: the seven menu special prompts', () => {
    const active = ctx.utils.getActiveSpecialPromptsIDs({ ...ALL_FEATURES, effective_conn: API_EVERYWHERE });
    assert.deepEqual([...active].sort(), SPECIAL_IDS.filter(id => !HIDDEN_SPECIAL_IDS.includes(id)).sort());
});

k.test('active-feature-off', 'a feature flag off hides its prompt', () => {
    const active = ctx.utils.getActiveSpecialPromptsIDs({ ...ALL_FEATURES, spamfilter: false, effective_conn: API_EVERYWHERE });
    assert.equal(active.includes('prompt_spamfilter'), false);
    assert.ok(active.includes('prompt_add_tags'));
});

k.test('active-per-feature-connection', 'the connection is judged per feature: ChatGPT Web or none hides only that feature', () => {
    const active = ctx.utils.getActiveSpecialPromptsIDs({ ...ALL_FEATURES,
        effective_conn: { ...API_EVERYWHERE, summarize: 'chatgpt_web', translate: '' } });
    assert.equal(active.includes('prompt_summarize'), false);
    assert.equal(active.includes('prompt_translate_this'), false);
    assert.ok(active.includes('prompt_spamfilter') && active.includes('prompt_get_task'));
});

k.test('active-clipboard-needs-calendar', 'the clipboard calendar prompt needs get_calendar_event too', () => {
    const noCal = ctx.utils.getActiveSpecialPromptsIDs({ ...ALL_FEATURES, get_calendar_event: false, effective_conn: API_EVERYWHERE });
    assert.equal(noCal.includes('prompt_get_calendar_event_from_clipboard'), false);
    assert.equal(noCal.includes('prompt_get_calendar_event'), false);
    const noClip = ctx.utils.getActiveSpecialPromptsIDs({ ...ALL_FEATURES, get_calendar_event_from_clipboard: false, effective_conn: API_EVERYWHERE });
    assert.ok(noClip.includes('prompt_get_calendar_event'));
    assert.equal(noClip.includes('prompt_get_calendar_event_from_clipboard'), false);
});

k.test('active-clipboard-shares-prefix', 'both calendar prompts follow the get_calendar_event connection', () => {
    const active = ctx.utils.getActiveSpecialPromptsIDs({ ...ALL_FEATURES,
        effective_conn: { ...API_EVERYWHERE, get_calendar_event: 'chatgpt_web' } });
    assert.equal(active.includes('prompt_get_calendar_event'), false);
    assert.equal(active.includes('prompt_get_calendar_event_from_clipboard'), false);
});

k.test('factory-show-in', 'getFactoryShowIn(): the declared value; "popup" for a custom prompt', () => {
    for (const id of ['prompt_spamfilter', 'prompt_summarize', 'prompt_translate_this']) {
        assert.equal(p.getFactoryShowIn(id), 'context', id);
    }
    assert.equal(p.getFactoryShowIn('prompt_reply'), 'popup');
    assert.equal(p.getFactoryShowIn('prompt_user_a'), 'popup');
    for (const id of HIDDEN_SPECIAL_IDS) assert.equal(p.getFactoryShowIn(id), 'none', id);
});

k.coverage();
