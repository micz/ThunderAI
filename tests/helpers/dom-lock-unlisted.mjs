/*
 *  Spec 08 "Strict mode", in a page: with "_lock_unlisted": true every control of a key locked
 *  at its default looks and behaves exactly like one locked by an explicit policy value -
 *  disabled, data-mzta-managed, a marker - with no code of its own: the page receives those
 *  keys through get_managed_values as ordinary locked values. A key named in _user_editable,
 *  and an excluded key, keep their control as on an unmanaged page.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, managedControls, controlKey } from './dom-page.mjs';

export async function lockUnlistedScenario(page, editableKey) {
    const ctx = await openPage(page, {
        policy: { _lock_unlisted: true, _user_editable: [editableKey] },
    });
    after(() => ctx.close());
    const bg = ctx.bgManaged;

    test('the page hydrated the implicit locks', () => {
        assert.ok(ctx.mods.mztaManaged.getLockedKeys().length > 0);
        assert.deepEqual(ctx.mods.mztaManaged.getLockedKeys().sort(), bg.getLockedKeys().sort());
    });

    test('every control of a key locked at its default is disabled and marked as managed', () => {
        const locked = managedControls(ctx.document).filter(el => bg.isLockedByDefault(controlKey(el)));
        assert.ok(locked.length > 0, 'no control of a key locked at its default on the page');
        for (const el of locked) {
            assert.equal(el.disabled, true, controlKey(el) + ' disabled');
            assert.equal(el.dataset.mztaManaged, '1', controlKey(el) + ' data-mzta-managed');
        }
        assert.ok(ctx.$$('.managed_marker').length > 0, 'no marker');
        assert.equal(ctx.$('#managed_config_banner')?.classList.contains('shown') ?? true, true);
    });

    test(`the _user_editable key ${editableKey} keeps its control`, () => {
        const el = ctx.document.getElementById(editableKey);
        assert.ok(el, 'no #' + editableKey);
        assert.equal(bg.hasManagedValue(editableKey), false);
        assert.equal(el.dataset.mztaManaged, undefined);
        assert.equal(el.disabled, false);
    });

    test('no API key field shows the managed-secret marker', () => {
        const { MANAGED_SECRET_MARKER } = ctx.mods;
        for (const el of ctx.$$('input[id$="_api_key"]')) {
            assert.notEqual(el.value, MANAGED_SECRET_MARKER, el.id);
        }
    });

    test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
    return ctx;
}
