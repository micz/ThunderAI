/*
 *  DOM harness, managed layer. The harness itself - openPage(), the strict browser proxy,
 *  settle(), assertHarnessClean() - is the core one (./core/dom-harness.mjs): with the managed
 *  plugin (./plugins/managed.mjs) present, a page's background is the background instance of
 *  js/mzta-managed.js running the policy, the page hydrates through the real get_managed_values
 *  listener, and ctx.bgManaged is that instance.
 *
 *  What is added here is only what reads the managed configuration in a page.
 */

export {
    PAGES,
    openPage,
    assertHarnessClean,
    msg,
} from './core/dom-harness.mjs';

/** Every control managed-ui.js considers: .option-input and [data-mzta-pref]. */
export function managedControls(document) {
    return [...document.querySelectorAll('.option-input, [data-mzta-pref]')];
}

/** The preference key of a control, by the spec's rule: data-mzta-pref, else the id. */
export function controlKey(el) {
    if (el.dataset.mztaPref) return el.dataset.mztaPref;
    if (el.classList.contains('option-input')) return el.id || '';
    return '';
}

/** Everything the managed code leaves in a page, for the "no policy" checks. */
export function managedArtifacts(document) {
    return {
        marked: [...document.querySelectorAll('[data-mzta-managed]')].map(e => e.id || e.tagName),
        markers: document.querySelectorAll('.managed_marker').length,
        secrets: document.querySelectorAll('.managed_secret').length,
        disabledLinks: document.querySelectorAll('.managed_disabled').length,
        bannerShown: !!document.querySelector('#managed_config_banner.shown'),
        restrictionNotes: [...document.querySelectorAll('.managed_restriction_note.shown, #managed_restriction_note.shown, #managed_restriction_defaults_note.shown')].length,
    };
}
