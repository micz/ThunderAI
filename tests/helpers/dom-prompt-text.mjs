/*
 *  Spec 08 "Enforced special prompt texts" -> "UI": lockEnforcedPromptText() on a feature
 *  page. For every textarea whose prompt text the policy enforces:
 *
 *   - it shows the enforced text (the read-time overlay) and is readOnly, NOT disabled - the
 *     text can still be selected and copied;
 *   - it carries data-mzta-managed="1" and the managed_prompt_text_tooltip title;
 *   - its Save and Reset buttons are disabled and marked;
 *   - the marker goes right of the group title heading its .mzta_field;
 *   - Save and Reset, re-enabled by hand and clicked after an edit, write nothing: the
 *     handlers return early on isEnforcedPromptText(), and _special_prompts never receives
 *     the enforced text.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from './dom-page.mjs';
import { groupTitleHost } from './dom-sweep.mjs';
import { loadFixture } from './load.mjs';

/**
 * @param {string} page
 * @param {string} fixture          policy fixture carrying _special_prompts_text
 * @param {Array<{id, promptIds, save, reset}>} areas   the page's prompt textareas
 */
export async function enforcedTextScenario(page, fixture, areas) {
    const policy = loadFixture(fixture);
    const texts = policy._special_prompts_text;
    const ctx = await openPage(page, {
        policy,
        local: { connection_type: 'chatgpt_api', chatgpt_api_key: 'sk-user-own' },
    });
    after(() => ctx.close());
    const orgName = policy._org_name;

    const storedTexts = () => Object.fromEntries((ctx.ctl.localData()._special_prompts || [])
        .map(p => [p.id, p.text]));

    for (const a of areas) {
        const ta = () => ctx.$('#' + a.id);
        const expected = texts[a.promptIds[0]];

        test(`${a.id}: shows the enforced text, read-only but not disabled`, () => {
            assert.ok(ta(), 'no #' + a.id);
            assert.equal(ta().value, expected);
            assert.equal(ta().readOnly, true, 'readOnly');
            assert.equal(ta().disabled, false, 'disabled: the text could not be selected and copied');
            assert.equal(ta().dataset.mztaManaged, '1');
            assert.equal(ta().title, msg('managed_prompt_text_tooltip'));
        });

        test(`${a.id}: Save and Reset are disabled and marked`, () => {
            for (const id of [a.save, a.reset]) {
                const b = ctx.$('#' + id);
                assert.ok(b, 'no #' + id);
                assert.equal(b.disabled, true, id + ' enabled');
                assert.equal(b.dataset.mztaManaged, '1', id + ' not marked');
            }
        });

        test(`${a.id}: the marker sits right of the group title`, () => {
            const field = ta().closest('.mzta_field');
            assert.ok(field, 'the textarea is not in a .mzta_field');
            const host = groupTitleHost(field) || field;
            const marker = host.querySelector(':scope > .managed_marker');
            assert.ok(marker, 'no marker in ' + host.tagName + '.' + host.className);
            assert.equal(marker.textContent, orgName
                ? msg('managed_marker_org', [orgName]) : msg('managed_marker'));
        });
    }

    test('Save and Reset, re-enabled by hand, write nothing and reload no menu', async () => {
        const before = storedTexts();
        const sentBefore = ctx.ctl.sent.length;
        for (const a of areas) {
            const ta = ctx.$('#' + a.id);
            ta.readOnly = false;
            ta.value = 'typed by the user over the enforced text';
            await ctx.fire(ta, 'input');
            for (const id of [a.save, a.reset]) {
                const b = ctx.$('#' + id);
                b.disabled = false;
                await ctx.click(b);
            }
        }
        const after_ = storedTexts();
        for (const a of areas) {
            for (const id of a.promptIds) {
                assert.equal(after_[id], before[id], id + ' text changed in storage');
                if (after_[id] !== undefined) assert.notEqual(after_[id], texts[id], id + ': the enforced text was stored');
            }
        }
        const reloads = ctx.ctl.sent.slice(sentBefore).filter(m => m && m.command === 'reload_menus');
        assert.deepEqual(reloads, [], 'a Save went through (reload_menus sent)');
    });

    test('the enforced texts never reached storage', () => {
        const all = JSON.stringify(ctx.ctl.localData()._special_prompts || []);
        for (const a of areas) {
            for (const id of a.promptIds) {
                if (texts[id]) assert.equal(all.includes(JSON.stringify(texts[id]).slice(1, -1)), false, id);
            }
        }
    });

    test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
    return ctx;
}
