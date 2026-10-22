// The runtime guards of the permission-gated features, and the tag API failures [#962].
//
// Spec 01 "Feature permissions", "Runtime guards": every path that uses a gated feature checks
// its permissions before acting; without them it does not act and tells the user, never only the
// console - the background cannot request a permission (no user gesture), so the message says
// where to grant it:
//  - processEmails() (automatic and context-menu runs): add_tags and the spam filter are checked
//    once per run, before any message is read; a feature without its permissions is skipped for
//    the run with ONE red panel (feature_permission_missing), the other features go on;
//  - the address book rule (spamfilter_skip_addressbook) without addressBooks is skipped with ONE
//    blue notice per run (spamfilter_addressbook_permission_missing), and the message is still
//    analyzed - also on the panel's Refresh;
//  - assign_tags (the tags confirmed in the dialog): checked again; a tag that cannot be created
//    stops the assignment and is shown;
//  - the menu actions of the popup Add tags dialog and of "Add calendar event from clipboard":
//    refused before the body is read or the AI called, with the message as an alert in the tab.
// js/mzta-utils.js: createTag() and assignTagsToMessage() reject with the API's own error.
//
// The context is started with every permission granted, so the reconciliation keeps the features
// on; each test then revokes a permission in the model only (no onRemoved, no storage write), the
// state the guards exist for: the reconciliation has not run since, or the key is locked.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import {
    API,
    featureResponder,
    sentPrompts,
    receive,
    fromTab,
    clickContextMenu,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const verdicts = {};
const ctx = await bgContext({
    local: {
        ...API,
        add_tags: true,
        add_tags_auto: true,
        add_tags_max_messages: 0,
        spamfilter: true,
        spamfilter_skip_addressbook: true,
        get_calendar_event: true,
        get_calendar_event_from_clipboard: true,
        summarize: false,
        translate: false,
    },
    mail: {
        tags: [{ key: 'work', tag: 'Work', color: '#00ff00', ordinal: '' }],
        contacts: [{ id: 'c1', properties: { PrimaryEmail: 'pal@book.test' } }],
    },
    // Sparks present: the calendar clipboard prompt is in the menus.
    external: (id, msg) => (msg?.action === 'checkPresence' ? '99.0.0' : null),
    setup(m) { m.addTab({ id: 7, type: 'mail', active: true }); },
});
ctx.workers.respond = featureResponder({
    spam: hid => JSON.stringify({ spamValue: verdicts[hid] ?? 5, explanation: 'x' }),
});
const k = caseTests('38-permission-guards');
const i18n = (name, subs) => ctx.ctl.browser.i18n.getMessage(name, subs);
const label = key => i18n({
    add_tags: 'prefs_OptionText_add_tags',
    spamfilter: 'prefs_OptionText_spamfilter',
    spamfilter_skip_addressbook: 'prefs_OptionText_spamfilter_skip_addressbook',
    get_calendar_event_from_clipboard: 'prefs_OptionText_get_calendar_event_from_clipboard',
}[key]);
const missing = key => i18n('feature_permission_missing', [label(key)]);
const TAB = { id: 7, windowId: 1, type: 'mail' };
const mail = (hid, o = {}) => {
    if (o.spam !== undefined) verdicts[hid] = o.spam;
    return ctx.m.addMessage({ headerMessageId: hid, author: o.author, folderId: 'f-inbox' });
};
const calls = api => ctx.m.calls.filter(c => c.api === api);
const tagUpdates = () => calls('messages.update').filter(c => 'tags' in c.args[1]);
const errors = () => ctx.m.sentTo(7, 'showGenericError');
const infos = () => ctx.m.sentTo(7, 'showGenericInfo');
const labelsOf = hid => (ctx.m.byHeaderId(hid)?.tags || []).map(key => ctx.m.tags.find(t => t.key === key)?.tag ?? key);
/** Revoke `permission` for the rest of test t (granted back after it). */
const revoke = (t, permission) => {
    ctx.m.permissions.delete(permission);
    t.after(() => ctx.m.permissions.add(permission));
};
const reset = () => { ctx.m.tabSends.length = 0; ctx.m.calls.length = 0; };

k.test('auto-add-tags-blocked', 'incoming mail without messagesTags: nothing tagged, the spam filter still runs, one red panel for the run', async (t) => {
    revoke(t, 'messagesTags');
    reset();
    const before = sentPrompts(ctx).length;
    await receive(ctx, [mail('a1@x'), mail('a2@x'), mail('a3@x')]);
    const prompts = sentPrompts(ctx).slice(before);
    assert.equal(prompts.some(p => p.feature === 'add_tags'), false, 'no add_tags AI call');
    assert.deepEqual(prompts.filter(p => p.feature === 'spam').map(p => p.message).sort(), ['a1@x', 'a2@x', 'a3@x']);
    assert.deepEqual(calls('messages.tags.create'), []);
    assert.deepEqual(tagUpdates(), []);
    assert.equal(errors().length, 1, 'one panel for the run, not one per message');
    assert.equal(errors()[0].data.message, missing('add_tags'));
    assert.equal(errors()[0].data.source, label('add_tags'));
});

k.test('context-add-tags-blocked', 'context menu Add tags without messagesTags: no AI call, nothing tagged, one red panel', async (t) => {
    revoke(t, 'messagesTags');
    reset();
    const hs = [mail('c1@x'), mail('c2@x')];
    const before = ctx.workers.prompts().length;
    await clickContextMenu(ctx, 'mzta-ctx-prompt_add_tags', TAB, hs);
    assert.equal(ctx.workers.prompts().length, before, 'no AI call');
    assert.deepEqual(tagUpdates(), []);
    assert.deepEqual(errors().map(e => e.data.message), [missing('add_tags')]);
});

k.test('auto-spam-blocked', 'incoming mail without messagesMove: no spam analysis and no move, tags still assigned, one red panel', async (t) => {
    revoke(t, 'messagesMove');
    reset();
    const before = sentPrompts(ctx).length;
    await receive(ctx, [mail('s1@x', { spam: 99 }), mail('s2@x', { spam: 99 })]);
    const prompts = sentPrompts(ctx).slice(before);
    assert.equal(prompts.some(p => p.feature === 'spam'), false, 'no spam AI call');
    assert.deepEqual(calls('messages.move'), []);
    assert.equal(ctx.m.byHeaderId('s1@x').folder.id, 'f-inbox');
    assert.deepEqual(labelsOf('s1@x'), ['Work'], 'add_tags went on');
    assert.deepEqual(errors().map(e => e.data.message), [missing('spamfilter')]);
});

k.test('context-spam-blocked', 'context menu spam filter without messagesUpdate: no analysis, one red panel', async (t) => {
    revoke(t, 'messagesUpdate');
    reset();
    const hs = [mail('cs1@x', { spam: 99 }), mail('cs2@x', { spam: 99 })];
    const before = ctx.workers.prompts().length;
    await clickContextMenu(ctx, 'mzta-ctx-prompt_spamfilter', TAB, hs);
    assert.equal(ctx.workers.prompts().length, before, 'no AI call');
    assert.deepEqual(calls('messages.move'), []);
    assert.deepEqual(errors().map(e => e.data.message), [missing('spamfilter')]);
});

k.test('addressbook-skipped', 'the address book rule without addressBooks: skipped, every message still analyzed, one blue notice for the run', async (t) => {
    revoke(t, 'addressBooks');
    reset();
    const before = sentPrompts(ctx).length;
    await receive(ctx, [mail('ab1@x', { author: 'Pal <pal@book.test>' }), mail('ab2@x', { author: 'Pal <pal@book.test>' })]);
    const spam = sentPrompts(ctx).slice(before).filter(p => p.feature === 'spam').map(p => p.message).sort();
    assert.deepEqual(spam, ['ab1@x', 'ab2@x'], 'the contact is analyzed by the AI');
    assert.deepEqual(calls('contacts.quickSearch'), []);
    assert.deepEqual(errors(), []);
    assert.deepEqual(infos().map(e => e.data.message), [i18n('spamfilter_addressbook_permission_missing', [label('spamfilter_skip_addressbook')])]);
});

k.test('addressbook-granted', 'with addressBooks granted the rule applies: a contact is not analyzed, no notice', async () => {
    reset();
    const before = sentPrompts(ctx).length;
    await receive(ctx, [mail('ab3@x', { author: 'pal@book.test' })]);
    assert.equal(sentPrompts(ctx).slice(before).some(p => p.feature === 'spam'), false);
    assert.deepEqual(infos(), []);
});

k.test('addressbook-refresh', 'the panel Refresh without addressBooks: analyzed, one blue notice', async (t) => {
    revoke(t, 'addressBooks');
    const h = mail('ab4@x', { author: 'pal@book.test' });
    ctx.m.tab(7).displayed = h.id;
    reset();
    const before = sentPrompts(ctx).length;
    await fromTab(ctx, 7, { command: 'refreshSpamReport', headerMessageId: 'ab4@x' });
    assert.deepEqual(sentPrompts(ctx).slice(before).map(p => p.message), ['ab4@x']);
    assert.equal(infos().length, 1);
});

k.test('assign-tags-blocked', 'assign_tags from the dialog without messagesTags: nothing assigned, one red panel', async (t) => {
    revoke(t, 'messagesTags');
    const h = mail('d1@x');
    reset();
    await fromTab(ctx, 7, { command: 'assign_tags', messageId: h.id, tags: ['Work', 'Brand new'] });
    assert.deepEqual(calls('messages.tags.create'), []);
    assert.deepEqual(tagUpdates(), []);
    assert.deepEqual(errors().map(e => e.data.message), [missing('add_tags')]);
});

k.test('assign-tags-failure', 'assign_tags: a tag that cannot be created stops the assignment and is shown', async (t) => {
    const tagsApi = ctx.ctl.browser.messages.tags;
    const realCreate = tagsApi.create;
    tagsApi.create = async () => { throw new Error('tag store unavailable'); };
    t.after(() => { tagsApi.create = realCreate; });
    const h = mail('d2@x');
    reset();
    await fromTab(ctx, 7, { command: 'assign_tags', messageId: h.id, tags: ['Brand new', 'Work'] });
    assert.deepEqual(tagUpdates(), [], 'stopped before assigning');
    assert.deepEqual(errors().map(e => e.data.message), ['tag store unavailable']);
});

k.test('create-tag-rejects', 'createTag() rejects with the API error (awaited, rethrown)', async (t) => {
    revoke(t, 'messagesTags');
    await assert.rejects(ctx.utils.createTag('Anything'), { name: 'TypeError', message: /tags\.create is not a function/ });
});

k.test('assign-rejects', 'assignTagsToMessage() rejects with the API error, not a ReferenceError', async (t) => {
    revoke(t, 'messagesUpdate');
    const h = mail('d3@x');
    await assert.rejects(ctx.utils.assignTagsToMessage(h.id, ['Work']), { name: 'TypeError', message: /messages\.update is not a function/ });
});

k.test('menu-add-tags-blocked', 'the popup Add tags action without messagesTags: refused before the AI, with the alert in the tab', async (t) => {
    revoke(t, 'messagesTags');
    reset();
    const before = ctx.workers.prompts().length;
    const result = await ctx.bg.$eval('menus').executeMenuAction('prompt_add_tags');
    assert.deepEqual(result, { ok: '0' });
    assert.equal(ctx.workers.prompts().length, before, 'no AI call');
    assert.deepEqual(ctx.m.sentTo(7).map(m => m.command), ['sendAlert'], 'the body is not read');
    assert.equal(ctx.m.sentTo(7, 'sendAlert')[0].message, missing('add_tags'));
});

k.test('menu-clipboard-blocked', 'Add calendar event from clipboard without clipboardRead: refused with the missing-permission alert', async (t) => {
    revoke(t, 'clipboardRead');
    reset();
    const result = await ctx.bg.$eval('menus').executeMenuAction('prompt_get_calendar_event_from_clipboard');
    assert.deepEqual(result, { ok: '0' });
    assert.deepEqual(ctx.m.sentTo(7, 'sendAlert').map(m => m.message), [missing('get_calendar_event_from_clipboard')]);
    assert.notEqual(missing('get_calendar_event_from_clipboard'), i18n('clipboard_read_error'));
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
