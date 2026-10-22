/*
 *  The managed-configuration plugin (contract: ../core/plugins.mjs).
 *
 *  Background context: js/mzta-managed.js is loaded with the other modules, and loadManaged() -
 *  the one call mzta-background.js makes before its first preference read - runs before the
 *  context is handed to the test.
 *
 *  Page context: two independent instances of js/mzta-managed.js live in this process: the
 *  page's own (the plain module, which js/mzta-prefs.js imports) and the background's (the same
 *  file under a query string, hence a separate singleton). The background instance reads the
 *  policy with loadManaged(); the page reaches it only through runtime.sendMessage, answered by
 *  the real get_managed_values listener taken from mzta-background.js (../background-handler.mjs).
 *  The ctx gets the background instance as `bgManaged`.
 *
 *  No jsdom here, so level 1 can load it.
 */

import { extractManagedValuesListener } from '../background-handler.mjs';

/** js/mzta-managed.js, as the fields startBackground() / startPage() add to the ctx. */
export async function managedModules(imp) {
    const managed = await imp('js/mzta-managed.js');
    return {
        mztaManaged: managed.mztaManaged,
        MANAGED_SECRET_MARKER: managed.MANAGED_SECRET_MARKER,
        managedModule: managed,
    };
}

export default {
    name: 'managed',

    modules: managedModules,

    async startBackground(ctx) {
        await ctx.mztaManaged.loadManaged();
    },

    // Imported BEFORE the page's modules, as it always has been: the background instance is a
    // separate singleton either way, but the order is part of what the tests were written on.
    async remoteBackground({ browser, imp }) {
        const bgManaged = await imp('js/mzta-managed.js?context=background');
        return {
            async start(mods) {
                const listener = extractManagedValuesListener({
                    browser,
                    mztaManaged: bgManaged.mztaManaged,
                    MANAGED_SECRET_MARKER: bgManaged.MANAGED_SECRET_MARKER,
                    prefs_default: mods.prefs_default,
                });
                await bgManaged.mztaManaged.loadManaged();
                return {
                    fields: { bgManaged: bgManaged.mztaManaged },
                    listeners: [listener],
                };
            },
        };
    },
};
