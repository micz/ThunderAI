# ![ThunderAI icon](images/icon-32px.png "ThunderAI") ThunderAI

> Use ChatGPT, Google Gemini, Claude or Ollama to enhance your emails!

[![Thunderbird Add-ons](https://img.shields.io/badge/Thunderbird%20Add--ons-install-blue?logo=thunderbird)](https://addons.thunderbird.net/thunderbird/addon/thunderai/)
[![Thunderbird 140.0+](https://img.shields.io/badge/Thunderbird-140.0%2B-informational?logo=thunderbird)](https://www.thunderbird.net/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-green.svg)](LICENSE)

ThunderAI is a Thunderbird add-on that brings AI directly into your mailbox: analyse, write, correct, translate, summarize, tag and optimize your emails, and turn them into calendar events or tasks — without leaving Thunderbird.

You can connect it to a **cloud provider** (ChatGPT, OpenAI, Google Gemini, Claude) or keep everything **local** with Ollama or an OpenAI-compatible server.

You can also define, export and import your own **[custom prompts](https://micz.it/thunderbird-addon-thunderai/custom-prompts/)**, and use additional **[data placeholders](https://micz.it/thunderbird-addon-thunderai/data-placeholders/)** in any of them.

## Installation

Install ThunderAI from the [Thunderbird Add-on site](https://addons.thunderbird.net/thunderbird/addon/thunderai/), or download the last release from the [release page](https://github.com/micz/ThunderAI/releases).

**Requirements:** Thunderbird **140.0** or later.

On first run a **Setup Wizard** guides you through choosing an AI provider, testing the connection and enabling the automatic features — no manual configuration needed. You can launch it again at any time from the welcome page, the toolbar popup or the settings page.

## Features

### Email actions

| | Action | Description |
|---|---|---|
| ![](images/context_menu/prompt_reply.png) | **Reply** | Draft a reply to the selected email, with a simple or an advanced prompt, or with your own custom instruction |
| ![](images/context_menu/proofread.png) | **Proofread** | Correct grammar and spelling, then review the result in an **interactive change picker**: original and suggestion side by side, accept or reject each change, or edit manually |
| ![](images/context_menu/rewrite_polite.png) | **Rewrite** | Rewrite the selected text in a polite or a formal tone, preserving the HTML formatting |
| ![](images/context_menu/summarize.png) | **Summarize** | Summarize one or more emails, in the chat window or inline in the message pane |
| ![](images/context_menu/translate.png) | **Translate** | Translate an email or the selected text, in the chat window or inline |
| ![](images/context_menu/autotags.png) | **Add tags** | Let the AI suggest and assign Thunderbird tags |
| ![](images/context_menu/classify.png) | **Classify** | Classify an email according to your own criteria |
| ![](images/context_menu/getcalendarevent.png) | **Calendar event** | Extract an event from an email — or from the clipboard — with date, location and description |
| ![](images/context_menu/gettask.png) | **Task** | Extract a task from an email, with due date and description |
| ![](images/context_menu/prompt_this.png) | **Prompt this** | Send the email or the selected text to the AI with a free-form prompt |

> The **Calendar event** and **Task** actions also require the companion add-on [ThunderAI Sparks](https://addons.thunderbird.net/thunderbird/addon/thunderai-sparks/).

### Automatic features

Using an API integration, ThunderAI can work on incoming mail on its own:

| | Feature | Description |
|---|---|---|
| ![](images/context_menu/autotags.png) | **Auto-tagging** | Tag incoming emails automatically, with an exclusion list and an option for sent mail |
| ![](images/context_menu/spamfilter.png) | **Spam filter** | Move spam to the junk folder, with a per-message report and a consultable log |
| ![](images/context_menu/summarize.png) | **Auto-summarize** | Summarize on open, on receive or on demand, with caching and an optional list of senders/domains always summarized |
| ![](images/context_menu/translate.png) | **Auto-translate** | Translate incoming emails inline, with caching |

Drafts, templates, outbox and sent messages are skipped, so a draft is never processed while you are writing it.

### Customization

- **Custom prompts** — create, edit, export and import your own prompts, with `{%placeholder%}` highlighting, autocomplete and validation while you type
- **Custom data placeholders** — define your own reusable data tokens
- **Menu order** — drag and drop to choose which prompts appear in the popup and in the context menu, and in which order
- **Per-prompt integration** — any prompt can use a different AI provider and model than the global one
- **AI chat window** — conversation turns, the API and model in use, light/dark theme following Thunderbird, per-answer actions and thinking/reasoning blocks
- **Quick access** — search box in the popup and the `Ctrl+Alt+A` shortcut
- **Batch processing** — run a prompt on many emails, with a progress counter and a stop button
- **Many interface languages**, check [here](https://micz.it/thunderbird-addon-thunderai/translate/) the list

## Integrations

| Provider | API key | Notes |
|---|---|---|
| **ChatGPT Web** | not needed | Works with a free account: the prompt is sent through a ChatGPT window. Supports a specific model, a Project, a Custom GPT and temporary chats |
| **OpenAI API** | required | Model, developer messages, temperature and conversation storage. On reasoning models you can set the *reasoning summary* and the *effort*, and send extra JSON parameters with every request |
| **Google Gemini** | required | Model, temperature, *System Instructions* and *thinking budget* — leave the budget empty to let the model decide |
| **Claude API** | required | Model, system prompt, max tokens, extended thinking budget and *effort*. The request adapts to the selected model, so the options that a model rejects are disabled instead of failing. Requires the permission *"Access your data for sites in the https://anthropic.com domain"* |
| **Ollama** | not needed | Runs fully locally: model, context size, temperature, thinking and forced JSON output. The server must accept requests from the add-on, adding `OLLAMA_ORIGINS = moz-extension://*` to its environment variables — [more info about CORS](https://micz.it/thunderbird-addon-thunderai/ollama-cors-information/) |
| **OpenAI Compatible** | optional | Any OpenAI-compatible server, local or remote, such as LM Studio. Ready-made configurations for **DeepSeek**, **Grok**, **Mistral**, **OpenRouter** and **Perplexity**, or set the host by hand. The *"v1"* compatibility segment can be turned off, the model name typed manually when the server exposes no models list, and extra JSON parameters sent with every request |

## Documentation

- [ThunderAI home page](https://micz.it/thunderbird-addon-thunderai/) — features and guides
- [Setup Guides](https://micz.it/thunderbird-addon-thunderai/guides/) — step-by-step guides to connect ThunderAI to the AI backend of your choice, from ChatGPT to local models with Ollama
- [Custom Prompt Tutorial](https://micz.it/thunderbird-addon-thunderai/tutorial/) — learn how to build your first custom prompt from scratch, combining placeholders and user input to automate your email replies
- [ThunderAI Prompt Architect](https://chatgpt.com/g/g-69b6b11c89b88191a6798be6e97025f1-thunder-ai-prompt-architect) — let ChatGPT help you crafting your custom prompts. Thanks to [Paweł](https://github.com/PawelKinczyk) for this tool!
- [Changelog](CHANGELOG.md) — all of the changes of ThunderAI

## Contributing

- **Found a bug, or have an idea?** Open an issue using the [bug report or feature request templates](https://github.com/micz/ThunderAI/issues/new/choose).
- **Do you want to help translate this add-on?** [Find out how!](https://micz.it/thunderbird-addon-thunderai/translate/) Translations are managed on [Weblate](https://hosted.weblate.org/engage/thunderai/) — please do not edit the locale files directly, only `_locales/en/messages.json` is edited by hand.

## Privacy and Permissions

You can find all the information on [this page](https://micz.it/thunderbird-addon-thunderai/privacy-permissions/).

## Support this addon!

Are you using this addon in your Thunderbird?<br>
Consider to support the development making a small donation. [Click here!](https://www.paypal.com/donate/?business=UHN4SXPGEXWQL&no_recurring=1&item_name=Thunderbird+Addon+ThunderAI&currency_code=EUR)

## License

ThunderAI is released under the **GNU General Public License v3.0**. See [LICENSE](LICENSE) for the full text.

<h2 style="display:inline">Attributions</h2>

### Translations
- Brazilian Portuguese - Português Brasileiro (pt-br): Bruno Pereira de Souza, Generated automatically, [Bruno Scatolin](https://github.com/Brusca) <img src="https://micz.it/weblate/thunderai/pt-br.svg">
- Chinese (Simplified) - Jiǎntǐ Zhōngwén (简体中文) (zh_Hans): [jeklau](https://github.com/jeklau), [Min9X1n](https://github.com/Min9X1n) <img src="https://micz.it/weblate/thunderai/zh_Hans.svg">
- Chinese (Traditional) - Fántǐ Zhōngwén (繁體中文) (zh_Hant): [evez](https://github.com/evez) <img src="https://micz.it/weblate/thunderai/zh_Hant.svg">
- Croatian - Hrvatski (hr): Petar Jedvaj <img src="https://micz.it/weblate/thunderai/hr.svg">
- Czech - Čeština (cs): [Fjuro](https://hosted.weblate.org/user/Fjuro/), [Jaroslav Staněk](https://hosted.weblate.org/user/jaroush/) <img src="https://micz.it/weblate/thunderai/cs.svg">
- French - Français (fr): Generated automatically, [Noam](https://github.com/noam-sc) <img src="https://micz.it/weblate/thunderai/fr.svg">
- German - Deutsch (de): Generated automatically <img src="https://micz.it/weblate/thunderai/de.svg">
- Greek - Elliniká (Ελληνικά) (el): [ChristosK.](https://github.com/christoskaterini) <img src="https://micz.it/weblate/thunderai/el.svg">
- Hungarian - Magyar (hu): [Roland S](https://hosted.weblate.org/user/simaphonesave/) <img src="https://micz.it/weblate/thunderai/hu.svg">
- Indonesian - Bahasa Indonesia (id): [Arif Budiman](https://github.com/arifpedia) <img src="https://micz.it/weblate/thunderai/id.svg">
- Italian - Italiano (it): [Mic](https://github.com/micz) <img src="https://micz.it/weblate/thunderai/it.svg">
- Japanese - Nihongo (日本語) (ja): [Taichi Ito](https://github.com/watya1) <img src="https://micz.it/weblate/thunderai/ja.svg">
- Polish - Polski (pl): [neexpl](https://github.com/neexpl), [makkacprzak](https://github.com/makkacprzak), [Michał Stankiewicz](https://github.com/stankiewiczmichal), [LukaszJal](https://github.com/LukaszJal), Generated automatically <img src="https://micz.it/weblate/thunderai/pl.svg">
- Português - Portuguese (pt): [Silvério Santos](https://github.com/SantosSi), [Afonso Nóbrega](https://hosted.weblate.org/user/nobrega8/)</a>, [Antonio Lucena de Faria](https://hosted.weblate.org/user/alucenafaria/), <img src="https://micz.it/weblate/thunderai/pt.svg">
- Russian - Russkiy (русский) (ru): [Maksim](https://hosted.weblate.org/user/law820314/) <img src="https://micz.it/weblate/thunderai/ru.svg">
- Spanish - Español (es): [Gerardo Sobarzo](https://hosted.weblate.org/user/gerardo.sobarzo/), [Andrés Rendón Hernández](https://hosted.weblate.org/user/arendon/), [Erick Limon](https://hosted.weblate.org/user/ErickLimonG/) <img src="https://micz.it/weblate/thunderai/es.svg">
- Swedish - Svenska (sv): [Andreas Pettersson](https://hosted.weblate.org/user/Andy_tb/), [Luna Jernberg](https://hosted.weblate.org/user/bittin1ddc447d824349b2/) <img src="https://micz.it/weblate/thunderai/sv.svg">
<br>

Do you want to help translate this addon? [Find out how!](https://micz.it/thunderbird-addon-thunderai/translate/)<br>
_The language status represents the percentage of translated strings in the latest stable release._


<br>

### Graphics
- ChatGPT-4 for the help with the addon icon ;-)
- <a href="https://loading.io">loading.io</a> for the loading SVGs
- [Fluent Design System](https://www.iconfinder.com/fluent-designsystem) for the Custom Prompts table sorting icons
- [JessiGue](https://www.flaticon.com/authors/jessigue) for the show/hide icon for api key fields
- [Iconka.com](https://www.iconarchive.com/artist/iconka.html) for various context menu icons
- [Icojam](https://www.iconarchive.com/artist/icojam.html) for various context menu icons
- [Roundicons](https://www.flaticon.com/authors/roundicons) for the summarize context menu icon
- [HideMau](https://www.flaticon.com/authors/hidemaru) for the ai summarize icon
- [Hilmy Abiyyu A.](https://www.flaticon.com/authors/hilmy-abiyyu-a) for various context menu icons
- [bearicons](https://www.flaticon.com/authors/bearicons) for the empty context menu icon
- [meaicon](https://www.flaticon.com/authors/meaicon) for the add task context menu icon


<br>


### Miscellaneous
- <a href="https://github.com/KudoAI/chatgpt.js">chatgpt.js</a> for providing methods to interact with the ChatGPT web frontend
- <a href="https://github.com/boxabirds">Julian Harris</a> for his project <a href="https://github.com/boxabirds/chatgpt-frontend-nobuild">chatgpt-frontend-nobuild</a>, that has been used as a starting point for the API Web Interface
- <a href="https://hosted.weblate.org/widgets/thunderai/">Hosted Weblate</a> for managing the localization
