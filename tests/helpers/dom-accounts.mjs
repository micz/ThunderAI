/*
 *  Spec 08 "Account lists by policy" -> "The account checkboxes": lockAccountSelector() on the
 *  spam filter and Add Tags pages, when {feature}_enabled_accounts_match is set.
 *
 *   - every checkbox is re-checked from the RESOLVED list (not the stored selection), then
 *     disabled and marked;
 *   - "Select All" / "Deselect All" are made inert (lockCompanions());
 *   - the marker goes right of the section title;
 *   - "Each change is saved immediately" is replaced by AccountSelector_managed_note, or by
 *     AccountSelector_managed_none when the list matches nothing here;
 *   - the checkbox change handler and both buttons return early: the stored
 *     {feature}_enabled_accounts - the user's own selection - is never written.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from './dom-page.mjs';
import { loadFixture } from './load.mjs';

/**
 * @param {string} page       'spamfilter' | 'addtags'
 * @param {string} feature    'spamfilter' | 'add_tags'
 * @param {string} fixture    the policy
 * @param {string[]} expected the account ids the spec's matching rules give for
 *                            tests/fixtures/accounts.json (written out from the spec, not
 *                            computed by the code under test)
 */
export async function accountSelectorScenario(page, feature, fixture, expected) {
    const policy = { _org_name: 'ACME', ...loadFixture(fixture) };
    const USER_SELECTION = ['account2', 'account5'];
    const ctx = await openPage(page, {
        policy,
        accounts: loadFixture('accounts.json'),
        local: {
            connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-user-own',
            [feature + '_enabled_accounts']: USER_SELECTION,
        },
    });
    after(() => ctx.close());

    const container = () => ctx.$('#account_selector_checkboxes');
    const boxes = () => [...container().querySelectorAll('input[type="checkbox"]')];

    test('the checkboxes show the resolved list, not the stored selection', () => {
        assert.ok(boxes().length > 0, 'no account checkbox was built');
        const checked = boxes().filter(b => b.checked).map(b => b.value).sort();
        assert.deepEqual(checked, [...expected].sort());
    });

    test('every checkbox is disabled and marked', () => {
        for (const b of boxes()) {
            assert.equal(b.disabled, true, b.value);
            assert.equal(b.dataset.mztaManaged, '1', b.value);
            assert.equal(b.title, msg('managed_marker_tooltip'), b.value);
        }
    });

    test('Select All and Deselect All are disabled and marked', () => {
        for (const id of ['accounts_select_all', 'accounts_deselect_all']) {
            assert.equal(ctx.$('#' + id).disabled, true, id);
            assert.equal(ctx.$('#' + id).dataset.mztaManaged, '1', id);
        }
    });

    test('the marker sits right of the section title', () => {
        const section = container().closest('.mzta_section');
        const title = section.querySelector(':scope > .mzta_prompt_title');
        assert.ok(title, 'no section title');
        const marker = title.querySelector(':scope > .managed_marker');
        assert.ok(marker, 'no marker in the section title');
        assert.equal(marker.textContent, msg('managed_marker_org', ['ACME']));
    });

    test('the "saved immediately" line gives way to the managed note', () => {
        const note = ctx.$('#account_selector_checkboxes_managed_note');
        assert.ok(note, 'no managed note');
        assert.equal(note.textContent,
            msg(expected.length > 0 ? 'AccountSelector_managed_note' : 'AccountSelector_managed_none'));
        const section = container().closest('.mzta_section');
        const others = [...section.querySelectorAll(':scope > p.mzta_help')].filter(p => p !== note);
        for (const p of others) assert.equal(p.style.display, 'none', 'the old info line is still shown');
    });

    test('changing a checkbox or clicking the buttons, even re-enabled by hand, writes nothing', async () => {
        const since = ctx.ctl.calls.length;
        for (const b of boxes()) {
            b.disabled = false;
            b.checked = !b.checked;
            await ctx.fire(b, 'change');
        }
        for (const id of ['accounts_select_all', 'accounts_deselect_all']) {
            const btn = ctx.$('#' + id);
            btn.disabled = false;
            await ctx.click(btn);
        }
        assert.deepEqual(ctx.ctl.localData()[feature + '_enabled_accounts'], USER_SELECTION);
        const writes = ctx.localWrites(since).filter(c => Object.hasOwn(c.items, feature + '_enabled_accounts'));
        assert.deepEqual(writes, [], feature + '_enabled_accounts was written');
    });

    test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
    return ctx;
}
