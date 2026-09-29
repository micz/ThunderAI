/*
 * A policy naming EVERY key of prefs_default, each with its own default value (so each
 * passes the type check). Built rather than stored, because it must follow prefs_default.
 * The two account matchers get a non-empty value: an empty one means "not managed" and is
 * not recorded, which would hide whether the key is on the allowlist.
 */
export function buildEveryKeyPolicy(prefs_default) {
    const policy = {};
    for (const [key, value] of Object.entries(prefs_default)) {
        policy[key] = /_enabled_accounts_match$/.test(key) ? ['local'] : value;
    }
    return policy;
}
