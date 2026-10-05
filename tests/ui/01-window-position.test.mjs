// Spec 05 "UI & Feature Preferences", rows chatgpt_win_top / chatgpt_win_left: any finite number
// is a position, 0 and negatives included; '' and the null of a cleared number input mean "not
// saved"; the position is applied only when both coordinates are set. toWindowCoordinate() and
// getSavedWindowPosition() (js/mzta-utils.js) are what the background's
// applyWindowPositionAndSize() and the options page's restore use; the options page side is in
// tests/dom/options/ui-02-api-configured.
//
// Level 1: nothing imported here reaches jsdom.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startBackground, repoPath } from '../helpers/core/load.mjs';

let utils;
before(async () => {
    ({ utils } = await startBackground());
});

test('toWindowCoordinate(): a finite number is a coordinate, 0 and negatives included', () => {
    for (const v of [0, -0, 1, 120, -1920, 33.5]) assert.equal(utils.toWindowCoordinate(v), v, String(v));
});

test('toWindowCoordinate(): a numeric string is read as its number', () => {
    assert.equal(utils.toWindowCoordinate('0'), 0);
    assert.equal(utils.toWindowCoordinate(' 250 '), 250);
    assert.equal(utils.toWindowCoordinate('-40'), -40);
});

test('toWindowCoordinate(): anything else is "not saved"', () => {
    for (const v of ['', '   ', null, undefined, NaN, Infinity, -Infinity, 'abc', true, {}, []]) {
        assert.equal(utils.toWindowCoordinate(v), null, JSON.stringify(v) ?? String(v));
    }
});

test('getSavedWindowPosition(): both coordinates set -> the position, 0 included', () => {
    assert.deepEqual(utils.getSavedWindowPosition({ chatgpt_win_top: 0, chatgpt_win_left: 0 }), { top: 0, left: 0 });
    assert.deepEqual(utils.getSavedWindowPosition({ chatgpt_win_top: 10, chatgpt_win_left: -1900 }), { top: 10, left: -1900 });
});

test('getSavedWindowPosition(): one coordinate missing -> no position', () => {
    for (const [top, left] of [['', ''], ['', 0], [0, ''], [null, 100], [100, null], [NaN, 5], [undefined, undefined]]) {
        assert.equal(utils.getSavedWindowPosition({ chatgpt_win_top: top, chatgpt_win_left: left }), null, `${top}, ${left}`);
    }
    assert.equal(utils.getSavedWindowPosition({}), null);
    assert.equal(utils.getSavedWindowPosition(undefined), null);
});

test('the default is "not saved"', async () => {
    const { prefs_default } = await import('../../options/mzta-options-default.js');
    assert.equal(utils.getSavedWindowPosition(prefs_default), null);
});

// mzta-background.js cannot be imported under a mock (tests/README.md), so the call site is checked
// in the source: the position goes through getSavedWindowPosition(), never a loose `!= ''`.
test('applyWindowPositionAndSize() reads the position through getSavedWindowPosition()', () => {
    const src = readFileSync(repoPath('mzta-background.js'), 'utf8');
    const start = src.indexOf('function applyWindowPositionAndSize(');
    assert.notEqual(start, -1, 'applyWindowPositionAndSize() not found');
    const body = src.slice(start, src.indexOf('\n}\n', start));
    assert.match(body, /getSavedWindowPosition\(prefs\)/);
    assert.doesNotMatch(body, /chatgpt_win_(top|left)\s*!=/);
});
