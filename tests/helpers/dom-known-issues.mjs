/*
 *  Potential bugs found by the DOM tests: assertions that contradict spec 08 against the
 *  shipped code as it is. The tests are NOT changed to pass, and neither is the source: each
 *  failing assertion is run as a node:test TODO carrying the reason below, so it shows up in
 *  every run ("# TODO") without turning CI red, until the maintainer fixes the code or rules
 *  the behaviour correct (and then updates the spec).
 *
 *  Remove an entry as soon as its test passes: node:test reports a passing TODO too.
 *
 *  Shape, for the sweeps: { page: { locked: {key: {aspect: reason}}, unlocked: {...} } }.
 *  Other test files import the named reasons directly.
 */

const INERTNESS = 'spec 08 "Marker placement and inertness" (page logic must go through setDisabledRespectingManaged())';

export const REASONS = {
    connTypeRestoredFromPrompt:
        'potential bug - spec 08 "UI" ("an input restored from mztaPrefs already holds the enforced or '
        + 'initial value by the time applyManagedUI() disables it"): the feature page\'s restoreOptions() '
        + 'overwrites the resolved {prefix}_connection_type with the special prompt\'s api_type, or with a '
        + 'seed from the global connection, so a locked policy value is never shown',
    effortRestoredBeforeOptions:
        'potential bug - spec 08 "UI": restoreOptions() runs while the anthropic_effort <select> has no '
        + '<option> yet (updateAnthropicModelCapabilityUI() builds them later and keeps the then-empty '
        + 'value), so neither an enforced nor a stored value is ever shown. Not policy-specific',
    effortNeverPopulatedInWizard:
        'potential bug - spec 08 "The setup wizard" / "UI": the wizard never calls '
        + 'updateAnthropicModelCapabilityUI(), so the anthropic_effort <select> has no <option> at all '
        + 'and cannot show an enforced (or any) value. Not policy-specific',
    effortReenabled:
        'potential bug - ' + INERTNESS + ': updateAnthropicModelCapabilityUI() in '
        + 'pages/_lib/connection-ui.js assigns field.disabled = !supported after applyManagedUI(), '
        + 're-enabling a locked anthropic_effort (and anthropic_temperature / '
        + 'anthropic_extended_thinking_budget whenever the selected model supports them)',
    uselistReenabled:
        'potential bug - ' + INERTNESS + ': pages/addtags/mzta-add-tags.js assigns '
        + 'add_tags_auto_uselist_list.disabled = !add_tags_auto_uselist.checked after applyManagedUI(), '
        + 're-enabling the locked textarea whenever the toggle is on',
    uselistNoMarker:
        'potential bug - spec 08 "Marker placement and inertness" (.mzta_field fallback): markManaged() '
        + 'skips a host holding a .managed_marker ANYWHERE inside it (querySelector, not ":scope >"); '
        + 'this field already contains the nested add_tags_auto_uselist toggle\'s marker, so the locked '
        + 'textarea gets no marker of its own',
    displayModeForcedByAuto:
        'policy conflict, not necessarily a bug - the sweep locks summarize_auto to "3" and '
        + 'summarize_display_mode to "webchat"; updateDisplayModeConstraint() shows (and tries to store) '
        + '"inline", the only mode auto-summarize supports. Spec 08 does not say what a contradictory '
        + 'policy shows. The re-enabling half of that function is a real bug: see 04-respect-managed',
    lockedFeatureShownOff:
        'potential bug - spec 08 "Interaction points" (_reconcileFeatureFlags(): "A policy-enabled '
        + 'feature with an unusable connection stays on") and "UI" (a locked control shows the policy '
        + 'value): disable_ApiFeature() in options/mzta-options.js assigns checkbox.checked = false '
        + 'whenever no connection is selected, a locked toggle included, so the options page shows the '
        + 'feature switched off (the setPref(prefix, false) it then attempts is refused by the guard)',
    fetchEnabledByHostCheck:
        'potential bug - spec 08 "Policy-supplied API keys" ("the empty-key warnings keep the fetch '
        + 'button disabled"): warn_OpenAIComp_HostEmpty() in pages/_lib/connection-ui.js enables '
        + 'btnUpdateOpenAICompModels whenever the host is set, without checking the key for '
        + 'MANAGED_SECRET_MARKER. The click handler still refuses the marker',
    fetchEnabledByVersionCheck:
        'potential bug - spec 08 "Policy-supplied API keys" ("the empty-key warnings keep the fetch '
        + 'button disabled"): warn_Anthropic_VersionEmpty() runs after warn_Anthropic_APIKeyEmpty() '
        + 'and enables btnUpdateAnthropicModels whenever the version is set, undoing the marker check. '
        + 'The click handler still refuses the marker',
    lockedModelClearedOnEmptyCredential:
        'potential bug - spec 08 "Locked model selects" (toggleTomSelectDisabled() "disables it without '
        + 'clear(), so the enforced model stays shown"): with an empty key/host/version, the warn_*Empty() '
        + 'branch calls toggleTomSelectDisabled(select, true), which still runs tomselect.clear() for a '
        + 'managed model, and then sets select.selectedIndex = -1: the enforced model disappears and does '
        + 'not come back when the credential is typed again',
    displayModeReenabled:
        'potential bug - ' + INERTNESS + ': updateDisplayModeConstraint() in '
        + 'pages/summarize/mzta-summarize.js assigns display_mode_el.disabled = false on every '
        + 'summarize_auto change to "1", re-enabling a locked summarize_display_mode',
};

const featureConnType = prefix => ({
    locked: { [prefix + '_connection_type']: { value: REASONS.connTypeRestoredFromPrompt } },
});

export const KNOWN = {
    'options': {
        locked: { anthropic_effort: { value: REASONS.effortRestoredBeforeOptions, disabled: REASONS.effortReenabled } },
    },
    'setup-wizard': {
        locked: { anthropic_effort: { value: REASONS.effortNeverPopulatedInWizard } },
    },
    'spamfilter': featureConnType('spamfilter'),
    'addtags': {
        locked: {
            add_tags_connection_type: { value: REASONS.connTypeRestoredFromPrompt },
            add_tags_auto_uselist_list: { disabled: REASONS.uselistReenabled, marker: REASONS.uselistNoMarker },
        },
    },
    'summarize': {
        locked: {
            summarize_connection_type: { value: REASONS.connTypeRestoredFromPrompt },
            summarize_display_mode: { value: REASONS.displayModeForcedByAuto },
        },
    },
    'translate': featureConnType('translate'),
    'get-calendar-event': featureConnType('get_calendar_event'),
    'get-task': featureConnType('get_task'),
};
