/*
 *  The get_managed_values listener, taken verbatim from mzta-background.js.
 *
 *  It is registered inline in the background script, which cannot be imported under test:
 *  its top level awaits every startup step (menus, content scripts, migrations) against the
 *  whole Thunderbird API. Rather than keep a copy of the handler here - which would test the
 *  copy - the source is located by its command guard, cut out with the core tokenizer
 *  (./core/background-source.mjs, re-exported below) and evaluated against the injected
 *  dependencies.
 *
 *  If this throws "not found", the handler was moved or restructured: update the locator
 *  below, not the assertions.
 */

import {
    backgroundSource,
    locateListener,
    evalListener,
} from './core/background-source.mjs';

export {
    segments,
    stripComments,
    backgroundSource,
} from './core/background-source.mjs';

const GUARD = "message.command !== 'get_managed_values'";

/** The listener's source text, "(message, sender) => { ... }", and where it sits. */
export function locateManagedValuesListener(src = backgroundSource()) {
    return locateListener(GUARD, { src, label: 'background-handler', what: 'get_managed_values listener' });
}

/** Build the real listener, bound to the given background-side dependencies. */
export function extractManagedValuesListener({ browser, mztaManaged, MANAGED_SECRET_MARKER, prefs_default }) {
    const { text } = locateManagedValuesListener();
    return evalListener(text, { browser, mztaManaged, MANAGED_SECRET_MARKER, prefs_default });
}
