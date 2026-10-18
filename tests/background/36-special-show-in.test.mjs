// Spec 02 "User Properties" (show_in: "both" for the special prompts shown in both menus) and
// "Special Prompt Visibility Dependencies", end to end on the background side, from a FRESH profile
// (no _special_prompts stored: getSpecialPrompts() hands out the shipped definitions):
//  - prompt_summarize and prompt_translate_this ship with show_in "both": once their feature is on
//    and their connection can drive an API, the popup is handed them with show_in "both" and a
//    reading type (what the popup's filterPromptsForTab() keeps for a message tab, spec 02 "Popup
//    Menu"; the filter itself is the ui area's), and the context menu lists them;
//  - the popup running them (shortcut_do_prompt) acts on the message its tab displays;
//  - feature off, or a connection that is not an API: in neither menu;
//  - a show_in "context" already saved in _special_prompts is the user's and is never migrated.
// prompt_spamfilter keeps its shipped "context".

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import {
    API,
    featureResponder,
    record,
    setPrefs,
    assertClean
} from './flows.mjs';
import { menuItems } from './apis.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';
import { SENDERS } from '../helpers/core/browser-mock.mjs';

const ctx = await bgContext({
    local: { ...API, summarize: true, summarize_display_mode: 'inline', translate: true, translate_lang: 'German', spamfilter: true, add_tags: false },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
        m.addTab({ id: 8, type: 'messageDisplay', windowId: 2 });
    },
});
ctx.workers.respond = featureResponder();
const k = caseTests('36-special-show-in');
const contextIds = () => menuItems(ctx.m).filter(i => i.parentId === 'mzta-context-parent').map(i => i.id.replace('mzta-ctx-', ''));
const entry = id => ctx.bg.$eval('menus').shortcutMenu.find(e => e.id === id);
// The popup's rule for a message tab (popup/mzta-popup.js filterPromptsForTab(), filtering 1).
const inReadingPopup = e => !!e && ['popup', 'both'].includes(e.show_in || 'popup') && ['0', '1'].includes(String(e.type));
const settle = async () => { for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r)); };

k.test('fresh-nothing-stored', 'a fresh profile: no _special_prompts stored, the shipped definitions are used', () => {
    assert.equal(ctx.ctl.localData()._special_prompts, undefined);
});

k.test('fresh-popup', 'fresh profile, feature on, API connection: summarize and translate pass the popup filter of a message tab', () => {
    assert.equal(ctx.bg.preparePopupMenu({ id: 8, type: 'messageDisplay' }).lastShortcutFiltering, 1);
    for (const id of ['prompt_summarize', 'prompt_translate_this']) {
        assert.equal(entry(id)?.show_in, 'both', id);
        assert.ok(inReadingPopup(entry(id)), id);
    }
    assert.equal(entry('prompt_spamfilter')?.show_in, 'context');
    assert.equal(inReadingPopup(entry('prompt_spamfilter')), false, 'the spam filter stays out of the popup');
});

k.test('fresh-context', 'fresh profile, feature on, API connection: summarize and translate are in the context menu', () => {
    const ids = contextIds();
    for (const id of ['prompt_summarize', 'prompt_translate_this', 'prompt_spamfilter']) assert.ok(ids.includes(id), id);
});

k.test('popup-runs-summarize', 'the popup running summarize acts on the message its message tab displays', async () => {
    const h = ctx.m.addMessage({ headerMessageId: 'sum1@x' });
    ctx.m.tab(8).displayed = h.id;
    await ctx.ctl.dispatchMessage({ command: 'shortcut_do_prompt', tabId: 8, promptId: 'prompt_summarize' }, SENDERS.popup);
    await settle();
    assert.ok(record(ctx, 'sum1@x')?.summary, 'summarized');
    assert.ok(ctx.m.sentTo(8, 'showSummary').length > 0, 'inline, in that tab');
});

k.test('popup-runs-translate', 'the popup running translate acts on the message its message tab displays', async () => {
    const h = ctx.m.addMessage({ headerMessageId: 'tr1@x' });
    ctx.m.tab(8).displayed = h.id;
    await ctx.ctl.dispatchMessage({ command: 'shortcut_do_prompt', tabId: 8, promptId: 'prompt_translate_this' }, SENDERS.popup);
    await settle();
    assert.ok(record(ctx, 'tr1@x')?.translation, 'translated');
    assert.ok(ctx.m.sentTo(8, 'showTranslation').some(c => c.data.headerMessageId === 'tr1@x'), 'shown in that tab');
});

k.test('feature-off', 'summarize off: in neither menu', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { summarize: false });
    await ctx.bg._reload_menus();
    assert.equal(entry('prompt_summarize'), undefined, 'not handed to the popup');
    assert.equal(contextIds().includes('prompt_summarize'), false, 'not in the context menu');
    assert.ok(entry('prompt_translate_this'), 'translate is still on');
});

k.test('non-api-connection', 'summarize on but a ChatGPT Web connection: in neither menu', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { summarize: true, connection_type: 'chatgpt_web' });
    await ctx.bg._reload_menus();
    for (const id of ['prompt_summarize', 'prompt_translate_this']) {
        assert.equal(entry(id), undefined, id + ' not handed to the popup');
        assert.equal(contextIds().includes(id), false, id + ' not in the context menu');
    }
});

k.test('saved-context-kept', 'a show_in "context" saved in _special_prompts is kept: context menu only, storage untouched', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const saved = { id: 'prompt_summarize', name: '__MSG_prompt_summarize__', text: 'Sum {%mail_text_body%}', type: '1', action: '0',
        need_selected: '0', need_signature: '0', need_custom_text: '0', define_response_lang: '0', use_diff_viewer: '0',
        api_type: '', is_default: '1', is_special: '1', show_in: 'context', custom_icon: '' };
    await setPrefs(t, ctx, { ...API, summarize: true, _special_prompts: [saved] });
    await ctx.bg._reload_menus();
    assert.equal(entry('prompt_summarize')?.show_in, 'context');
    assert.equal(inReadingPopup(entry('prompt_summarize')), false, 'not in the popup');
    assert.ok(contextIds().includes('prompt_summarize'), 'in the context menu');
    const stored = ctx.ctl.localData()._special_prompts;
    assert.equal(stored.find(p => p.id === 'prompt_summarize').show_in, 'context', 'never migrated');
    assert.equal(stored.find(p => p.id === 'prompt_translate_this').show_in, 'both', 'a missing entry is restored as shipped');
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
