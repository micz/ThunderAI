// The options page's QNote row with QNote installed (its external API, access never requested),
// the switch off, no AI connection, no policy.
//
// Spec 05 "QNote integration row" [#980]: QNote answers, so the row shows, usable with no AI
// connection (it is outside the connection logic); the status line and "Check access" only while
// the switch is on; only a user action calls requestAccess: switching the toggle on and "Check
// access", never the page load (getStatus); "waiting" with the button disabled while QNote's dialog
// is open; the status for every answer (granted, denied, not granted yet, QNote without the API, an
// error reply); the preference stays on whatever the answer; switching off calls nothing, and the
// answer to a requestAccess a newer one replaced is ignored.
//
// QNote is `otherAddons` below (the ui plugin). `answer` is what it replies to the next
// requestAccess; `hold()` keeps the next one pending until the test releases it. The tests run in
// order on the one page and build on each other.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { shown } from '../../ui/dom-helpers.mjs';

const QNOTE_ID = 'qnote@dqdp.net';
const toQNote = [];
let answer = { apiVersion: 1, access: 'granted' };
const held = [];     // requestAccess calls kept pending, in order
const ctx = await openPage('options', {
    otherAddons: async (id, message) => {
        if (id !== QNOTE_ID) return null;   // Sparks: absent
        toQNote.push(message);
        if (message.command === 'getStatus') return { apiVersion: 1, access: 'unknown' };
        if (message.command === 'requestAccess') {
            if (held.length > 0) return held.shift().promise;
            return answer;
        }
        return { apiVersion: 1, error: 'unknown-command' };
    },
});
after(() => ctx.close());
const k = uiTests('options', '12');
const $ = ctx.$;

const S_ROW = 'spec 05 "QNote integration row"';
const S_ROWS = 'spec 05 "Feature Rows — Disabled vs. API-Needed"';

const toggle = () => $('#qnote_integration');
const status = () => $('#qnote_status').textContent;
const commands = () => toQNote.map(m => m.command);
/** The next requestAccess (one per call of hold()) stays pending: returns release(reply). */
const hold = () => {
    let release;
    const promise = new Promise(r => { release = r; });
    held.push({ promise });
    return reply => release(reply);
};
/** Turn the event loop without settle() (which waits for a held QNote) until pred() holds. */
const spinUntil = async (pred, what) => {
    for (let i = 0; i < 500; i++) {
        if (pred()) return;
        await new Promise(r => setImmediate(r));
    }
    throw new Error('spinUntil: ' + what);
};

k.test('visible', S_ROW, 'QNote answers: the row shows, the status line and Check access hidden while the switch is off', () => {
    assert.equal(shown($('#qnote_tr')), true);
    assert.equal(toggle().checked, false);
    assert.equal(shown($('#qnote_status')), false);
    assert.equal(shown($('#btnQNoteCheckAccess')), false);
});

k.test('no-connection', S_ROWS, 'with no AI connection the QNote switch stays enabled, unlike the API-driven rows', () => {
    assert.equal(toggle().disabled, false);
    assert.equal($('#translate').disabled, true);
    assert.equal($('#features_no_connection_note').classList.contains('shown'), true);
});

k.test('load-status-only', S_ROW, 'the page load asks getStatus only, never requestAccess', () => {
    assert.deepEqual(commands(), ['getStatus']);
});

k.test('switch-on', S_ROW, 'switching on stores true and calls requestAccess; "waiting" with the button disabled until QNote answers', async () => {
    const release = hold();
    toggle().click();
    await spinUntil(() => commands().includes('requestAccess'), 'requestAccess sent');
    await spinUntil(() => status() === msg('prefs_qnote_status_waiting'), 'the waiting status');
    assert.equal($('#btnQNoteCheckAccess').disabled, true);
    release({ apiVersion: 1, access: 'granted' });
    await ctx.settle();
    assert.strictEqual(ctx.ctl.localData().qnote_integration, true);
    assert.deepEqual(commands(), ['getStatus', 'requestAccess']);
    assert.equal(status(), msg('prefs_qnote_status_granted'));
    assert.equal($('#btnQNoteCheckAccess').disabled, false);
});

k.test('check-denied', S_ROW, 'Check access calls requestAccess; denied: the denied status, the preference stays on', async () => {
    answer = { apiVersion: 1, access: 'denied' };
    await ctx.click($('#btnQNoteCheckAccess'));
    assert.deepEqual(commands(), ['getStatus', 'requestAccess', 'requestAccess']);
    assert.equal(status(), msg('prefs_qnote_status_denied'));
    assert.strictEqual(ctx.ctl.localData().qnote_integration, true);
    assert.equal(toggle().checked, true);
});

k.test('check-not-granted', S_ROW, 'unknown or pending: the "not granted yet" status', async () => {
    for (const access of ['pending', 'unknown']) {
        answer = { apiVersion: 1, access };
        await ctx.click($('#btnQNoteCheckAccess'));
        assert.equal(status(), msg('prefs_qnote_status_not_granted'), access);
    }
});

k.test('check-unsupported', S_ROW, 'a reply with no apiVersion, or below 1: the "update QNote" status', async () => {
    for (const reply of [{ access: 'granted' }, { apiVersion: 0, access: 'granted' }]) {
        answer = reply;
        await ctx.click($('#btnQNoteCheckAccess'));
        assert.equal(status(), msg('prefs_qnote_status_unsupported'), JSON.stringify(reply));
    }
    assert.equal(toggle().checked, true);
});

k.test('check-error', S_ROW, 'an error reply: the error status', async () => {
    answer = { apiVersion: 1, error: 'invalid-request' };
    await ctx.click($('#btnQNoteCheckAccess'));
    assert.equal(status(), msg('prefs_qnote_status_error'));
});

k.test('late-ignored', S_ROW, "switched off while QNote's dialog is open: false is stored, nothing is called, and the late answer is ignored", async () => {
    const releaseOld = hold();
    $('#btnQNoteCheckAccess').click();
    await spinUntil(() => status() === msg('prefs_qnote_status_waiting'), 'the waiting status');
    const sentBefore = toQNote.length;
    toggle().click();
    await spinUntil(() => ctx.ctl.localData().qnote_integration === false, 'false stored');
    assert.equal(toQNote.length, sentBefore, 'switching off calls nothing');
    assert.equal(shown($('#qnote_status')), false);
    // On again: a new dialog, still open when the first one's answer finally arrives.
    const releaseNew = hold();
    toggle().click();
    await spinUntil(() => toQNote.length === sentBefore + 1, 'a new requestAccess');
    releaseOld({ apiVersion: 1, access: 'granted' });
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    assert.equal(status(), msg('prefs_qnote_status_waiting'), 'the old "granted" is ignored');
    assert.equal($('#btnQNoteCheckAccess').disabled, true);
    releaseNew({ apiVersion: 1, access: 'denied' });
    await ctx.settle();
    assert.equal(status(), msg('prefs_qnote_status_denied'));
    assert.equal($('#btnQNoteCheckAccess').disabled, false);
});

k.test('switch-off', S_ROW, 'switching off stores false and asks QNote nothing', async () => {
    const sentBefore = toQNote.length;
    await ctx.click(toggle());
    assert.strictEqual(ctx.ctl.localData().qnote_integration, false);
    assert.equal(toQNote.length, sentBefore);
    assert.equal(shown($('#btnQNoteCheckAccess')), false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
