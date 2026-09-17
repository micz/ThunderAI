/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/*
 *  Managed-configuration UI, shared by the options page and every pages/* settings page.
 *
 *  A settings page NEVER reads browser.storage.managed: that call is known to fail on
 *  options pages in Thunderbird. It asks the background page instead, with a single
 *  "get_managed_state" message, and gets back only what it needs to render:
 *
 *      { active, orgName, lockedKeys }
 *
 *  Note what is NOT in that payload: the managed VALUES. A page only needs to know which
 *  controls to disable, so a policy-supplied API key never travels over the message
 *  channel at all. The value already reaches the input through the normal preference read
 *  (js/mzta-prefs.js resolves it), and for an API key the field is masked anyway.
 *
 *  This is presentation only. It is NOT what stops a locked preference being written -
 *  that is the write guard in js/mzta-prefs.js, which holds even if a page forgets to call
 *  any of this, or if a control is re-enabled from the developer tools.
 */

import { taLogger } from '../../js/mzta-logger.js';

let _state = null;
let _logger = null;

/**
 * Fetch the managed state once and cache it for the lifetime of the page.
 *
 * Never throws and never leaves a page half-rendered: if the background is not ready yet
 * the page simply behaves as an unmanaged one, which is the correct fallback because the
 * write guard still protects every locked key.
 */
export async function getManagedState(do_debug = false) {
    if (_state) return _state;
    if (!_logger) _logger = new taLogger("mzta-managed-ui", do_debug);
    try {
        const managed = await browser.runtime.sendMessage({ command: 'get_managed_state' });
        _state = (managed && typeof managed === 'object') ? managed : {};
    } catch (e) {
        _logger.warn('Could not read the managed state: ' + e);
        _state = {};
    }
    _state.active = _state.active === true;
    _state.orgName = _state.orgName || '';
    _state.lockedKeys = Array.isArray(_state.lockedKeys) ? _state.lockedKeys : [];
    _state.disablePromptManagement = _state.disablePromptManagement === true;
    _state.disableSetupWizard = _state.disableSetupWizard === true;
    return _state;
}

/**
 * True when the policy forbids creating, importing or exporting prompts.
 *
 * Synchronous, like isLockedKey(): getManagedState() must have run first. A caller that
 * has not awaited it gets false, which is the safe default for a page that could not reach
 * the background page at all.
 */
export function isPromptManagementDisabled() {
    return !!_state && _state.disablePromptManagement === true;
}

/** True when the policy forbids opening the setup wizard. Synchronous, see above. */
export function isSetupWizardDisabled() {
    return !!_state && _state.disableSetupWizard === true;
}

/** The enforced preference keys on this page. Empty array when no policy is active. */
export async function getLockedKeys(do_debug = false) {
    return (await getManagedState(do_debug)).lockedKeys;
}

/** True when the given preference key is enforced by the policy. */
export function isLockedKey(key) {
    return !!_state && _state.lockedKeys.includes(key);
}

/**
 * Disable every control bound to a locked preference and mark it as managed.
 *
 * Relies on the invariant the options page already depends on: an .option-input element's
 * id IS its preference key (that is how saveOptions() and restoreOptions() work). So the
 * mapping needs no table - the policy key and the element id are the same string.
 *
 * Safe to call repeatedly: a page that injects controls later (the connection panel builds
 * its provider rows on demand) calls it again and the already-marked ones are skipped.
 */
export async function applyManagedUI(root = document, do_debug = false) {
    const state = await getManagedState(do_debug);
    if (!state.active || state.lockedKeys.length === 0) return state;

    // Walk the controls once and test each against the locked set, rather than running a
    // selector per locked key: an id-suffix selector would also catch unrelated controls
    // whose id merely ends with the key ("translate" would match "auto_translate").
    const locked = new Set(state.lockedKeys);
    root.querySelectorAll('.option-input').forEach(element => {
        if (!element.id) return;
        if (!locked.has(element.id)) return;
        if (element.dataset.mztaManaged === '1') return;
        element.dataset.mztaManaged = '1';
        element.disabled = true;
        lockControl(element);
        markManaged(element, state);
    });

    return state;
}

/**
 * Put a visible marker next to a managed control, so a disabled field reads as "your
 * organization set this" rather than as a bug.
 */
function markManaged(element, state) {
    // The row is the natural anchor on the options page and on every feature page, which
    // all lay their settings out as table rows; fall back to the control's own parent.
    const anchor = element.closest('td') || element.closest('label') || element.parentElement;
    if (!anchor) return;

    // A feature toggle is an <input> hidden inside <label class="mzta_switch">. Appending
    // the marker there would put it inside the switch, i.e. to the LEFT of the visible
    // track and inside the label's click target. Place it before the label instead, so the
    // row reads "... [Managed by Org] (toggle)" and the badge is not clickable.
    const switchLabel = element.closest('.mzta_switch');
    const target = switchLabel && switchLabel.parentElement ? switchLabel.parentElement : anchor;
    if (target.querySelector('.managed_marker')) return;

    const marker = document.createElement('span');
    marker.className = 'managed_marker';
    marker.textContent = state.orgName
        ? browser.i18n.getMessage('managed_marker_org', [state.orgName])
        : browser.i18n.getMessage('managed_marker');
    marker.title = browser.i18n.getMessage('managed_marker_tooltip');

    if (switchLabel && target === switchLabel.parentElement) {
        target.insertBefore(marker, switchLabel);
    } else {
        target.appendChild(marker);
    }
}

/**
 * Disable a control that a restriction takes away, and say who took it away.
 *
 * Restrictions have no preference behind them, so applyManagedUI() cannot reach these
 * controls: its whole mapping is "element id IS the preference key". They are also plain
 * buttons and links rather than .option-input fields. This is the explicit counterpart,
 * called at the few sites a restriction covers.
 *
 * Marks the element the same way applyManagedUI() does, so setDisabledRespectingManaged()
 * keeps it disabled if page logic later reassigns `disabled` for its own reasons.
 */
export function disableForManagedRestriction(element, do_debug = false) {
    if (!element) return;
    if (element.dataset.mztaManaged === '1') return;
    element.dataset.mztaManaged = '1';
    element.disabled = true;
    // An <a> has no `disabled` property that the browser honours: give it the same inert
    // treatment the markup gets, so a restricted link cannot be followed or tabbed into.
    if (element.tagName === 'A') {
        element.setAttribute('aria-disabled', 'true');
        element.classList.add('managed_disabled');
        element.removeAttribute('href');
    }
    element.title = browser.i18n.getMessage('managed_restriction_tooltip');
    lockControl(element);
}

/**
 * Set `disabled` on a control without ever un-disabling one a policy locked.
 *
 * Page logic greys controls out for its own reasons (no connection selected, Sparks not
 * installed) and reassigns `disabled` unconditionally on every refresh. Routing those
 * assignments through here keeps a managed control disabled no matter what the page
 * decides, instead of the last writer winning.
 */
export function setDisabledRespectingManaged(element, disabled) {
    if (!element) return;
    element.disabled = disabled || element.dataset.mztaManaged === '1';
}

/**
 * Keep a managed toggle inert even if something else re-enables the input.
 *
 * `disabled` alone is not enough here: disable_ApiFeature() on the options page reassigns
 * `checkbox.disabled` unconditionally from the storage.onChanged listener, which runs after
 * applyManagedUI(). Without this the switch would flip visually (the write guard in
 * mzta-prefs.js still refuses to persist it) and look like the policy was bypassed.
 */
function lockControl(element) {
    if (element.dataset.mztaManagedLock === '1') return;
    element.dataset.mztaManagedLock = '1';

    const swallow = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };
    // The visible target is the wrapping label/track, not the visually hidden input, so the
    // listener has to sit on the label to catch the label-forwarded activation.
    const clickTarget = element.closest('.mzta_switch') || element;
    clickTarget.addEventListener('click', swallow, true);
    clickTarget.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter') swallow(event);
    }, true);
}

/**
 * Show the "this add-on is centrally managed" banner.
 *
 * The element is expected to exist in the page markup, hidden; this only fills in the text
 * and reveals it, mirroring how #no_connection_banner is handled on the options page.
 */
export async function showManagedBanner(banner_id = 'managed_config_banner', do_debug = false) {
    const state = await getManagedState(do_debug);
    const banner = document.getElementById(banner_id);
    if (!banner) return state;
    if (!state.active) return state;

    const textEl = banner.querySelector('.managed_banner_text') || banner;
    textEl.textContent = state.orgName
        ? browser.i18n.getMessage('managed_banner_org', [state.orgName])
        : browser.i18n.getMessage('managed_banner');
    banner.classList.add('shown');
    return state;
}
