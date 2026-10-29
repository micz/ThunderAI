// The options page's ThunderAI Privacy switch, no policy.
//
// Spec 05 "Companion processing" (`ai_processing_enabled`, `updatePrivacyCompanion()`) and
// "Options Page Advanced Section (`#mzta_adv_panel`)" (its place, right before Debug); spec 09
// "Activation switch" (the row while a compatible companion answers or while the switch is on,
// the notice otherwise, the probe again on focus, the switch followed through storage.onChanged)
// and "Model readiness" (the switch can be turned on only with the model ready, the download
// and settings buttons, the progress relayed by the background).
//
// The background's answers are this file's: `companion` below for `probe`, `downloaded` for
// `downloadModel`; `opened` counts `openSettings`.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

const READY = { installed: true, compatible: true, version: '1.0.0', ready: true, downloading: false, progress: null, error: null };
let companion = { installed: false, compatible: false };
let downloaded = { ready: false, downloading: true, progress: 0, error: null };
let opened = 0;
const ctx = await openPage('options', {
    local: { connection_type: 'chatgpt_api' },
    commands: {
        ai_processing: ({ operation }) => {
            if (operation === 'probe') return companion;
            if (operation === 'downloadModel') return downloaded;
            if (operation === 'openSettings') { ++opened; return {}; }
            throw new Error(`Unmodelled processing operation: ${operation}`);
        },
    },
});
after(() => ctx.close());
const k = uiTests('options', '06');
const $ = ctx.$;

const S_COMPANION = 'spec 05 "Companion processing"';
const S_ADV = 'spec 05 "Options Page Advanced Section (`#mzta_adv_panel`)"';
const S_READY = 'spec 09 "Model readiness"';

const shown = sel => $(sel).style.display !== 'none';
const rowShown = () => shown('#ai_processing_tr');
const toggle = () => $('#ai_processing_enabled');
/** The companion answers `answer` from now on; the page probes again when it gets the focus. */
const companionIs = async answer => {
    companion = answer;
    await ctx.fire(ctx.window, 'focus');
};
/** The background relays a change of the companion's model to the page. */
const modelChanged = async model => {
    await ctx.ctl.dispatchMessage({ command: 'ai_processing_readiness', ...model }, { id: 'thunderai@micz.it' });
    await ctx.settle();
};

// ---- at load: no companion ---------------------------------------------------------------

k.test('absent', S_COMPANION, 'with no companion and the switch off, the row hides and the "not installed" notice shows', () => {
    assert.equal(rowShown(), false);
    assert.equal($('#no_privacy').style.display, 'block');
    assert.equal($('#no_privacy_text').style.display, 'inline');
    assert.equal($('#wrong_privacy_text').style.display, 'none');
    assert.equal($('#no_privacy_text').textContent.trim(), msg('prefs_OptionText_ai_processing_Privacy_not_present'));
    assert.match($('#no_privacy a').href, /addons\.thunderbird\.net\/.*thunderai-privacy/);
});

k.test('place', S_ADV, 'the switch and its notice sit in the advanced panel, right before Debug', () => {
    const panel = $('#mzta_adv_panel');
    assert.ok(panel.contains($('#ai_processing_tr')));
    assert.equal($('#ai_processing_tr').nextElementSibling, $('#no_privacy'));
    assert.ok($('#no_privacy').nextElementSibling.contains($('#do_debug')));
});

k.test('default-off', S_COMPANION, 'the switch is off by default and nothing is written at load', () => {
    assert.equal(toggle().checked, false);
    assert.equal(Object.hasOwn(ctx.ctl.localData(), 'ai_processing_enabled'), false);
});

// ---- the companion answers ---------------------------------------------------------------

k.test('incompatible', S_COMPANION, 'an incompatible companion: no row, the "not compatible" notice', async () => {
    await companionIs({ installed: true, compatible: false });
    assert.equal(rowShown(), false);
    assert.equal($('#no_privacy').style.display, 'block');
    assert.equal($('#no_privacy_text').style.display, 'none');
    assert.equal($('#wrong_privacy_text').style.display, 'inline');
});

k.test('model-missing', S_READY, 'installed without its model: the switch shows but cannot be turned on, with the note and both buttons', async () => {
    await companionIs({ ...READY, ready: false });
    assert.equal(rowShown(), true);
    assert.equal($('#no_privacy').style.display, 'none');
    assert.equal(toggle().disabled, true);
    assert.equal(shown('#ai_processing_model'), true);
    assert.equal($('#ai_processing_model_missing').textContent.trim(), msg('prefs_OptionText_ai_processing_model_missing'));
    assert.equal(shown('#ai_processing_model_progress'), false);
    assert.equal(shown('#btnAiProcessingDownload'), true);
    assert.equal($('#btnAiProcessingDownload').disabled, false);
    assert.equal(shown('#btnAiProcessingOpenSettings'), true);
});

k.test('download', S_READY, 'Download asks the companion and shows the progress, the button disabled meanwhile', async () => {
    await ctx.click($('#btnAiProcessingDownload'));
    assert.equal(shown('#ai_processing_model_missing'), false);
    assert.equal($('#ai_processing_model_downloading').textContent, msg('prefs_OptionText_ai_processing_model_downloading', ['0']));
    assert.equal(shown('#ai_processing_model_progress'), true);
    assert.equal($('#btnAiProcessingDownload').disabled, true);
    assert.equal(toggle().disabled, true);
});

k.test('progress', S_READY, 'the progress relayed by the background is drawn without asking again', async () => {
    await modelChanged({ ready: false, downloading: true, progress: 42, error: null });
    assert.equal($('#ai_processing_model_downloading').textContent, msg('prefs_OptionText_ai_processing_model_downloading', ['42']));
    assert.equal($('#ai_processing_model_progress').value, 42);
});

k.test('download-failed', S_READY, 'a failed download shows the companion\'s error and offers the button again', async () => {
    await modelChanged({ ready: false, downloading: false, progress: null, error: 'The model download failed.' });
    assert.equal($('#ai_processing_model_error').textContent, 'The model download failed.');
    assert.equal(shown('#ai_processing_model_missing'), true);
    assert.equal($('#btnAiProcessingDownload').disabled, false);
});

k.test('download-done', S_READY, 'once the model is ready the switch can be turned on and the model note goes', async () => {
    await modelChanged({ ready: true, downloading: false, progress: null, error: null });
    assert.equal(toggle().disabled, false);
    assert.equal(shown('#ai_processing_model'), false);
    assert.equal(shown('#btnAiProcessingDownload'), false);
    assert.equal(shown('#btnAiProcessingOpenSettings'), true);
});

k.test('open-settings', S_READY, 'the settings button asks the companion to open its page', async () => {
    await ctx.click($('#btnAiProcessingOpenSettings'));
    assert.equal(opened, 1);
});

k.test('present', S_COMPANION, 'a compatible companion with its model: the row shows, the notice hides', async () => {
    await companionIs(READY);
    assert.equal(rowShown(), true);
    assert.equal($('#no_privacy').style.display, 'none');
    assert.equal(toggle().disabled, false);
});

k.test('save', S_COMPANION, 'the switch is stored as a boolean on change', async () => {
    await ctx.click(toggle());
    assert.strictEqual(ctx.ctl.localData().ai_processing_enabled, true);
});

k.test('off-without-model', S_READY, 'switched on, the model gone: the switch can still be turned off', async () => {
    await companionIs({ ...READY, ready: false });
    assert.equal(toggle().checked, true);
    assert.equal(toggle().disabled, false);
});

k.test('stays-while-on', S_COMPANION, 'switched on, the row stays when the companion goes away, with the notice, so it can be switched off', async () => {
    await companionIs({ installed: false, compatible: false });
    assert.equal(rowShown(), true);
    assert.equal($('#no_privacy').style.display, 'block');
    assert.equal(toggle().disabled, false);
    assert.equal(shown('#ai_processing_actions'), false, 'no companion: nothing to download or open');
    await ctx.click(toggle());
    assert.strictEqual(ctx.ctl.localData().ai_processing_enabled, false);
    assert.equal(rowShown(), false, 'off with no companion: back to the notice alone');
});

k.test('mirror', S_COMPANION, 'a write from elsewhere (the companion) is shown at once', async () => {
    await companionIs(READY);
    await ctx.ctl.browser.storage.local.set({ ai_processing_enabled: true });
    await ctx.settle();
    assert.equal(toggle().checked, true);
    await ctx.ctl.browser.storage.local.set({ ai_processing_enabled: false });
    await ctx.settle();
    assert.equal(toggle().checked, false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
