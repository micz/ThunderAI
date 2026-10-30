# Contributing to ThunderAI

Thank you for your interest in contributing to ThunderAI!
This page explains how to report issues, help with translations and open pull requests.

## Reporting bugs and requesting features

Please open an issue using the [bug report or feature request templates](https://github.com/micz/ThunderAI/issues/new/choose).
Before opening a new issue, check whether a similar one already exists.

## Translations

Translations are managed on [Weblate](https://hosted.weblate.org/engage/thunderai/).
Please **do not edit the locale files directly**: the only file edited by hand is `_locales/en/messages.json`.
If your change adds or modifies user-facing strings, update only the English file; the other languages will be updated through Weblate.

More information: [How to translate ThunderAI](https://micz.it/thunderbird-addon-thunderai/translate/).

## Release notes and changelog

Please **do not edit `CHANGELOG.md`**: it is generated automatically from the release notes and committed by a GitHub workflow.
If your change needs to be mentioned in the release notes, edit only `options/mzta-release-notes.html`.

## New AI providers and presets

ThunderAI sends the content of your emails to the AI provider you choose, so new integrations and new ready-made configurations are added with care.

**Any OpenAI-compatible service can already be used without changing the code**: choose the *custom* configuration in the OpenAI Compatible API settings and set the host of the service, turning the *"v1"* segment on or off as needed. A pull request is not needed to use a service with ThunderAI.

The ready-made configurations (presets) are a short list of widely used providers and are not a directory of every compatible service. A new preset can be considered when the provider:

- is widely used and well known independently of the pull request;
- has a public privacy policy and terms of service that apply to its API;
- exposes a stable API that follows the OpenAI Chat Completions format.

Please **open an issue before writing the code** for a new preset or a new integration, so that it can be discussed first. A pull request adding a provider must be tested in Thunderbird with that provider, not only with the automated tests.

If you work for, or are affiliated with, the provider you are proposing, please say so in the issue. Requests from providers to add their own service are generally not accepted, unless the provider is already widely used.

A preset can be removed if the service stops working, changes its API in an incompatible way, or no longer meets these criteria.

## Branches

| Branch | Purpose |
| ------ | ------- |
| `main` | Released code. It always matches the latest version published on [addons.thunderbird.net](https://addons.thunderbird.net/thunderbird/addon/thunderai/). |
| `dev`  | Ongoing development. The next release is built from here. |

### Which branch should my pull request target?

**Target `dev`** for almost everything: new features, improvements, refactoring, documentation and non-urgent bug fixes.

**Target `main` only for urgent bug fixes** to the released version, for example:

- a crash or a feature that is completely broken;
- a regression introduced by the latest release;
- a problem caused by a change in a provider API (OpenAI, Gemini, Claude, Ollama…) that makes an integration stop working;
- a security issue.

If you are not sure, target `dev` and explain the urgency in the pull request: the fix can still be moved to `main` if needed.

> Pull requests opened on `main` are automatically retargeted to `dev`, unless the source branch name starts with `hotfix/`.
> For an urgent fix, name your branch like `hotfix/short-description`.

## Opening a pull request

1. Fork the repository and create your branch:
   - from `dev` for regular changes: `git switch -c my-feature origin/dev`
   - from `main` for urgent fixes: `git switch -c hotfix/short-description origin/main`
2. Keep the pull request focused on a single change. Smaller pull requests are reviewed faster.
3. Test your change in Thunderbird (see below).
4. Open the pull request against the correct branch and fill in the template.

If GitHub reports conflicts, please update your branch by merging or rebasing the target branch into it.

### Testing your change

ThunderAI requires **Thunderbird 140.0 or later**.

To load your local copy without packaging it:

1. In Thunderbird, open *Tools → Developer Tools → Debug Add-ons*.
2. Click *Load Temporary Add-on…* and select the `manifest.json` file in your working copy.
3. Use *Reload* after each change.

If your change affects a specific integration, please mention in the pull request which providers and models you tested it with.

## License

ThunderAI is released under the [GNU General Public License v3.0](LICENSE).
By contributing, you agree that your contributions will be licensed under the same license.
