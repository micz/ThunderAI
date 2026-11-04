// The storage management page (pages/storage/) opened as the Spam Filter page's link opens it:
// mzta-storage-manager.html#spam. No policy.
//
// Spec 05 "Storage Management Page" (entry list): a plain hash, #summary / #translation / #spam,
// selects the list's type when the page opens and when the hash changes; any other hash is ignored.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { seedMessageData } from '../../ui/dom-helpers.mjs';

const meta = { subject: [], from: [], message_date: '' };
await seedMessageData({
    summary: [{ messageId: 's1@x', createdAt: 1000, summary: 'S', ...meta }],
    translation: [{ messageId: 't1@x', createdAt: 1000, translated_text: 'T', ...meta }],
    spam: [{ messageId: 'p1@x', createdAt: 1000, spamValue: 50, explanation: 'e', moved: false, SpamThreshold: 70, ...meta }],
});
const ctx = await openPage('storage', { query: '#spam' });
after(() => ctx.close());
const k = uiTests('storage', '04');
const S_LIST = 'spec 05 "Storage Management Page — entry list"';
const firstCell = () => ctx.$$('#entries_body tr')[0].cells[0].textContent;
const firstId = () => ctx.$$('#entries_body tr')[0].dataset.messageId;

k.test('hash-spam', S_LIST, '#spam: the page opens on the spam reports', () => {
    assert.equal(ctx.$('#entries_type').value, 'spam');
    assert.equal(ctx.$('#entries_table').dataset.type, 'spam');
    assert.equal(firstCell(), 'p1@x');
});

k.test('hash-change', S_LIST, 'a later hash change selects that type', async () => {
    ctx.window.location.hash = '#translation';
    ctx.window.dispatchEvent(new ctx.window.HashChangeEvent('hashchange'));
    await ctx.settle();
    assert.equal(ctx.$('#entries_type').value, 'translation');
    assert.equal(firstId(), 't1@x');
});

k.test('hash-unknown', S_LIST, 'an unknown hash changes nothing', async () => {
    ctx.window.location.hash = '#nothing';
    ctx.window.dispatchEvent(new ctx.window.HashChangeEvent('hashchange'));
    await ctx.settle();
    assert.equal(ctx.$('#entries_type').value, 'translation');
});

k.test('harness-clean', S_LIST, 'the page ran on modelled APIs only', () => assertHarnessClean(ctx));

k.coverage();
