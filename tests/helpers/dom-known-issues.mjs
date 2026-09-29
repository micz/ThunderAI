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

export const REASONS = {
    connTypeRestoredFromPrompt:
        'potential bug - spec 08 "UI" ("an input restored from mztaPrefs already holds the enforced or '
        + 'initial value by the time applyManagedUI() disables it"): restoreOptions() on the feature page '
        + 'overwrites the resolved {prefix}_connection_type with the api_type of the special prompt, or with a '
        + 'seed from the global connection, so a locked policy value is never shown',
    displayModeForcedByAuto:
        'policy conflict, not necessarily a bug - the sweep locks summarize_auto to "3" and '
        + 'summarize_display_mode to "webchat"; updateDisplayModeConstraint() shows (and tries to store) '
        + '"inline", the only mode auto-summarize supports. Spec 08 does not say what a contradictory '
        + 'policy shows',
};

const featureConnType = prefix => ({
    locked: { [prefix + '_connection_type']: { value: REASONS.connTypeRestoredFromPrompt } },
});

export const KNOWN = {
    'spamfilter': featureConnType('spamfilter'),
    'addtags': featureConnType('add_tags'),
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
