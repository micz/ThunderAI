// The per-account Add Tags settings (add_tags_account_settings) at run time: two accounts, an entry
// for acc2 only, so a message of acc2 gets the account's values and a message of acc1 the global
// ones.
//
// Spec 02 "Add tags: per-account settings":
//  - semantics: a key missing from the entry inherits the global value, an override REPLACES the
//    global value (an account's exclusion list is the whole list); the use list applies on the
//    automatic/batch path only, the popup path (act()) keeps passing false, '';
//  - resolution point 1, the batch (runAddTagsJob(), automatic and context-menu runs): per message,
//    the account text (addTags_applyAccountPrompt()) and prefs_msg for getDefaultLang(),
//    finalizePrompt_add_tags() (max number, force language, language, use list, force existing),
//    getTagsFromResponse() (use list) and _assign_tags() (exclusions, exact match, force existing);
//    resolveAddTagsSetup() is memoized for the batch, so nothing per account is applied inside it;
//  - resolution point 2, the popup (act() in js/mzta-menus.js): the account text in a copy (the
//    menu entry's curr_prompt left untouched), the account's language, prefs_at resolved (max
//    number, force language, language, force existing), the use list never;
//  - resolution point 3: assign_tags from the tag dialog has only messageId, reads the header for
//    the account, and filters with that account's exclusions and exact-match flag; the header is not
//    read at all when no account has settings;
//  - resolution point 4: addtags_get_exclusion_prefs {messageId?} returns the EFFECTIVE values plus
//    exclusions_locked and exclusions_account_id; addtags_set_exclusions {list, accountId?} writes the
//    account's list (the rest of its entry kept) or, without one, the global list;
//  - policy: an override is ignored when the policy locks its global key, prompt_text when the
//    policy enforces the Add Tags text (_text_by_policy); with _disable_add_tags_account_settings
//    (spec 08a) every entry is ignored on every path, kept in storage, the tag dialog gets the
//    global values and list (no header read) and addtags_set_exclusions ignores an accountId.
// The `add_tags_account_settings` row of spec 05; spec 08 "The allowlist" (never bypasses a policy).
//
// What the prompt says is checked through the statements finalizePrompt_add_tags() appends (spec 02
// "Add tags: extra prompt statements"), read from the raw prompt the worker received.
//
// The area runs with no policy (README): a lock or an enforced text is simulated by stubbing the
// questions js/mzta-prefs.js, js/mzta-prompts.js and the module ask js/mzta-managed.js
// (isManagedLocked / getManagedValue / getSpecialPromptText), for one test, as
// 37-permission-reconcile does.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import {
    API,
    featureOf,
    featureResponder,
    messageOf,
    receive,
    setPrefs,
    fromTab,
    clickContextMenu,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const folder = (id, accountId, name, specialUse) => ({ id, accountId, name, path: '/' + name, specialUse });
const answers = {};
const ctx = await bgContext({
    local: {
        ...API,
        add_tags: true,
        add_tags_auto: true,
        add_tags_max_messages: 0,
        add_tags_maxnum: 3,
        add_tags_force_lang: true,
        default_chatgpt_lang: 'Italian',
        add_tags_exclusions: ['newsletter'],
        add_tags_exclusions_exact_match: false,
        add_tags_auto_force_existing: false,
        add_tags_auto_uselist: false,
        add_tags_auto_uselist_list: '',
        // The labels stay as the model wrote them (createTag() would recase a new one).
        add_tags_first_uppercase: false,
        spamfilter: false,
        summarize: false,
        translate: false,
    },
    mail: {
        accounts: [{ id: 'acc1', name: 'Account 1' }, { id: 'acc2', name: 'Account 2' }],
        folders: [
            folder('f-inbox', 'acc1', 'Inbox', ['inbox']),
            folder('f-junk', 'acc1', 'Junk', ['junk']),
            folder('f-sent', 'acc1', 'Sent', ['sent']),
            folder('f-lists', 'acc1', 'Lists', []),
            folder('g-inbox', 'acc2', 'Inbox2', ['inbox']),
            folder('g-junk', 'acc2', 'Junk2', ['junk']),
            folder('g-lists', 'acc2', 'Lists2', []),
        ],
        tags: [
            { key: '$label1', tag: 'Important', color: '#ff0000', ordinal: '' },
            { key: 'work', tag: 'Work', color: '#00ff00', ordinal: '' },
        ],
    },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
        // The popup's tab (act()): a message tab in its own window, made current by popup().
        m.addTab({ id: 8, type: 'messageDisplay', windowId: 2, active: true });
    },
});
ctx.workers.respond = featureResponder({
    add_tags: hid => JSON.stringify({ tags: answers[hid] ?? ['Work'] }),
});
const k = caseTests('24b-add-tags-accounts');
const { mztaManaged } = await import('../../js/mzta-managed.js');
const i18n = id => ctx.ctl.browser.i18n.getMessage(id);
const GLOBAL_TEXT = (await ctx.prompts.getAddTagsPrompt()).text;
const TAB = { id: 7, windowId: 1, type: 'mail' };

let n = 0;
/** A new message of `account` (acc1 / acc2) whose AI answer is `tags`. */
const mail = (account, tags, o = {}) => {
    const hid = 'm' + (++n) + '-' + account + '@x';
    answers[hid] = tags;
    return ctx.m.addMessage({ headerMessageId: hid, folderId: o.folderId ?? (account === 'acc1' ? 'f-inbox' : 'g-inbox') });
};
const labelsOf = h => (ctx.m.byHeaderId(h.headerMessageId)?.tags || []).map(key => ctx.m.tags.find(t => t.key === key)?.tag ?? key).sort();
const created = () => ctx.m.calls.filter(c => c.api === 'messages.tags.create').map(c => c.args[1]);
/** The Add Tags prompts the worker received for message h, raw. */
const promptsFor = h => ctx.workers.prompts().map(String).filter(p => featureOf(p) === 'add_tags' && messageOf(p) === h.headerMessageId);
const promptFor = h => {
    const ps = promptsFor(h);
    assert.equal(ps.length, 1, 'one Add Tags prompt for ' + h.headerMessageId);
    return ps[0];
};
const maxnum = v => i18n('prompt_add_tags_maxnum') + ' ' + v + '.';
const forceLang = lang => i18n('prompt_add_tags_force_lang') + ' ' + lang + '.';
const useList = list => i18n('prompt_add_tags_use_list') + ': ' + list + '.';
const forceExisting = i18n('prompt_add_tags_force_existing') + ':';

const timersOn = new WeakSet();
/** add_tags_account_settings = {acc2: entry} (raw: the way a settings page writes it), and other prefs. */
async function account(t, entry, other = {}) {
    if (!timersOn.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timersOn.add(t); }
    await setPrefs(t, ctx, { add_tags_account_settings: entry === null ? {} : { acc2: entry }, ...other });
}

/** Lock `locked` (key -> enforced value) for the rest of test t. */
function lock(t, locked) {
    const isLocked = mztaManaged.isManagedLocked.bind(mztaManaged);
    const value = mztaManaged.getManagedValue.bind(mztaManaged);
    t.mock.method(mztaManaged, 'isManagedLocked', key => (key in locked) || isLocked(key));
    t.mock.method(mztaManaged, 'getManagedValue', key => (key in locked) ? structuredClone(locked[key]) : value(key));
}

/**
 * The popup running Add tags (act() in js/mzta-menus.js) on message h, displayed in tab 8, the
 * active tab of the current window. The content script answers the body reads; the tag dialog
 * (getTags) is recorded. Returns {result, prompt, dialog}.
 */
async function popup(t, h) {
    const tab = ctx.m.tab(8);
    const win = ctx.m.currentWindow;
    tab.displayed = h.id;
    ctx.m.currentWindow = 2;
    ctx.m.tabAnswer = (id, message) => {
        switch (message.command) {
            case 'getSelectedText':
            case 'getSelectedHtml':
            case 'getFullHtml':
            case 'getOnlyQuotedText':
                return '';
            case 'getTextOnly':
                return 'Body of <' + h.headerMessageId + '>';
            case 'getOnlyTypedText':
                return { text: '', html: '' };
            default:
                return true;
        }
    };
    t.after(() => {
        tab.displayed = null;
        ctx.m.currentWindow = win;
        ctx.m.tabAnswer = null;
    });
    const dialogs = ctx.m.sentTo(8, 'getTags').length;
    const result = await ctx.bg.$eval('menus').executeMenuAction('prompt_add_tags');
    return { result, prompt: promptFor(h), dialog: ctx.m.sentTo(8, 'getTags').slice(dialogs) };
}

// --- The automatic path ---------------------------------------------------------------------------

const BASE = { add_tags_maxnum: 7, default_chatgpt_lang: 'French' };

k.test('auto-maxnum-lang', 'auto: the acc2 message gets the account max number and language (force language inherited), the acc1 message the global ones', async (t) => {
    await account(t, BASE);
    const a1 = mail('acc1', ['Work']);
    const a2 = mail('acc2', ['Work']);
    await receive(ctx, [a1, a2]);
    const p1 = promptFor(a1);
    const p2 = promptFor(a2);
    assert.ok(p1.includes(maxnum(3)), 'acc1: global max number');
    assert.ok(p1.includes(forceLang('Italian')), 'acc1: global language');
    assert.ok(p2.includes(maxnum(7)), 'acc2: account max number');
    assert.ok(!p2.includes(maxnum(3)));
    assert.ok(p2.includes(forceLang('French')), 'acc2: account language');
    assert.ok(!p2.includes(forceLang('Italian')));
    assert.deepEqual(labelsOf(a1), ['Work']);
    assert.deepEqual(labelsOf(a2), ['Work']);
});

k.test('auto-force-lang', 'auto: an account add_tags_force_lang false drops the language statement for acc2 only', async (t) => {
    await account(t, { ...BASE, add_tags_force_lang: false });
    const a1 = mail('acc1', ['Work']);
    const a2 = mail('acc2', ['Work']);
    await receive(ctx, [a1, a2]);
    assert.ok(promptFor(a1).includes(forceLang('Italian')));
    assert.ok(!promptFor(a2).includes(i18n('prompt_add_tags_force_lang')), 'no language statement for acc2');
});

k.test('auto-exclusions', 'auto: the acc2 message is filtered with the account list and exact match only (it replaces the global list), the acc1 message with the global ones', async (t) => {
    await account(t, { ...BASE, add_tags_exclusions: ['promo'], add_tags_exclusions_exact_match: true });
    const tags = ['Work', 'Weekly Newsletter', 'Promo', 'Promo deals'];
    const a1 = mail('acc1', tags);
    const a2 = mail('acc2', tags);
    await receive(ctx, [a1, a2]);
    assert.deepEqual(labelsOf(a1), ['Promo', 'Promo deals', 'Work'], 'acc1: "newsletter" by substring');
    assert.deepEqual(labelsOf(a2), ['Promo deals', 'Weekly Newsletter', 'Work'], 'acc2: only "promo", exact (case-insensitive)');
});

k.test('auto-exact-match-only', 'auto: an account overriding only the exact-match flag keeps the global list, matched exactly', async (t) => {
    await account(t, { add_tags_exclusions_exact_match: true });
    const tags = ['Work', 'Weekly Newsletter', 'Newsletter'];
    const a1 = mail('acc1', tags);
    const a2 = mail('acc2', tags);
    await receive(ctx, [a1, a2]);
    assert.deepEqual(labelsOf(a1), ['Work']);
    assert.deepEqual(labelsOf(a2), ['Weekly Newsletter', 'Work']);
});

k.test('auto-uselist', 'auto: the account use list is sent and applied to the acc2 message only', async (t) => {
    await account(t, { ...BASE, add_tags_auto_uselist: true, add_tags_auto_uselist_list: 'Alpha, Beta' });
    const a1 = mail('acc1', ['Alpha', 'Gamma']);
    const a2 = mail('acc2', ['Alpha', 'Gamma']);
    await receive(ctx, [a1, a2]);
    assert.ok(!promptFor(a1).includes(i18n('prompt_add_tags_use_list')), 'acc1: no use list');
    assert.ok(promptFor(a2).includes(useList('Alpha, Beta')), 'acc2: the account use list');
    assert.deepEqual(labelsOf(a1), ['Alpha', 'Gamma']);
    assert.deepEqual(labelsOf(a2), ['Alpha']);
});

k.test('auto-uselist-global-off', 'auto: a global use list is replaced by an account add_tags_auto_uselist false', async (t) => {
    await account(t, { add_tags_auto_uselist: false }, { add_tags_auto_uselist: true, add_tags_auto_uselist_list: 'Alpha' });
    const a1 = mail('acc1', ['Alpha', 'Gamma']);
    const a2 = mail('acc2', ['Alpha', 'Gamma']);
    await receive(ctx, [a1, a2]);
    assert.ok(promptFor(a1).includes(useList('Alpha')));
    assert.ok(!promptFor(a2).includes(i18n('prompt_add_tags_use_list')));
    assert.deepEqual(labelsOf(a1), ['Alpha']);
    assert.deepEqual(labelsOf(a2), ['Alpha', 'Gamma']);
    await setPrefs(t, ctx, { add_tags_auto_uselist: false, add_tags_auto_uselist_list: '' });
});

k.test('auto-force-existing', 'auto: with the account force existing, the acc2 message gets only existing tags (none created) and the existing-tags statement; acc1 creates its new tag', async (t) => {
    await account(t, { ...BASE, add_tags_auto_force_existing: true });
    const a1 = mail('acc1', ['Work', 'Brandnew1']);
    const a2 = mail('acc2', ['Work', 'Brandnew2']);
    await receive(ctx, [a1, a2]);
    assert.ok(!promptFor(a1).includes(forceExisting));
    assert.ok(promptFor(a2).includes(forceExisting), 'acc2: the existing tags are listed');
    assert.ok(!promptFor(a2).includes(i18n('prompt_add_tags_force_lang')), 'force existing: no language statement');
    assert.deepEqual(labelsOf(a1), ['Brandnew1', 'Work']);
    assert.deepEqual(labelsOf(a2), ['Work']);
    assert.ok(created().includes('Brandnew1'));
    assert.ok(!created().includes('Brandnew2'));
});

k.test('auto-prompt-text', 'auto: the acc2 message uses the account prompt text, the acc1 message of the SAME batch the global one', async (t) => {
    await account(t, { prompt_text: 'ACCOUNT2 TEXT. ' + GLOBAL_TEXT });
    const a2 = mail('acc2', ['Work']);
    const a1 = mail('acc1', ['Work']);
    const a2b = mail('acc2', ['Work']);
    await receive(ctx, [a2, a1, a2b]);
    assert.ok(promptFor(a2).startsWith('ACCOUNT2 TEXT. '));
    assert.ok(promptFor(a2b).startsWith('ACCOUNT2 TEXT. '));
    assert.ok(!promptFor(a1).includes('ACCOUNT2 TEXT'), 'the memoized prompt of the batch was not changed');
    assert.deepEqual(labelsOf(a2), ['Work']);
});

k.test('auto-prompt-text-next-batch', 'auto: a later batch with only acc1 messages still gets the global text', async (t) => {
    await account(t, { prompt_text: 'ACCOUNT2 TEXT. ' + GLOBAL_TEXT });
    const a1 = mail('acc1', ['Work']);
    await receive(ctx, [a1]);
    assert.ok(!promptFor(a1).includes('ACCOUNT2 TEXT'));
    assert.equal((await ctx.prompts.getAddTagsPrompt()).text, GLOBAL_TEXT, 'the stored prompt untouched');
});

k.test('auto-malformed', 'an entry with a malformed value: that value is ignored (the global one used), the valid ones still apply', async (t) => {
    await account(t, { add_tags_maxnum: 'seven', add_tags_exclusions: 'promo', default_chatgpt_lang: 'French', prompt_text: '   ' });
    const a2 = mail('acc2', ['Work', 'Weekly Newsletter', 'Promo']);
    await receive(ctx, [a2]);
    const p2 = promptFor(a2);
    assert.ok(p2.includes(maxnum(3)), 'global max number');
    assert.ok(p2.includes(forceLang('French')), 'the valid language applies');
    assert.ok(!p2.startsWith('   '));
    assert.deepEqual(labelsOf(a2), ['Promo', 'Work'], 'global exclusion list');
});

k.test('auto-no-entry', 'no entry for any account: both messages get the global values', async (t) => {
    await account(t, null);
    const a1 = mail('acc1', ['Work', 'Weekly Newsletter']);
    const a2 = mail('acc2', ['Work', 'Weekly Newsletter']);
    await receive(ctx, [a1, a2]);
    for (const h of [a1, a2]) {
        assert.ok(promptFor(h).includes(maxnum(3)));
        assert.ok(promptFor(h).includes(forceLang('Italian')));
        assert.deepEqual(labelsOf(h), ['Work']);
    }
});

// --- The context-menu path (processEmails() with addTagsAuto, not in auto mode) -------------------

k.test('context-menu-values', 'context menu: the acc2 message gets the account max number, language, exclusions and exact match; the acc1 message the global ones', async (t) => {
    await account(t, { ...BASE, add_tags_exclusions: ['promo'], add_tags_exclusions_exact_match: true });
    const tags = ['Work', 'Weekly Newsletter', 'Promo', 'Promo deals'];
    const c1 = mail('acc1', tags, { folderId: 'f-lists' });
    const c2 = mail('acc2', tags, { folderId: 'g-lists' });
    await clickContextMenu(ctx, 'mzta-ctx-prompt_add_tags', TAB, [c1, c2]);
    assert.ok(promptFor(c1).includes(maxnum(3)));
    assert.ok(promptFor(c1).includes(forceLang('Italian')));
    assert.ok(promptFor(c2).includes(maxnum(7)));
    assert.ok(promptFor(c2).includes(forceLang('French')));
    assert.deepEqual(labelsOf(c1), ['Promo', 'Promo deals', 'Work']);
    assert.deepEqual(labelsOf(c2), ['Promo deals', 'Weekly Newsletter', 'Work']);
});

k.test('context-menu-force-existing', 'context menu: the account force existing keeps the acc2 message to existing tags', async (t) => {
    await account(t, { add_tags_auto_force_existing: true });
    const c1 = mail('acc1', ['Work', 'Brandnew3']);
    const c2 = mail('acc2', ['Work', 'Brandnew4']);
    await clickContextMenu(ctx, 'mzta-ctx-prompt_add_tags', TAB, [c1, c2]);
    assert.deepEqual(labelsOf(c1), ['Brandnew3', 'Work']);
    assert.deepEqual(labelsOf(c2), ['Work']);
    assert.ok(!created().includes('Brandnew4'));
});

k.test('context-menu-prompt-text', 'context menu: the account prompt text for acc2, the global one for acc1', async (t) => {
    await account(t, { prompt_text: 'ACCOUNT2 TEXT. ' + GLOBAL_TEXT });
    const c1 = mail('acc1', ['Work']);
    const c2 = mail('acc2', ['Work']);
    await clickContextMenu(ctx, 'mzta-ctx-prompt_add_tags', TAB, [c2, c1]);
    assert.ok(promptFor(c2).startsWith('ACCOUNT2 TEXT. '));
    assert.ok(!promptFor(c1).includes('ACCOUNT2 TEXT'));
});

// --- The popup (act() in js/mzta-menus.js) --------------------------------------------------------

k.test('popup-values', 'popup: the acc2 message gets the account max number and language, the acc1 message the global ones; the dialog gets the message id', async (t) => {
    await account(t, BASE);
    const p2 = mail('acc2', ['Work']);
    const r2 = await popup(t, p2);
    assert.deepEqual(r2.result, { ok: '1' });
    assert.ok(r2.prompt.includes(maxnum(7)));
    assert.ok(r2.prompt.includes(forceLang('French')));
    assert.deepEqual(r2.dialog, [{ command: 'getTags', tags: ['Work'], messageId: p2.id }]);
    const p1 = mail('acc1', ['Work']);
    const r1 = await popup(t, p1);
    assert.ok(r1.prompt.includes(maxnum(3)));
    assert.ok(r1.prompt.includes(forceLang('Italian')));
    assert.deepEqual(labelsOf(p1), [], 'the popup assigns nothing: the dialog does');
});

k.test('popup-no-uselist', 'popup: the use list is never applied, not even the account one', async (t) => {
    await account(t, { add_tags_auto_uselist: true, add_tags_auto_uselist_list: 'Alpha' });
    const p2 = mail('acc2', ['Alpha', 'Gamma']);
    const r2 = await popup(t, p2);
    assert.ok(!r2.prompt.includes(i18n('prompt_add_tags_use_list')));
    assert.deepEqual(r2.dialog[0].tags, ['Alpha', 'Gamma']);
});

k.test('popup-force-existing', 'popup: the account force existing keeps the dialog to existing tags for acc2 only', async (t) => {
    await account(t, { add_tags_auto_force_existing: true });
    const p2 = mail('acc2', ['Work', 'Brandnew5']);
    assert.deepEqual((await popup(t, p2)).dialog[0].tags, ['Work']);
    const p1 = mail('acc1', ['Work', 'Brandnew5']);
    assert.deepEqual((await popup(t, p1)).dialog[0].tags, ['Work', 'Brandnew5']);
});

k.test('popup-prompt-text', 'popup: the account text for acc2, and the menu entry keeps the global text for the next run (acc1, then acc2 again)', async (t) => {
    await account(t, { prompt_text: 'ACCOUNT2 TEXT. ' + GLOBAL_TEXT });
    const first = await popup(t, mail('acc2', ['Work']));
    assert.ok(first.prompt.startsWith('ACCOUNT2 TEXT. '));
    const second = await popup(t, mail('acc1', ['Work']));
    assert.ok(!second.prompt.includes('ACCOUNT2 TEXT'), 'the menu entry was not mutated');
    const third = await popup(t, mail('acc2', ['Work']));
    assert.ok(third.prompt.startsWith('ACCOUNT2 TEXT. '));
    assert.ok(!third.prompt.includes('ACCOUNT2 TEXT. ACCOUNT2 TEXT.'));
});

// --- The tag dialog's commands --------------------------------------------------------------------

const TAGS = ['Weekly Newsletter', 'Promo', 'Promo deals'];

k.test('assign-tags-account', 'assign_tags: the acc2 message is filtered with the account exclusions and exact match, the acc1 message with the global ones', async (t) => {
    await account(t, { add_tags_exclusions: ['promo'], add_tags_exclusions_exact_match: true });
    const d1 = mail('acc1', []);
    const d2 = mail('acc2', []);
    await fromTab(ctx, 7, { command: 'assign_tags', messageId: d1.id, tags: TAGS });
    await fromTab(ctx, 7, { command: 'assign_tags', messageId: d2.id, tags: TAGS });
    assert.deepEqual(labelsOf(d1), ['Promo', 'Promo deals']);
    assert.deepEqual(labelsOf(d2), ['Promo deals', 'Weekly Newsletter']);
});

k.test('assign-tags-no-settings-no-read', 'assign_tags: with no account settings at all the header is not read for the account (one read less than with settings)', async (t) => {
    const gets = () => ctx.m.calls.filter(c => c.api === 'messages.get').length;
    await account(t, { add_tags_maxnum: 5 });
    const d = mail('acc2', []);
    let before = gets();
    await fromTab(ctx, 7, { command: 'assign_tags', messageId: d.id, tags: ['Work'] });
    const withSettings = gets() - before;
    await account(t, null);
    before = gets();
    await fromTab(ctx, 7, { command: 'assign_tags', messageId: d.id, tags: ['Work'] });
    const without = gets() - before;
    assert.equal(without, withSettings - 1);
});

k.test('get-exclusion-prefs-account', 'addtags_get_exclusion_prefs with the message id of acc2: the account values, and exclusions_account_id acc2', async (t) => {
    await account(t, { add_tags_exclusions: ['promo'], add_tags_exclusions_exact_match: true }, { add_tags_hide_exclusions: true });
    const d2 = mail('acc2', []);
    assert.deepEqual(await fromTab(ctx, 7, { command: 'addtags_get_exclusion_prefs', messageId: d2.id }), {
        add_tags_exclusions: ['promo'],
        add_tags_exclusions_exact_match: true,
        add_tags_hide_exclusions: true,
        exclusions_locked: false,
        exclusions_account_id: 'acc2',
    });
    await setPrefs(t, ctx, { add_tags_hide_exclusions: false });
});

k.test('get-exclusion-prefs-global', 'addtags_get_exclusion_prefs for acc1, or with no message id: the global values, exclusions_account_id ""', async (t) => {
    await account(t, { add_tags_exclusions: ['promo'], add_tags_exclusions_exact_match: true });
    const d1 = mail('acc1', []);
    const global = {
        add_tags_exclusions: ['newsletter'],
        add_tags_exclusions_exact_match: false,
        add_tags_hide_exclusions: false,
        exclusions_locked: false,
        exclusions_account_id: '',
    };
    assert.deepEqual(await fromTab(ctx, 7, { command: 'addtags_get_exclusion_prefs', messageId: d1.id }), global);
    assert.deepEqual(await fromTab(ctx, 7, { command: 'addtags_get_exclusion_prefs' }), global);
});

k.test('get-exclusion-prefs-no-list', 'addtags_get_exclusion_prefs for an account overriding only the exact match: its flag, the global list, exclusions_account_id ""', async (t) => {
    await account(t, { add_tags_exclusions_exact_match: true });
    const d2 = mail('acc2', []);
    const out = await fromTab(ctx, 7, { command: 'addtags_get_exclusion_prefs', messageId: d2.id });
    assert.deepEqual(out.add_tags_exclusions, ['newsletter']);
    assert.equal(out.add_tags_exclusions_exact_match, true);
    assert.equal(out.exclusions_account_id, '');
});

k.test('set-exclusions-account', 'addtags_set_exclusions with an account id: that account\'s list written, the rest of its entry kept, the global list untouched', async (t) => {
    await account(t, { add_tags_exclusions: ['promo'], add_tags_maxnum: 5 });
    assert.equal(await fromTab(ctx, 7, { command: 'addtags_set_exclusions', list: ['promo', 'ads'], accountId: 'acc2' }), true);
    const data = ctx.ctl.localData();
    assert.deepEqual(data.add_tags_account_settings, { acc2: { add_tags_exclusions: ['promo', 'ads'], add_tags_maxnum: 5 } });
    assert.deepEqual(data.add_tags_exclusions, ['newsletter']);
});

k.test('set-exclusions-new-account', 'addtags_set_exclusions for an account without an entry: an entry with that list', async (t) => {
    await account(t, { add_tags_maxnum: 5 });
    await fromTab(ctx, 7, { command: 'addtags_set_exclusions', list: ['x'], accountId: 'acc1' });
    assert.deepEqual(ctx.ctl.localData().add_tags_account_settings, { acc1: { add_tags_exclusions: ['x'] }, acc2: { add_tags_maxnum: 5 } });
});

k.test('set-exclusions-global', 'addtags_set_exclusions without an account id (or with ""): the global list, the account settings untouched', async (t) => {
    await account(t, { add_tags_exclusions: ['promo'] });
    await fromTab(ctx, 7, { command: 'addtags_set_exclusions', list: ['newsletter', 'spam'] });
    assert.deepEqual(ctx.ctl.localData().add_tags_exclusions, ['newsletter', 'spam']);
    await fromTab(ctx, 7, { command: 'addtags_set_exclusions', list: ['newsletter'], accountId: '' });
    assert.deepEqual(ctx.ctl.localData().add_tags_exclusions, ['newsletter']);
    assert.deepEqual(ctx.ctl.localData().add_tags_account_settings, { acc2: { add_tags_exclusions: ['promo'] } });
});

// --- The policy -----------------------------------------------------------------------------------

k.test('policy-locked-maxnum', 'a policy locking add_tags_maxnum: the acc2 override is ignored (the policy value for both), the unlocked language still applies', async (t) => {
    await account(t, BASE);
    lock(t, { add_tags_maxnum: 5 });
    const a1 = mail('acc1', ['Work']);
    const a2 = mail('acc2', ['Work']);
    await receive(ctx, [a1, a2]);
    assert.ok(promptFor(a1).includes(maxnum(5)));
    assert.ok(promptFor(a2).includes(maxnum(5)));
    assert.ok(!promptFor(a2).includes(maxnum(7)));
    assert.ok(promptFor(a2).includes(forceLang('French')));
});

k.test('policy-locked-exclusions', 'a policy locking add_tags_exclusions: the acc2 list is ignored on every path, and the dialog is told the list is locked and global', async (t) => {
    await account(t, { add_tags_exclusions: ['promo'] });
    lock(t, { add_tags_exclusions: ['newsletter'] });
    const a2 = mail('acc2', ['Work', 'Weekly Newsletter', 'Promo']);
    await receive(ctx, [a2]);
    assert.deepEqual(labelsOf(a2), ['Promo', 'Work']);
    const d2 = mail('acc2', []);
    await fromTab(ctx, 7, { command: 'assign_tags', messageId: d2.id, tags: ['Weekly Newsletter', 'Promo'] });
    assert.deepEqual(labelsOf(d2), ['Promo']);
    const out = await fromTab(ctx, 7, { command: 'addtags_get_exclusion_prefs', messageId: d2.id });
    assert.deepEqual(out.add_tags_exclusions, ['newsletter']);
    assert.equal(out.exclusions_locked, true);
    assert.equal(out.exclusions_account_id, '');
});

k.test('policy-enforced-text', 'the policy enforcing the Add Tags text: the acc2 prompt_text is ignored on the batch and on the popup', async (t) => {
    await account(t, { prompt_text: 'ACCOUNT2 TEXT. ' + GLOBAL_TEXT, add_tags_maxnum: 7 });
    const getText = mztaManaged.getSpecialPromptText.bind(mztaManaged);
    const enforced = t.mock.method(mztaManaged, 'getSpecialPromptText', id => (id === 'prompt_add_tags' ? 'POLICY TEXT. ' + GLOBAL_TEXT : getText(id)));
    const a2 = mail('acc2', ['Work']);
    await receive(ctx, [a2]);
    assert.ok(promptFor(a2).startsWith('POLICY TEXT. '));
    assert.ok(!promptFor(a2).includes('ACCOUNT2 TEXT'));
    assert.ok(promptFor(a2).includes(maxnum(7)), 'the other overrides still apply');
    // The popup's menu entry is built from the prompts at the last menu build: rebuilt here, as a
    // policy is in place from startup.
    await ctx.bg._reload_menus();
    const r = await popup(t, mail('acc2', ['Work']));
    assert.ok(r.prompt.startsWith('POLICY TEXT. '));
    assert.ok(!r.prompt.includes('ACCOUNT2 TEXT'));
    enforced.mock.restore();
    await ctx.bg._reload_menus();
});

k.test('policy-disabled', 'a policy disabling the per-account settings: the acc2 values and text are ignored on the batch and the popup, the entry kept', async (t) => {
    const entry = { ...BASE, prompt_text: 'ACCOUNT2 TEXT. ' + GLOBAL_TEXT, add_tags_exclusions: ['promo'] };
    await account(t, entry);
    t.mock.method(mztaManaged, 'isAddTagsAccountSettingsDisabled', () => true);
    const a2 = mail('acc2', ['Work', 'Weekly Newsletter', 'Promo']);
    await receive(ctx, [a2]);
    const p2 = promptFor(a2);
    assert.ok(!p2.includes('ACCOUNT2 TEXT'));
    assert.ok(p2.includes(maxnum(3)));
    assert.ok(p2.includes(forceLang('Italian')));
    assert.deepEqual(labelsOf(a2), ['Promo', 'Work'], 'the global exclusion list');
    const r = await popup(t, mail('acc2', ['Work']));
    assert.ok(!r.prompt.includes('ACCOUNT2 TEXT'));
    assert.ok(r.prompt.includes(maxnum(3)));
    assert.deepEqual(ctx.ctl.localData().add_tags_account_settings, { acc2: entry });
});

k.test('policy-disabled-dialog', 'a policy disabling the per-account settings: the tag dialog gets and filters with the global values, no header read, and writes the global list', async (t) => {
    await account(t, { add_tags_exclusions: ['promo'], add_tags_exclusions_exact_match: true });
    t.mock.method(mztaManaged, 'isAddTagsAccountSettingsDisabled', () => true);
    const gets = () => ctx.m.calls.filter(c => c.api === 'messages.get').length;
    const d2 = mail('acc2', []);
    const before = gets();
    assert.deepEqual(await fromTab(ctx, 7, { command: 'addtags_get_exclusion_prefs', messageId: d2.id }), {
        add_tags_exclusions: ['newsletter'],
        add_tags_exclusions_exact_match: false,
        add_tags_hide_exclusions: false,
        exclusions_locked: false,
        exclusions_account_id: '',
    });
    assert.equal(gets(), before, 'the header was read for the account');
    await fromTab(ctx, 7, { command: 'assign_tags', messageId: d2.id, tags: TAGS });
    assert.deepEqual(labelsOf(d2), ['Promo', 'Promo deals']);
    await fromTab(ctx, 7, { command: 'addtags_set_exclusions', list: ['newsletter', 'ads'], accountId: 'acc2' });
    const data = ctx.ctl.localData();
    assert.deepEqual(data.add_tags_exclusions, ['newsletter', 'ads']);
    assert.deepEqual(data.add_tags_account_settings, { acc2: { add_tags_exclusions: ['promo'], add_tags_exclusions_exact_match: true } });
    await setPrefs(t, ctx, { add_tags_exclusions: ['newsletter'] });
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
