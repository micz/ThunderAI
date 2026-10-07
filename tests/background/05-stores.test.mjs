// Spec 01 "Per-Message Data Storage", the three stores over taStorage:
//  - taSummaryStore (js/mzta-summarystore.js): load / save / remove summaries, a 100-entry cache
//    limit with oldest-first truncation, error states;
//  - taTranslationStore (js/mzta-translationstore.js): the same; a translation record stores
//    translated_text, lang and optional error information;
//  - taSpamReport (js/mzta-spamreport.js), with spec 02 "Missing special prompts":
//    saveError(id, message, metadata = {}) spreads the metadata over the stored record (subject /
//    from / message_date), getAllReportData() resolves to {} (never undefined) when nothing was
//    screened.
// Spec 01 "Panel HTML sanitization": cached results include "entries written by older versions" -
// a record lacking a field added since must still load (the legacy cases below).
// Spec 01 "In-flight jobs": the stores keep no "processing" state any more.
// Whether the background CALLS the truncation is a flow question (20-receive-summary-translation).

import assert from 'node:assert/strict';
import { moduleContext } from './context.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ctx = await moduleContext({
    local: {
        // Written by an older version: no summary_html, no summary_date.
        'msg:legacy-sum@x': { v: 1, ts: Date.parse('2025-03-01T00:00:00Z'), summary: { summary: 'legacy', error: false, ts: Date.parse('2025-03-01T00:00:00Z') } },
        // Written before translated_subject / translation_status existed.
        'msg:legacy-tr@x': { v: 1, ts: Date.parse('2025-03-01T00:00:00Z'), translation: { translated_text: 'vecchio', lang: 'it', ts: Date.parse('2025-03-01T00:00:00Z') } },
        // Written before the spam log kept subject / from / date.
        'msg:legacy-spam@x': { v: 1, ts: Date.parse('2025-03-01T00:00:00Z'), spam: { spamValue: 90, explanation: 'x', ts: Date.parse('2025-03-01T00:00:00Z') } },
    },
});
const { taSummaryStore } = await import('../../js/mzta-summarystore.js');
const { taTranslationStore } = await import('../../js/mzta-translationstore.js');
const { taSpamReport } = await import('../../js/mzta-spamreport.js');
const sum = new taSummaryStore(false);
const tr = new taTranslationStore(false);
const spam = new taSpamReport(false);
const k = caseTests('05-stores');
const raw = id => ctx.ctl.localData()['msg:' + id];

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

k.test('summary-error', 'saveError() stores an error state that loads back as an error with its message', async () => {
    await sum.saveError('s2@x', 'Message not found');
    const s = await sum.loadSummary('s2@x');
    assert.equal(s.error, true);
    assert.equal(s.message, 'Message not found');
});

k.test('summary-missing', 'loadSummary() of a message with no summary is null, also when the record holds other fields', async () => {
    assert.equal(await sum.loadSummary('none@x'), null);
    assert.equal(await sum.loadSummary('legacy-tr@x'), null);
});

k.test('summary-legacy', 'a summary written by an older version (no summary_html, no summary_date) still loads', async () => {
    const s = await sum.loadSummary('legacy-sum@x');
    assert.equal(s.summary, 'legacy');
    assert.equal(s.error, false);
    assert.equal(typeof s.summary_html, 'string');
    assert.ok(s.summary_date instanceof Date && !Number.isNaN(s.summary_date.getTime()), 'a usable date');
});

k.test('summary-remove', 'removeSummary() drops the summary and keeps the rest of the record', async () => {
    await tr.saveTranslation({ translated_text: 'T', lang: 'en' }, 's1@x');
    await sum.removeSummary('s1@x');
    assert.equal(await sum.loadSummary('s1@x'), null);
    assert.ok(raw('s1@x').translation);
});

k.test('summary-trunc', 'truncSummaries() keeps the 100 newest summaries and drops the oldest', async () => {
    const base = Date.parse('2026-03-01T00:00:00Z');
    for (let i = 0; i < 103; i++) {
        await sum.saveSummary({ summary: 'n' + i, summary_date: new Date(base + i * 60000) }, 'trunc' + i + '@x');
    }
    await sum.truncSummaries();
    const left = Object.keys(await sum.getAllSummaries()).filter(id => id.startsWith('trunc'));
    const total = Object.keys(await sum.getAllSummaries()).length;
    assert.equal(total, 100, 'at most 100 summaries');
    for (const id of ['trunc102@x', 'trunc50@x', 'trunc6@x']) assert.ok(left.includes(id), id + ' kept');
    // 105 summaries: s2 (today), the series from trunc0 (2026-03-01) up, legacy-sum (2025):
    // the five oldest go.
    assert.equal(left.includes('trunc0@x'), false, 'the oldest dropped');
    assert.equal(raw('legacy-sum@x'), undefined, 'the legacy summary is older still: dropped, record gone with it');
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
    assert.ok(t.translation_date instanceof Date);
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
});

k.test('translation-remove', 'removeTranslation() drops the translation', async () => {
    await tr.removeTranslation('t2@x');
    assert.equal(await tr.loadTranslation('t2@x'), null);
});

k.test('translation-trunc', 'truncTranslations() keeps the 100 newest translations', async () => {
    for (let i = 0; i < 101; i++) {
        await tr.saveTranslation({ translated_text: 'x' + i, lang: 'en' }, 'tt' + i + '@x');
    }
    await tr.truncTranslations();
    assert.equal(Object.keys(await tr.getAllTranslations()).length, 100);
});

k.test('spam-roundtrip', 'a saved spam report loads back with its verdict and metadata', async () => {
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
    assert.ok(r.report_date instanceof Date);
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

k.test('spam-legacy', 'a spam report written before the log kept subject, sender and date still loads', async () => {
    const r = await spam.loadReportData('legacy-spam@x');
    assert.equal(r.spamValue, 90);
    assert.equal(r.subject, undefined);
});

k.test('spam-trunc', 'truncReportData() keeps the 100 newest reports', async () => {
    for (let i = 0; i < 100; i++) {
        await spam.saveReportData({ spamValue: i, explanation: '' }, 'pp' + i + '@x');
    }
    await spam.truncReportData();
    const all = await spam.getAllReportData();
    assert.equal(Object.keys(all).length, 100);
    assert.equal('legacy-spam@x' in all, false, 'the oldest report went first');
});

k.test('spam-empty-all', 'getAllReportData() resolves to {} once nothing is screened', async () => {
    await spam.clearReportData();
    assert.deepEqual(await spam.getAllReportData(), {});
});

k.test('clear-per-field', 'clearing one store removes only its field: the other fields of the same messages stay', async () => {
    await sum.saveSummary({ summary: 'keep me' }, 'mix@x');
    await tr.saveTranslation({ translated_text: 'and me', lang: 'en' }, 'mix@x');
    await spam.saveReportData({ spamValue: 1, explanation: '' }, 'mix@x');
    await tr.clearTranslations();
    assert.equal((await sum.loadSummary('mix@x')).summary, 'keep me');
    assert.equal(await tr.loadTranslation('mix@x'), null);
    assert.equal((await spam.loadReportData('mix@x')).spamValue, 1);
    await sum.clearSummaries();
    assert.deepEqual(await sum.getAllSummaries(), {});
    assert.equal((await spam.loadReportData('mix@x')).spamValue, 1);
});

k.test('no-session-state', 'the stores write nothing to storage.session: in-flight state is the job registry', async () => {
    const sessionWrites = ctx.ctl.calls.filter(c => c.area === 'session' && c.op === 'set');
    assert.deepEqual(sessionWrites, []);
});

k.coverage();
