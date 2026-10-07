// What the spam filter does to a message, on reception (processEmails(), auto mode).
//
// Spec 01 "Per-message pipelines in processEmails()":
//  - spam first, per message: a verdict moving the message to junk stops its pipeline (no tags,
//    no summary, no translation); _generateSpamReportForMessage() returns {moved}, the junk move is
//    awaited before it returns;
//  - re-read after the spam step: the header is re-read with messages.get(message.id) (a moved
//    message gets a new id, so this fails) and the pipeline stops quietly when it is gone;
//  - fetch failures are feature-local: a getFull() failure skips only the feature that needed it,
//    the next feature retries the fetch once;
//  - serialized junk moves (_enqueueJunkMove()): one messages.update({junk}) + messages.move() at a
//    time; a failure - an account with no junk folder included - is logged and leaves
//    report_data.moved = false, and the verdict is still saved.
// Spec 01 "Data Flow: Spam filter sender rules", _moveMessageToJunk(): marks the message junk and
// moves it to the account's specialUse ['junk'] folder; never throws.
// Spec 01 "Shared guards" / "onNewMailReceived registration": in auto mode the spam filter skips
// the auto-skipped folders, the accounts not enabled (spamfilter_enabled_accounts, [] = all) and,
// with spamfilter_only_inbox, everything outside the inbox; the manual path is never filtered.
// Spec 01 "In-flight jobs": updateSpamPanel() broadcasts to every tab displaying the message,
// gated by spamfilter_show_msg_panel: the in-progress badge, then the report.
// Spec 05 `spamfilter_threshold`: the verdict is spam from the threshold up.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import { holding } from './fake-worker.mjs';
import {
    API,
    featureResponder,
    sentPrompts,
    receive,
    record,
    drive,
    setPrefs,
    clickContextMenu,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const verdicts = {};
const ctx = await bgContext({
    local: {
        ...API,
        spamfilter: true,
        spamfilter_threshold: 70,
        spamfilter_enabled_accounts: ['acc1', 'acc-nojunk'],
        spamfilter_skip_addressbook: false,
        summarize: true,
        summarize_auto: 3,
        translate: false,
    },
    mail: {
        accounts: [{ id: 'acc1', name: 'Main' }, { id: 'acc2', name: 'Not enabled' }, { id: 'acc-nojunk', name: 'No junk folder' }],
        folders: [
            { id: 'f-inbox', accountId: 'acc1', name: 'Inbox', path: '/INBOX', specialUse: ['inbox'] },
            { id: 'f-junk', accountId: 'acc1', name: 'Junk', path: '/Junk', specialUse: ['junk'] },
            { id: 'f-trash', accountId: 'acc1', name: 'Trash', path: '/Trash', specialUse: ['trash'] },
            { id: 'f-lists', accountId: 'acc1', name: 'Lists', path: '/Lists', specialUse: [] },
            { id: 'g-inbox', accountId: 'acc2', name: 'Inbox', path: '/INBOX', specialUse: ['inbox'] },
            { id: 'n-inbox', accountId: 'acc-nojunk', name: 'Inbox', path: '/INBOX', specialUse: ['inbox'] },
        ],
    },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
        m.addTab({ id: 8, type: 'messageDisplay', windowId: 2 });
    },
});
ctx.workers.respond = featureResponder({
    spam: hid => JSON.stringify({ spamValue: verdicts[hid] ?? 10, explanation: 'verdict for ' + hid }),
});
const k = caseTests('23-spam-actions');
const mail = (hid, folderId = 'f-inbox', spamValue = 10) => {
    verdicts[hid] = spamValue;
    return ctx.m.addMessage({ headerMessageId: hid, folderId });
};
const prompted = (feature, hid) => sentPrompts(ctx).some(p => p.feature === feature && p.message === hid);
const inFolder = hid => ctx.m.byHeaderId(hid)?.folder.id;

k.test('spam-moved', 'a verdict at the threshold or above: the message is marked junk and moved to its account\'s junk folder', async () => {
    const h = mail('s1@x', 'f-inbox', 95);
    await receive(ctx, [h]);
    const r = record(ctx, 's1@x').spam;
    assert.equal(r.spamValue, 95);
    assert.equal(r.moved, true);
    assert.equal(r.SpamThreshold, 70);
    assert.equal(inFolder('s1@x'), 'f-junk');
    assert.equal(ctx.m.byHeaderId('s1@x').junk, true);
    const upd = ctx.m.calls.findIndex(c => c.api === 'messages.update' && c.args[0] === h.id && c.args[1].junk === true);
    const mov = ctx.m.calls.findIndex(c => c.api === 'messages.move' && c.args[0].includes(h.id) && c.args[1] === 'f-junk');
    assert.ok(upd !== -1 && mov > upd, 'marked junk, then moved');
});

k.test('spam-stops-pipeline', 'a message moved to junk is not summarized', () => {
    assert.equal(prompted('summary', 's1@x'), false);
    assert.equal(record(ctx, 's1@x').summary, undefined);
});

k.test('below-threshold', 'a verdict below the threshold: not moved, and the message goes on to its summary', async () => {
    await receive(ctx, [mail('s2@x', 'f-inbox', 69)]);
    const r = record(ctx, 's2@x');
    assert.equal(r.spam.moved, false);
    assert.equal(inFolder('s2@x'), 'f-inbox');
    assert.ok(r.summary);
});

k.test('at-threshold', 'a verdict equal to the threshold is spam', async () => {
    await receive(ctx, [mail('s3@x', 'f-inbox', 70)]);
    assert.equal(record(ctx, 's3@x').spam.moved, true);
});

k.test('panel-broadcast', 'every tab displaying the message gets the in-progress badge, then the report', async () => {
    const h = mail('s4@x', 'f-inbox', 5);
    ctx.m.tab(7).displayed = h.id;
    ctx.m.tab(8).displayed = h.id;
    ctx.m.tabSends.length = 0;
    await receive(ctx, [h]);
    for (const tab of [7, 8]) {
        const cmds = ctx.m.commandsTo(tab).filter(c => c.startsWith('showSpam'));
        assert.deepEqual(cmds, ['showSpamCheckInProgress', 'showSpamReport'], 'tab ' + tab);
        assert.equal(ctx.m.sentTo(tab, 'showSpamReport')[0].data.spamValue, 5);
    }
});

k.test('no-junk-folder', 'an account with no junk folder: the move fails quietly, the verdict is saved with moved = false', async () => {
    await receive(ctx, [mail('nj1@x', 'n-inbox', 99)]);
    const r = record(ctx, 'nj1@x').spam;
    assert.equal(r.spamValue, 99);
    assert.equal(r.moved, false);
    assert.equal(inFolder('nj1@x'), 'n-inbox');
});

k.test('no-junk-folder-continues', 'not moved, the message goes on to its other features', () => {
    assert.ok(record(ctx, 'nj1@x').summary);
});

k.test('account-not-enabled', 'auto mode: a message of an account not in spamfilter_enabled_accounts is not screened', async () => {
    await receive(ctx, [mail('acc2@x', 'g-inbox', 99)]);
    assert.equal(prompted('spam', 'acc2@x'), false);
    assert.equal(record(ctx, 'acc2@x')?.spam, undefined);
    assert.ok(record(ctx, 'acc2@x')?.summary, 'its other features still run');
});

k.test('skipped-folder', 'auto mode: a message already in trash is not screened (nor summarized)', async () => {
    await receive(ctx, [mail('tr1@x', 'f-trash', 99)]);
    assert.equal(prompted('spam', 'tr1@x'), false);
    assert.equal(record(ctx, 'tr1@x'), null);
});

k.test('reread-gone', 'a message moved by a filter during the analysis is gone after the spam step: the pipeline stops quietly, nothing else is written', async () => {
    const hold = holding();
    ctx.workers.respond = hold.respond;
    const h = mail('gone@x', 'f-inbox', 10);
    const batch = receive(ctx, [h]);
    for (let i = 0; i < 60 && hold.held.length === 0; i++) await new Promise(r => setImmediate(r));
    assert.equal(hold.held.length, 1);
    ctx.m.moveTo(h.id, 'f-lists');          // a user filter moved it: new id
    hold.held[0].answer('{"spamValue": 10, "explanation": "fine"}');
    await batch;
    assert.equal(record(ctx, 'gone@x').spam.spamValue, 10, 'the verdict is stored');
    assert.equal(record(ctx, 'gone@x').summary, undefined, 'no summary for a message that is gone');
    assert.equal(hold.held.length, 1, 'no further prompt');
    ctx.workers.respond = featureResponder({ spam: hid => JSON.stringify({ spamValue: verdicts[hid] ?? 10, explanation: 'verdict for ' + hid }) });
});

k.test('fetch-failure-local', 'getFull() failing (a filter moved the message): the spam filter and the summary are skipped, nothing stored', async () => {
    const h = mail('ff1@x', 'f-inbox', 99);
    ctx.m.failGetFull.add(h.id);
    await receive(ctx, [h]);
    assert.equal(prompted('spam', 'ff1@x'), false);
    assert.equal(prompted('summary', 'ff1@x'), false);
    assert.equal(record(ctx, 'ff1@x'), null);
    assert.equal(inFolder('ff1@x'), 'f-inbox');
});

k.test('ai-not-json', 'an answer that is not JSON: an error report is saved, and the message is not moved', async () => {
    ctx.workers.respond = featureResponder({ spam: () => 'I think it is spam.' });
    await receive(ctx, [mail('nj@x', 'f-inbox', 99)]);
    const r = record(ctx, 'nj@x').spam;
    assert.equal(r.moved, false);
    assert.ok(r.explanation && r.explanation.length > 0, 'the error is the explanation');
    assert.notEqual(r.spamValue, 99);
    assert.equal(inFolder('nj@x'), 'f-inbox');
    ctx.workers.respond = featureResponder({ spam: hid => JSON.stringify({ spamValue: verdicts[hid] ?? 10, explanation: 'verdict for ' + hid }) });
});

k.test('serialized-moves', 'several spam messages in one batch: each is moved once, to junk, and the moves never overlap', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await ctx.ctl.browser.storage.local.set({ batch_max_concurrency: 3 });
    t.mock.timers.tick(200);
    let inFlight = 0;
    let maxInFlight = 0;
    const realUpdate = ctx.ctl.browser.messages.update;
    const realMove = ctx.ctl.browser.messages.move;
    ctx.ctl.browser.messages.update = async (...a) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise(r => setImmediate(r)); return realUpdate(...a); };
    ctx.ctl.browser.messages.move = async (...a) => { await new Promise(r => setImmediate(r)); const r = await realMove(...a); inFlight--; return r; };
    const hs = [1, 2, 3].map(i => mail('par' + i + '@x', 'f-inbox', 90));
    await drive(t, receive(ctx, hs));
    ctx.ctl.browser.messages.update = realUpdate;
    ctx.ctl.browser.messages.move = realMove;
    for (const h of hs) assert.equal(inFolder(h.headerMessageId), 'f-junk');
    assert.equal(maxInFlight, 1, 'one junk move at a time');
    const moves = ctx.m.calls.filter(c => c.api === 'messages.move' && hs.some(h => c.args[0].includes(h.id)));
    assert.equal(moves.length, 3);
});

k.test('manual-not-filtered', 'the context-menu spam check is not filtered by the auto-mode guards: a message in trash is screened', async () => {
    const h = mail('man@x', 'f-trash', 20);
    await clickContextMenu(ctx, 'mzta-ctx-prompt_spamfilter', { id: 7, windowId: 1, type: 'mail' }, [h]);
    assert.equal(prompted('spam', 'man@x'), true);
    assert.equal(record(ctx, 'man@x').spam.spamValue, 20);
});

k.test('only-inbox', 'with spamfilter_only_inbox, auto mode screens the inbox only', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { spamfilter_only_inbox: true });
    await receive(ctx, [mail('oi1@x', 'f-lists', 99), mail('oi2@x', 'f-inbox', 99)]);
    assert.equal(prompted('spam', 'oi1@x'), false);
    assert.equal(inFolder('oi1@x'), 'f-lists');
    assert.equal(prompted('spam', 'oi2@x'), true);
    assert.equal(inFolder('oi2@x'), 'f-junk');
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
