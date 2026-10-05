// The options page with no AI connection selected (the fresh-install default), no policy.
//
// Spec 05 "Global Integration Settings" (no connection selected), "Special Prompt Integration
// Overrides" (the "Using <provider>" pill), "UI & Feature Preferences", "Feature Flags",
// "Feature Rows — Disabled vs. API-Needed", "Feature 'Manage settings' Links — Hidden vs.
// Disabled", "Connection Settings Panel — Advanced Options Disclosure", "Connection Settings
// Panel — Connection Test Status Strip", "Connection Settings Panel — Provider Setup Note
// (`#miczDescription`)", "Options Page Bottom Block (`#mzta_bottom`)".
//
// Stored state: no connection_type, two feature flags left on (add_tags, spamfilter), and
// Summarize on with its own integration (OpenAI API). Then the user picks providers in turn,
// toggles features and edits preferences on the same page.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import {
    shown,
    userSets,
    writtenSince,
} from '../../ui/dom-helpers.mjs';

const permissions = {};       // .request swapped by a test (the harness reads it per call)
const ctx = await openPage('options', {
    local: {
        add_tags: true,
        spamfilter: true,
        summarize: true,
        summarize_use_specific_integration: true,
        summarize_connection_type: 'chatgpt_api',
    },
    permissions,
});
after(() => ctx.close());
const k = uiTests('options', '01');
const $ = ctx.$;
const label = type => msg({
    chatgpt_web: 'prefs_Connection_type_ChatGPT_Web',
    chatgpt_api: 'prefs_Connection_type_ChatGPT_API',
    ollama_api: 'prefs_Connection_type_Ollama_API',
}[type]);
const select = $('#connection_type');
const pick = async (type) => {
    const since = ctx.ctl.calls.length;
    select.value = type;
    await ctx.fire(select, 'change');
    return since;
};

const S_GLOBAL = 'spec 05 "Global Integration Settings"';
const S_OVERRIDES = 'spec 05 "Special Prompt Integration Overrides"';
const S_UI = 'spec 05 "UI & Feature Preferences"';
const S_FLAGS = 'spec 05 "Feature Flags"';
const S_ROWS = 'spec 05 "Feature Rows — Disabled vs. API-Needed"';
const S_MANAGE = 'spec 05 "Feature \'Manage settings\' Links — Hidden vs. Disabled"';
const S_ADV = 'spec 05 "Connection Settings Panel — Advanced Options Disclosure"';
const S_TEST = 'spec 05 "Connection Settings Panel — Connection Test Status Strip"';
const S_NOTE = 'spec 05 "Connection Settings Panel — Provider Setup Note (`#miczDescription`)"';
const S_BOTTOM = 'spec 05 "Options Page Bottom Block (`#mzta_bottom`)"';

const API_ROWS = ['add_tags', 'spamfilter', 'summarize', 'translate'];
const MANAGE = {
    add_tags: 'btnManageTagsInfo', spamfilter: 'btnManageSpamFilterInfo',
    summarize: 'btnManageSummarizeInfo', translate: 'btnManageTranslateInfo',
    get_calendar_event: 'btnManageCalendarEventInfo', get_task: 'btnManageTaskInfo',
};
const warnShown = prefix => $('#' + prefix + '_warn_API_needed').style.display === 'inline-block';

// ---- at load ---------------------------------------------------------------------------

k.test('select-placeholder', S_GLOBAL, 'the global select shows the disabled "no connection" placeholder', () => {
    assert.equal(select.value, '');
    const opt = select.options[select.selectedIndex];
    assert.ok(opt, 'an option is selected, not a blank control');
    assert.equal(opt.value, '');
    assert.equal(opt.disabled, true, 'the placeholder is disabled');
    assert.equal(opt.textContent, msg('prefs_Connection_type_none'));
    assert.equal(select.options[0], opt, 'it is prepended');
});

k.test('no-connection-banner', S_GLOBAL, 'the blue setup-wizard banner is shown', () => {
    assert.equal($('#no_connection_banner').classList.contains('shown'), true);
});

k.test('panel-pill-none', S_OVERRIDES, 'the connection panel pill names the empty state, not a bare dot', () => {
    assert.equal($('#mzta_conn_pill_name').textContent, msg('prefs_Connection_type_none'));
});

k.test('nothing-written-at-load', S_GLOBAL, 'opening the page persists no connection type', () => {
    assert.equal(ctx.ctl.localData().connection_type, undefined);
});

k.test('rows-disabled', S_ROWS, 'with nothing selected the API rows are unchecked, greyed, and show no API hint', () => {
    for (const p of ['add_tags', 'spamfilter', 'translate']) {
        assert.equal($('#' + p).checked, false, p + ' checked');
        assert.equal($('#' + p).disabled, true, p + ' not greyed');
        assert.equal(warnShown(p), false, p + ' warn_API_needed shown');
    }
});

k.test('flags-cleared', S_ROWS, 'with nothing selected a flag left on is cleared and the false persisted', () => {
    const local = ctx.ctl.localData();
    assert.equal(local.add_tags, false);
    assert.equal(local.spamfilter, false);
});

k.test('own-integration-enabled', S_ROWS, 'a feature on its own API stays enabled and on with no global connection', () => {
    assert.equal($('#summarize').checked, true);
    assert.equal($('#summarize').disabled, false);
    assert.equal(warnShown('summarize'), false);
    assert.equal(ctx.ctl.localData().summarize, true, 'its flag was not cleared');
});

k.test('features-note', S_ROWS, 'the "select an AI connection" note is shown under the features subtitle', () => {
    const note = $('#features_no_connection_note');
    assert.equal(note.classList.contains('shown'), true);
    assert.equal(note.textContent.trim(), msg('prefs_FeaturesNoConnection'));
});

k.test('calendar-rows-hidden', S_ROWS, 'with nothing selected the calendar / task rows are hidden outright', () => {
    for (const cls of ['get_calendar_event_tr', 'get_task_tr']) {
        for (const row of ctx.$$('.' + cls)) assert.equal(row.style.display, 'none', cls);
    }
});

k.test('no-sparks-hidden', S_ROWS, 'with both calendar features unusable the "Sparks missing" notice stays hidden', () => {
    assert.notEqual($('#no_sparks').style.display, 'block');
});

k.test('manage-hidden', S_MANAGE, 'an unchecked feature\'s Manage button is hidden and disabled; a checked one\'s shown', () => {
    for (const p of ['add_tags', 'spamfilter', 'translate']) {
        const btn = $('#' + MANAGE[p]);
        assert.equal(btn.style.display, 'none', p);
        assert.equal(btn.disabled, true, p);
    }
    const btn = $('#' + MANAGE.summarize);
    assert.notEqual(btn.style.display, 'none');
    assert.equal(btn.disabled, false);
});

k.test('pill-own-integration', S_OVERRIDES, 'a feature on its own integration shows "Using <provider>"; the others none', () => {
    const pill = $('#summarize_specific_api_indicator');
    assert.equal(pill.textContent, msg('prefs_specific_api_indicator', [label('chatgpt_api')]));
    assert.notEqual(pill.style.display, 'none');
    for (const p of ['add_tags', 'spamfilter', 'translate', 'get_calendar_event', 'get_task']) {
        const other = $('#' + p + '_specific_api_indicator');
        assert.equal(other.style.display, 'none', p);
        assert.equal(other.textContent, '', p);
    }
});

k.test('adv-hidden', S_ADV, 'with no provider the connection "Advanced options" button is hidden and the table collapsed', () => {
    assert.equal($('#mzta_conn_adv_btn').style.display, 'none');
    assert.equal($('#connection_ui_adv_table').classList.contains('hidden'), true);
    assert.equal($('#mzta_conn_adv_btn').getAttribute('aria-expanded'), 'false');
});

k.test('adv-rows-moved', S_ADV, 'every advanced row sits in #connection_ui_adv_table, none in the core table', () => {
    assert.equal(ctx.$$('#connection_ui_table tr.conn_adv').length, 0);
    assert.ok(ctx.$$('#connection_ui_adv_table tr.conn_adv').length > 0);
});

k.test('strip-hidden', S_TEST, 'the connection test strip is hidden while nothing is selected', () => {
    assert.equal(shown($('#mzta_conn_test')), false);
});

k.test('note-empty', S_NOTE, 'no provider text and no guide link in the setup note', () => {
    for (const span of ctx.$$('#miczDescription .info_specific')) assert.equal(span.style.display, 'none', span.className);
    assert.equal($('#mzta_info_guide').style.display, 'none');
});

k.test('ui-defaults', S_UI, 'with nothing stored each preference shows its default', () => {
    const d = ctx.mods.prefs_default;
    assert.equal($('#reply_type').value, d.reply_type);
    assert.equal($('#diff_granularity').value, d.diff_granularity);
    for (const id of ['chatgpt_win_height', 'chatgpt_win_width', 'max_prompt_length', 'special_command_timeout', 'batch_max_concurrency']) {
        assert.equal($('#' + id).valueAsNumber, d[id], id);
    }
    for (const id of ['do_debug', 'chatgpt_win_save_position', 'dynamic_menu_force_enter', 'placeholders_use_default_value', 'hide_thinking', 'chat_show_usage_data']) {
        assert.equal($('#' + id).checked, d[id], id);
    }
    assert.equal($('#default_sign_name').value, d.default_sign_name);
    assert.equal($('#default_chatgpt_lang').value, d.default_chatgpt_lang);
});

k.test('max-prompt-length-irrelevant', S_GLOBAL, 'max_prompt_length is not offered with nothing selected', () => {
    assert.equal($('#max_prompt_length').disabled, true);
});

k.test('usage-row-feature-integration', S_UI, 'the usage-data row shows when a feature\'s own integration reports usage', () => {
    assert.notEqual($('#chat_show_usage_data_tr').style.display, 'none');
    assert.equal($('#chat_show_usage_data_openai_comp_note').style.display, 'none');
});

k.test('shortcut-chips', S_BOTTOM, 'the shortcut chips come from browser.commands, one <kbd> per key', () => {
    assert.equal(ctx.apiCalls('browser.commands.getAll').length, 1, 'read once at init');
    assert.deepEqual(ctx.$$('#mzta_shortcut_keys kbd').map(k => k.textContent), ['Ctrl', 'Alt', 'A']);
});

k.test('bottom-structure', S_BOTTOM, 'the disclaimer precedes the shortcut strip; the footer holds the three plain links', () => {
    const row = $('#mzta_bottom #mzta_info_row');
    assert.ok(row, '#mzta_info_row inside #mzta_bottom');
    assert.deepEqual([...row.children].map(e => e.id), ['mzta_disclaimer', 'mzta_shortcut_strip']);
    assert.match($('#mzta_disclaimer').textContent, new RegExp(msg('prefs_disclaimer_short').slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok($('#mzta_disclaimer a'), 'the privacy link');
    assert.equal($('#mzta_shortcut_strip .mzta_shortcut_label').textContent, msg('prefs_shortcut_label'));
    const links = [...$('#mzta_bottom #mzta_footer').children];
    assert.deepEqual(links.map(a => [a.tagName, a.id]), [['A', 'miczTranslate'], ['A', 'miczDonation'], ['A', 'miczRelNotes']]);
    assert.equal($('#miczTranslate').textContent, msg('prefs_footer_translate'));
    assert.equal($('#miczDonation').textContent, msg('prefs_footer_donate'));
    assert.equal($('#miczRelNotes').textContent, msg('prefs_OptionText_release_notes'));
    assert.match($('#miczDonation').getAttribute('href'), /^https:\/\//);
});

k.test('note-in-panel', S_NOTE, 'the setup note is the last element of #mzta_conn_panel, after the test strip, with no heading', () => {
    const panel = $('#mzta_conn_panel');
    assert.equal(panel.lastElementChild.id, 'miczDescription');
    assert.equal($('#miczDescription').previousElementSibling.id, 'mzta_conn_test');
    assert.equal(ctx.$$('#miczDescription h1, #miczDescription h2, #miczDescription h3').length, 0);
    assert.equal($('#mzta_bottom #miczDescription'), null);
});

// ---- the user picks a provider -----------------------------------------------------------

k.test('pick-api', S_GLOBAL, 'picking a provider stores it and drops the empty-state UI', async () => {
    const since = await pick('chatgpt_api');
    assert.deepEqual(writtenSince(ctx, since).connection_type, 'chatgpt_api');
    assert.equal($('#no_connection_banner').classList.contains('shown'), false);
    assert.equal($('#mzta_conn_pill_name').textContent, label('chatgpt_api'));
    assert.equal($('#max_prompt_length').disabled, false);
});

k.test('pick-api-rows', S_ROWS, 'with an API the rows are enabled, not re-checked, and show no hint', () => {
    assert.equal($('#features_no_connection_note').classList.contains('shown'), false);
    for (const p of ['add_tags', 'spamfilter', 'translate']) {
        assert.equal($('#' + p).disabled, false, p);
        assert.equal($('#' + p).checked, false, p + ' restored: the repair is one-directional');
        assert.equal(warnShown(p), false, p);
    }
});

k.test('pick-api-adv', S_ADV, 'with a provider the button shows, collapsed, and only that provider\'s rows are in the table', () => {
    const btn = $('#mzta_conn_adv_btn');
    assert.notEqual(btn.style.display, 'none');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.equal($('#connection_ui_adv_table').classList.contains('hidden'), true);
    for (const tr of ctx.$$('#connection_ui_adv_table tr[class*="conntype_"]')) {
        assert.equal(tr.style.display !== 'none', tr.classList.contains('conntype_chatgpt_api'), tr.className);
    }
});

k.test('pick-api-strip', S_TEST, 'with a testable provider the strip shows, idle', () => {
    const strip = $('#mzta_conn_test');
    assert.equal(shown(strip), true);
    assert.equal(strip.getAttribute('data-state'), 'idle');
    assert.equal($('#mzta_conn_test_text').textContent, msg('connTest_idle'));
    assert.equal($('#mzta_conn_test_link').textContent, msg('connTest_link_test'));
});

k.test('pick-api-note', S_NOTE, 'only the selected provider\'s text shows, tinted, and OpenAI has no guide link', () => {
    for (const span of ctx.$$('#miczDescription .info_specific')) {
        assert.equal(span.style.display !== 'none', span.classList.contains('conntype_chatgpt_api'), span.className);
    }
    assert.equal($('#miczDescription').classList.contains('tint_chatgpt_api'), true);
    assert.equal($('#mzta_info_guide').style.display, 'none');
});

k.test('pick-web-rows', S_ROWS, 'with ChatGPT Web the rows stay clickable and show the API hint', async () => {
    await pick('chatgpt_web');
    for (const p of ['add_tags', 'spamfilter', 'translate']) {
        assert.equal($('#' + p).disabled, false, p);
        assert.equal(warnShown(p), true, p);
    }
    assert.equal(warnShown('summarize'), false, 'summarize runs on its own API');
});

k.test('pick-web-strip', S_TEST, 'ChatGPT Web has no endpoint: the strip is hidden', () => {
    assert.equal(shown($('#mzta_conn_test')), false);
});

k.test('pick-web-max-prompt', S_GLOBAL, 'max_prompt_length is not offered with ChatGPT Web', () => {
    assert.equal($('#max_prompt_length').disabled, true);
});

k.test('pick-web-guide', S_NOTE, 'ChatGPT Web gets the status-page guide link, inline in its own text', () => {
    const link = $('#mzta_info_guide');
    assert.notEqual(link.style.display, 'none');
    assert.equal(link.parentElement, $('#miczDescription .conntype_chatgpt_web.info_specific'));
    assert.match(link.href, /^https:\/\/micz\.it\/(\w+\/)?thunderbird-addon-thunderai\/status\/$/);
    assert.equal($('#miczDescription').classList.contains('tint_chatgpt_web'), true);
    assert.equal($('#miczDescription').classList.contains('tint_chatgpt_api'), false);
});

k.test('pick-web-sparks', S_ROWS, 'with ChatGPT Web and no Sparks the calendar rows hide and the "Sparks missing" notice shows', () => {
    for (const row of ctx.$$('.get_calendar_event_tr, .get_task_tr')) assert.equal(row.style.display, 'none');
    assert.equal($('#no_sparks').style.display, 'block');
    assert.notEqual($('#no_sparks_text').style.display, 'none');
    assert.equal($('#wrong_sparks_text').style.display, 'none');
});

k.test('pick-ollama-guide', S_NOTE, 'Ollama gets the CORS guide link, moved into its own text', async () => {
    await pick('ollama_api');
    const link = $('#mzta_info_guide');
    assert.notEqual(link.style.display, 'none');
    assert.equal(link.parentElement, $('#miczDescription .conntype_ollama_api.info_specific'));
    assert.match(link.href, /\/thunderbird-addon-thunderai\/ollama-cors-information\/$/);
});

k.test('switch-collapses-adv', S_ADV, 'a provider switch collapses an expanded disclosure', async () => {
    await pick('chatgpt_api');
    const btn = $('#mzta_conn_adv_btn');
    await ctx.click(btn);
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    await pick('ollama_api');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.equal($('#connection_ui_adv_table').classList.contains('hidden'), true);
    await pick('chatgpt_api');
});

// ---- the user toggles features -----------------------------------------------------------

k.test('flag-on', S_FLAGS, 'switching Add Tags on asks for its permissions and stores true', async () => {
    const since = ctx.ctl.calls.length;
    const asked = ctx.apiCalls('browser.permissions.request').length;
    await ctx.click($('#add_tags'));
    const req = ctx.apiCalls('browser.permissions.request').slice(asked);
    assert.equal(req.length, 1);
    assert.deepEqual([...req[0].args[0].permissions].sort(), ['messagesTags', 'messagesUpdate']);
    assert.strictEqual(writtenSince(ctx, since).add_tags, true);
});

k.test('flag-on-manage', S_MANAGE, 'checking a feature shows its Manage button, enabled', () => {
    const btn = $('#btnManageTagsInfo');
    assert.notEqual(btn.style.display, 'none');
    assert.equal(btn.disabled, false);
});

k.test('manage-opens', S_MANAGE, 'the Manage button opens the feature\'s settings page', async () => {
    const before = ctx.apiCalls('browser.tabs.create').length;
    await ctx.click($('#btnManageTagsInfo'));
    const opened = ctx.apiCalls('browser.tabs.create').slice(before);
    assert.equal(opened.length, 1);
    assert.match(opened[0].args[0].url, /\/pages\/addtags\/mzta-add-tags\.html$/);
});

k.test('flag-off', S_MANAGE, 'unchecking it stores false and hides the Manage button again', async () => {
    const since = ctx.ctl.calls.length;
    await ctx.click($('#add_tags'));
    assert.strictEqual(writtenSince(ctx, since).add_tags, false);
    assert.equal($('#btnManageTagsInfo').style.display, 'none');
    assert.equal($('#btnManageTagsInfo').disabled, true);
});

k.test('flag-denied', S_MANAGE, 'a denied permission turns Spam Filter back off, stores false and hides its Manage button', async () => {
    permissions.request = () => false;
    try {
        const since = ctx.ctl.calls.length;
        await ctx.click($('#spamfilter'));
        assert.equal($('#spamfilter').checked, false);
        const written = ctx.localWrites(since).map(c => c.items.spamfilter).filter(v => v !== undefined);
        assert.strictEqual(written.at(-1), false, 'the last value stored');
        assert.equal($('#btnManageSpamFilterInfo').style.display, 'none');
        assert.equal($('#btnManageSpamFilterInfo').disabled, true);
    } finally {
        delete permissions.request;
    }
});

k.test('flag-translate', S_FLAGS, 'switching Translate on and off stores the boolean', async () => {
    let since = ctx.ctl.calls.length;
    await ctx.click($('#translate'));
    assert.strictEqual(writtenSince(ctx, since).translate, true);
    assert.notEqual($('#btnManageTranslateInfo').style.display, 'none');
    since = ctx.ctl.calls.length;
    await ctx.click($('#translate'));
    assert.strictEqual(writtenSince(ctx, since).translate, false);
});

// ---- the user edits preferences ----------------------------------------------------------

k.test('write-text', S_UI, 'a text field is stored trimmed, as a string', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#default_sign_name'), '  Ann Example  ');
    await userSets(ctx, $('#default_chatgpt_lang'), ' Italian ');
    const w = writtenSince(ctx, since);
    assert.strictEqual(w.default_sign_name, 'Ann Example');
    assert.strictEqual(w.default_chatgpt_lang, 'Italian');
});

k.test('write-select', S_UI, 'a select is stored as its value', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#reply_type'), 'reply_sender');
    await userSets(ctx, $('#diff_granularity'), 'sentences');
    const w = writtenSince(ctx, since);
    assert.strictEqual(w.reply_type, 'reply_sender');
    assert.strictEqual(w.diff_granularity, 'sentences');
});

k.test('write-number', S_UI, 'a number field is stored as a number', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#chatgpt_win_height'), '900');
    await userSets(ctx, $('#special_command_timeout'), '60000');
    await userSets(ctx, $('#batch_max_concurrency'), '3');
    const w = writtenSince(ctx, since);
    assert.strictEqual(w.chatgpt_win_height, 900);
    assert.strictEqual(w.special_command_timeout, 60000);
    assert.strictEqual(w.batch_max_concurrency, 3);
});

k.test('write-number-cleared', S_UI, 'a cleared batch_max_concurrency is saved as NaN', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#batch_max_concurrency'), '');
    const w = writtenSince(ctx, since);
    assert.ok('batch_max_concurrency' in w, 'nothing stored');
    assert.ok(Number.isNaN(w.batch_max_concurrency), String(w.batch_max_concurrency));
});

k.test('write-checkbox', S_UI, 'a switch is stored as a boolean', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#do_debug'), true);
    await userSets(ctx, $('#hide_thinking'), false);
    await userSets(ctx, $('#chatgpt_win_save_position'), true);
    const w = writtenSince(ctx, since);
    assert.strictEqual(w.do_debug, true);
    assert.strictEqual(w.hide_thinking, false);
    assert.strictEqual(w.chatgpt_win_save_position, true);
});

k.test('write-connection-field', S_GLOBAL, 'a provider field is stored flat under {provider}_{key}', async () => {
    const since = ctx.ctl.calls.length;
    await userSets(ctx, $('#chatgpt_api_key'), '  sk-test-1  ');
    const w = writtenSince(ctx, since);
    assert.strictEqual(w.chatgpt_api_key, 'sk-test-1');
});

k.test('adv-no-pref', S_ADV, 'expanding and collapsing the disclosure persists nothing', async () => {
    const since = ctx.ctl.calls.length;
    const btn = $('#mzta_conn_adv_btn');
    await ctx.click(btn);
    assert.equal($('#connection_ui_adv_table').classList.contains('hidden'), false);
    await ctx.click(btn);
    assert.equal($('#connection_ui_adv_table').classList.contains('hidden'), true);
    assert.deepEqual(ctx.localWrites(since), []);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
