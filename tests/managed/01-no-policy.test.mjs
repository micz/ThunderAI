// Spec 08 "Overview": with no policy installed the behaviour is byte-for-byte what it was
// before managed configuration existed. storage.managed.get() REJECTS - the normal case -
// and that is swallowed silently, without even a debug line.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserMock } from '../helpers/browser-mock.mjs';
import { captureConsole, loadModules, loadFixture } from '../helpers/load.mjs';

const STORED = {
    do_debug: true,                    // debug on, to prove not even a debug line is written
    connection_type: 'ollama_api',
    spamfilter_threshold: null,        // an emptied number input: must come back as null
    default_sign_name: 'Me',
    spamfilter_enabled_accounts: ['account2'],
    // A stray value for a policy-only key: without a policy it must not limit anything.
    spamfilter_enabled_accounts_match: ['nobody@nowhere.example'],
    spamfilter_use_specific_integration: false,
    _special_prompts: [
        // A legacy override saved while the preference is false: must keep working unmanaged.
        { id: 'prompt_spamfilter', text: 'My own spam text {%mail_html_body%} spamValue explanation',
          api_type: 'ollama_api', ollama_model: 'llama3', is_default: '1', is_special: '1', show_in: 'context' },
    ],
};

let ctl, con, m, callsAtImport;

before(async () => {
    ctl = installBrowserMock({ policy: null, local: STORED, accounts: loadFixture('accounts.json') });
    con = captureConsole();
    m = await loadModules();
    callsAtImport = ctl.calls.filter(c => c.area === 'managed').length;
    m.mztaManaged.logger.changeDebug(true);
    await m.mztaManaged.loadManaged();
});

test('importing the modules never reads storage.managed (load is explicit, spec "Load ordering")', () => {
    assert.equal(callsAtImport, 0);
});

test('loadManaged() reads storage.managed once, and its rejection resolves the load', async () => {
    assert.equal(ctl.calls.filter(c => c.area === 'managed').length, 1);
    await m.mztaManaged.loadManaged();       // idempotent: same promise, no second read
    await m.mztaManaged.managedReady();
    assert.equal(ctl.calls.filter(c => c.area === 'managed').length, 1);
});

test('the module reports "read, and there is none"', () => {
    const mm = m.mztaManaged;
    assert.equal(mm.hasLoaded(), true);
    assert.equal(mm.isManagedActive(), false);
    assert.deepEqual(mm.getLockedKeys(), []);
    assert.deepEqual(mm.getOrgPrompts(), []);
    assert.deepEqual(mm.getSpecialPromptsText(), {});
    assert.equal(mm.getOrgName(), '');
    assert.equal(mm.isPromptManagementDisabled(), false);
    assert.equal(mm.areDefaultPromptsDisabled(), false);
    assert.equal(mm.isSetupWizardDisabled(), false);
    assert.equal(mm.hasManagedValue('connection_type'), false);
});

test('the background never messages itself for the managed state', () => {
    assert.equal(ctl.sent.length, 0);
});

test('reads: stored value, else prefs_default; a stored null stays null', async () => {
    const p = m.mztaPrefs;
    assert.equal(await p.getPref('connection_type'), 'ollama_api');
    assert.equal(await p.getPref('reply_type'), m.prefs_default.reply_type);
    assert.equal(await p.getPref('spamfilter_threshold'), null);
    assert.deepEqual(await p.getPrefs(['connection_type', 'spamfilter_threshold', 'default_sign_name', 'reply_type']), {
        connection_type: 'ollama_api', spamfilter_threshold: null, default_sign_name: 'Me',
        reply_type: m.prefs_default.reply_type,
    });
    const all = await p.getAllPrefs();
    for (const key of Object.keys(m.prefs_default)) {
        const expected = key in STORED ? STORED[key] : m.prefs_default[key];
        assert.deepEqual(all[key], expected, key);
    }
});

test('reads hand storage.get() exactly the prefs_default defaults', async () => {
    ctl.calls.length = 0;
    await m.mztaPrefs.getPrefs(['reply_type', 'chatgpt_model', 'add_tags_exclusions']);
    const gets = ctl.calls.filter(c => c.area === 'local' && c.op === 'get' &&
        c.keys && typeof c.keys === 'object' && 'reply_type' in c.keys);
    assert.equal(gets.length, 1);
    assert.deepEqual(gets[0].keys, {
        reply_type: m.prefs_default.reply_type,
        chatgpt_model: m.prefs_default.chatgpt_model,
        add_tags_exclusions: m.prefs_default.add_tags_exclusions,
    });
});

test('writes reach storage unfiltered, setPrefs({}) writes nothing', async () => {
    await m.mztaPrefs.setPref('connection_type', 'anthropic_api');
    await m.mztaPrefs.setPrefs({ chatgpt_model: 'gpt-me', spamfilter: true });
    const local = ctl.localData();
    assert.equal(local.connection_type, 'anthropic_api');
    assert.equal(local.chatgpt_model, 'gpt-me');
    assert.equal(local.spamfilter, true);
    ctl.calls.length = 0;
    await m.mztaPrefs.setPrefs({});
    assert.equal(ctl.calls.filter(c => c.op === 'set').length, 0);
});

test('special prompts: shipped/user texts, no policy marker, legacy override intact', async () => {
    const specials = await m.prompts.getSpecialPrompts();
    const spam = specials.find(p => p.id === 'prompt_spamfilter');
    assert.equal(spam.text, STORED._special_prompts[0].text);
    assert.equal(spam.api_type, 'ollama_api');
    assert.equal(spam.ollama_model, 'llama3');
    assert.ok(specials.every(p => !('_text_by_policy' in p)));
    const task = specials.find(p => p.id === 'prompt_get_task');
    assert.equal(task.text, ctl.browser.i18n.getMessage('prompt_get_task_full_text'));
    assert.deepEqual(await m.prompts.getIgnoredProviderOverrides(), []);
    assert.deepEqual(await m.prompts.getEnforcedTextPlaceholderProblems(), []);
});

test('prompts: no org prompts, nothing marked inactive, built-ins available', async () => {
    const all = await m.prompts.getPrompts();
    assert.ok(all.some(p => p.id === 'prompt_reply'));
    assert.ok(all.every(p => String(p.is_org) !== '1'));
    const mgmt = await m.prompts.getPromptsForManagement();
    assert.ok(mgmt.every(p => !p._shadowed_by_org && !p._inert_by_policy && !p._default_inert_by_policy));
});

test('account scope is the stored list; a stray stored _match value limits nothing', async () => {
    ctl.calls.length = 0;
    assert.deepEqual(await m.utils.resolveEnabledAccounts('spamfilter', ['account2']),
        { restricted: true, accountIds: ['account2'], managed: false });
    assert.deepEqual(await m.utils.resolveEnabledAccounts('spamfilter', []),
        { restricted: false, accountIds: [], managed: false });
    assert.equal(ctl.calls.filter(c => c.area === 'accounts').length, 0);
});

test('nothing at all was logged by the managed module, and no warning by anyone', () => {
    assert.deepEqual(con.entries.filter(e => e.msg.includes('mzta-managed')), []);
    assert.deepEqual(con.warnings(), []);
    assert.deepEqual(con.entries.filter(e => e.level === 'error'), []);
});
