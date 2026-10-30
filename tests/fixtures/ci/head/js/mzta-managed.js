// Fixture of tests/ci: the parts of js/mzta-managed.js the policy surface report reads, the head
// revision. Against the base: _new_switch added, _old_switch removed, a key added to EXCLUDED_KEYS.
const POLICY_ORG_NAME = '_org_name';
const POLICY_LOCK_UNLISTED = '_lock_unlisted';
const POLICY_NEW_SWITCH = '_new_switch';

const EXCLUDED_KEY_PATTERNS = [
    /^chatgpt_win_/,          // window geometry, per machine
];
const EXCLUDED_KEYS = new Set([
    'api_webchat_font_scale', // local UI zoom
]);

export function isPolicyExcludedKey(key) {
    return EXCLUDED_KEYS.has(key) || EXCLUDED_KEY_PATTERNS.some(re => re.test(key));
}
