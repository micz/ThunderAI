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
 *  options pages in Thunderbird. Everything it knows about the policy comes from
 *  js/mzta-managed.js, which managedReady() hydrates once from the background
 *  ("get_managed_values") - the values and locks, the restrictions, the banner state. The
 *  first preference read already does that (js/mzta-prefs.js awaits it), so an input restored
 *  from mztaPrefs holds the enforced or initial value, and getManagedState() below only reads
 *  the hydrated module: there is no second round trip, and so no second answer to disagree
 *  with the first. A policy-supplied API key reaches a settings page only as
 *  MANAGED_SECRET_MARKER (see js/mzta-managed.js).
 *
 *  This is presentation only. It is NOT what stops a locked preference being written -
 *  that is the write guard in js/mzta-prefs.js, which holds even if a page forgets to call
 *  any of this, or if a control is re-enabled from the developer tools.
 */

import { mztaManaged, managedReady, MANAGED_SECRET_MARKER } from '../../js/mzta-managed.js';
import { prefs_default } from '../../options/mzta-options-default.js';
import { resolveEnabledAccounts, hasNoConnectionSelected } from '../../js/mzta-utils.js';

let _state = null;

/**
 * The managed state this page renders, read once from the hydrated js/mzta-managed.js and
 * cached for the lifetime of the page:
 *
 *     { active, orgName, lockedKeys, disablePromptManagement, disableDefaultPrompts,
 *       disableSetupWizard }
 *
 * Never throws and never leaves a page half-rendered: if the hydration failed the page simply
 * behaves as an unmanaged one (fail open, see managedReady()). The background still enforces
 * every locked key on its own reads.
 */
export async function getManagedState(do_debug = false) {
    if (_state) return _state;
    await managedReady();
    _state = {
        active: mztaManaged.isManagedActive(),
        orgName: mztaManaged.getOrgName(),
        lockedKeys: mztaManaged.getLockedKeys(),
        disablePromptManagement: mztaManaged.isPromptManagementDisabled(),
        disableDefaultPrompts: mztaManaged.areDefaultPromptsDisabled(),
        disableSetupWizard: mztaManaged.isSetupWizardDisabled(),
    };
    return _state;
}

// The synchronous accessors below read js/mzta-managed.js directly. They need the policy to
// have been hydrated, which any awaited preference read - or getManagedState() - has done; a
// caller that has awaited neither gets false, the safe default of a page that could not reach
// the background at all.

/** True when the policy forbids creating, importing or exporting prompts. */
export function isPromptManagementDisabled() {
    return mztaManaged.isPromptManagementDisabled();
}

/**
 * True when the policy takes the built-in prompts out of the menus.
 *
 * Independent of isPromptManagementDisabled(): the two restrictions cover disjoint sets of
 * prompts - the built-in ones here, the user's own ones there - and can be on together.
 */
export function areDefaultPromptsDisabled() {
    return mztaManaged.areDefaultPromptsDisabled();
}

/** True when the policy forbids opening the setup wizard. */
export function isSetupWizardDisabled() {
    return mztaManaged.isSetupWizardDisabled();
}

/** The enforced preference keys on this page. Empty array when no policy is active. */
export async function getLockedKeys(do_debug = false) {
    return (await getManagedState(do_debug)).lockedKeys;
}

/**
 * True when the given preference key is enforced by the policy: the same answer the write
 * guard in js/mzta-prefs.js acts on.
 */
export function isLockedKey(key) {
    return mztaManaged.isManagedLocked(key);
}

/**
 * Same as isLockedKey(). Kept as the name restoreOptions() code uses: readable before
 * getManagedState() or applyManagedUI() has run, since restoreOptions() has always awaited a
 * preference read by the time it decides anything.
 */
export function isEnforcedPref(key) {
    return isLockedKey(key);
}

/**
 * Disable every control bound to a locked preference and mark it as managed.
 *
 * Relies on the invariant the options page already depends on: an .option-input element's
 * id IS its preference key (that is how saveOptions() and restoreOptions() work). So the
 * mapping needs no table - the policy key and the element id are the same string.
 *
 * A control with its own load/save logic (a textarea saved as a normalised list, a checkbox
 * that requests a permission) must NOT be an .option-input, or the generic saveOptions() /
 * restoreOptions() would handle it and break its serialisation. Such a control opts in
 * explicitly with data-mzta-pref="<preference key>" instead, and is matched against the
 * locked set exactly like an .option-input is by its id. Its companion buttons are the
 * page's business: see lockCompanions().
 *
 * Safe to call repeatedly: a page that injects controls later (the connection panel builds
 * its provider rows on demand) calls it again and the already-marked ones are skipped.
 */
export async function applyManagedUI(root = document, do_debug = false) {
    const state = await getManagedState(do_debug);
    // The connection fields a policy connection enforces (_special_prompts_connection) are
    // not preferences, so they are not in lockedKeys; but the feature pages' connection panel
    // names its inputs `${prefix}_${field}`, which is exactly what this list holds, so they get
    // the same treatment. Read from the hydrated values, as isEnforcedPref() does.
    await managedReady();
    const locked = new Set([...state.lockedKeys, ...mztaManaged.getEnforcedConnectionControlIds()]);
    if (!state.active || locked.size === 0) return state;

    // Walk the controls once and test each against the locked set, rather than running a
    // selector per locked key: an id-suffix selector would also catch unrelated controls
    // whose id merely ends with the key ("translate" would match "auto_translate").
    root.querySelectorAll('.option-input, [data-mzta-pref]').forEach(element => {
        const key = controlPrefKey(element);
        if (!key) return;
        if (!locked.has(key)) return;
        if (element.dataset.mztaManaged === '1') return;
        element.dataset.mztaManaged = '1';
        element.disabled = true;
        lockControl(element);
        markManaged(element, state);
        // Lets the control's own widgets follow (an API key's eye toggle becomes a padlock).
        element.dispatchEvent(new Event('mzta-managed'));
    });

    return state;
}

/**
 * The preference key a control is bound to: its explicit data-mzta-pref opt-in, or else the
 * id of an .option-input. '' for anything else.
 */
function controlPrefKey(element) {
    if (element.dataset.mztaPref) return element.dataset.mztaPref;
    if (element.classList.contains('option-input')) return element.id || '';
    return '';
}

/**
 * Disable the companion controls of a data-mzta-pref control - its Save or Reset button, and
 * anything else that would change the preference - when that preference is locked.
 *
 * They are marked like the control itself, so setDisabledRespectingManaged() keeps them
 * disabled when page logic later reassigns `disabled` (an "unsaved changes" check does, on
 * every input). Synchronous, like isLockedKey(): getManagedState() - or applyManagedUI() -
 * must have been awaited first. Returns whether the key is locked, so the caller can guard
 * its own handlers with the same answer.
 */
export function lockCompanions(key, elements) {
    if (!isLockedKey(key)) return false;
    disableCompanions(elements);
    return true;
}

function disableCompanions(elements) {
    elements.forEach(element => {
        if (!element) return;
        element.dataset.mztaManaged = '1';
        element.disabled = true;
        element.title = browser.i18n.getMessage('managed_marker_tooltip');
    });
}

/**
 * True when the policy enforces the text of this special prompt (_special_prompts_text).
 *
 * Synchronous, like isLockedKey(): the values must have been hydrated first, which every
 * feature page has done by the time it can save - it reads getSpecialPrompts(), which awaits
 * managedReady(), before anything else. Without a hydrated policy it is false.
 */
export function isEnforcedPromptText(promptId) {
    return mztaManaged.getSpecialPromptText(promptId) !== undefined;
}

/**
 * Make a special prompt's text editor read-only when the policy enforces that text, and say
 * who set it.
 *
 * Not applyManagedUI() territory: there is no preference behind a prompt text, so no locked
 * key to match. The textarea already shows the enforced text - getSpecialPrompts() overlaid
 * it - so this only takes the editing away:
 *
 *  - the textarea becomes readOnly rather than disabled, so the text can still be scrolled,
 *    selected and copied (a user may well want to start their own prompt from it);
 *  - `companions` (its Save and Reset buttons) are disabled and marked, exactly like
 *    lockCompanions() does for a locked preference;
 *  - the marker goes right of the group title the textarea's .mzta_field is headed by (see
 *    groupTitleFor()), where the list textareas get theirs: the textarea's own parent is the
 *    editor-highlight wrapper.
 *
 * `promptIds` lists every prompt the textarea saves (the calendar page writes two). Call it
 * AFTER the page has filled the textarea and set its buttons' initial state. The page's Save
 * and Reset handlers must still return early on isEnforcedPromptText(): a control re-enabled
 * from the developer tools is not the same as the action being available. The storage gate
 * (keepStoredTexts() in js/mzta-prompts.js) holds regardless.
 */
export async function lockEnforcedPromptText(textarea, promptIds, companions = [], do_debug = false) {
    if (!textarea) return false;
    await managedReady();
    if (!promptIds.some(id => isEnforcedPromptText(id))) return false;
    const state = await getManagedState(do_debug);
    textarea.readOnly = true;
    textarea.dataset.mztaManaged = '1';
    textarea.title = browser.i18n.getMessage('managed_prompt_text_tooltip');
    disableCompanions(companions);
    markManaged(textarea, state, textarea.closest('.mzta_field'));
    return true;
}

/**
 * Show the account selector of an automatic feature ('spamfilter', 'add_tags') as the policy
 * resolves it, when {feature}_enabled_accounts_match is set, and take the editing away.
 *
 * Not applyManagedUI() territory: the checkboxes are built by the page, one per account, and
 * are bound to {feature}_enabled_accounts, which is not what the policy sets. So:
 *
 *  - every checkbox is (re)checked from resolveEnabledAccounts() - the stored selection is
 *    not what applies - then disabled and marked like a locked control;
 *  - `companions` ("Select All" / "Deselect All") are disabled via lockCompanions();
 *  - the marker goes right of the section title, and a note under it says the list is set
 *    by the policy, or that it matches no account, which would otherwise read as a bug.
 *
 * Call it AFTER the page has built and checked the boxes. Returns whether the selector is
 * managed: the page's change and Select/Deselect handlers must return early on it. The
 * stored {feature}_enabled_accounts is never written from here, so the user's own selection
 * comes back when the policy is removed.
 */
export async function lockAccountSelector(feature, container, companions = [], do_debug = false) {
    const key = feature + '_enabled_accounts_match';
    const state = await getManagedState(do_debug);
    if (!container || !isLockedKey(key)) return false;
    const resolved = await resolveEnabledAccounts(feature, [], { warnIfNone: false });
    container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = resolved.accountIds.includes(checkbox.value);
        checkbox.dataset.mztaManaged = '1';
        checkbox.disabled = true;
        checkbox.title = browser.i18n.getMessage('managed_marker_tooltip');
    });
    lockCompanions(key, companions);

    const section = container.closest('.mzta_section');
    const title = section ? section.querySelector(':scope > .mzta_prompt_title') : null;
    if (title) markManaged(title, state, title);
    if (!document.getElementById(container.id + '_managed_note')) {
        // "Each change is saved immediately" is no longer true: the note takes its place.
        const infoline = section ? section.querySelector(':scope > p.mzta_help') : null;
        if (infoline) infoline.style.display = 'none';
        const note = document.createElement('p');
        note.className = 'mzta_help';
        note.id = container.id + '_managed_note';
        note.textContent = browser.i18n.getMessage(resolved.accountIds.length > 0
            ? 'AccountSelector_managed_note' : 'AccountSelector_managed_none');
        container.before(note);
    }
    return true;
}

/**
 * The value a per-feature or per-prompt connection field is SEEDED with from its global
 * counterpart, when the prompt has no value of its own.
 *
 * A policy-supplied global value (locked or not) is never used as a seed: the seeded fields
 * are written into the prompt (_special_prompts, _custom_prompt) on the next save - on a
 * feature page even on page open - with no write guard, because they are prompt
 * properties, not preferences. A seeded policy value would therefore outlive the policy,
 * and a seeded API key would be MANAGED_SECRET_MARKER, i.e. garbage sent to the provider.
 * Such a field starts from prefs_default instead. With no policy this is exactly
 * prefs[key], as before.
 */
export function seedFromGlobal(prefs, key) {
    if (mztaManaged.hasManagedValue(key)) return prefs_default[key];
    return prefs[key];
}

/**
 * True when this special prompt's connection comes from the policy (_special_prompts_connection):
 * getSpecialPrompts() overlaid it and marked the prompt. Its api_type and fields are then the
 * administrator's, not the user's, and must not be copied anywhere - a feature page's page-open
 * block would otherwise store them as `${prefix}_*` preferences.
 */
export function isPolicyConnection(prompt) {
    return !!prompt && prompt._connection_by_policy === true;
}

/**
 * The mode of a feature's specific-integration panel ({prefix}_use_specific_integration plus
 * its connection), decided once, so initializeSpecificIntegrationUI() in connection-ui.js acts on
 * one answer instead of re-testing the policy at every site. Pure apart from reading the
 * hydrated policy: call it after a preference read.
 *
 *   kind          'locked_off'  the policy locks the switch off: the stored override is hidden
 *                               (applyLockedOffIntegrations()) and nothing writes the prompt;
 *                 'policy'      the policy supplies the connection (_special_prompts_connection):
 *                               the switch is locked on, unlocked fields are the user's to change;
 *                 'locked_on'   the policy locks the switch on and nothing more: the connection
 *                               is the user's, as without a policy;
 *                 'mandatory'   no policy on the switch, and the global connection cannot run the
 *                               feature (ChatGPT Web, or none chosen): forced on in the UI;
 *                 'free'        the user's switch, as without a policy.
 *   switchValue   the value a switch re-enabled by hand is put back to (true / false), or null
 *                 when the user may change it. Whenever the policy holds the switch, a change
 *                 must write nothing at all - not even the prompt, which no write guard covers;
 *   typeLocked    {prefix}_connection_type is locked: never written into the prompt;
 *   writesPrompt  the panel may write the prompt (_updatePrompt());
 *   seedsOnOpen   opening the page with the switch on writes the prompt and persists the shown
 *                 connection type (never for a policy connection: what it shows is the policy's);
 *   mandatory     the "mandatory" forcing, badge and persisting of the switch. Never under a
 *                 policy-held switch: the managed marker is the explanation, and the write
 *                 guard refuses the write anyway;
 *   mandatoryMsgKey  the note explaining why it is mandatory, or ''.
 *
 * An initial (":locked": false) {prefix}_use_specific_integration holds nothing: the mode is
 * 'mandatory' or 'free', as without a policy.
 */
export function resolveSpecificIntegrationMode(prefix, globalConnType) {
    const useKey = `${prefix}_use_specific_integration`;
    const switchLocked = mztaManaged.isManagedLocked(useKey);
    const typeLocked = mztaManaged.isManagedLocked(`${prefix}_connection_type`);
    let kind;
    if (switchLocked && mztaManaged.getManagedValue(useKey) === false) kind = 'locked_off';
    else if (mztaManaged.getSpecialPromptConnection(prefix) !== undefined) kind = 'policy';
    else if (switchLocked) kind = 'locked_on';
    else if (globalConnType === 'chatgpt_web' || hasNoConnectionSelected(globalConnType)) kind = 'mandatory';
    else kind = 'free';
    return {
        kind,
        switchValue: kind === 'locked_off' ? false : (kind === 'policy' || kind === 'locked_on') ? true : null,
        typeLocked,
        writesPrompt: kind !== 'locked_off',
        seedsOnOpen: kind !== 'locked_off' && kind !== 'policy',
        mandatory: kind === 'mandatory',
        mandatoryMsgKey: kind !== 'mandatory' ? ''
            : (globalConnType === 'chatgpt_web' ? 'specific_integration_mandatory_chatgpt_web'
                                                : 'specific_integration_mandatory_no_connection'),
    };
}

/** True when the value is the stand-in a settings page shows for a policy-supplied API key. */
export function isManagedSecret(value) {
    return value === MANAGED_SECRET_MARKER;
}

/**
 * Put a visible marker next to a managed control, so a disabled field reads as "your
 * organization set this" rather than as a bug.
 */
function markManaged(element, state, explicitAnchor = null) {
    // The row is the natural anchor on the options page and on every feature page, which
    // all lay their settings out as table rows; fall back to the control's own parent.
    const anchor = explicitAnchor || element.closest('td') || element.closest('label') ||
                   element.parentElement;
    if (!anchor) return;

    // A feature toggle is an <input> hidden inside <label class="mzta_switch">. Appending
    // the marker there would put it inside the switch, i.e. to the LEFT of the visible
    // track and inside the label's click target. Place it before the label instead, so the
    // row reads "... [Managed by Org] (toggle)" and the badge is not clickable.
    const switchLabel = element.closest('.mzta_switch');
    let target = switchLabel && switchLabel.parentElement ? switchLabel.parentElement : anchor;
    // A textarea block (prompt text, address lists) is a .mzta_field headed by a group title:
    // the badge goes right of that title rather than under the buttons.
    const groupTitle = groupTitleFor(target);
    if (groupTitle) target = groupTitle;
    // One marker per host, checked on its direct children only: a host can CONTAIN another
    // control's marker (a .mzta_field holding a nested switch row), and that one does not
    // say this control is locked.
    if (target.querySelector(':scope > .managed_marker')) return;

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
 * The title a .mzta_field is headed by: its own .opt_title_small (a section holding several
 * fields, like the summarize prompts), or else the section's .mzta_prompt_title when the field
 * is the only one in the section. null when there is no unambiguous title - a section title
 * over several fields would not say which one is locked.
 */
function groupTitleFor(field) {
    if (!field.classList.contains('mzta_field')) return null;
    const ownTitle = field.querySelector(':scope > .opt_title_small');
    if (ownTitle) return ownTitle;
    const section = field.parentElement;
    if (!section || !section.classList.contains('mzta_section')) return null;
    const sectionTitle = section.querySelector(':scope > .mzta_prompt_title');
    if (!sectionTitle) return null;
    if (section.querySelectorAll(':scope > .mzta_field').length !== 1) return null;
    return sectionTitle;
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
