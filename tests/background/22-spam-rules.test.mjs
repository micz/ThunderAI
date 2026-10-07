// Spec 01 "Data Flow: Spam filter sender rules" (_runSpamJob() deciding by rule, without an AI
// call, after the message is loaded and before the prompt is built):
//
//     allowMatch = matchAddressListType(author, spamfilter_skip_addresses)    'exact' | 'domain' | null
//     blockMatch = matchAddressListType(author, spamfilter_block_addresses)
//     blocked    = blockMatch && (!allowMatch || (blockMatch === 'exact' && allowMatch === 'domain'))
//         allowMatch && !blocked  -> report spamValue 0   (spamfilter_skip_addresses_explanation)
//         blocked                 -> report spamValue 100 (spamfilter_block_addresses_explanation),
//                                    junk move when autoMove / entry.wantsMove
//         neither                 -> address book check (spamfilter_skip_addressbook), unchanged
//                                    -> otherwise the AI
//
//  - precedence: the more specific match wins; on equal specificity the allow list wins; both
//    lists come before the address book, so a blocked contact is still blocked;
//  - an allow-list report can never be moved, even with a threshold of 0 (verdict.isSpam is
//    explicit); a blocked message is moved on the same terms as an AI verdict, and moved = true
//    stops the processEmails() pipeline; a manual check (no autoMove) only shows the 100 report;
//  - lists are tested with hasAddressListEntries(): a legacy [''] reads as empty;
//  - processEmails() passes both lists from its own read; any other caller (panel Refresh) leaves
//    them out and _runSpamJob() reads them from storage.
// Spec 05 `spamfilter_threshold` row: 0 is a legitimate setting ("flag everything").
// Spec 02 "Missing special prompts": subject and from are stored as arrays (MIME header shape).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repoPath } from '../helpers/core/load.mjs';
import { bgContext } from './context.mjs';
import {
    API,
    featureResponder,
    sentPrompts,
    receive,
    record,
    fromTab,
    setPrefs,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const MESSAGES = JSON.parse(readFileSync(repoPath('_locales/en/messages.json'), 'utf8'));
const i18n = name => MESSAGES[name].message;

const ctx = await bgContext({
    local: {
        ...API,
        spamfilter: true,
        spamfilter_threshold: 0,
        spamfilter_skip_addresses: ['friend@corp.test', '@trusted.test', 'boss@evil.test', 'x@both.test', '@dual.test'],
        spamfilter_block_addresses: ['@evil.test', 'scam@trusted.test', 'x@both.test', '*@dual.test'],
        spamfilter_skip_addressbook: true,
        summarize: true,
        summarize_auto: 3,
        translate: false,
    },
    mail: {
        permissions: ['addressBooks'],
        contacts: [
            { id: 'c1', properties: { PrimaryEmail: 'pal@else.test' } },
            { id: 'c2', properties: { PrimaryEmail: 'rogue@evil.test' } },
        ],
    },
    setup(m) { m.addTab({ id: 7, type: 'mail', active: true }); },
});
ctx.workers.respond = featureResponder();
const k = caseTests('22-spam-rules');
const mail = (hid, author) => ctx.m.addMessage({ headerMessageId: hid, author });
const spamCalls = () => sentPrompts(ctx).filter(p => p.feature === 'spam').map(p => p.message);
const inFolder = hid => ctx.m.byHeaderId(hid)?.folder.id;

/** Receive one message from `author`, return its stored spam report. */
async function screen(hid, author) {
    await receive(ctx, [mail(hid, author)]);
    return record(ctx, hid)?.spam ?? null;
}

const ALLOW = i18n('spamfilter_skip_addresses_explanation');
const BLOCK = i18n('spamfilter_block_addresses_explanation');
const BOOK = i18n('spamfilter_skip_addressbook_explanation');

k.test('allow-exact', 'an exact allow-list address: report 0 with the allow explanation, no AI call, not moved', async () => {
    const r = await screen('al1@x', 'Friend <friend@corp.test>');
    assert.equal(r.spamValue, 0);
    assert.equal(r.explanation, ALLOW);
    assert.equal(r.moved, false);
    assert.equal(spamCalls().includes('al1@x'), false);
    assert.equal(inFolder('al1@x'), 'f-inbox');
});

k.test('allow-never-moved', 'an allow-list report is never moved, even with a threshold of 0', async () => {
    const r = await screen('al2@x', 'anyone@trusted.test');
    assert.equal(r.spamValue, 0);
    assert.equal(r.SpamThreshold, 0);
    assert.equal(r.moved, false);
    assert.equal(inFolder('al2@x'), 'f-inbox');
});

k.test('allow-continues', 'an allowed message goes on through its pipeline (summarized)', () => {
    assert.ok(record(ctx, 'al1@x').summary);
});

k.test('block-domain', 'a block-list domain: report 100 with the block explanation, no AI call, moved to junk', async () => {
    const r = await screen('bl1@x', 'Bad <bad@evil.test>');
    assert.equal(r.spamValue, 100);
    assert.equal(r.explanation, BLOCK);
    assert.equal(r.moved, true);
    assert.equal(spamCalls().includes('bl1@x'), false);
    assert.equal(inFolder('bl1@x'), 'f-junk');
});

k.test('block-stops-pipeline', 'a blocked message moved to junk gets no summary', () => {
    assert.equal(record(ctx, 'bl1@x').summary, undefined);
});

k.test('block-exact-beats-allow-domain', 'an exact block entry beats an allow-list domain', async () => {
    const r = await screen('bl2@x', 'scam@trusted.test');
    assert.equal(r.spamValue, 100);
    assert.equal(inFolder('bl2@x'), 'f-junk');
});

k.test('allow-exact-beats-block-domain', 'an exact allow entry beats a block-list domain', async () => {
    const r = await screen('bl3@x', 'boss@evil.test');
    assert.equal(r.spamValue, 0);
    assert.equal(inFolder('bl3@x'), 'f-inbox');
});

k.test('equal-exact-allow-wins', 'the same exact address in both lists: the allow list wins', async () => {
    const r = await screen('eq1@x', 'x@both.test');
    assert.equal(r.spamValue, 0);
    assert.equal(inFolder('eq1@x'), 'f-inbox');
});

k.test('equal-domain-allow-wins', 'the same domain in both lists (@ and *@ forms): the allow list wins', async () => {
    const r = await screen('eq2@x', 'y@dual.test');
    assert.equal(r.spamValue, 0);
});

k.test('blocked-contact', 'a blocked sender in the address book is still blocked: the lists come first', async () => {
    const r = await screen('bk1@x', 'rogue@evil.test');
    assert.equal(r.spamValue, 100);
    assert.equal(r.explanation, BLOCK);
});

k.test('address-book', 'neither list, sender in the address book: report 0 with the address book explanation, no AI call', async () => {
    const r = await screen('ab1@x', 'Pal <pal@else.test>');
    assert.equal(r.spamValue, 0);
    assert.equal(r.explanation, BOOK);
    assert.equal(r.moved, false);
    assert.equal(spamCalls().includes('ab1@x'), false);
});

k.test('neither-ai', 'neither list nor the address book: the AI decides', async () => {
    const r = await screen('ai1@x', 'unknown@else.test');
    assert.equal(spamCalls().includes('ai1@x'), true);
    assert.equal(r.spamValue, 10);
    assert.equal(r.explanation, 'Looks fine');
});

k.test('threshold-zero', 'a threshold of 0 flags everything: the AI verdict (10) is moved to junk', () => {
    assert.equal(record(ctx, 'ai1@x').spam.moved, true);
    assert.equal(inFolder('ai1@x'), 'f-junk');
});

k.test('report-metadata', 'a rule report stores the subject and sender as arrays, and the message date', () => {
    const r = record(ctx, 'bl1@x').spam;
    assert.ok(Array.isArray(r.subject) && Array.isArray(r.from));
    assert.deepEqual(r.from, ['Bad <bad@evil.test>']);
    assert.equal(typeof r.message_date, 'string');
});

k.test('manual-block-not-moved', 'a manual check (panel Refresh) of a blocked sender shows the 100 report and does not move it', async () => {
    const h = mail('man1@x', 'other@evil.test');
    ctx.m.tab(7).displayed = h.id;
    ctx.m.tabSends.length = 0;
    await fromTab(ctx, 7, { command: 'refreshSpamReport', headerMessageId: 'man1@x' });
    const r = record(ctx, 'man1@x').spam;
    assert.equal(r.spamValue, 100);
    assert.equal(r.moved, false);
    assert.equal(inFolder('man1@x'), 'f-inbox');
    assert.ok(ctx.m.sentTo(7, 'showSpamReport').some(c => c.data.spamValue === 100), 'the report is shown in the tab');
});

k.test('legacy-empty-lists', "legacy [''] lists read as empty: a sender once listed now goes to the AI", async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { spamfilter_skip_addresses: [''], spamfilter_block_addresses: [''], spamfilter_threshold: 70 });
    const r = await screen('lg1@x', 'friend@corp.test');
    assert.equal(spamCalls().includes('lg1@x'), true);
    assert.equal(r.spamValue, 10);
    assert.equal(r.moved, false);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
