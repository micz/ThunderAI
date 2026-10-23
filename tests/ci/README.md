# Tests: CI tooling

Level-1 tests of the scripts the GitHub workflows run, when what they compute comes from a spec.
Today one: `.github/scripts/policy-keys-diff.mjs`, the report behind
`.github/workflows/policy-docs-issue.yml`, which opens or updates an issue on the site repository
when the enterprise policy surface changes
([`claude-spec/08-managed-configuration.md`](../../claude-spec/08-managed-configuration.md),
"Adding a policy-settable preference").

```sh
node --test "tests/ci/*.test.mjs"     # this area only, from the repository root
```

Nothing to install. The script is run as the workflow runs it, a child process with
`GITHUB_OUTPUT` set, and writes only to temporary directories.

| File | Covers |
|---|---|
| `01-policy-keys-diff` | the report on two revisions built from the fixtures: keys added (generated ones too, and excluded ones marked), removed, defaults changed, structural `_` keys, exclusion rules (comments and whitespace ignored), the no-change case (`changed=false`), a base without `js/mzta-managed.js`, an options file that no longer loads on its own |
| `02-excluded-key-source` | spec 08 "The allowlist": `isPolicyExcludedKey()` agrees with the allowlist on every key of the real `prefs_default` |

The fixtures, `fixtures/ci/base/` and `fixtures/ci/head/`, are cut-down copies of
`options/mzta-options-default.js` and `js/mzta-managed.js`, never the real files: each
difference between them is one case of the report. No plugin and, today, no known issues.
