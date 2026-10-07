// The background side of "Data Flow: Inline Translation on Message Display" (spec 01), with spec 02
// "Translate: Inline-Only Prompt System":
//  - initTranslation: translate_auto 0 -> nothing; 1 -> the "click to translate" button; 2 ->
//    generate at once (never in an auto-skipped folder); a cached translation is always shown;
//  - the target language is translate_lang, falling back on default_chatgpt_lang;
//  - the AI answer is a JSON object {subject, body, status}: status "1" a translation, "-1" skipped;
//  - triggerTranslationGeneration / refreshTranslation / removeTranslation, as for the summary.
// Spec 01 "In-flight jobs": the missing translate language is a guard that must neither create a
// job nor write the store. The manual trigger then alerts translate_no_language_configured (code
// path of triggerTranslationGeneration) and gives the button back.
// Spec 01 "Panel HTML sanitization": showTranslation's translated_text is sanitized only when it
// looks like HTML (/<[a-z][^>]*>/i); plain text is left untouched; the stored object never changes.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import {
    API,
    featureResponder,
    sentPrompts,
    record,
    fromTab,
    setPrefs,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const answers = {};
const ctx = await bgContext({
    local: {
        ...API,
        summarize: false,
        translate: true,
        translate_auto: 1,
        translate_lang: 'German',
        default_chatgpt_lang: 'Italian',
    },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
        m.addTab({ id: 8, type: 'messageDisplay', windowId: 2 });
    },
});
ctx.workers.respond = featureResponder({
    translation: hid => answers[hid] ?? JSON.stringify({ subject: 'Betreff', body: 'Text ' + hid, status: '1' }),
});
const k = caseTests('26-inline-translation');
const show = (tabId, hid, folderId = 'f-inbox') => {
    const h = ctx.m.byHeaderId(hid) || ctx.m.addMessage({ headerMessageId: hid, folderId });
    ctx.m.tab(tabId).displayed = h.id;
    return h;
};
const calls = hid => sentPrompts(ctx).filter(p => p.feature === 'translation' && p.message === hid).length;
const reset = () => { ctx.m.tabSends.length = 0; };

k.test('auto1-button', 'translate_auto = 1: the tab gets the manual button for its message, nothing is generated', async () => {
    show(7, 'b1@x');
    reset();
    await fromTab(ctx, 7, { command: 'initTranslation' });
    assert.deepEqual(ctx.m.sentTo(7), [{ command: 'showTranslationButton', headerMessageId: 'b1@x' }]);
    assert.equal(calls('b1@x'), 0);
});

k.test('trigger', 'the button: the generating panel, then the translation, stored on that message in translate_lang', async () => {
    reset();
    await fromTab(ctx, 7, { command: 'triggerTranslationGeneration', headerMessageId: 'b1@x' });
    const cmds = ctx.m.commandsTo(7);
    assert.equal(cmds[0], 'showTranslationGenerating');
    assert.equal(cmds[cmds.length - 1], 'showTranslation');
    const data = ctx.m.sentTo(7, 'showTranslation')[0].data;
    assert.equal(data.headerMessageId, 'b1@x');
    assert.equal(data.translated_text, 'Text b1@x');
    assert.equal(data.translated_subject, 'Betreff');
    const t = record(ctx, 'b1@x').translation;
    assert.equal(t.lang, 'German');
    assert.equal(t.translation_status, '1');
});

k.test('prompt-language', 'the prompt asks for translate_lang', () => {
    const p = ctx.workers.prompts().find(x => x.includes('b1@x'));
    assert.match(p, /German/);
});

k.test('cached', 'opening a message with a cached translation shows it at once, with no API call', async () => {
    reset();
    await fromTab(ctx, 7, { command: 'initTranslation' });
    assert.deepEqual(ctx.m.commandsTo(7), ['showTranslation']);
    assert.equal(calls('b1@x'), 1);
});

k.test('skipped-status', 'status "-1" (the language is excluded, or already the target): stored and shown as skipped', async () => {
    answers['sk1@x'] = JSON.stringify({ subject: '', body: '', status: '-1' });
    show(7, 'sk1@x');
    reset();
    await fromTab(ctx, 7, { command: 'triggerTranslationGeneration', headerMessageId: 'sk1@x' });
    assert.equal(record(ctx, 'sk1@x').translation.translation_status, '-1');
    assert.equal(ctx.m.sentTo(7, 'showTranslation')[0].data.translation_status, '-1');
});

k.test('html-sanitized', 'an HTML translation crosses the sanitizer on its way to the tab; the stored one is untouched', async () => {
    answers['h1@x'] = JSON.stringify({ subject: 'S', body: '<p>Hallo <b>Welt</b></p>', status: '1' });
    show(7, 'h1@x');
    reset();
    await fromTab(ctx, 7, { command: 'triggerTranslationGeneration', headerMessageId: 'h1@x' });
    assert.equal(ctx.m.sentTo(7, 'showTranslation')[0].data.translated_text, '<!--sanitized--><p>Hallo <b>Welt</b></p>');
    assert.equal(record(ctx, 'h1@x').translation.translated_text, '<p>Hallo <b>Welt</b></p>');
});

k.test('plain-not-sanitized', 'a plain-text translation is handed on as it is (a < b stays a < b)', async () => {
    answers['p1@x'] = JSON.stringify({ subject: 'S', body: 'a < b & c', status: '1' });
    show(7, 'p1@x');
    reset();
    const before = ctx.standIns.sanitizeBlockHtml.length;
    await fromTab(ctx, 7, { command: 'triggerTranslationGeneration', headerMessageId: 'p1@x' });
    assert.equal(ctx.m.sentTo(7, 'showTranslation')[0].data.translated_text, 'a < b & c');
    assert.equal(ctx.standIns.sanitizeBlockHtml.length, before, 'the sanitizer is not called on plain text');
});

k.test('remove', 'removeTranslation drops the stored translation and draws the button again', async () => {
    reset();
    await fromTab(ctx, 7, { command: 'removeTranslation', headerMessageId: 'p1@x' });
    assert.equal(record(ctx, 'p1@x')?.translation, undefined);
    assert.deepEqual(ctx.m.sentTo(7), [{ command: 'showTranslationButton', headerMessageId: 'p1@x' }]);
});

k.test('refresh', 'refreshTranslation regenerates with a new API call', async () => {
    answers['b1@x'] = JSON.stringify({ subject: 'Neu', body: 'Neuer Text', status: '1' });
    show(7, 'b1@x');
    reset();
    await fromTab(ctx, 7, { command: 'refreshTranslation', headerMessageId: 'b1@x' });
    assert.equal(record(ctx, 'b1@x').translation.translated_text, 'Neuer Text');
    assert.equal(calls('b1@x'), 2);
});

k.test('lang-fallback', 'with no translate_lang the target language is default_chatgpt_lang', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { translate_lang: '' });
    show(7, 'fb1@x');
    await fromTab(ctx, 7, { command: 'triggerTranslationGeneration', headerMessageId: 'fb1@x' });
    assert.equal(record(ctx, 'fb1@x').translation.lang, 'Italian');
});

k.test('no-language', 'no language at all: no job, nothing stored, the user is told and the button comes back', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { translate_lang: '', default_chatgpt_lang: '' });
    show(7, 'nl1@x');
    reset();
    await fromTab(ctx, 7, { command: 'triggerTranslationGeneration', headerMessageId: 'nl1@x' });
    assert.equal(calls('nl1@x'), 0);
    assert.equal(record(ctx, 'nl1@x'), null);
    const alert = ctx.m.sentTo(7, 'sendAlert');
    assert.equal(alert.length, 1);
    assert.equal(alert[0].message, ctx.ctl.browser.i18n.getMessage('translate_no_language_configured'));
    assert.equal(ctx.m.commandsTo(7).pop(), 'showTranslationButton');
});

k.test('auto2-generates', 'translate_auto = 2: opening a message translates it at once', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { translate_auto: 2, default_chatgpt_lang: 'Italian' });
    show(7, 'a2@x');
    reset();
    await fromTab(ctx, 7, { command: 'initTranslation' });
    assert.deepEqual(ctx.m.commandsTo(7), ['showTranslationGenerating', 'showTranslation']);
    assert.ok(record(ctx, 'a2@x').translation);
});

k.test('auto2-skipped-folder', 'translate_auto = 2: a draft opened is not translated automatically', async () => {
    show(7, 'dr1@x', 'f-drafts');
    await fromTab(ctx, 7, { command: 'initTranslation' });
    assert.equal(calls('dr1@x'), 0);
});

k.test('auto0-nothing', 'translate_auto = 0: nothing is drawn, nothing generated; a cached translation is still shown', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { translate_auto: 0 });
    show(7, 'a0@x');
    reset();
    await fromTab(ctx, 7, { command: 'initTranslation' });
    assert.deepEqual(ctx.m.sentTo(7), []);
    show(7, 'a2@x');
    await fromTab(ctx, 7, { command: 'initTranslation' });
    assert.deepEqual(ctx.m.commandsTo(7), ['showTranslation']);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
