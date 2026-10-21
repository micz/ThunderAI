// Group D: the message-display panels, on the captured HTML mail displayed as message
// "msg-A@example.com". The background commands are delivered as the background sends them; the
// commands the panels send back (trigger, refresh, remove) are recorded.
//
// Spec 01 "Data Flow: Inline Summary / Translation on Message Display" (the script sends initSummary
// and initTranslation at load; the result renders as a banner). Spec 01 "Stale-result guard (rapid
// message switching)": a generating panel is drawn only for the script's own message, with a
// non-empty id; each result command bumps a per-feature counter, and a generating command that sees
// it moved does nothing ("a result can never be painted over by a late spinner"); hide... is
// message-aware with an id, unconditional without; the buttons remove the generating panel; the
// generating panels remove the toolbar button (spec 01 "In-flight jobs": "Queued messages").
// Spec 05 "Mandatory Specific Integration" ("Deleting a result redraws its button": the banner's
// Delete sends removeSummary / removeTranslation). Spec 05 "Feature Flags" (*_max_display_length:
// truncated at a word boundary, a See more / See less toggle). Spec 04 "Batch cancellation" ("Generic
// panels": the ids, the dismiss control, clearGeneric*). Spec 01 "Panel HTML sanitization": plain
// summary, translated_subject, error messages, the spam report and showGeneric* through textContent.
// Spec 01 "Key Modules" (js/mzta-compose-script.js): the toolbar (spam badge, summary / translation
// buttons) and the panels (generic error, spam explanation, summary, translation) in #mzta-container.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import {
    assertHarnessClean,
    msg,
} from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    DISPLAY_URL,
    openMailDocument,
    readCapture,
    send,
    sentCommands,
} from '../../compose/compose-doc.mjs';

const ID = 'msg-A@example.com';
const OTHER = 'msg-B@example.com';
const capture = readCapture('mail_html_reading.txt', { encoding: 'latin1' });
const recorded = () => true;
const ctx = await openMailDocument({
    url: DISPLAY_URL,
    displayedMessageId: ID,
    html: '<!DOCTYPE html><html><head></head><body><div class="moz-text-html" lang="x-unicode">'
        + capture.body + '</div></body></html>',
    commands: Object.fromEntries(['triggerSummaryGeneration', 'triggerSummaryWebchat', 'triggerTranslationGeneration',
        'refreshSummary', 'removeSummary', 'refreshTranslation', 'removeTranslation', 'refreshSpamReport',
        'removeSpamReport'].map(c => [c, recorded])),
});
after(() => ctx.close());
const k = composeTests('10');

const S_SUMMARY = 'spec 01 "Data Flow: Inline Summary on Message Display"';
const S_TRANSLATION = 'spec 01 "Data Flow: Inline Translation on Message Display"';
const S_STALE = 'spec 01 "Stale-result guard (rapid message switching)"';
const S_JOBS = 'spec 01 "In-flight jobs (`taJobRegistry`)"';
const S_DELETE = 'spec 05 "Mandatory Specific Integration (feature settings pages)"';
const S_FLAGS = 'spec 05 "Feature Flags"';
const S_GENERIC = 'spec 04 "Batch cancellation (user-triggered stop)"';
const S_MODULES = 'spec 01 "Key Modules"';

const $ = sel => ctx.$(sel);
const toolbarIds = () => [...$('#mzta-toolbar').children].map(el => el.id);
const panelIds = () => [...$('#mzta-panels').children].map(el => el.id);
const toolbarShown = () => $('#mzta-toolbar').style.display === 'flex';

/** The row of a panel's ⋮ menu whose label is that message. */
function menuRow(panel, key) {
    const label = [...panel.querySelectorAll('span')].find(s => s.textContent === msg(key));
    assert.ok(label, 'menu entry ' + key);
    return label.parentElement;
}

const summary = (data = {}) => send(ctx, { command: 'showSummary', data: { summary: 'A weekly update.', headerMessageId: ID, ...data } });
const translation = (data = {}) => send(ctx, { command: 'showTranslation',
    data: { translated_text: 'Good morning.', translated_subject: 'Weekly update', lang: 'en', headerMessageId: ID, ...data } });

// --- load ------------------------------------------------------------------------------------

k.test('load-asks', S_SUMMARY, 'at load the script asks for its displayed message and sends initSummary and initTranslation', () => {
    assert.equal(sentCommands(ctx, 'getDisplayedMessageId').length, 1);
    assert.equal(sentCommands(ctx, 'initSummary').length, 1);
    assert.equal(sentCommands(ctx, 'initTranslation').length, 1);
});

// --- summary -------------------------------------------------------------------------------

k.test('summary-button', S_SUMMARY, 'the "click to generate" button shows in the toolbar', async () => {
    assert.equal(await send(ctx, { command: 'showSummaryButton', headerMessageId: ID }), true);
    assert.ok($('#mzta-toolbar-summary'));
    assert.ok(toolbarShown());
    assert.ok($('#mzta-toolbar-summary').textContent.includes(msg('get_ai_summary')));
});

k.test('summary-generating-other', S_STALE, 'a generating panel for another message is not drawn', async () => {
    assert.equal(await send(ctx, { command: 'showSummaryGenerating', headerMessageId: OTHER }), false);
    assert.equal(await send(ctx, { command: 'showSummaryGenerating', headerMessageId: '' }), false);
    assert.equal($('#mzta-summary-generating'), null);
    assert.ok($('#mzta-toolbar-summary'), 'the button stays');
});

k.test('summary-generating-own', S_JOBS, 'its own generating panel replaces the toolbar button', async () => {
    assert.equal(await send(ctx, { command: 'showSummaryGenerating', headerMessageId: ID }), true);
    assert.ok($('#mzta-summary-generating'));
    assert.equal($('#mzta-toolbar-summary'), null);
    assert.equal(toolbarShown(), false, 'an empty toolbar is hidden');
});

k.test('summary-hide-other', S_STALE, 'hideSummaryGenerating for another message leaves the panel', async () => {
    assert.equal(await send(ctx, { command: 'hideSummaryGenerating', headerMessageId: OTHER }), false);
    assert.ok($('#mzta-summary-generating'));
});

k.test('summary-result', S_SUMMARY, 'the result replaces the generating panel with the summary banner', async () => {
    assert.equal(await summary(), true);
    assert.equal($('#mzta-summary-generating'), null);
    assert.ok($('#mzta-summary-banner').textContent.includes('A weekly update.'));
});

k.test('summary-replaced', S_SUMMARY, 'a new result replaces the banner: one banner, the new text', async () => {
    await summary({ summary: 'Second summary.' });
    assert.equal(ctx.$$('#mzta-summary-banner').length, 1);
    assert.ok($('#mzta-summary-banner').textContent.includes('Second summary.'));
    assert.ok(!$('#mzta-summary-banner').textContent.includes('A weekly update.'));
});

k.test('summary-late-spinner', S_STALE, 'a generating command still resolving when the result arrives is not drawn over it', async () => {
    const gen = ctx.ctl.dispatchMessage({ command: 'showSummaryGenerating', headerMessageId: ID }, { id: 'thunderai@micz.it' });
    const res = ctx.ctl.dispatchMessage({ command: 'showSummary', data: { summary: 'Fresh result.', headerMessageId: ID } }, { id: 'thunderai@micz.it' });
    assert.equal(await gen, false);
    assert.equal(await res, true);
    await ctx.settle();
    assert.equal($('#mzta-summary-generating'), null);
    assert.ok($('#mzta-summary-banner').textContent.includes('Fresh result.'));
});

k.test('summary-text-plain', 'spec 01 "Stale-result guard (rapid message switching)"', 'a plain summary and an error message are text, never markup', async () => {
    await summary({ summary: '<img src=x onerror=alert(1)> & <b>x</b>' });
    assert.equal($('#mzta-summary-banner img[src="x"], #mzta-summary-banner b'), null);
    assert.ok($('#mzta-summary-banner').textContent.includes('<img src=x onerror=alert(1)> & <b>x</b>'));
    await summary({ error: true, message: '<b>Rate limited</b>' });
    assert.ok($('#mzta-summary-banner').textContent.includes('<b>Rate limited</b>'));
    assert.equal($('#mzta-summary-banner b'), null);
});

k.test('summary-strip-formatting', S_SUMMARY, 'stripFormatting shows the plain summary, not the html', async () => {
    await summary({ summary: 'Plain one.', summary_html: '<p><b>Html</b> one.</p>', stripFormatting: true });
    assert.ok($('#mzta-summary-banner').textContent.includes('Plain one.'));
    assert.equal($('#mzta-summary-banner b'), null);
});

k.test('summary-max-length', S_FLAGS, 'max display length: cut at a word boundary, See more shows it all, See less again', async () => {
    const full = 'one two three four five six seven eight nine ten';
    await summary({ summary: full, maxDisplayLength: 12 });
    const content = $('#mzta-summary-banner .thunderai-summary-content');
    const shown = content.textContent;
    assert.ok(shown.length < full.length, shown);
    const kept = shown.replace(/…$/, '');
    assert.ok(full.startsWith(kept) && full[kept.length] === ' ', 'cut at a word boundary: ' + JSON.stringify(shown));
    const toggle = [...$('#mzta-summary-banner').querySelectorAll('a')].find(a => a.textContent === msg('summarize_see_more'));
    assert.ok(toggle, 'See more');
    await ctx.click(toggle);
    assert.equal(content.textContent, full);
    assert.equal(toggle.textContent, msg('summarize_see_less'));
});

k.test('summary-refresh', S_JOBS, 'Refresh in the banner menu asks the background to refresh this message', async () => {
    await summary();
    await ctx.click(menuRow($('#mzta-summary-banner'), 'summarize_refresh'));
    assert.deepEqual(sentCommands(ctx, 'refreshSummary').map(m => m.headerMessageId), [ID]);
});

k.test('summary-delete', S_DELETE, 'Delete in the banner menu removes the banner and sends removeSummary', async () => {
    await summary();
    await ctx.click(menuRow($('#mzta-summary-banner'), 'summarize_delete'));
    assert.equal($('#mzta-summary-banner'), null);
    assert.deepEqual(sentCommands(ctx, 'removeSummary').map(m => m.headerMessageId), [ID]);
});

k.test('summary-button-clears-spinner', S_STALE, 'the button removes a generating panel, and a click triggers the generation for this message', async () => {
    await send(ctx, { command: 'showSummaryGenerating', headerMessageId: ID });
    await send(ctx, { command: 'showSummaryButton', headerMessageId: ID });
    assert.equal($('#mzta-summary-generating'), null);
    await ctx.click($('#mzta-toolbar-summary'));
    assert.equal($('#mzta-toolbar-summary'), null);
    assert.deepEqual(sentCommands(ctx, 'triggerSummaryGeneration').map(m => m.headerMessageId), [ID]);
});

k.test('summary-hide-unconditional', S_STALE, 'hideSummaryGenerating without an id removes the panel', async () => {
    await send(ctx, { command: 'showSummaryGenerating', headerMessageId: ID });
    assert.equal(await send(ctx, { command: 'hideSummaryGenerating' }), true);
    assert.equal($('#mzta-summary-generating'), null);
});

// --- translation ---------------------------------------------------------------------------

k.test('translation-flow', S_TRANSLATION, 'button, generating panel (own message only), then the banner with the subject', async () => {
    await send(ctx, { command: 'showTranslationButton', headerMessageId: ID });
    assert.ok($('#mzta-toolbar-translation').textContent.includes(msg('get_ai_translation')));
    assert.equal(await send(ctx, { command: 'showTranslationGenerating', headerMessageId: OTHER }), false);
    assert.equal(await send(ctx, { command: 'showTranslationGenerating', headerMessageId: ID }), true);
    assert.equal($('#mzta-toolbar-translation'), null);
    await translation();
    assert.equal($('#mzta-translation-generating'), null);
    const banner = $('#mzta-translation-banner');
    assert.ok(banner.textContent.includes('Good morning.') && banner.textContent.includes('Weekly update'), banner.textContent);
});

k.test('translation-late-spinner', S_STALE, 'a late translation spinner is not drawn over the result', async () => {
    const gen = ctx.ctl.dispatchMessage({ command: 'showTranslationGenerating', headerMessageId: ID }, { id: 'thunderai@micz.it' });
    const res = ctx.ctl.dispatchMessage({ command: 'showTranslation', data: { translated_text: 'Late-proof.', headerMessageId: ID } }, { id: 'thunderai@micz.it' });
    assert.equal(await gen, false);
    assert.equal(await res, true);
    await ctx.settle();
    assert.equal($('#mzta-translation-generating'), null);
    assert.ok($('#mzta-translation-banner').textContent.includes('Late-proof.'));
});

k.test('translation-subject-text', 'spec 01 "Stale-result guard (rapid message switching)"', 'the translated subject and a plain translation are text', async () => {
    await translation({ translated_subject: '<img src=x onerror=alert(1)>', translated_text: 'a < b & c' });
    const banner = $('#mzta-translation-banner');
    assert.equal(banner.querySelector('img[src="x"]'), null);
    assert.ok(banner.textContent.includes('<img src=x onerror=alert(1)>') && banner.textContent.includes('a < b & c'));
});

k.test('translation-delete', S_DELETE, 'Delete in the banner menu removes the banner and sends removeTranslation', async () => {
    await translation();
    await ctx.click(menuRow($('#mzta-translation-banner'), 'translate_delete'));
    assert.equal($('#mzta-translation-banner'), null);
    assert.deepEqual(sentCommands(ctx, 'removeTranslation').map(m => m.headerMessageId), [ID]);
});

k.test('translation-button-click', S_TRANSLATION, 'the button triggers the translation of this message', async () => {
    await send(ctx, { command: 'showTranslationButton', headerMessageId: ID });
    await ctx.click($('#mzta-toolbar-translation'));
    assert.equal($('#mzta-toolbar-translation'), null);
    assert.deepEqual(sentCommands(ctx, 'triggerTranslationGeneration').map(m => m.headerMessageId), [ID]);
});

// --- spam --------------------------------------------------------------------------------------

k.test('spam-progress-then-report', S_MODULES, 'the spam badge: "check in progress", then the score and the explanation, as text', async () => {
    await send(ctx, { command: 'showSpamCheckInProgress' });
    assert.ok($('#mzta-toolbar-spam').textContent.includes(msg('spam_check_in_progress')));
    await send(ctx, { command: 'showSpamReport',
        data: { spamValue: 85, SpamThreshold: 70, explanation: '<b>Phishing</b> link', headerMessageId: ID } });
    const badge = $('#mzta-toolbar-spam');
    assert.ok(!badge.textContent.includes(msg('spam_check_in_progress')));
    assert.ok(badge.textContent.includes('85') && badge.textContent.includes('<b>Phishing</b> link'), badge.textContent);
    assert.equal(badge.querySelector('b'), null);
    assert.equal(ctx.$$('#mzta-toolbar-spam').length, 1);
});

k.test('spam-delete', S_MODULES, 'Delete in the badge menu removes the badge and sends removeSpamReport', async () => {
    await ctx.click(menuRow($('#mzta-toolbar-spam'), 'spamfilter_delete'));
    assert.equal($('#mzta-toolbar-spam'), null);
    assert.deepEqual(sentCommands(ctx, 'removeSpamReport').map(m => m.headerMessageId), [ID]);
});

// --- generic panels ----------------------------------------------------------------------------

k.test('generic-error', S_GENERIC, 'showGenericError draws #mzta-generic-error with the message as text; a second replaces it', async () => {
    await send(ctx, { command: 'showGenericError', data: { message: '<b>first</b>', source: 'Add tags' } });
    await send(ctx, { command: 'showGenericError', data: { message: 'second', source: 'Add tags' } });
    assert.equal(ctx.$$('#mzta-generic-error').length, 1);
    assert.ok($('#mzta-generic-error').textContent.includes('second'));
    await send(ctx, { command: 'showGenericError', data: { message: '<b>third</b>' } });
    assert.ok($('#mzta-generic-error').textContent.includes('<b>third</b>'));
    assert.equal($('#mzta-generic-error b'), null);
});

k.test('generic-error-dismiss', S_GENERIC, 'the dismiss control removes the error panel', async () => {
    await ctx.click(menuRow($('#mzta-generic-error'), 'generic_error_dismiss'));
    assert.equal($('#mzta-generic-error'), null);
});

k.test('generic-clear', S_GENERIC, 'clearGenericError / clearGenericInfo remove the panels', async () => {
    await send(ctx, { command: 'showGenericError', data: { message: 'e' } });
    await send(ctx, { command: 'showGenericInfo', data: { message: 'i' } });
    assert.ok($('#mzta-generic-error') && $('#mzta-generic-info'));
    await send(ctx, { command: 'clearGenericError' });
    await send(ctx, { command: 'clearGenericInfo' });
    assert.equal($('#mzta-generic-error'), null);
    assert.equal($('#mzta-generic-info'), null);
});

// --- order -------------------------------------------------------------------------------------

k.test('order', S_MODULES, 'whatever the arrival order: toolbar spam, summary, translation; panels generic error, generic info, translation, summary', async () => {
    await send(ctx, { command: 'showTranslationButton', headerMessageId: ID });
    await send(ctx, { command: 'showSummaryButton', headerMessageId: ID });
    await send(ctx, { command: 'showSpamReport', data: { spamValue: 3, SpamThreshold: 70, explanation: 'ok', headerMessageId: ID } });
    await summary();
    await translation();
    await send(ctx, { command: 'showGenericInfo', data: { message: 'i' } });
    await send(ctx, { command: 'showGenericError', data: { message: 'e' } });
    // showSummary / showTranslation removed their buttons; the badge alone is left in the toolbar.
    assert.deepEqual(toolbarIds(), ['mzta-toolbar-spam']);
    await send(ctx, { command: 'showTranslationButton', headerMessageId: ID });
    await send(ctx, { command: 'showSummaryButton', headerMessageId: ID });
    assert.deepEqual(toolbarIds(), ['mzta-toolbar-spam', 'mzta-toolbar-summary', 'mzta-toolbar-translation']);
    assert.deepEqual(panelIds(), ['mzta-generic-error', 'mzta-generic-info', 'mzta-translation-banner', 'mzta-summary-banner']);
    assert.equal(ctx.document.body.firstElementChild.id, 'mzta-container', 'above the mail');
});

const S_PANELS = 'spec 01 "The message-display panels and dialogs (`js/mzta-compose-script.js`)"';

k.test('summary-button-webchat', S_PANELS, 'a summary button drawn for the webchat display mode triggers the webchat summary', async () => {
    await summary();      // removes the summary button left by the order test
    await send(ctx, { command: 'showSummaryButton', headerMessageId: ID, webchat: true });
    await ctx.click($('#mzta-toolbar-summary'));
    assert.equal($('#mzta-toolbar-summary'), null);
    assert.deepEqual(sentCommands(ctx, 'triggerSummaryWebchat').map(m => m.headerMessageId), [ID]);
});

k.test('translation-skipped', S_PANELS, 'a skipped translation shows the "skipped" message, not a text', async () => {
    await translation({ translated_text: 'should not show', translation_status: '-1' });
    const banner = $('#mzta-translation-banner');
    assert.ok(banner.textContent.includes(msg('translate_skipped')), banner.textContent);
    assert.ok(!banner.textContent.includes('should not show'));
});

k.test('generic-prefix', S_PANELS, 'the generic panels read "[ThunderAI | source] message", "[ThunderAI] message" with no source', async () => {
    await send(ctx, { command: 'showGenericError', data: { message: 'Tagging failed.', source: 'Add tags' } });
    assert.ok($('#mzta-generic-error').textContent.includes('[ThunderAI | Add tags] Tagging failed.'));
    await send(ctx, { command: 'showGenericInfo', data: { message: 'Done.' } });
    assert.ok($('#mzta-generic-info').textContent.includes('[ThunderAI] Done.'));
});

k.test('harness-clean', S_SUMMARY, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
