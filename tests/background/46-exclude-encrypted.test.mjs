// exclude_encrypted_messages (#1047): with the option on, the content of an OpenPGP or S/MIME
// encrypted message never reaches the AI provider, from the automatic features or the manual
// actions; with it off, nothing changes.
//
// Spec 01 "Encrypted messages (exclude_encrypted_messages)":
//  - detection (isMessageEncrypted() in js/mzta-utils.js): getFull(id, {decrypt: false}) and the
//    root's decryptionStatus ("skipped" / "success" / "fail" are encrypted), the top-level content
//    type (multipart/encrypted, application/pkcs7-mime but not smime-type=signed-data), inline PGP
//    through the armored block in the inline text parts; a failed detection with the option on
//    excludes (fail safe); with the option off nothing is read;
//  - processEmails(): checked once per message before any feature reads it; the automatic run is
//    silent and stores nothing, a manual one (context menu) shows one notice at its end, and the
//    context-menu summarize leaves the encrypted messages out before anything is read;
//  - the summary / translation jobs: a manual trigger gets the reason in its panel, an automatic
//    one only loses its generating panel; nothing is stored;
//  - the spam job (Refresh from its panel): the reason in the panel, nothing analyzed or stored;
//  - act() (js/mzta-menus.js, the popup / menus / shortcut): refused with an alert before the body
//    is read, for an encrypted displayed message and for a compose window whose related message
//    (relatedMessageId) is encrypted.
// Spec 05 `exclude_encrypted_messages`.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import {
    API,
    featureResponder,
    sentPrompts,
    receive,
    record,
    fromTab,
    clickContextMenu,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const H = {};
const ctx = await bgContext({
    local: {
        ...API,
        exclude_encrypted_messages: true,
        summarize: true, summarize_auto: 3, summarize_display_mode: 'inline',
        translate: true, translate_auto: 3,
        add_tags: true, add_tags_auto: true,
        spamfilter: true,
        default_chatgpt_lang: 'Italian',
    },
    setup(m) {
        H.plain = m.addMessage({ headerMessageId: 'plain@x' });
        H.pgp = m.addMessage({ headerMessageId: 'pgp@x', encryption: 'pgp-mime' });
        H.smime = m.addMessage({ headerMessageId: 'smime@x', encryption: 'smime' });
        H.fail = m.addMessage({ headerMessageId: 'fail@x', encryption: 'fail' });
        H.signed = m.addMessage({ headerMessageId: 'signed@x', encryption: 'smime-signed' });
        H.inline = m.addMessage({ headerMessageId: 'inline@x', text: 'Hi,\n-----BEGIN PGP MESSAGE-----\n\nhQEMA1234\n-----END PGP MESSAGE-----\n' });
        m.addTab({ id: 7, type: 'mail', active: true });
        m.addTab({ id: 10, type: 'messageCompose', windowId: 4, active: true });
    },
});
ctx.workers.respond = featureResponder();
const k = caseTests('46-exclude-encrypted');
const i18n = (name, subs) => ctx.ctl.browser.i18n.getMessage(name, subs);
const utils = await import('../../js/mzta-utils.js');
const ENCRYPTED = ['pgp@x', 'smime@x', 'fail@x', 'inline@x'];
const promptsFor = hid => sentPrompts(ctx).filter(p => p.message === hid).map(p => p.feature).sort();
const callsFor = (api, id) => ctx.m.calls.filter(c => c.api === api && c.args[0] === id);
const setOption = async (value) => ctx.ctl.browser.storage.local.set({ exclude_encrypted_messages: value });

// --- Detection ----------------------------------------------------------------------------------

k.test('detect', 'isMessageEncrypted: OpenPGP/MIME, S/MIME enveloped, undecryptable and inline PGP are encrypted; plain and S/MIME signed-only are not', async () => {
    assert.equal(await utils.isMessageEncrypted(H.plain.id), false);
    assert.equal(await utils.isMessageEncrypted(H.pgp.id), true);
    assert.equal(await utils.isMessageEncrypted(H.smime.id), true);
    assert.equal(await utils.isMessageEncrypted(H.fail.id), true);
    assert.equal(await utils.isMessageEncrypted(H.inline.id), true);
    assert.equal(await utils.isMessageEncrypted(H.signed.id), false);
    assert.deepEqual(callsFor('messages.getFull', H.pgp.id).map(c => c.args[1]), [{ decrypt: false }], 'read without decrypting');
    assert.deepEqual(callsFor('messages.listInlineTextParts', H.pgp.id), [], 'an encrypted MIME message: no text part read');
});

k.test('fail-safe', 'a detection that fails with the option on excludes the message; the option off reads nothing', async (t) => {
    const h = ctx.m.addMessage({ headerMessageId: 'unreadable@x' });
    ctx.m.failGetFull.add(h.id);
    t.after(() => ctx.m.failGetFull.delete(h.id));
    assert.equal(await utils.isEncryptedMessageExcluded(h.id, 'test'), true);
    await setOption(false);
    t.after(() => setOption(true));
    const before = ctx.m.calls.length;
    assert.equal(await utils.isEncryptedMessageExcluded(H.pgp.id, 'test'), false);
    assert.deepEqual(ctx.m.calls.slice(before).filter(c => c.api.startsWith('messages.')), [], 'no message read with the option off');
});

// --- Automatic processing on receive ------------------------------------------------------------

await receive(ctx, [H.plain, H.pgp, H.smime, H.fail, H.signed, H.inline]);

k.test('receive', 'on receive, every feature runs on the plain and the signed-only message, none on an encrypted one', () => {
    const all = ['add_tags', 'spam', 'summary', 'translation'];
    assert.deepEqual(promptsFor('plain@x'), all);
    assert.deepEqual(promptsFor('signed@x'), all);
    for (const hid of ENCRYPTED) assert.deepEqual(promptsFor(hid), [], 'no prompt for ' + hid);
    assert.equal(ctx.workers.prompts().some(p => /BEGIN PGP MESSAGE/.test(p)), false, 'the inline PGP block never sent');
});

k.test('receive-no-decrypt', 'on receive, an encrypted MIME message is never read decrypted', () => {
    for (const h of [H.pgp, H.smime, H.fail]) {
        assert.deepEqual(callsFor('messages.getFull', h.id).map(c => c.args[1]).filter(o => o?.decrypt !== false), [], 'getFull() of ' + h.headerMessageId + ' only without decrypting');
    }
});

k.test('receive-silent', 'on receive, nothing is stored for an encrypted message and no notice is shown', async () => {
    for (const hid of ENCRYPTED) assert.equal(await record(ctx, hid), null, 'nothing stored for ' + hid);
    assert.ok(await record(ctx, 'plain@x'), 'the plain message has its results');
    assert.deepEqual(ctx.m.sentTo(null, 'showGenericInfo'), []);
    assert.deepEqual(ctx.m.sentTo(null, 'showGenericError'), []);
});

k.test('option-off', 'with the option off, an encrypted message is processed as before', async (t) => {
    await setOption(false);
    t.after(() => setOption(true));
    const h = ctx.m.addMessage({ headerMessageId: 'off@x', encryption: 'pgp-mime' });
    await receive(ctx, [h]);
    assert.deepEqual(promptsFor('off@x'), ['add_tags', 'spam', 'summary', 'translation']);
    assert.deepEqual(callsFor('messages.getFull', h.id).filter(c => c.args.length > 1), [], 'no detection read');
});

// --- Manual actions -----------------------------------------------------------------------------

k.test('context-summarize', 'the context-menu Summarize on one encrypted message shows the notice and reads nothing', async () => {
    const before = ctx.m.sentTo(7, 'showGenericInfo').length;
    const h = ctx.m.addMessage({ headerMessageId: 'cs@x', encryption: 'smime' });
    await clickContextMenu(ctx, 'mzta-ctx-prompt_summarize', ctx.m.tab(7), [h]);
    const info = ctx.m.sentTo(7, 'showGenericInfo').slice(before);
    assert.equal(info.length, 1);
    assert.equal(info[0].data.message, i18n('encrypted_message_excluded'));
    assert.equal(info[0].data.source, i18n('encrypted_messages_source'));
    assert.deepEqual(promptsFor('cs@x'), []);
    assert.deepEqual(ctx.m.sentTo(7, 'showSummaryGenerating').filter(x => x.headerMessageId === 'cs@x'), []);
    assert.deepEqual(callsFor('messages.getFull', h.id).map(c => c.args[1]), [{ decrypt: false }]);
});

k.test('context-translate', 'the context-menu Translate on a plain and an encrypted message translates the plain one and counts the other in the notice', async () => {
    const before = ctx.m.sentTo(7, 'showGenericInfo').length;
    const a = ctx.m.addMessage({ headerMessageId: 'ct-plain@x' });
    const b = ctx.m.addMessage({ headerMessageId: 'ct-pgp@x', encryption: 'pgp-mime' });
    await clickContextMenu(ctx, 'mzta-ctx-prompt_translate_this', ctx.m.tab(7), [a, b]);
    assert.deepEqual(promptsFor('ct-plain@x'), ['translation']);
    assert.deepEqual(promptsFor('ct-pgp@x'), []);
    const info = ctx.m.sentTo(7, 'showGenericInfo').slice(before);
    assert.equal(info.length, 1);
    assert.equal(info[0].data.message, i18n('encrypted_messages_skipped', ['1']));
});

k.test('panel-summary-manual', 'the summary button on an encrypted message: the reason in the panel, no prompt, nothing stored', async () => {
    ctx.m.tab(7).displayed = H.pgp.id;
    await fromTab(ctx, 7, { command: 'triggerSummaryGeneration', headerMessageId: 'pgp@x' });
    const shown = ctx.m.sentTo(7, 'showSummary').filter(x => x.data?.headerMessageId === 'pgp@x');
    assert.equal(shown.length, 1);
    assert.equal(shown[0].data.error, true);
    assert.equal(shown[0].data.message, i18n('encrypted_message_excluded'));
    assert.deepEqual(promptsFor('pgp@x'), []);
    assert.equal(await record(ctx, 'pgp@x'), null);
});

k.test('panel-translation-manual', 'the translation button on an encrypted message: the reason in the panel, no prompt, nothing stored', async () => {
    ctx.m.tab(7).displayed = H.smime.id;
    await fromTab(ctx, 7, { command: 'triggerTranslationGeneration', headerMessageId: 'smime@x' });
    const shown = ctx.m.sentTo(7, 'showTranslation').filter(x => x.data?.headerMessageId === 'smime@x');
    assert.equal(shown.length, 1);
    assert.equal(shown[0].data.error, true);
    assert.equal(shown[0].data.message, i18n('encrypted_message_excluded'));
    assert.deepEqual(promptsFor('smime@x'), []);
    assert.equal(await record(ctx, 'smime@x'), null);
});

k.test('panel-summary-auto', 'the automatic summary on display (summarize_auto 2) skips an encrypted message silently', async (t) => {
    await ctx.ctl.browser.storage.local.set({ summarize_auto: 2 });
    t.after(() => ctx.ctl.browser.storage.local.set({ summarize_auto: 3 }));
    ctx.m.tab(7).displayed = H.fail.id;
    const before = ctx.m.sentTo(7).length;
    await fromTab(ctx, 7, { command: 'initSummary' });
    const sent = ctx.m.sentTo(7).slice(before);
    assert.ok(sent.some(x => x.command === 'hideSummaryGenerating' && x.headerMessageId === 'fail@x'), 'the generating panel taken down');
    assert.equal(sent.some(x => x.command === 'showSummary'), false, 'nothing shown');
    assert.deepEqual(promptsFor('fail@x'), []);
});

k.test('panel-spam-refresh', 'Refresh in the spam panel of an encrypted message: the reason in the panel, nothing analyzed or stored', async () => {
    ctx.m.tab(7).displayed = H.inline.id;
    const before = ctx.m.sentTo(7, 'showSpamReport').length;
    await fromTab(ctx, 7, { command: 'refreshSpamReport', headerMessageId: 'inline@x' });
    assert.equal(ctx.m.sentTo(7, 'showSpamReport').length, before + 1, 'the panel told');
    assert.deepEqual(promptsFor('inline@x'), []);
    assert.equal(await record(ctx, 'inline@x'), null);
});

/** act() through executeMenuAction(), the content script answering the body reads. */
async function runAct(t, tabId, promptId) {
    const win = ctx.m.currentWindow;
    ctx.m.currentWindow = ctx.m.tab(tabId).windowId;
    ctx.m.tabAnswer = (id, message) => {
        switch (message.command) {
            case 'getTextOnly': return 'Body';
            case 'getOnlyTypedText': return { text: '', html: '' };
            case 'getSelectedText':
            case 'getSelectedHtml':
            case 'getFullHtml':
            case 'getOnlyQuotedText':
                return '';
            default: return true;
        }
    };
    t.after(() => {
        ctx.m.currentWindow = win;
        ctx.m.tabAnswer = null;
    });
    const before = ctx.m.sentTo(tabId).length;
    const result = await ctx.bg.$eval('menus').executeMenuAction(promptId);
    return { result, sent: ctx.m.sentTo(tabId).slice(before) };
}

k.test('act-display', 'a prompt on a displayed encrypted message is refused with the alert, before the body is read', async (t) => {
    ctx.m.tab(7).displayed = H.pgp.id;
    const { result, sent } = await runAct(t, 7, 'prompt_add_tags');
    assert.deepEqual(result, { ok: '0' });
    const alerts = sent.filter(x => x.command === 'sendAlert');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].message, i18n('encrypted_message_excluded'));
    assert.deepEqual(sent.filter(x => x.command !== 'sendAlert'), [], 'no body read through the content script');
});

k.test('act-compose', 'a prompt in a compose window replying to an encrypted message is refused with the alert, before the body is read', async (t) => {
    ctx.m.tab(10).relatedMessageId = H.smime.id;
    t.after(() => { ctx.m.tab(10).relatedMessageId = null; });
    const { result, sent } = await runAct(t, 10, 'prompt_rewrite_polite');
    assert.deepEqual(result, { ok: '0' });
    assert.deepEqual(sent.map(x => x.command), ['sendAlert']);
    assert.equal(sent[0].message, i18n('encrypted_message_excluded'));
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
