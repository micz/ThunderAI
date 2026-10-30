// The per-account Add Tags settings module (js/mzta-addtags-account-settings.js), on its own.
//
// Spec 02 "Add tags: per-account settings" (and the `add_tags_account_settings` row of spec 05):
//  - ADD_TAGS_ACCOUNT_KEYS are the nine override keys, prompt_text included; the others ARE the
//    global preference keys;
//  - addTags_getAccountSettings(): the whole object, {} when missing or not a plain object;
//  - addTags_getAccountEntry(accountId): the account's entry cleaned (known keys with a valid
//    value), or {};
//  - addTags_setAccountSettings(accountId, entry): only the known keys with the right type (a
//    blank prompt_text is no key, arrays must hold strings and are copied), a copy stored, the
//    account deleted when the entry ends up empty, the whole updated object returned, never
//    mutating what the preference layer handed out;
//  - addTags_resolveAccountPrefs(prefs, accountId): a COPY of prefs with the overrides applied
//    for every key present in prefs whose global key the policy does not lock; prompt_text never
//    copied into prefs; with no account id or no entry still a fresh copy equal to prefs;
//  - addTags_applyAccountPrompt(curr_prompt, accountId): a shallow copy with the account text, or
//    curr_prompt itself; untouched when the policy enforces the text (_text_by_policy).
//
// The area runs with no policy (README): a locked key is simulated by stubbing the two questions
// js/mzta-prefs.js and the module ask js/mzta-managed.js (isManagedLocked / getManagedValue), for
// one test, as 37-permission-reconcile does.

import assert from 'node:assert/strict';
import { moduleContext } from './context.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ctx = await moduleContext({ local: {} });
const mod = await import('../../js/mzta-addtags-account-settings.js');
const { mztaManaged } = await import('../../js/mzta-managed.js');
const k = caseTests('06-addtags-account-settings');

const stored = () => ctx.ctl.localData().add_tags_account_settings;
const writeRaw = value => ctx.ctl.browser.storage.local.set({ add_tags_account_settings: value });
const clear = () => ctx.ctl.browser.storage.local.remove('add_tags_account_settings');

/** A full, valid entry: one value per override key. */
const FULL = {
    prompt_text: 'Account prompt',
    add_tags_maxnum: 4,
    add_tags_force_lang: true,
    default_chatgpt_lang: 'German',
    add_tags_auto_force_existing: true,
    add_tags_auto_uselist: true,
    add_tags_auto_uselist_list: 'Work, Home',
    add_tags_exclusions: ['news', 'promo'],
    add_tags_exclusions_exact_match: true,
};

k.test('keys', 'ADD_TAGS_ACCOUNT_KEYS: prompt_text and the eight global Add Tags keys, each a declared preference', () => {
    assert.deepEqual([...mod.ADD_TAGS_ACCOUNT_KEYS].sort(), Object.keys(FULL).sort());
    for (const key of mod.ADD_TAGS_ACCOUNT_KEYS.filter(key => key !== 'prompt_text')) {
        assert.ok(key in ctx.prefs_default, key + ' is a global preference');
    }
    assert.deepEqual(ctx.prefs_default.add_tags_account_settings, {});
});

k.test('get-missing', 'no stored settings: {}', async () => {
    await clear();
    assert.deepEqual(await mod.addTags_getAccountSettings(), {});
    assert.deepEqual(await mod.addTags_getAccountEntry('acc1'), {});
});

k.test('get-not-object', 'stored settings that are not a plain object: {}', async () => {
    for (const bad of [[], ['acc1'], 'acc1', 42, true, null]) {
        await writeRaw(bad);
        assert.deepEqual(await mod.addTags_getAccountSettings(), {}, JSON.stringify(bad));
        assert.deepEqual(await mod.addTags_getAccountEntry('acc1'), {}, JSON.stringify(bad));
    }
    await clear();
});

k.test('entry-unknown', 'an account without an entry, or no account id: {}', async () => {
    await writeRaw({ acc1: { add_tags_maxnum: 3 } });
    assert.deepEqual(await mod.addTags_getAccountEntry('acc2'), {});
    for (const none of ['', undefined, null]) {
        assert.deepEqual(await mod.addTags_getAccountEntry(none), {}, String(none));
    }
    await clear();
});

k.test('entry-cleaned', 'a stored entry is read cleaned: unknown keys and wrong-typed values dropped', async () => {
    await writeRaw({
        acc1: {
            add_tags_maxnum: 'ten',
            add_tags_force_lang: 'yes',
            default_chatgpt_lang: 'French',
            add_tags_exclusions: ['ok', 3],
            add_tags_exclusions_exact_match: true,
            prompt_text: '   ',
            add_tags_auto: true,
            connection_type: 'ollama_api',
        },
    });
    assert.deepEqual(await mod.addTags_getAccountEntry('acc1'), { default_chatgpt_lang: 'French', add_tags_exclusions_exact_match: true });
    await clear();
});

k.test('set-full', 'a full valid entry is stored as given and the whole object returned', async () => {
    await clear();
    const out = await mod.addTags_setAccountSettings('acc1', FULL);
    assert.deepEqual(out, { acc1: FULL });
    assert.deepEqual(stored(), { acc1: FULL });
    assert.deepEqual(await mod.addTags_getAccountEntry('acc1'), FULL);
});

k.test('set-other-accounts-kept', 'setting one account keeps the entries of the others, and replaces its own whole entry', async () => {
    await writeRaw({ acc1: { add_tags_maxnum: 3, add_tags_force_lang: true }, acc2: { add_tags_maxnum: 9 } });
    const out = await mod.addTags_setAccountSettings('acc1', { add_tags_maxnum: 5 });
    assert.deepEqual(out, { acc1: { add_tags_maxnum: 5 }, acc2: { add_tags_maxnum: 9 } });
    assert.deepEqual(stored(), out);
    await clear();
});

k.test('set-drops-unknown', 'unknown keys are dropped (the automatic tagging behaviour and the connection are not per account)', async () => {
    await clear();
    await mod.addTags_setAccountSettings('acc1', {
        add_tags_maxnum: 2,
        add_tags_auto: true,
        add_tags_auto_only_inbox: false,
        add_tags_enabled_accounts: ['acc1'],
        connection_type: 'ollama_api',
        foo: 'bar',
    });
    assert.deepEqual(stored(), { acc1: { add_tags_maxnum: 2 } });
    await clear();
});

k.test('set-drops-wrong-types', 'a value of the wrong type is dropped, key by key', async () => {
    const cases = [
        ['add_tags_maxnum', -1], ['add_tags_maxnum', 2.5], ['add_tags_maxnum', '3'], ['add_tags_maxnum', null], ['add_tags_maxnum', NaN],
        ['add_tags_force_lang', 'true'], ['add_tags_force_lang', 1],
        ['default_chatgpt_lang', 5], ['default_chatgpt_lang', null],
        ['add_tags_auto_force_existing', 0],
        ['add_tags_auto_uselist', 'false'],
        ['add_tags_auto_uselist_list', ['Work']],
        ['add_tags_exclusions', 'news'], ['add_tags_exclusions', ['news', 1]], ['add_tags_exclusions', { 0: 'news' }],
        ['add_tags_exclusions_exact_match', 'yes'],
        ['prompt_text', 42], ['prompt_text', ''], ['prompt_text', '  \n '],
    ];
    for (const [key, value] of cases) {
        await clear();
        // A valid companion key shows the bad one is dropped alone, not the whole entry.
        const companion = key === 'add_tags_exclusions_exact_match' ? { add_tags_force_lang: true } : { add_tags_exclusions_exact_match: true };
        const out = await mod.addTags_setAccountSettings('acc1', { ...companion, [key]: value });
        const expected = { acc1: companion };
        assert.deepEqual(out, expected, key + ' = ' + JSON.stringify(value));
    }
    await clear();
});

k.test('set-valid-edges', 'the edge values that are valid are kept: maxnum 0, false booleans, empty strings, an empty exclusion list', async () => {
    await clear();
    const entry = {
        add_tags_maxnum: 0,
        add_tags_force_lang: false,
        default_chatgpt_lang: '',
        add_tags_auto_force_existing: false,
        add_tags_auto_uselist: false,
        add_tags_auto_uselist_list: '',
        add_tags_exclusions: [],
        add_tags_exclusions_exact_match: false,
    };
    await mod.addTags_setAccountSettings('acc1', entry);
    assert.deepEqual(stored(), { acc1: entry });
    await clear();
});

k.test('set-empty-deletes', 'an empty entry, or one with nothing valid left, removes the account', async () => {
    for (const empty of [{}, { foo: 1 }, { prompt_text: '  ' }, { add_tags_maxnum: -3 }, null, undefined, 'x', []]) {
        await writeRaw({ acc1: { add_tags_maxnum: 3 }, acc2: { add_tags_maxnum: 9 } });
        const out = await mod.addTags_setAccountSettings('acc1', empty);
        assert.deepEqual(out, { acc2: { add_tags_maxnum: 9 } }, JSON.stringify(empty));
        assert.deepEqual(stored(), { acc2: { add_tags_maxnum: 9 } }, JSON.stringify(empty));
    }
    await mod.addTags_setAccountSettings('acc2', {});
    assert.deepEqual(stored(), {}, 'the last account removed: an empty object');
    await clear();
});

k.test('set-copies', 'the stored entry shares nothing with the caller: changing the given entry or array afterwards changes nothing stored', async () => {
    await clear();
    const exclusions = ['news'];
    const entry = { add_tags_maxnum: 3, add_tags_exclusions: exclusions };
    const out = await mod.addTags_setAccountSettings('acc1', entry);
    exclusions.push('later');
    entry.add_tags_maxnum = 99;
    assert.deepEqual(stored(), { acc1: { add_tags_maxnum: 3, add_tags_exclusions: ['news'] } });
    assert.deepEqual(await mod.addTags_getAccountEntry('acc1'), { add_tags_maxnum: 3, add_tags_exclusions: ['news'] });
    assert.notEqual(out.acc1, entry);
    assert.notEqual(out.acc1.add_tags_exclusions, exclusions);
    await clear();
});

k.test('set-no-mutation', 'a write never mutates what the preference layer handed out, nor prefs_default', async () => {
    await clear();
    await mod.addTags_setAccountSettings('acc1', { add_tags_maxnum: 3 });
    assert.deepEqual(ctx.prefs_default.add_tags_account_settings, {}, 'the default object untouched');
    const before = await mod.addTags_getAccountSettings();
    const snapshot = structuredClone(before);
    await mod.addTags_setAccountSettings('acc2', { add_tags_maxnum: 4 });
    await mod.addTags_setAccountSettings('acc1', {});
    assert.deepEqual(before, snapshot, 'the object read earlier is unchanged');
    assert.deepEqual(stored(), { acc2: { add_tags_maxnum: 4 } });
    await clear();
});

const PREFS = {
    add_tags_maxnum: 3,
    add_tags_force_lang: false,
    default_chatgpt_lang: 'Italian',
    add_tags_auto_force_existing: false,
    add_tags_auto_uselist: false,
    add_tags_auto_uselist_list: '',
    add_tags_exclusions: ['global'],
    add_tags_exclusions_exact_match: false,
    connection_type: 'chatgpt_api',
};

k.test('resolve-fresh-copy', 'no account id, or an account without an entry: a NEW object equal to prefs', async () => {
    await writeRaw({ acc1: { add_tags_maxnum: 7 } });
    for (const id of ['', undefined, null, 'acc2']) {
        const out = await mod.addTags_resolveAccountPrefs(PREFS, id);
        assert.notEqual(out, PREFS, String(id));
        assert.deepEqual(out, PREFS, String(id));
    }
    await clear();
});

k.test('resolve-applies', 'the account overrides replace the global values, the other keys are kept, prefs itself is unchanged', async () => {
    await writeRaw({ acc1: { add_tags_maxnum: 7, default_chatgpt_lang: 'French', add_tags_exclusions: ['mine'], add_tags_exclusions_exact_match: true } });
    const prefs = structuredClone(PREFS);
    const out = await mod.addTags_resolveAccountPrefs(prefs, 'acc1');
    assert.deepEqual(out, { ...PREFS, add_tags_maxnum: 7, default_chatgpt_lang: 'French', add_tags_exclusions: ['mine'], add_tags_exclusions_exact_match: true });
    assert.deepEqual(prefs, PREFS, 'prefs not mutated');
    await clear();
});

k.test('resolve-replaces-list', 'an exclusion list override replaces the global list, it does not extend it; an empty one empties it', async () => {
    await writeRaw({ acc1: { add_tags_exclusions: [] } });
    assert.deepEqual((await mod.addTags_resolveAccountPrefs(PREFS, 'acc1')).add_tags_exclusions, []);
    await clear();
});

k.test('resolve-only-present', 'only the keys present in prefs are overridden: no key is added, prompt_text never', async () => {
    await writeRaw({ acc1: { prompt_text: 'Account prompt', add_tags_maxnum: 7, add_tags_auto_uselist: true } });
    const out = await mod.addTags_resolveAccountPrefs({ add_tags_maxnum: 3, do_debug: false }, 'acc1');
    assert.deepEqual(out, { add_tags_maxnum: 7, do_debug: false });
    await clear();
});

k.test('resolve-malformed-ignored', 'a stored value of the wrong type is ignored: the global value stays', async () => {
    await writeRaw({ acc1: { add_tags_maxnum: 'seven', add_tags_force_lang: 1, add_tags_exclusions: 'mine', default_chatgpt_lang: 'French' } });
    const out = await mod.addTags_resolveAccountPrefs(PREFS, 'acc1');
    assert.deepEqual(out, { ...PREFS, default_chatgpt_lang: 'French' });
    await clear();
});

k.test('resolve-locked', 'a global key the policy locks is never overridden; the unlocked ones still are', async (t) => {
    const isLocked = mztaManaged.isManagedLocked.bind(mztaManaged);
    t.mock.method(mztaManaged, 'isManagedLocked', key => key === 'add_tags_maxnum' || key === 'add_tags_exclusions' || isLocked(key));
    await writeRaw({ acc1: { add_tags_maxnum: 7, add_tags_exclusions: ['mine'], default_chatgpt_lang: 'French' } });
    const out = await mod.addTags_resolveAccountPrefs(PREFS, 'acc1');
    assert.equal(out.add_tags_maxnum, 3);
    assert.deepEqual(out.add_tags_exclusions, ['global']);
    assert.equal(out.default_chatgpt_lang, 'French');
    await clear();
});

const PROMPT = { id: 'prompt_add_tags', text: 'Global text', is_special: '1' };

k.test('prompt-none', 'no account id, no entry, or an entry without prompt_text: curr_prompt itself', async () => {
    await writeRaw({ acc1: { add_tags_maxnum: 7 } });
    for (const id of ['', undefined, 'acc1', 'acc2']) {
        assert.equal(await mod.addTags_applyAccountPrompt(PROMPT, id), PROMPT, String(id));
    }
    assert.equal(await mod.addTags_applyAccountPrompt(null, 'acc1'), null);
    assert.equal(await mod.addTags_applyAccountPrompt(undefined, 'acc1'), undefined);
    await clear();
});

k.test('prompt-copy', 'an account prompt text: a shallow copy with that text, the original untouched', async () => {
    await writeRaw({ acc1: { prompt_text: 'Account text' } });
    const prompt = structuredClone(PROMPT);
    const out = await mod.addTags_applyAccountPrompt(prompt, 'acc1');
    assert.notEqual(out, prompt);
    assert.deepEqual(out, { ...PROMPT, text: 'Account text' });
    assert.deepEqual(prompt, PROMPT, 'the original prompt untouched');
    await clear();
});

k.test('prompt-enforced', 'the policy enforces the Add Tags text (_text_by_policy): the account text is ignored', async () => {
    await writeRaw({ acc1: { prompt_text: 'Account text' } });
    const enforced = { ...PROMPT, text: 'Policy text', _text_by_policy: true };
    assert.equal(await mod.addTags_applyAccountPrompt(enforced, 'acc1'), enforced);
    assert.equal(enforced.text, 'Policy text');
    await clear();
});

k.coverage();
