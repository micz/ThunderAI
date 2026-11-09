// Spec 01 "Per-Message Data Storage", the three stores over taStorage:
//  - taSummaryStore (js/mzta-summarystore.js): load / save / remove summaries and error states;
//    saveSummary(data, id, metadata = {}) and saveError(id, message, metadata = {}) save the
//    metadata (subject / from / message_date, the shape buildMessageMetadata() gives) with it;
//  - taTranslationStore (js/mzta-translationstore.js): the same; a translation record stores
//    translated_text, translated_subject, translation_status, lang and optional error information;
//  - taSpamReport (js/mzta-spamreport.js), with spec 02 "Missing special prompts":
//    saveError(id, message, metadata = {}) spreads the metadata over the stored record; the spam
//    log reads its pages newest first (getReportPage(), countReports());
//  - the dates a store loads come from createdAt, the time of the write; a stored record has no ts;
//  - without metadata (the message not available), subject / from / message_date are empty.
// Spec 01 "Panel HTML sanitization": cached results include "entries written by older versions" -
// a record lacking a field added since must still load (the legacy cases below, written to
// storage.local by an older version and moved to IndexedDB at the start).
// Spec 01 "In-flight jobs": the stores keep no "processing" state any more.

import assert from 'node:assert/strict';
import { moduleContext } from './context.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const LEGACY_TS = Date.parse('2025-03-01T00:00:00Z');
const ctx = await moduleContext({
    local: {
        // Written by an older version: no summary_html, no summary_date.
        'msg:legacy-sum@x': { v: 1, ts: LEGACY_TS, summary: { summary: 'legacy', error: false, ts: LEGACY_TS } },
        // Written before translated_subject / translation_status existed.
        'msg:legacy-tr@x': { v: 1, ts: LEGACY_TS, translation: { translated_text: 'vecchio', lang: 'it', ts: LEGACY_TS } },
        // Written before the spam log kept subject / from / date.
        'msg:legacy-spam@x': { v: 1, ts: LEGACY_TS, spam: { spamValue: 90, explanation: 'x', ts: LEGACY_TS } },
    },
});
const { taSummaryStore } = await import('../../js/mzta-summarystore.js');
const { taTranslationStore } = await import('../../js/mzta-translationstore.js');
const { taSpamReport } = await import('../../js/mzta-spamreport.js');
const { taStorage } = await import('../../js/mzta-storage.js');
const sum = new taSummaryStore(false);
const tr = new taTranslationStore(false);
const spam = new taSpamReport(false);
const st = new taStorage(false);
const k = caseTests('05-stores');
const stored = async (type, id) => (await st.getRecord(id))?.[type];

const META = { subject: ['Quarterly report'], from: ['Alice <alice@example.test>'], message_date: new Date('2026-01-05T09:30:00Z') };

k.test('summary-roundtrip', 'a saved summary loads back with its text, HTML, date and no error', async () => {
    const date = new Date('2026-02-03T04:05:06Z');
    await sum.saveSummary({ summary: 'Plain', summary_html: '<p>Plain</p>', summary_date: date, headerMessageId: 's1@x' }, 's1@x');
    const s = await sum.loadSummary('s1@x');
    assert.equal(s.headerMessageId, 's1@x');
    assert.equal(s.summary, 'Plain');
    assert.equal(s.summary_html, '<p>Plain</p>');
    assert.equal(s.error, false);
    assert.equal(s.summary_date.toISOString(), date.toISOString());
});

k.test('summary-metadata', 'saveSummary() saves the metadata with the summary', async () => {
    await sum.saveSummary({ summary: 'With metadata' }, 'sm@x', META);
    const r = await stored('summary', 'sm@x');
    assert.deepEqual(r.subject, ['Quarterly report']);
    assert.deepEqual(r.from, ['Alice <alice@example.test>']);
    assert.equal(r.message_date, '2026-01-05T09:30:00.000Z');
    assert.equal(r.summary, 'With metadata');
});

k.test('summary-error', 'saveError() stores an error state, with the metadata it is given, that loads back as an error', async () => {
    await sum.saveError('s2@x', 'The AI did not answer', META);
    const s = await sum.loadSummary('s2@x');
    assert.equal(s.error, true);
    assert.equal(s.message, 'The AI did not answer');
    assert.deepEqual((await stored('summary', 's2@x')).subject, ['Quarterly report']);
});

k.test('summary-no-metadata', 'without metadata (the message not available) subject, from and message_date are empty', async () => {
    await sum.saveError('s3@x', 'Message not found');
    const r = await stored('summary', 's3@x');
    assert.deepEqual([r.subject, r.from, r.message_date], [[], [], '']);
});

k.test('summary-missing', 'loadSummary() of a message with no summary is null, also when another type is stored', async () => {
    assert.equal(await sum.loadSummary('none@x'), null);
    assert.equal(await sum.loadSummary('legacy-tr@x'), null);
});

k.test('summary-legacy', 'a summary written by an older version (no summary_html, no summary_date) still loads, dated by its ts', async () => {
    const s = await sum.loadSummary('legacy-sum@x');
    assert.equal(s.summary, 'legacy');
    assert.equal(s.error, false);
    assert.equal(typeof s.summary_html, 'string');
    assert.equal(s.summary_date.getTime(), LEGACY_TS);
});

k.test('summary-remove', 'removeSummary() drops the summary and keeps the other types of the message', async () => {
    await tr.saveTranslation({ translated_text: 'T', lang: 'en' }, 's1@x');
    await sum.removeSummary('s1@x');
    assert.equal(await sum.loadSummary('s1@x'), null);
    assert.ok(await stored('translation', 's1@x'));
});

k.test('translation-roundtrip', 'a saved translation loads back with its text, subject, status and language', async () => {
    await tr.saveTranslation({ translated_text: 'Ciao', translated_subject: 'Oggetto', translation_status: '1', lang: 'Italian' }, 't1@x');
    const t = await tr.loadTranslation('t1@x');
    assert.equal(t.headerMessageId, 't1@x');
    assert.equal(t.translated_text, 'Ciao');
    assert.equal(t.translated_subject, 'Oggetto');
    assert.equal(t.translation_status, '1');
    assert.equal(t.lang, 'Italian');
    assert.equal(t.error, false);
    assert.equal(t.translation_date.getTime(), (await stored('translation', 't1@x')).createdAt, 'dated by createdAt');
});

k.test('translation-metadata', 'saveTranslation() and saveError() save the metadata; without it, it is empty', async () => {
    await tr.saveTranslation({ translated_text: 'Hallo', lang: 'German' }, 'tm@x', META);
    assert.deepEqual((await stored('translation', 'tm@x')).from, ['Alice <alice@example.test>']);
    await tr.saveError('tm2@x', 'boom', META);
    assert.equal((await stored('translation', 'tm2@x')).message_date, '2026-01-05T09:30:00.000Z');
    await tr.saveError('tm3@x', 'Message not found');
    const r = await stored('translation', 'tm3@x');
    assert.deepEqual([r.subject, r.from, r.message_date], [[], [], '']);
});

k.test('translation-error', 'translation saveError() stores an error state that loads back as an error', async () => {
    await tr.saveError('t2@x', 'boom');
    const t = await tr.loadTranslation('t2@x');
    assert.equal(t.error, true);
    assert.equal(t.message, 'boom');
});

k.test('translation-legacy', 'a translation written before subject and status existed still loads', async () => {
    const t = await tr.loadTranslation('legacy-tr@x');
    assert.equal(t.translated_text, 'vecchio');
    assert.equal(t.lang, 'it');
    assert.equal(t.translated_subject, '');
    assert.equal(t.translation_status, '');
    assert.equal(t.translation_date.getTime(), LEGACY_TS);
});

k.test('translation-remove', 'removeTranslation() drops the translation', async () => {
    await tr.removeTranslation('t2@x');
    assert.equal(await tr.loadTranslation('t2@x'), null);
});

k.test('spam-roundtrip', 'a saved spam report loads back with its verdict and metadata, dated by createdAt', async () => {
    await spam.saveReportData({
        spamValue: 85, explanation: 'Phishing', subject: ['Win'], from: ['x@spam.test'],
        message_date: new Date('2026-01-05T00:00:00Z'), moved: true, SpamThreshold: 70,
        report_date: new Date(), headerMessageId: 'p1@x',
    }, 'p1@x');
    const r = await spam.loadReportData('p1@x');
    assert.equal(r.headerMessageId, 'p1@x');
    assert.equal(r.spamValue, 85);
    assert.equal(r.explanation, 'Phishing');
    assert.deepEqual(r.subject, ['Win']);
    assert.deepEqual(r.from, ['x@spam.test']);
    assert.equal(r.message_date, '2026-01-05T00:00:00.000Z');
    assert.equal(r.moved, true);
    assert.equal(r.SpamThreshold, 70);
    assert.equal(r.report_date.getTime(), (await stored('spam', 'p1@x')).createdAt);
});

k.test('spam-error-metadata', 'saveError() keeps the metadata it is given, so an error row keeps subject, sender and date', async () => {
    await spam.saveError('p2@x', 'Message vanished', { subject: ['Hello'], from: ['a@b.test'], message_date: new Date('2026-01-06T00:00:00Z') });
    const r = await spam.loadReportData('p2@x');
    assert.equal(r.explanation, 'Message vanished');
    assert.deepEqual(r.subject, ['Hello']);
    assert.deepEqual(r.from, ['a@b.test']);
    assert.equal(r.moved, false);
    assert.equal(r.message_date, '2026-01-06T00:00:00.000Z');
});

k.test('spam-error-no-metadata', 'a "Message not found" error with no metadata is stored, with empty date, sender and subject', async () => {
    await spam.saveError('p3@x', 'Message not found');
    const r = await spam.loadReportData('p3@x');
    assert.equal(r.spamValue, -999);
    assert.equal(r.explanation, 'Message not found');
    assert.deepEqual([r.subject, r.from, r.message_date], [[], [], '']);
});

k.test('spam-legacy', 'a spam report written before the log kept subject, sender and date still loads, with them empty', async () => {
    const r = await spam.loadReportData('legacy-spam@x');
    assert.equal(r.spamValue, 90);
    assert.deepEqual(r.subject, []);
    assert.equal(r.report_date.getTime(), LEGACY_TS);
});

k.test('spam-page', 'the spam log pages: getReportPage() newest first in the panel shape, countReports() the total', async () => {
    const total = await spam.countReports();
    assert.equal(total, 4);
    const page = await spam.getReportPage(0, 2);
    assert.deepEqual(page.map(r => r.headerMessageId), ['p3@x', 'p2@x']);
    assert.ok(page[0].report_date instanceof Date);
    assert.deepEqual((await spam.getReportPage(2, 2)).map(r => r.headerMessageId), ['p1@x', 'legacy-spam@x']);
    assert.deepEqual(await spam.getReportPage(4, 2), []);
});

k.test('save-failure-rejects', 'a failed write makes the store reject, never resolve as if saved', async (t) => {
    t.mock.method(globalThis.IDBObjectStore.prototype, 'put', function () { throw new Error('quota'); });
    await assert.rejects(sum.saveSummary({ summary: 'x' }, 'f@x', META), /quota/);
    await assert.rejects(tr.saveTranslation({ translated_text: 'x' }, 'f@x'), /quota/);
    await assert.rejects(spam.saveReportData({ spamValue: 1 }, 'f@x'), /quota/);
    await assert.rejects(sum.saveError('f@x', 'e'), /quota/);
});

k.test('no-session-state', 'the stores write nothing to storage.session: in-flight state is the job registry', async () => {
    const sessionWrites = ctx.ctl.calls.filter(c => c.area === 'session' && c.op === 'set');
    assert.deepEqual(sessionWrites, []);
});

k.coverage();
