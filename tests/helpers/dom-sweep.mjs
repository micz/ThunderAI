/*
 *  The allowlist sweep (spec 08 "UI", "Controls with their own load/save logic",
 *  "Marker placement and inertness", "The write guard").
 *
 *  Nothing here is hand-written per key. For a page:
 *
 *    1. the allowlist comes from the real js/mzta-managed.js (probeAllowlist());
 *    2. the page is probed, unmanaged, in a worker: every .option-input / [data-mzta-pref]
 *       control whose key is on the allowlist is a case;
 *    3. sweepValues() gives each case a policy value P and a stored user value U, different
 *       from each other and valid for both the control and the prefs_default type;
 *    4. the page is probed again, unmanaged, with U stored: the BASELINE;
 *    5. the page is opened in this process under the policy (every case locked, or every case
 *       ":locked": false) with U stored, and one test() is declared per key.
 *
 *  Known failures are passed in as `todo` ({key: {aspect: 'potential bug: ...'}}): the
 *  assertion still runs and is reported as a failing TODO, never skipped.
 *
 *  A key whose shown value the spec derives from the other locked keys, rather than from its
 *  own policy value, is passed in as `expected` ({key: {value, why}}): the locked "shows"
 *  assertion checks that value instead. `why` names the spec rule, and goes in the test title.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { probeAllowlist, probePage } from './dom-probe.mjs';
import { openPage, assertHarnessClean, msg } from './dom-page.mjs';
import { prefs_default } from '../../options/mzta-options-default.js';

export const ORG_NAME = 'Acme Test Org';

/**
 * The companion controls of the data-mzta-pref controls (spec "Controls with their own
 * load/save logic"): their Save buttons, which lockCompanions() must disable.
 */
export const COMPANIONS = {
    spamfilter_skip_addresses: ['btn_save_skip_addresses'],
    add_tags_exclusions: ['btn_save_excl_list'],
    summarize_auto_senders_list: ['btn_save_auto_senders'],
    // "Reset to default" buttons of number inputs.
    max_prompt_length: ['reset_max_prompt_length'],
    special_command_timeout: ['reset_special_command_timeout'],
    summarize_max_messages: ['reset_summarize_max_messages'],
};

const isSecret = key => key.endsWith('_api_key');

/** Distinct, valid P (policy) and U (user) values for one control. null = cannot be swept. */
export function sweepValues(c, key = c.key) {
    const d = prefs_default[key];
    if (Array.isArray(d)) {
        return { P: ['policy@example.com'], U: ['user@example.com'] };
    }
    if (c.tag === 'input' && c.type === 'checkbox') {
        if (typeof d !== 'boolean') return null;
        return { P: !d, U: d };
    }
    if (c.tag === 'select') {
        // Model lists are fetched from the provider: any model id is a legitimate value.
        if (key.endsWith('_model') && typeof d === 'string') {
            return { P: 'policy-model', U: 'user-model' };
        }
        const values = (c.options || []).filter(o => o.value !== '' && !o.disabled).map(o => o.value);
        if (values.length < 2) {
            // A select the page fills later (or never): it can only be swept with free
            // values, which the type check accepts for a string preference.
            if (typeof d !== 'string') return null;
            return { P: 'policy-' + key, U: 'user-' + key };
        }
        const cast = v => (typeof d === 'number' ? Number(v) : v);
        const P = values[values.length - 1];
        const U = values.find(v => v !== P && v !== String(d)) ?? values[0];
        return { P: cast(P), U: cast(U) };
    }
    if (c.tag === 'input' && c.type === 'number') {
        const step = Number(c.step) > 0 ? Number(c.step) : 1;
        const base = typeof d === 'number' ? d : (Number(d) || 0);
        const min = c.min !== null && c.min !== '' ? Number(c.min) : -Infinity;
        const max = c.max !== null && c.max !== '' ? Number(c.max) : Infinity;
        let U = base + step;
        let P = base + 2 * step;
        if (P > max) { U = base - step; P = base - 2 * step; }
        if (U < min || P < min) return null;
        const cast = v => (typeof d === 'number' ? v : String(v));
        return { P: cast(P), U: cast(U) };
    }
    if (typeof d === 'string') {
        if (/_extra_body$/.test(key)) return { P: '{"policy": 1}', U: '{"user": 1}' };
        if (/_host$/.test(key)) return { P: 'http://policy.example:11434', U: 'http://user.example:11434' };
        if (isSecret(key)) return { P: 'sk-policy-' + key, U: 'sk-user-' + key };
        if (/temperature$/.test(key)) return { P: '0.3', U: '0.7' };
        if (/thinking_budget$/.test(key)) return { P: '512', U: '256' };
        return { P: 'policy-' + key, U: 'user-' + key };
    }
    return null;
}

/** What the control shows, in the terms of its preference value. */
export function shows(el, value) {
    if (el.tagName === 'INPUT' && el.type === 'checkbox') return el.checked === value;
    if (Array.isArray(value)) {
        const shown = el.value.split(/[\n,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
        return value.every(v => shown.includes(String(v).toLowerCase())) && shown.length === value.length;
    }
    if (el.tagName === 'INPUT' && el.type === 'number') return el.value !== '' && Number(el.value) === Number(value);
    return el.value === String(value);
}

const describeShown = el => (el.type === 'checkbox' ? 'checked=' + el.checked : JSON.stringify(el.value));

/**
 * Where the spec puts a control's marker (spec "Marker placement and inertness"):
 *  - a control inside a .mzta_switch: before that label, as a sibling;
 *  - else the row: closest('td') || closest('label') || parentElement;
 *  - and when that host is a .mzta_field headed by an unambiguous group title (its own
 *    .opt_title_small, or the section's .mzta_prompt_title over a single field): the title.
 * Returns { host, before } - `before` is the element the marker must precede, if any.
 */
export function expectedMarkerHost(el) {
    const sw = el.closest('.mzta_switch');
    let host = sw && sw.parentElement ? sw.parentElement
        : (el.closest('td') || el.closest('label') || el.parentElement);
    let before = sw && sw.parentElement ? sw : null;
    const title = host ? groupTitleHost(host) : null;
    if (title) { host = title; before = null; }
    return { host, before };
}

/**
 * Spec "Group titles win over the column": the title heading a .mzta_field - its own direct
 * .opt_title_small, else the section's .mzta_prompt_title when the field is the section's
 * only direct .mzta_field. null when the element is not a .mzta_field or no title is
 * unambiguous.
 */
export function groupTitleHost(field) {
    if (!field.classList.contains('mzta_field')) return null;
    const own = field.querySelector(':scope > .opt_title_small');
    if (own) return own;
    const section = field.parentElement;
    if (!section || !section.classList.contains('mzta_section')) return null;
    const sectionTitle = section.querySelector(':scope > .mzta_prompt_title');
    if (!sectionTitle) return null;
    return section.querySelectorAll(':scope > .mzta_field').length === 1 ? sectionTitle : null;
}

/** The candidate controls of an inventory, by key (the first control per key). */
function casesFrom(inventory, allowlist) {
    const allowed = new Set(allowlist);
    const byKey = new Map();
    for (const c of inventory.controls) {
        if (!c.key || !allowed.has(c.key) || byKey.has(c.key)) continue;
        // The account matchers have no control of their own (spec "The account checkboxes").
        if (/_enabled_accounts_match$/.test(c.key)) continue;
        byKey.set(c.key, c);
    }
    const cases = [];
    const unsweepable = [];
    for (const [key, c] of byKey) {
        const v = sweepValues(c);
        if (v) cases.push({ key, control: c, ...v });
        else unsweepable.push(key);
    }
    return { cases, unsweepable };
}

/** Steps 1-4: the cases and the baseline. */
async function prepare(page) {
    const allowlist = await probeAllowlist();
    const inventory = await probePage(page, {});
    const { cases, unsweepable } = casesFrom(inventory, allowlist);
    const local = Object.fromEntries(cases.map(c => [c.key, c.U]));
    const baseline = await probePage(page, { local });
    const baseByKey = new Map(baseline.controls.filter(c => c.key).map(c => [c.key, c]));
    return { allowlist, inventory, cases, unsweepable, local, baseline, baseByKey };
}

function todoFor(todo = {}, key, aspect) {
    return (todo[key] && todo[key][aspect]) || (todo['*'] && todo['*'][aspect]) || undefined;
}

function sweepHeaderTests(page, prep) {
    test('the sweep found allowlisted controls on this page', () => {
        assert.ok(prep.cases.length > 0, 'no allowlisted control on ' + page);
    });
    test('every allowlisted control on this page could be given two distinct values', () => {
        assert.deepEqual(prep.unsweepable, []);
    });
    test('the baseline (unmanaged) probe ran on modelled APIs only', () => {
        assert.deepEqual(prep.baseline.violations, []);
        assert.deepEqual(prep.baseline.rejections, []);
        assert.deepEqual(prep.baseline.jsdomErrors, []);
    });
}

/**
 * Every allowlisted key with a control on the page, LOCKED, with a different user value
 * stored. Then the write attempts: every locked control changed through the DOM, before and
 * after being re-enabled by hand.
 */
export async function lockedSweep(page, { todo, expected = {} } = {}) {
    const prep = await prepare(page);
    const policy = { _org_name: ORG_NAME };
    for (const c of prep.cases) policy[c.key] = c.P;
    const ctx = await openPage(page, { policy, local: prep.local });
    after(() => ctx.close());
    const lockedKeys = new Set(prep.cases.map(c => c.key));
    const { MANAGED_SECRET_MARKER } = ctx.mods;

    sweepHeaderTests(page, prep);

    for (const c of prep.cases) {
        const el = () => ctx.document.getElementById(c.control.id);
        const t = aspect => ({ todo: todoFor(todo, c.key, aspect) });
        test(`locked ${c.key}: disabled and marked as managed`, t('disabled'), () => {
            assert.equal(el().disabled, true, 'disabled');
            assert.equal(el().dataset.mztaManaged, '1', 'data-mzta-managed');
            // A select turned into a Tom Select is operated through the widget, which reads the
            // native `disabled` only when it is built: the widget itself must be disabled too.
            if (el().tomselect) assert.equal(el().tomselect.isDisabled, true, 'its Tom Select is still enabled');
        });
        if (expected[c.key]) {
            const { value, why } = expected[c.key];
            test(`locked ${c.key}: shows ${JSON.stringify(value)} (${why}), not the stored user value`, t('value'), () => {
                assert.ok(shows(el(), value), `expected ${JSON.stringify(value)}, shows ${describeShown(el())}`);
            });
        } else test(`locked ${c.key}: shows the policy value, not the stored user value`, t('value'), () => {
            const expected = isSecret(c.key) ? MANAGED_SECRET_MARKER : c.P;
            assert.ok(shows(el(), expected),
                `expected ${JSON.stringify(isSecret(c.key) ? 'MANAGED_SECRET_MARKER' : expected)}, shows ${describeShown(el())}`);
        });
        test(`locked ${c.key}: marker (with the org name) where the spec puts it`, t('marker'), () => {
            const { host, before } = expectedMarkerHost(el());
            assert.ok(host, 'no marker host');
            const marker = host.querySelector(':scope > .managed_marker');
            assert.ok(marker, 'no .managed_marker in ' + host.tagName + '#' + host.id + '.' + host.className);
            assert.equal(marker.textContent, msg('managed_marker_org', [ORG_NAME]));
            assert.equal(marker.title, msg('managed_marker_tooltip'));
            if (before) {
                assert.ok(marker.compareDocumentPosition(before) & ctx.window.Node.DOCUMENT_POSITION_FOLLOWING,
                    'the marker must come before the switch');
                assert.equal(marker.closest('label'), null, 'the marker must not be inside the switch label');
            }
        });
        if (COMPANIONS[c.key]) {
            test(`locked ${c.key}: companion controls disabled and marked`, t('companions'), () => {
                for (const id of COMPANIONS[c.key]) {
                    const b = ctx.document.getElementById(id);
                    assert.ok(b, 'missing companion #' + id);
                    assert.equal(b.disabled, true, '#' + id + ' disabled');
                    assert.equal(b.dataset.mztaManaged, '1', '#' + id + ' marked');
                }
            });
            test(`locked ${c.key}: a companion re-enabled and clicked by hand leaves the control showing the policy value`, t('companions'), async () => {
                // Its handler must return early: a Reset that refills the input would show a value
                // the write guard then refuses to store.
                for (const id of COMPANIONS[c.key]) {
                    const b = ctx.document.getElementById(id);
                    b.disabled = false;
                    await ctx.click(b);
                    b.disabled = true;
                }
                const want = isSecret(c.key) ? MANAGED_SECRET_MARKER
                    : (expected[c.key] ? expected[c.key].value : c.P);
                assert.ok(shows(el(), want), `expected ${JSON.stringify(want)}, shows ${describeShown(el())}`);
            });
        }
        test(`locked ${c.key}: opening the page left the stored user value alone`, t('storage'), () => {
            assert.deepEqual(ctx.ctl.localData()[c.key], c.U);
        });
    }

    test('write attempts through the UI never reach storage.local (write guard)', { todo: todoFor(todo, '*', 'writes') }, async () => {
        const since = ctx.ctl.calls.length;
        for (const pass of ['as rendered', 're-enabled by hand']) {
            for (const c of prep.cases) {
                const el = ctx.document.getElementById(c.control.id);
                if (!el) continue;
                const companions = (COMPANIONS[c.key] || []).map(id => ctx.document.getElementById(id)).filter(Boolean);
                if (pass === 're-enabled by hand') {
                    el.disabled = false;
                    el.readOnly = false;
                    companions.forEach(b => { b.disabled = false; });
                }
                writeSomething(el, c, ctx.window);
                await ctx.fire(el, 'input');
                await ctx.fire(el, 'change');
                for (const b of companions) await ctx.click(b);
            }
        }
        const leaked = ctx.localWrites(since)
            .flatMap(call => Object.keys(call.items))
            .filter(k => lockedKeys.has(k));
        assert.deepEqual([...new Set(leaked)], [], 'storage.local.set() carried locked keys');
        for (const c of prep.cases) {
            assert.deepEqual(ctx.ctl.localData()[c.key], c.U, c.key + ' changed in storage');
        }
        const stored = JSON.stringify(ctx.ctl.localData()._special_prompts || null);
        assert.ok(!stored.includes(MANAGED_SECRET_MARKER), 'MANAGED_SECRET_MARKER stored in _special_prompts');
    });

    test('the page ran on modelled APIs only', { todo: todoFor(todo, '*', 'harness') }, () => assertHarnessClean(ctx));
    return ctx;
}

/** Put a value different from both P and U in the control, the way a user would. */
function writeSomething(el, c, window) {
    if (el.tagName === 'INPUT' && el.type === 'checkbox') { el.checked = !el.checked; return; }
    if (el.tagName === 'SELECT') {
        const other = [...el.options].find(o => o.value !== el.value && o.value !== '');
        if (other) el.value = other.value;
        else {
            el.add(new window.Option('written-by-test', 'written-by-test'));
            el.value = 'written-by-test';
        }
        return;
    }
    if (el.tagName === 'INPUT' && el.type === 'number') { el.value = String(Number(el.value || 0) + 7); return; }
    el.value = Array.isArray(c.U) ? 'written@example.com' : 'written-' + c.key;
}

/**
 * Every allowlisted key with a control on the page as an INITIAL value (":locked": false),
 * with a user value stored: the user's value wins, and the control is exactly as editable as
 * on an unmanaged page.
 */
export async function unlockedSweep(page, { todo } = {}) {
    const prep = await prepare(page);
    const policy = { _org_name: ORG_NAME };
    for (const c of prep.cases) {
        policy[c.key] = c.P;
        policy[c.key + ':locked'] = false;
    }
    const ctx = await openPage(page, { policy, local: prep.local });
    after(() => ctx.close());

    sweepHeaderTests(page, prep);

    test('no control on the page is marked or badged', () => {
        assert.deepEqual([...ctx.document.querySelectorAll('[data-mzta-managed]')].map(e => e.id), []);
        assert.equal(ctx.document.querySelectorAll('.managed_marker').length, 0);
    });

    for (const c of prep.cases) {
        const el = () => ctx.document.getElementById(c.control.id);
        const t = aspect => ({ todo: todoFor(todo, c.key, aspect) });
        const base = prep.baseByKey.get(c.key);
        test(`unlocked ${c.key}: shows the user's value exactly as the same page does without a policy`, t('value'), () => {
            // Compared with the baseline rather than with U itself: some pages derive what a
            // control shows from more than its preference (a feature page's connection select
            // follows the special prompt, a mandatory toggle is forced on). What the policy
            // must not change is that result.
            assert.ok(base, 'no baseline for ' + c.key);
            const now = el().type === 'checkbox' ? String(el().checked) : el().value;
            const then = base.type === 'checkbox' ? String(base.checked) : base.value;
            assert.equal(now, then, 'differs from the unmanaged page with the same stored value');
            // And, whenever the unmanaged page shows the user's own value, that is still it.
            if (shows(el(), c.U) || base.value === String(c.U) || (base.type === 'checkbox' && base.checked === c.U)) {
                assert.ok(shows(el(), c.U), 'expected the user value ' + JSON.stringify(c.U) + ', shows ' + describeShown(el()));
            }
        });
        test(`unlocked ${c.key}: as editable as without a policy`, t('editable'), () => {
            assert.ok(base, 'no baseline for ' + c.key);
            assert.equal(el().disabled, base.disabled, 'disabled differs from the unmanaged page');
            assert.equal(!!el().readOnly, base.readOnly, 'readOnly differs from the unmanaged page');
            assert.equal(el().dataset.mztaManaged, undefined, 'data-mzta-managed');
        });
    }

    test('the page ran on modelled APIs only', { todo: todoFor(todo, '*', 'harness') }, () => assertHarnessClean(ctx));
    return ctx;
}
