/*
 * A policy naming EVERY key of prefs_default, each with its own default value (so each
 * passes the type check). Built rather than stored, because it must follow prefs_default.
 * The two account matchers get a non-empty value: an empty one means "not managed" and is
 * not recorded, which would hide whether the key is on the allowlist.
 *
 * A default that is the "nothing set yet" state rather than a usable value - connection_type
 * '' (no connection), an empty host or model - is refused by the content rules of the
 * validation (spec 08 "Validation"), so those keys get a usable value instead: this fixture is
 * about the allowlist, not about what a key may hold.
 */
export function buildEveryKeyPolicy(prefs_default) {
    const policy = {};
    for (const [key, value] of Object.entries(prefs_default)) {
        if (/_enabled_accounts_match$/.test(key)) policy[key] = ['local'];
        else if (key === 'connection_type') policy[key] = 'chatgpt_api';
        else if (/_host$/.test(key) && value === '') policy[key] = 'https://ai.example.org';
        else if (/_model$/.test(key) && value === '' && key !== 'chatgpt_web_model') policy[key] = 'model-x';
        else policy[key] = value;
    }
    return policy;
}
