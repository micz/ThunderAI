// Fixture of tests/ci: the parts of js/mzta-managed.js the policy surface report reads, the base
// revision.
const POLICY_ORG_NAME = '_org_name';
const POLICY_LOCK_UNLISTED = '_lock_unlisted';
const POLICY_OLD_SWITCH = '_old_switch';

const EXCLUDED_KEY_PATTERNS = [
    /^chatgpt_win_/,          // window geometry, per machine
];
const EXCLUDED_KEYS = new Set([
]);

export function isPolicyExcludedKey(key) {
    return EXCLUDED_KEYS.has(key) || EXCLUDED_KEY_PATTERNS.some(re => re.test(key));
}
