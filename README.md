# ![ThunderAI icon](images/icon-32px.png "ThunderAI") ThunderAI

ThunderAI is a Thunderbird Addon that uses the capabilities of ChatGPT, Google Gemini, Claude or Ollama to enhance email management.

It enables users to analyse, write, correct, assign tags, create calendar events or tasks and optimize their emails, facilitating more effective and professional communication.

ThunderAI is a tool for anyone looking to improve their email quality, both in content and grammar, making the writing process quicker and more intuitive. 

You can also define, export and import your own **[custom prompts](https://micz.it/thunderbird-addon-thunderai/custom-prompts/)**!

In any custom prompt you can use additional **[data placeholders](https://micz.it/thunderbird-addon-thunderai/data-placeholders/)**!

Using an API integration, you can activate some automatic features:
- Tagging incoming emails
- Moving spam emails to the junk folder

<br>


> [!NOTE]
> **Available Integrations**
> - **ChatGPT Web**
>   - There is no need for an API key!
>   - You can use a free account!
>
> <br>
>
> - **OpenAI API**
>   - Connect directly to ChatGPT using your API key.
>
> <br>
> 
> - **Google Gemini**
>   - You can use also the _System Instructions_ and _thinkingBudget_ options if needed.
> 
> 
> <br>
> 
> - **Claude API**
>   - You need to grant the permission "_Access your data for sites in the https://anthropic.com domain_" to use the Claude API.
>
>
> <br>
> 
> - **Using Ollama**
>   - Just remember to add `OLLAMA_ORIGINS = moz-extension://*` to the Ollama server environment variables.
>   - [More info about CORS](https://micz.it/thunderbird-addon-thunderai/ollama-cors-information/)
>
> <br>
> 
> - **OpenAI Compatible API**
>   - You can also use a local OpenAI Compatible API server, like LM Studio or Mistral AI!
>   - There is also an option to remove the "v1" segment from the API url, if needed, and to manually set the model name if the server doesn't have a models list endpoint.



<br>

## Translations
Do you want to help translate this addon?

[Find out how!](https://micz.it/thunderbird-addon-thunderai/translate/)

<br>

## Changelog
ThunderAI's changes are logged [here](CHANGELOG.md).

<br>

## Privacy and Permissions
You can find all the information on [this page](https://micz.it/thunderbird-addon-thunderai/privacy-permissions/).

<br>

## Support this addon!
Are you using this addon in your Thunderbird?
<br>Consider to support the development making a small donation. [Click here!](https://www.paypal.com/donate/?business=UHN4SXPGEXWQL&no_recurring=1&item_name=Thunderbird+Addon+ThunderAI&currency_code=EUR)

<br>

## Attributions

### Translations
- Chinese (Simplified) (zh_Hans): [jeklau](https://github.com/jeklau) <img src="https://micz.it/weblate/thunderai/zh_Hans.svg">
- Chinese (Traditional) (zh_Hant): [evez](https://github.com/evez) <img src="https://micz.it/weblate/thunderai/zh_Hant.svg">
- Croatian (hr): Petar Jedvaj <img src="https://micz.it/weblate/thunderai/hr.svg">
- Czech (cs): [Fjuro](https://hosted.weblate.org/user/Fjuro/), [Jaroslav Staněk](https://hosted.weblate.org/user/jaroush/) <img src="https://micz.it/weblate/thunderai/cs.svg">
- French (fr): Generated automatically, [Noam](https://github.com/noam-sc) <img src="https://micz.it/weblate/thunderai/fr.svg">
- German (de): Generated automatically <img src="https://micz.it/weblate/thunderai/de.svg">
- Greek (el): [ChristosK.](https://github.com/christoskaterini) <img src="https://micz.it/weblate/thunderai/el.svg">
- Italian (it): [Mic](https://github.com/micz) <img src="https://micz.it/weblate/thunderai/it.svg">
- Japanese (ja): [Taichi Ito](https://github.com/watya1) <img src="https://micz.it/weblate/thunderai/ja.svg">
- Polski (pl): [neexpl](https://github.com/neexpl), [makkacprzak](https://github.com/makkacprzak) <img src="https://micz.it/weblate/thunderai/pl.svg">
- Português Brasileiro (pt-br): Bruno Pereira de Souza <img src="https://micz.it/weblate/thunderai/pt-br.svg">
- Russian (ru): [Maksim](https://hosted.weblate.org/user/law820314/) <img src="https://micz.it/weblate/thunderai/ru.svg">
- Spanish (es): [Gerardo Sobarzo](https://hosted.weblate.org/user/gerardo.sobarzo/), [Andrés Rendón Hernández](https://hosted.weblate.org/user/arendon/), [Erick Limon](https://hosted.weblate.org/user/ErickLimonG/) <img src="https://micz.it/weblate/thunderai/es.svg">
- Swedish (sv): [Andreas Pettersson](https://hosted.weblate.org/user/Andy_tb/) <img src="https://micz.it/weblate/thunderai/sv.svg">
<br>

Do you want to help translate this addon? [Find out how!](https://micz.it/thunderbird-addon-thunderai/translate/)  <br>
_The language status represents the percentage of translated strings in the latest stable release._


<br>

### Graphics
- ChatGPT-4 for the help with the addon icon ;-)
- <a href="https://loading.io">loading.io</a> for the loading SVGs
- [Fluent Design System](https://www.iconfinder.com/fluent-designsystem) for the Custom Prompts table sorting icons
- [JessiGue](https://www.flaticon.com/authors/jessigue) for the show/hide icon for api key fields
- [Iconka.com](https://www.iconarchive.com/artist/iconka.html) for the autotag context menu icon
- [Icojam](https://www.iconarchive.com/artist/icojam.html) for the spam filter context menu icon


<br>


### Miscellaneous
- <a href="https://github.com/KudoAI/chatgpt.js">chatgpt.js</a> for providing methods to interact with the ChatGPT web frontend
- <a href="https://github.com/boxabirds">Julian Harris</a> for his project <a href="https://github.com/boxabirds/chatgpt-frontend-nobuild">chatgpt-frontend-nobuild</a>, that has been used as a starting point for the API Web Interface
- <a href="https://hosted.weblate.org/widgets/thunderai/">Hosted Weblate</a> for managing the localization
