// Spec 01 "Per-Message Data Storage", taStorage (js/mzta-storage.js):
//  - per-message data (summaries, spam reports, translations) is stored in storage.local, one
//    record per message keyed `msg:<headerMessageId>`, schema version 1;
//  - a record holds the optional fields `summary`, `spam`, `translation`, plus metadata `v`, `ts`;
//  - typed read / write / delete per field, automatic record cleanup when all fields are removed,
//    and age-based cleanup.
//  - the writes of one record are queued: writers of different fields running together never
//    drop each other's field; writes to different messages still run in parallel.
// And spec 05: the preferences live in the same storage.local, so nothing here may touch a key
// that is not a `msg:` record.
// The field contents are the stores' business (05-stores); here the record as a whole.

import assert from 'node:assert/strict';
import { moduleContext } from './context.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const ctx = await moduleContext({
    local: {
        do_debug: false,
        connection_type: 'ollama_api',
        'msg:old@x': { v: 1, ts: now - 40 * DAY, summary: { summary: 'old', ts: now - 40 * DAY } },
        'msg:mid@x': { v: 1, ts: now - 10 * DAY, translation: { translated_text: 'mid', ts: now - 10 * DAY } },
        'msg:new@x': { v: 1, ts: now - 1 * DAY, spam: { spamValue: 5, ts: now - 1 * DAY } },
    },
});
const { taStorage } = await import('../../js/mzta-storage.js');
const st = new taStorage(false);
const k = caseTests('04-storage');
const raw = id => ctx.ctl.localData()['msg:' + id];

k.test('key-and-schema', 'a record is stored in storage.local under msg:<headerMessageId>, with v = 1 and ts', async () => {
    await st.writeSummary('a@x', { summary: 'S', summary_date: new Date('2026-01-02T00:00:00Z') });
    const rec = raw('a@x');
    assert.ok(rec, 'msg:a@x exists');
    assert.equal(rec.v, 1);
    assert.equal(typeof rec.ts, 'number');
    assert.ok('summary' in rec);
    assert.equal(Object.keys(ctx.ctl.localData()).filter(k2 => k2.includes('a@x')).length, 1, 'one key for the message');
});

k.test('fields-coexist', 'the three fields live in one record: writing one keeps the others', async () => {
    await st.writeSpam('b@x', { spamValue: 80, explanation: 'e', subject: ['s'], from: ['f'], message_date: new Date('2026-01-01T00:00:00Z'), moved: false, SpamThreshold: 70 });
    await st.writeSummary('b@x', { summary: 'S' });
    await st.writeTranslation('b@x', { translated_text: 'T', lang: 'it' });
    const rec = raw('b@x');
    assert.deepEqual(Object.keys(rec).sort(), ['spam', 'summary', 'translation', 'ts', 'v']);
    assert.equal(rec.spam.spamValue, 80);
    assert.equal(rec.summary.summary, 'S');
    assert.equal(rec.translation.translated_text, 'T');
});

k.test('get-record', 'getRecord() returns the stored record, null when there is none', async () => {
    assert.deepEqual(await st.getRecord('b@x'), raw('b@x'));
    assert.equal(await st.getRecord('nothing@x'), null);
});

k.test('has-field', 'hasField() tells which fields a record holds', async () => {
    const rec = await st.getRecord('b@x');
    assert.equal(st.hasField(rec, 'summary'), true);
    assert.equal(st.hasField(null, 'summary'), false);
    assert.equal(st.hasField({ v: 1 }, 'spam'), false);
});

k.test('overwrite', 'a write replaces the field it writes (force, the default)', async () => {
    await st.writeSummary('c@x', { summary: 'first' });
    await st.writeSummary('c@x', { summary: 'second' });
    assert.equal(raw('c@x').summary.summary, 'second');
});

k.test('no-force', 'with force = false an existing field is kept', async () => {
    await st.writeTranslation('c@x', { translated_text: 'one' });
    await st.writeTranslation('c@x', { translated_text: 'two' }, false);
    assert.equal(raw('c@x').translation.translated_text, 'one');
    await st.writeSpam('c@x', { spamValue: 1 }, false);
    assert.equal(raw('c@x').spam.spamValue, 1, 'a missing field is written even without force');
});

k.test('delete-keeps-others', 'deleting one field keeps the record and its other fields', async () => {
    await st.deleteSummaryField('b@x');
    const rec = raw('b@x');
    assert.ok(rec);
    assert.equal('summary' in rec, false);
    assert.ok('spam' in rec && 'translation' in rec);
});

k.test('delete-last-removes', 'deleting the last field removes the whole record', async () => {
    await st.deleteSpamField('b@x');
    await st.deleteTranslationField('b@x');
    assert.equal(raw('b@x'), undefined);
});

k.test('delete-missing', 'deleting a field a record does not have (or of no record) changes nothing', async () => {
    const before = raw('c@x');
    await st.deleteSummaryField('c@x');
    await st.deleteSummaryField('c@x');
    await st.deleteSpamField('nothing@x');
    assert.ok(raw('c@x'));
    assert.deepEqual(Object.keys(raw('c@x')).sort(), Object.keys(before).filter(f => f !== 'summary').sort());
});

k.test('delete-record', 'deleteRecord() removes the record with every field', async () => {
    await st.deleteRecord('c@x');
    assert.equal(raw('c@x'), undefined);
});

k.test('get-all', 'getAll*Records() list the records holding that field, by headerMessageId, and nothing else', async () => {
    const summaries = await st.getAllSummaryRecords();
    assert.deepEqual(Object.keys(summaries).sort(), ['a@x', 'old@x']);
    assert.equal(summaries['a@x'].headerMessageId, 'a@x');
    assert.deepEqual(Object.keys(await st.getAllTranslationRecords()), ['mid@x']);
    assert.deepEqual(Object.keys(await st.getAllSpamRecords()), ['new@x']);
});

k.test('cleanup-age', 'cleanup(days) removes the records older than that, whatever their fields, and returns how many', async () => {
    const removed = await st.cleanup(30);
    assert.equal(removed, 1);
    assert.equal(raw('old@x'), undefined);
    assert.ok(raw('mid@x') && raw('new@x') && raw('a@x'));
});

k.test('cleanup-zero', 'cleanup(0) removes nothing', async () => {
    assert.equal(await st.cleanup(0), 0);
    assert.ok(raw('mid@x'));
});

k.test('cleanup-spares-prefs', 'age-based cleanup never touches a key that is not a msg: record', async () => {
    await st.cleanup(5);
    const data = ctx.ctl.localData();
    assert.equal(data.do_debug, false);
    assert.equal(data.connection_type, 'ollama_api');
    assert.equal(data['msg:mid@x'], undefined);
    assert.ok(data['msg:new@x']);
});

k.test('clear-all', 'clearAllRecords() removes every msg: record and keeps the preferences', async () => {
    await st.writeSummary('z@x', { summary: 'z' });
    const n = await taStorage.clearAllRecords();
    assert.ok(n >= 2);
    const data = ctx.ctl.localData();
    assert.deepEqual(Object.keys(data).filter(k2 => k2.startsWith('msg:')), []);
    assert.equal(data.connection_type, 'ollama_api');
});

k.test('concurrent-fields', 'three fields written to one message at the same moment: all three are stored', async () => {
    await Promise.all([
        st.writeSummary('race@x', { summary: 'S' }),
        st.writeTranslation('race@x', { translated_text: 'T' }),
        st.writeSpam('race@x', { spamValue: 1 }),
    ]);
    assert.deepEqual(Object.keys(raw('race@x')).filter(f => f !== 'v' && f !== 'ts').sort(), ['spam', 'summary', 'translation']);
});

k.test('concurrent-delete-write', 'a field deleted while another is written: the written one stays', async () => {
    await st.writeSpam('race2@x', { spamValue: 1 });
    await Promise.all([st.deleteSpamField('race2@x'), st.writeSummary('race2@x', { summary: 'kept' })]);
    const rec = raw('race2@x');
    assert.equal(rec.summary.summary, 'kept');
    assert.equal('spam' in rec, false);
});

k.test('concurrent-across-instances', 'the queue is shared: two taStorage instances (two stores) writing one message keep both fields', async () => {
    const other = new taStorage(false);
    await Promise.all([st.writeSummary('race3@x', { summary: 'S' }), other.writeTranslation('race3@x', { translated_text: 'T' })]);
    assert.ok(raw('race3@x').summary && raw('race3@x').translation);
});

k.test('queue-order', 'the writes of one message apply in the order they were made', async () => {
    await Promise.all([1, 2, 3].map(n => st.writeSummary('order@x', { summary: 'v' + n })));
    assert.equal(raw('order@x').summary.summary, 'v3');
});

k.test('queue-other-messages', 'writes to different messages are not queued behind each other', async () => {
    const gets = [];
    const realGet = ctx.ctl.browser.storage.local.get;
    let release;
    const gate = new Promise(r => { release = r; });
    ctx.ctl.browser.storage.local.get = async (keys) => {
        if (keys === 'msg:slow@x') { gets.push('slow'); await gate; }
        else if (keys === 'msg:fast@x') gets.push('fast');
        return realGet.call(ctx.ctl.browser.storage.local, keys);
    };
    const slow = st.writeSummary('slow@x', { summary: 's' });
    const fast = st.writeSummary('fast@x', { summary: 'f' });
    await fast;
    assert.ok(raw('fast@x'), 'the other message was written while the first one waits');
    release();
    await slow;
    ctx.ctl.browser.storage.local.get = realGet;
    assert.ok(raw('slow@x'));
});

k.coverage();
