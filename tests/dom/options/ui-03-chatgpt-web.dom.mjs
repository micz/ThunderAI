// The options page with ChatGPT Web as the global connection and every feature switched on,
// no policy.
//
// Spec 05 "Feature Rows — Disabled vs. API-Needed" (ChatGPT Web must not clear the flag, the
// Calendar / Task rows and the Sparks gate, the rows recomputed from storage.onChanged),
// "Feature 'Manage settings' Links — Hidden vs. Disabled", "Global Integration Settings"
// (max_prompt_length), "UI & Feature Preferences" (the usage-data row and its OpenAI Comp note),
// "Special Prompt Integration Overrides".
//
// The harness answers the Sparks presence check with null (not installed). The page asks again
// whenever its feature rows are recomputed, so this file replaces the mock's
// runtime.sendMessage for the Sparks id after the page has opened, then triggers a recompute.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { userSets } from '../../ui/dom-helpers.mjs';

const FLAGS = ['add_tags', 'spamfilter', 'summarize', 'translate', 'get_calendar_event', 'get_task'];
const ctx = await openPage('options', {
    local: { connection_type: 'chatgpt_web', ...Object.fromEntries(FLAGS.map(f => [f, true])) },
});
after(() => ctx.close());
const k = uiTests('options', '03');
const $ = ctx.$;

const S_GLOBAL = 'spec 05 "Global Integration Settings"';
const S_UI = 'spec 05 "UI & Feature Preferences"';
const S_OVERRIDES = 'spec 05 "Special Prompt Integration Overrides"';
const S_ROWS = 'spec 05 "Feature Rows — Disabled vs. API-Needed"';
const S_MANAGE = 'spec 05 "Feature \'Manage settings\' Links — Hidden vs. Disabled"';

const MANAGE = {
    add_tags: 'btnManageTagsInfo', spamfilter: 'btnManageSpamFilterInfo',
    summarize: 'btnManageSummarizeInfo', translate: 'btnManageTranslateInfo',
    get_calendar_event: 'btnManageCalendarEventInfo', get_task: 'btnManageTaskInfo',
};
const warnShown = prefix => $('#' + prefix + '_warn_API_needed').style.display === 'inline-block';
const rowsShown = cls => ctx.$$('.' + cls).every(r => r.style.display !== 'none');
const rowsHidden = cls => ctx.$$('.' + cls).every(r => r.style.display === 'none');

/** Sparks answers `version` (null: not installed) from now on. */
const SPARKS = 'thunderai-sparks@micz.it';
const realSend = ctx.ctl.browser.runtime.sendMessage;
let sparks = null;
ctx.ctl.browser.runtime.sendMessage = function (message, ...rest) {
    if (message === SPARKS) return Promise.resolve(sparks);
    return realSend.call(this, message, ...rest);
};
/** Recompute the feature rows the way another tab would: a relevant storage change. */
let bump = 0;
const recompute = async () => {
    await ctx.ctl.browser.storage.local.set({ spamfilter_connection_type: (bump++ % 2) ? '' : 'chatgpt_api' });
    await ctx.settle();
};

// ---- at load ---------------------------------------------------------------------------

k.test('web-keeps-flags', S_ROWS, 'ChatGPT Web leaves every flag on, the toggles clickable', () => {
    for (const p of ['add_tags', 'spamfilter', 'summarize', 'translate']) {
        assert.equal($('#' + p).checked, true, p + ' cleared');
        assert.equal($('#' + p).disabled, false, p + ' greyed');
    }
});

k.test('web-nothing-cleared', S_ROWS, 'no false is written for any flag', () => {
    for (const w of ctx.localWrites(0)) {
        for (const f of FLAGS) assert.notStrictEqual(w.items[f], false, f + ' written false');
    }
    for (const f of FLAGS) assert.strictEqual(ctx.ctl.localData()[f], true, f);
});

k.test('web-hint', S_ROWS, 'ChatGPT Web shows the "API needed" hint on the four rows', () => {
    for (const p of ['add_tags', 'spamfilter', 'summarize', 'translate']) {
        assert.equal(warnShown(p), true, p);
        assert.equal($('#' + p + '_warn_API_needed').textContent.trim(), msg('warn_API_needed'), p);
    }
    assert.equal($('#features_no_connection_note').classList.contains('shown'), false);
});

k.test('web-manage', S_MANAGE, 'the checked features keep their Manage button', () => {
    for (const p of ['add_tags', 'spamfilter', 'summarize', 'translate']) {
        assert.notEqual($('#' + MANAGE[p]).style.display, 'none', p);
    }
});

k.test('web-no-sparks', S_ROWS, 'without Sparks the calendar / task rows hide and the "not installed" notice shows', () => {
    assert.equal(rowsHidden('get_calendar_event_tr'), true);
    assert.equal(rowsHidden('get_task_tr'), true);
    assert.equal($('#no_sparks').style.display, 'block');
    assert.equal($('#no_sparks_text').style.display, 'inline');
    assert.equal($('#wrong_sparks_text').style.display, 'none');
});

k.test('web-max-prompt', S_GLOBAL, 'max_prompt_length is not offered with ChatGPT Web', () => {
    assert.equal($('#max_prompt_length').disabled, true);
});

k.test('web-usage-row', S_UI, 'a web-only setup never sees the usage-data row', () => {
    assert.equal($('#chat_show_usage_data_tr').style.display, 'none');
});

// ---- Sparks ------------------------------------------------------------------------------

k.test('sparks-present', S_ROWS, 'with Sparks the calendar / task rows show, clickable, with the hint, and no notice', async () => {
    sparks = '3.1.0';
    await recompute();
    assert.equal(rowsShown('get_calendar_event_tr'), true);
    assert.equal(rowsShown('get_task_tr'), true);
    for (const p of ['get_calendar_event', 'get_task']) {
        assert.equal($('#' + p).disabled, false, p);
        assert.equal($('#' + p).checked, true, p);
        assert.equal(warnShown(p), true, p + ' hint');
    }
    assert.equal($('#no_sparks').style.display, 'none');
});

k.test('sparks-present-manage', S_MANAGE, 'their Manage buttons show while they are checked', () => {
    for (const p of ['get_calendar_event', 'get_task']) assert.notEqual($('#' + MANAGE[p]).style.display, 'none', p);
});

k.test('sparks-own-api', S_ROWS, 'a calendar feature on its own API drops its hint; the other keeps it', async () => {
    await ctx.ctl.browser.storage.local.set({
        get_calendar_event_use_specific_integration: true,
        get_calendar_event_connection_type: 'chatgpt_api',
    });
    await ctx.settle();
    assert.equal(warnShown('get_calendar_event'), false);
    assert.equal(warnShown('get_task'), true);
    assert.notEqual($('#get_calendar_event_specific_api_indicator').style.display, 'none');
});

k.test('sparks-old', S_ROWS, 'an older Sparks (below 3.1.0) hides both rows and shows the "wrong version" notice', async () => {
    sparks = '3.0.9';
    await recompute();
    assert.equal(rowsHidden('get_calendar_event_tr'), true);
    assert.equal(rowsHidden('get_task_tr'), true);
    assert.equal($('#no_sparks').style.display, 'block');
    assert.equal($('#wrong_sparks_text').style.display, 'inline');
    assert.equal($('#no_sparks_text').style.display, 'none');
    sparks = '3.1.0';
    await recompute();
});

// ---- rows recomputed from another tab ----------------------------------------------------

k.test('onchanged-row', S_ROWS, 'a per-feature API configured in another tab drops that row\'s hint', async () => {
    await ctx.ctl.browser.storage.local.set({
        add_tags_use_specific_integration: true,
        add_tags_connection_type: 'anthropic_api',
    });
    await ctx.settle();
    assert.equal(warnShown('add_tags'), false);
    assert.equal(warnShown('translate'), true);
});

k.test('onchanged-pill', S_OVERRIDES, '... and its "Using <provider>" pill appears', () => {
    const pill = $('#add_tags_specific_api_indicator');
    assert.equal(pill.textContent, msg('prefs_specific_api_indicator', [msg('prefs_Connection_type_Anthropic_API')]));
    assert.notEqual(pill.style.display, 'none');
});

k.test('onchanged-usage-row', S_UI, 'a feature integration that reports usage brings the usage-data row', () => {
    assert.notEqual($('#chat_show_usage_data_tr').style.display, 'none');
});

k.test('openai-comp-note', S_UI, 'with OpenAI Compatible in use the server-dependent note shows', async () => {
    assert.equal($('#chat_show_usage_data_openai_comp_note').style.display, 'none');
    const sel = $('#connection_type');
    await userSets(ctx, sel, 'openai_comp_api');
    assert.notEqual($('#chat_show_usage_data_tr').style.display, 'none');
    assert.notEqual($('#chat_show_usage_data_openai_comp_note').style.display, 'none');
    await userSets(ctx, sel, 'chatgpt_web');
    assert.equal($('#chat_show_usage_data_openai_comp_note').style.display, 'none');
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
