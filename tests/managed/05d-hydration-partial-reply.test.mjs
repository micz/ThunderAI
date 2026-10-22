// Spec 08 "Hydration in every other context": _hydrate() fills _values / _locked /
// _specialPromptsText from {values, lockedKeys, specialPromptsText}; "a locked key without a
// value is dropped; a non-string text is dropped". The rest of the reply still applies.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SENDERS } from '../helpers/browser-mock.mjs';
import { startPage } from '../helpers/load.mjs';

const SPAM_TEXT = 'Check {%mail_html_body%} and answer {"explanation": "", "spamValue": 0}';

let ctx;

before(async () => {
    ctx = await startPage({
        policy: null,
        local: { spamfilter: false },
        sender: SENDERS.featurePage,
        remote: () => ({
            values: { connection_type: 'chatgpt_api' },
            lockedKeys: ['connection_type', 'spamfilter'],       // spamfilter has no value
            specialPromptsText: { prompt_spamfilter: SPAM_TEXT, prompt_add_tags: 42 },
        }),
    });
    await ctx.mztaPrefs.getPref('connection_type');
});

test('a locked key with a value is enforced', async () => {
    assert.equal(ctx.mztaManaged.isManagedLocked('connection_type'), true);
    assert.equal(await ctx.mztaPrefs.getPref('connection_type'), 'chatgpt_api');
});

test('a locked key without a value is dropped: not locked, still writable', async () => {
    assert.equal(ctx.mztaManaged.isManagedLocked('spamfilter'), false);
    await ctx.mztaPrefs.setPref('spamfilter', true);
    assert.equal(ctx.ctl.localData().spamfilter, true);
});

test('a string text is applied, a non-string one dropped', async () => {
    const specials = await ctx.prompts.getSpecialPrompts();
    const spam = specials.find(p => p.id === 'prompt_spamfilter');
    const tags = specials.find(p => p.id === 'prompt_add_tags');
    assert.equal(spam.text, SPAM_TEXT);
    assert.equal(spam._text_by_policy, true);
    assert.equal(tags.text, ctx.ctl.browser.i18n.getMessage('prompt_add_tags_full_text'));
    assert.equal('_text_by_policy' in tags, false);
});
