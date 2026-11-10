/*
 *  One context of the smartbar area: the core background (mock, console capture, core modules)
 *  and the SmartBar's modules, imported after the mock exists (js/mzta-prefs.js touches
 *  `browser` at import time, and the router reaches it through js/mzta-utils.js).
 *
 *  A test file is ONE context: call smartbarContext() once, at the top level.
 *
 *  Not a test file (no .test.mjs suffix). Imports only the core, never jsdom.
 */

import { startBackground } from '../helpers/core/load.mjs';

const imp = rel => import(new URL('../../' + rel, import.meta.url).href);

/** The core context plus { registry, router, execute, chat, store, storage, placeholders } (the module namespaces). */
export async function smartbarContext(mockOpts = {}) {
    const ctx = await startBackground({ ...mockOpts, local: { do_debug: false, ...(mockOpts.local || {}) } });
    const [registry, router, execute, chat, store, storage, placeholders] = await Promise.all([
        imp('js/mzta-smartbar-registry.js'),
        imp('js/mzta-smartbar-router.js'),
        imp('js/mzta-smartbar-execute.js'),
        imp('js/mzta-smartbar-chat.js'),
        imp('js/mzta-smartbar-store.js'),
        imp('js/mzta-storage.js'),
        imp('js/mzta-placeholders.js'),
    ]);
    return { ...ctx, registry, router, execute, chat, store, storage, placeholders };
}

/** An availability env where every default operation can run. */
export const ALL_AVAILABLE = Object.freeze({
    features: { add_tags: true, summarize: true, translate: true },
    permissions: { add_tags: true },
    usable: { add_tags: true, summarize: true, translate: true, smartbar_execute: true },
});
