// Two small primitives of the background:
//
// Spec 01 "Per-message pipelines in processEmails()", "Working indicator", for taWorkingStatus
// (js/mzta-working-status.js): WorkingLevel counts what is in flight (1 for a batch, 1 per AI
// call); it "drops back on every return path". The toolbar icon follows it: the loading icon
// while anything works, the normal icon once nothing does (the icon files are not named by the
// spec: only "loading" versus "back" is asserted, through the path the module sets).
//
// Spec 05 `add_tags_exclusions` row (and the note on hasAddressListEntries() below the table),
// for checkExcludedTag() (js/mzta-addtags-exclusion-list.js): substring match unless
// add_tags_exclusions_exact_match; an empty exclusion word excludes nothing (without that guard
// ''.includes('') would exclude every tag). Entries are stored lowercase; the tags the model
// returns are not, so the match is case-insensitive. addTags_getExclusionList() /
// addTags_setExclusionList() read and write the declared preference through mztaPrefs.

import assert from 'node:assert/strict';
import { moduleContext } from './context.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ctx = await moduleContext({ local: { add_tags_exclusions: ['newsletter'] } });
const { taWorkingStatus: ws } = await import('../../js/mzta-working-status.js');
const ex = await import('../../js/mzta-addtags-exclusion-list.js');
const k = caseTests('03-working-status-exclusions');

const lastIcons = () => {
    const by = {};
    for (const i of ctx.m.icons) by[i.which] = i.path;
    return by;
};

k.test('start-stop-level', 'startWorking() / stopWorking() move WorkingLevel up and down', () => {
    assert.equal(ws.WorkingLevel, 0);
    ws.startWorking();
    ws.startWorking();
    assert.equal(ws.WorkingLevel, 2);
    ws.stopWorking();
    assert.equal(ws.WorkingLevel, 1);
    ws.stopWorking();
    assert.equal(ws.WorkingLevel, 0);
});

k.test('icon-follows', 'the message display and compose icons show loading while working, and come back when nothing works', () => {
    ctx.m.icons.length = 0;
    ws.startWorking();
    const loading = lastIcons();
    assert.ok(loading.messageDisplayAction && loading.composeAction, 'both action icons set');
    assert.equal(loading.messageDisplayAction, loading.composeAction);
    ws.startWorking();
    ws.stopWorking();
    assert.equal(lastIcons().messageDisplayAction, loading.messageDisplayAction, 'still working: no reset');
    ws.stopWorking();
    const back = lastIcons();
    assert.notEqual(back.messageDisplayAction, loading.messageDisplayAction, 'back to the normal icon');
    assert.equal(back.messageDisplayAction, back.composeAction);
});

k.test('never-negative', 'an extra stopWorking() never takes the level below zero', () => {
    ws.stopWorking();
    ws.stopWorking();
    assert.equal(ws.WorkingLevel, 0);
    ws.startWorking();
    assert.equal(ws.WorkingLevel, 1, 'the next call counts from zero');
    ws.stopWorking();
});

k.test('excl-empty', 'an empty exclusion word excludes nothing', () => {
    assert.equal(ex.checkExcludedTag('Invoice', ''), false);
    assert.equal(ex.checkExcludedTag('Invoice', '', true), false);
});

k.test('excl-substring', 'substring match by default, case-insensitively', () => {
    assert.equal(ex.checkExcludedTag('Newsletters', 'newsletter'), true);
    assert.equal(ex.checkExcludedTag('Weekly NEWSLETTER', 'newsletter'), true);
    assert.equal(ex.checkExcludedTag('Invoice', 'newsletter'), false);
});

k.test('excl-exact', 'with exact match, only the whole tag (case-insensitively) is excluded', () => {
    assert.equal(ex.checkExcludedTag('Newsletters', 'newsletter', true), false);
    assert.equal(ex.checkExcludedTag('NewsLetter', 'newsletter', true), true);
});

k.test('excl-list-roundtrip', 'the exclusion list is the add_tags_exclusions preference, read and written through mztaPrefs', async () => {
    assert.deepEqual(await ex.addTags_getExclusionList(), ['newsletter']);
    await ex.addTags_setExclusionList(['promo', 'spam']);
    assert.deepEqual(ctx.ctl.localData().add_tags_exclusions, ['promo', 'spam']);
    assert.deepEqual(await ex.addTags_getExclusionList(), ['promo', 'spam']);
});

k.coverage();
