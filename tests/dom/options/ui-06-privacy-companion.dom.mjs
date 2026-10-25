// The options page's ThunderAI Privacy switch, no policy.
//
// Spec 05 "Companion processing" (`ai_processing_enabled`, `updatePrivacyCompanion()`) and
// "Options Page Advanced Section (`#mzta_adv_panel`)" (its place, right before Debug); spec 09
// "Activation switch" (the row while a compatible companion answers or while the switch is on,
// the notice otherwise, the probe again on focus, the switch followed through storage.onChanged).
//
// The background's `probe` answer is this file's: `companion` below, read on every probe.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';

let companion = { installed: false, compatible: false };
const ctx = await openPage('options', {
    local: { connection_type: 'chatgpt_api' },
    commands: {
        ai_processing: ({ operation }) => {
            if (operation === 'probe') return companion;
            throw new Error(`Unmodelled processing operation: ${operation}`);
        },
    },
});
after(() => ctx.close());
const k = uiTests('options', '06');
const $ = ctx.$;

const S_COMPANION = 'spec 05 "Companion processing"';
const S_ADV = 'spec 05 "Options Page Advanced Section (`#mzta_adv_panel`)"';

const rowShown = () => $('#ai_processing_tr').style.display !== 'none';
/** The companion answers `answer` from now on; the page probes again when it gets the focus. */
const companionIs = async answer => {
    companion = answer;
    await ctx.fire(ctx.window, 'focus');
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
    assert.equal($('#ai_processing_enabled').checked, false);
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

k.test('present', S_COMPANION, 'a compatible companion: the row shows, the notice hides', async () => {
    await companionIs({ installed: true, compatible: true, version: '1.0.0' });
    assert.equal(rowShown(), true);
    assert.equal($('#no_privacy').style.display, 'none');
    assert.equal($('#ai_processing_enabled').disabled, false);
});

k.test('save', S_COMPANION, 'the switch is stored as a boolean on change', async () => {
    await ctx.click($('#ai_processing_enabled'));
    assert.strictEqual(ctx.ctl.localData().ai_processing_enabled, true);
});

k.test('stays-while-on', S_COMPANION, 'switched on, the row stays when the companion goes away, with the notice, so it can be switched off', async () => {
    await companionIs({ installed: false, compatible: false });
    assert.equal(rowShown(), true);
    assert.equal($('#no_privacy').style.display, 'block');
    await ctx.click($('#ai_processing_enabled'));
    assert.strictEqual(ctx.ctl.localData().ai_processing_enabled, false);
    assert.equal(rowShown(), false, 'off with no companion: back to the notice alone');
});

k.test('mirror', S_COMPANION, 'a write from elsewhere (the companion) is shown at once', async () => {
    await companionIs({ installed: true, compatible: true, version: '1.0.0' });
    await ctx.ctl.browser.storage.local.set({ ai_processing_enabled: true });
    await ctx.settle();
    assert.equal($('#ai_processing_enabled').checked, true);
    await ctx.ctl.browser.storage.local.set({ ai_processing_enabled: false });
    await ctx.settle();
    assert.equal($('#ai_processing_enabled').checked, false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
