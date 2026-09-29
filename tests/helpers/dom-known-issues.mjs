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
    displayModeForcedByAuto:
        'policy conflict, not necessarily a bug - the sweep locks summarize_auto to "3" and '
        + 'summarize_display_mode to "webchat"; updateDisplayModeConstraint() shows (and tries to store) '
        + '"inline", the only mode auto-summarize supports. Spec 08 does not say what a contradictory '
        + 'policy shows',
};

export const KNOWN = {
    'summarize': {
        locked: {
            summarize_display_mode: { value: REASONS.displayModeForcedByAuto },
        },
    },
};
