// Spec 08 "Resolution order":
//   locked policy value > user value in storage.local > unlocked policy value > prefs_default
// An unlocked value is handed to storage.get() as the key's default, so storage.get()
// semantics - including a stored null - are untouched. A locked value is applied after the
// read and beats even a value stored before the policy existed.
// Spec 08 "Validation": API key values are masked in all log output.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserMock } from '../helpers/browser-mock.mjs';
import { captureConsole, loadModules, loadFixture } from '../helpers/load.mjs';

const POLICY = loadFixture('resolution.json');
const SECRET = POLICY.chatgpt_api_key;
const STORED = {
    do_debug: true,                     // every read is logged: the key must still be masked
    connection_type: 'ollama_api',      // written before the policy: the locked value must win
    chatgpt_model: 'user-model',        // user value beats the unlocked policy value
    spamfilter_threshold: null,         // stored null: present, so the unlocked default loses
    add_tags_maxnum: 2,                 // "<key>:locked": true is the same as no modifier
    chatgpt_api_key: 'sk-user-own',
    default_chatgpt_lang: 'Italian',    // not in the policy at all
};

let ctl, con, m;

before(async () => {
    ctl = installBrowserMock({ policy: POLICY, local: STORED });
    con = captureConsole();
    m = await loadModules();
    m.mztaManaged.logger.changeDebug(true);
    await m.mztaManaged.loadManaged();
});

const EXPECTED = {
    connection_type: 'chatgpt_api',          // locked > stored
    default_sign_name: 'ACME Staff',         // locked, nothing stored
    add_tags_maxnum: 5,                      // locked (explicit :locked true) > stored
    chatgpt_api_key: 'sk-org-SECRET-resolution', // locked > stored (background context: real key)
    chatgpt_model: 'user-model',             // stored > unlocked
    spamfilter_threshold: null,              // stored null > unlocked
    reply_type: 'reply_sender',              // unlocked > prefs_default
    default_chatgpt_lang: 'Italian',         // stored, not managed
};

test('the policy is active, with the org name', () => {
    assert.equal(m.mztaManaged.isManagedActive(), true);
    assert.equal(m.mztaManaged.getOrgName(), 'ACME');
});

test('lock state follows the lock convention', () => {
    const mm = m.mztaManaged;
    for (const k of ['connection_type', 'default_sign_name', 'add_tags_maxnum', 'chatgpt_api_key']) {
        assert.equal(mm.isManagedLocked(k), true, k);
    }
    for (const k of ['chatgpt_model', 'reply_type', 'spamfilter_threshold']) {
        assert.equal(mm.isManagedLocked(k), false, k);
        assert.equal(mm.hasManagedValue(k), true, k);
    }
});

test('getPref resolves every key in the documented order', async () => {
    for (const [key, value] of Object.entries(EXPECTED)) {
        assert.deepEqual(await m.mztaPrefs.getPref(key), value, key);
    }
    assert.equal(await m.mztaPrefs.getPref('translate_lang'), m.prefs_default.translate_lang);
});

test('getPrefs and getAllPrefs resolve identically to getPref', async () => {
    const keys = Object.keys(EXPECTED);
    assert.deepEqual(await m.mztaPrefs.getPrefs(keys), EXPECTED);
    const all = await m.mztaPrefs.getAllPrefs();
    for (const [key, value] of Object.entries(EXPECTED)) assert.deepEqual(all[key], value, key);
});

test('resolution is a read-time overlay: storage.local still holds the user values', () => {
    const local = ctl.localData();
    for (const [key, value] of Object.entries(STORED)) assert.deepEqual(local[key], value, key);
    assert.equal('default_sign_name' in local, false);
    assert.equal('reply_type' in local, false);
});

test('an API key is never written to the log, not even with do_debug on', () => {
    assert.ok(con.entries.some(e => e.msg.includes('chatgpt_api_key')), 'the key id is logged');
    for (const e of con.entries) {
        assert.equal(e.msg.includes(SECRET), false, 'policy key leaked: ' + e.msg);
        assert.equal(e.msg.includes('sk-user-own'), false, 'stored key leaked: ' + e.msg);
    }
});

test('a well-formed policy produces no warning', () => {
    assert.deepEqual(con.warnings(), []);
});
