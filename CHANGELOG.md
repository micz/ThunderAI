 # ![ThunderAI icon](images/icon-32px.png "ThunderAI") ThunderAI Release Notes




<h2>Version 2.0.5 - 19/08/2024</h2>
  <ul>
    <li><i>[ChatGPT Web]</i> Modified the permissions for the ChatGPT web interface, now requiring only the <code>https://*.chatgpt.com/*</code> and not all sites.</li>
    <li><i>[ChatGPT Web]</i> Fixed a problem loading the web interface on Thunderbird 115 under some circumstances.</li>
  </ul>
<h2>Version 2.0.4 - 16/08/2024</h2>
      <ul>
        <li><i>[ChatGPT API]</i> Fixed the vertical scroolbar with long reponses [<a href="https://github.com/micz/ThunderAI/issues/108">#108</a>].</li>
      </ul>
<h2>Version 2.0.3 - 15/08/2024</h2>
      <ul>
        <li><i>[ChatGPT API]</i> Fixed a loading bug in Thunderbird 128+ [<a href="https://github.com/micz/ThunderAI/issues/107">#107</a>].</li>
      </ul>
<h2>Version 2.0.2 - 15/08/2024</h2>
<ul>
  <li><i>[ChatGPT Web]</i> Now, the ChatGPT response must be selected by the user to be retrieved by ThunderAI. A single click on the text should work, but it's also possible to select the text manually [<a href="https://github.com/micz/ThunderAI/issues/104">#104</a>].</li>
  <li>Added a better error message when there is an error fetching models.</li>
  <li>When selecting a correct model in the options page, the field is no more highlighted in red [<a href="https://github.com/micz/ThunderAI/issues/100">#100</a>].</li>
  <li>When using the ChatGPT API, the double quotes at the beginning and end of the response are removed [<a href="https://github.com/micz/ThunderAI/issues/99">#99</a>].</li>
  <li><i>[ChatGPT Web]</i>"Keep formatting" option removed.</li>
</ul>
<h2>Version 2.0.1 - 09/08/2024</h2>
      <ul>
        <li><i>[ChatGPT Web]</i> No more notifying a missing API Key or model when using the web interface.</li>
      </ul>
<h2>Version 2.0.0 - 30/07/2024</h2>
      <ul>
        <li>Added OpenAI ChatGPT API connection [<a href="https://github.com/micz/ThunderAI/issues/40">#40</a>].</li>
        <li>Information text in the options page improved.</li>
      </ul>
<h2>Version 1.2.1 - 20/07/2024</h2>
      <ul>
        <li>Fixed changes in the ChatGPT web interface when importing in plain text [<a href="https://github.com/micz/ThunderAI/issues/87">#87</a>].</li>
        <li>Added an option to the prompts to specify the default language for the response [<a href="https://github.com/micz/ThunderAI/issues/86">#86</a>].</li>
        <li>Not adding to the prompt the statement about using the default language if asking for a translation [<a href="https://github.com/micz/ThunderAI/issues/85">#85</a>].</li>
        <li><i>[Thunderbird 128+ only]</i> Added a warning message when closing the Custom Prompts page with unsaved changes [<a href="https://github.com/micz/ThunderAI/issues/88">#88</a>].</li>
      </ul>
<h2>Version 1.2.0 - 17/07/2024</h2>
    <ul>
      <li>If no default language is set in the options, the language present in the text sent to ChatGPT will be used [<a href="https://github.com/micz/ThunderAI/issues/53">#53</a>].</li>
        <li>Added the functionality to import and export custom prompts [<a href="https://github.com/micz/ThunderAI/issues/65">#65</a>].</li>
        <li>Showing the currently used prompt name in the ChatGPT window [<a href="https://github.com/micz/ThunderAI/issues/20">#20</a>].</li>
    </ul>
<h2>Version 1.1.4 - 28/06/2024</h2>
    <ul>
        <li>Added an option to import text with formatting from ChatGPT, set to false by default [<a href="https://github.com/micz/ThunderAI/issues/70">#70</a>], [<a href="https://github.com/micz/ThunderAI/issues/77">#77</a>].</li>
        <li>Improve the message warning to choose the right model [<a href="https://github.com/micz/ThunderAI/issues/76">#76</a>].</li>
        <li>Added a description in the Custom Prompts page about default prompts [<a href="https://github.com/micz/ThunderAI/issues/74">#74</a>].</li>
        <li>Added a link to the <a href="https://micz.it/thunderbird-addon-thunderai/translate/">translate page</a> in the options window [<a href="https://github.com/micz/ThunderAI/issues/68">#68</a>].</li>
      </ul>

<h2>Version 1.1.3 - 18/06/2024</h2>
  <ul>
    <li>Fixed a bug in replying to a message [<a href="https://github.com/micz/ThunderAI/issues/71">#71</a>].</li>
  </ul>

<h2>Version 1.1.2 - 23/05/2024</h2>
  <ul>
    <li>Minor improvements.</li>
  </ul>


<h2>Version 1.1.1 - 22/05/2024</h2>
  <ul>
    <li>Improved handling of CSS in the ChatGPT web interface.</li>
  </ul>

<h2>Version 1.1.0 - 21/05/2024</h2>
  <ul>
    <li>A prompt can be configured to request additional text from the user.</li>
    <li>Added custom prompts. See more info <a href="https://micz.it/thunderbird-addon-thunderai/custom-prompts/">here</a>.</li>
    <li>Dark mode added.</li>
    <li>Added some error messages to handle potential changes in the ChatGPT web interface.</li>
    <li>German translation added.</li>
    <li>French translation added.</li>
    <li>Log messages improved.</li>
  </ul>

<h2>Version 1.0.10 - 17/05/2024</h2>
  <ul>
    <li>Now using the new URL chatgpt.com.</li>
    <li>More improvements in handling the ChatGPT web interface.</li>
  </ul>

<h2>Version 1.0.9 - 16/05/2024</h2>
  <ul>
    <li>Improved handling of different versions of the ChatGPT web interface.</li>
  </ul>

<h2>Version 1.0.8 - 15/05/2024</h2>
  <ul>
    <li>Fixed changes in the ChatGPT web interface [<a href="https://github.com/micz/ThunderAI/issues/57">#57</a>, <a href="https://github.com/micz/ThunderAI/issues/62">#62</a>].</li>
    <li>Correctly handling the model ChatGPT-4o.</li>
  </ul>

<h2>Version 1.0.7 - 09/05/2024</h2>
<ul>
  <li>Improved the reply prompt to exclude comments and other text beside the mail text.</li>
  <li>Correctly keeping the signature in a reply even if it's above the quoted email [<a href="https://github.com/micz/ThunderAI/issues/45">#45</a>].</li>
</ul>

<h2>Version 1.0.6 - 08/05/2024</h2>
<ul>
  <li>Correctly handling a change in the ChatGPT web interface [<a href="https://github.com/micz/ThunderAI/issues/43">#43</a>].</li>
  <li>Added a button to force the completion to display the 'Use last answer' button if ChatGPT has finished its work but the button has not appeared.</li>
</ul>

<h2>Version 1.0.5 - 03/05/2024</h2>
<ul>
  <li>Fixed the handling of ChatGPT-4 in a large window [<a href="https://github.com/micz/ThunderAI/issues/38">#38</a>].</li>
</ul>

<h2>Version 1.0.4 - 01/05/2024</h2>
<ul>
  <li>Stripping the quotation marks from the response.</li>
  <li>Now it is possible to undo text modifications implemented by ChatGPT (CTRL+Z on Windows) [<a href="https://github.com/micz/ThunderAI/issues/34">#34</a>].</li>
  <li>Now closing the compose window after unsaved text modifications implemented by ChatGPT triggers the usual warning message [<a href="https://github.com/micz/ThunderAI/issues/30">#30</a>].</li>
  <li>Updated the "Important Information" section on the options page, as it is no longer possible to disable the ChatGPT chat history.</li>
</ul>

<h2>Version 1.0.3 - 27/04/2024</h2>
<ul>
  <li>Using the right identity when replying to a message [<a href="https://github.com/micz/ThunderAI/issues/31">#31</a>].</li>
</ul>

<h2>Version 1.0.2 - 18/04/2024</h2>
<ul>
  <li>New standard menus.</li>
  <li>Fixed a bug in importing replies text.</li>
  <li>Fixed the handling of the new change model button in the ChatGPT interface.</li>
  <li>Added an option to choose between GPT-3.5 and GPT-4 Models [<a href="https://github.com/micz/ThunderAI/issues/27">#27</a>].</li>
  <li>Added a link to the <a href="https://micz.it/thunderbird-addon-thunderai/status/">Status Page</a>, to check if there are known issues in interacting with the ChatGPT web interface.</li>
</ul>

<h2>Version 1.0.1 - 13/04/2024</h2>
<ul>
  <li>Italian addon description fixed.</li>
  <li>Improved the method to open the ChatGPT window. Thanks to <a href="https://github.com/jobisoft">John Bieling</a>.</li>
  <li>Fixed a bug in replying to a message. Now the quoted text is correctly displayed.</li>
  <li>Fixed a bug in the compose window. Now is correctly used only the selected text.</li>
  <li>If the prompt is more than 30.000 characters, do not proceed and give a message to the user.</li>
</ul>

<h2>Version 1.0 - 05/04/2024</h2>
<ul>
  <li>First release.</li>
</ul>
