/*
 *  Spec 08 "An automatic summary is always inline", page side. With summarize_auto at 2 or 3 the
 *  summarize page forces its display mode select to 'inline' (updateDisplayModeConstraint()).
 *  Without a policy it also stores 'inline' when the page opens: the context menu summarize and
 *  the refresh read summarize_display_mode directly. But a value derived from a POLICY
 *  summarize_auto (locked, or initial and not the user's own) must not be stored on page open:
 *  it would replace the user's stored display mode and outlive the policy. A change the user
 *  makes on the summarize_auto select is theirs, and stores 'inline' as before.
 *
 *  One file per policy scenario: tests/dom/summarize/18-*, 19-*, 20-*.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean } from './dom-page.mjs';

/**
 * @param {object} o
 *   policy          the policy, or null
 *   local           the stored preferences
 *   storedOnOpen    the summarize_display_mode expected in storage after the page opened
 *   userChange      optional summarize_auto value to pick on the select afterwards, which must
 *                   then store 'inline'
 */
export async function displayModeScenario({ policy, local, storedOnOpen, userChange }) {
    const ctx = await openPage('summarize', { policy, local });
    after(() => ctx.close());
    const stored = () => ctx.ctl.localData().summarize_display_mode;

    test('the display mode select shows inline, as summarize_auto 2/3 requires', () => {
        assert.equal(ctx.$('#summarize_display_mode').value, 'inline');
    });

    test(`opening the page leaves summarize_display_mode ${JSON.stringify(storedOnOpen)} in storage`, () => {
        assert.equal(stored(), storedOnOpen);
    });

    if (userChange !== undefined) {
        test(`the user picking summarize_auto ${userChange} stores inline`, async () => {
            const sel = ctx.$('#summarize_auto');
            sel.value = String(userChange);
            await ctx.fire(sel, 'change');
            assert.equal(stored(), 'inline');
        });
    }

    test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
    return ctx;
}
