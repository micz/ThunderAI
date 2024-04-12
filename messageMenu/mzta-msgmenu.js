// Modified version derived from https://github.com/ali-raheem/Aify/blob/cfadf52f576b7be3720b5b73af7c8d3129c054da/plugin/html/actions.js

import { defaultPrompts } from '../js/mzta-prompts.js';
import { getLanguageDisplayName } from '../js/mzta-utils.js'

const addAction = (curr_prompt, promptsContainer) => {
    const promptDiv = document.createElement("div");
    promptDiv.classList.add("button");
    const nameInput = document.createElement("p");
    nameInput.classList.add("flat");
    nameInput.innerText = curr_prompt.name;
    nameInput.classList.add("prompt-name");

    const getHighlight = async () => {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        return {tabId: tabs[0].id, 
            selection: await browser.tabs.sendMessage(tabs[0].id, { command: "getSelectedText" }),
            text: await browser.tabs.sendMessage(tabs[0].id, { command: "getTextOnly" })
        };
    };

    nameInput.onclick = async () => {
        const msg_text = await getHighlight();

        //check if a selection is needed
        if(curr_prompt.need_selected && (msg_text.selection==='')){
            //A selection is needed, but nothing is selected!
            alert(browser.i18n.getMessage('prompt_selection_needed'));
            return;
        }

        var body_text = '';
        if (msg_text.selection!=='') {
            body_text = msg_text.selection.replace(/\s+/g, ' ').trim();
        } else {
            body_text = msg_text.text.replace(/\s+/g, ' ').trim();
        }
        //open chatgpt window
        //console.log("Click menu item...");
        let prefs = await browser.storage.sync.get({default_chatgpt_lang: getLanguageDisplayName(browser.i18n.getUILanguage())});
        let chatgpt_lang = prefs.default_chatgpt_lang;

        var fullPrompt = fullPrompt = curr_prompt.text + (curr_prompt.need_signature ? " " + await getDefaultSignature():"") + " " + browser.i18n.getMessage("prompt_lang") + chatgpt_lang + ". \"" + msg_text.text + "\" ";

        switch(curr_prompt.id){
            case 'prompt_translate_this':
                fullPrompt = curr_prompt.text + chatgpt_lang + ". \"" + msg_text.text + "\" ";
                break;
            case 'prompt_reply':
                fullPrompt += "Do not add the subject line to the response."
                break;
            default:
                break;
        }

        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        browser.runtime.sendMessage({command: "chatgpt_open", prompt: fullPrompt, action: curr_prompt.action, tabId: tabs[0].id});
    };
    promptDiv.appendChild(nameInput);
    promptsContainer.appendChild(promptDiv);
};

async function getDefaultSignature(){
    let prefs = await browser.storage.sync.get({default_sign_name: ''});
    if(prefs.default_sign_name===''){
        return '';
    }else{
        return "Sign the message as " + prefs.default_sign_name + ".";
    }
}

async function checkCompose(){
    return await browser.windows.getCurrent().then((currWindow) => {
        //console.log("currWindow.type: "+currWindow.type);
        return currWindow.type == 'messageCompose';
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    let inCompose = await checkCompose();
    //console.log("inCompose: "+inCompose)
    const promptsContainer = document.getElementById("prompts-container");
    defaultPrompts.forEach((prompt) => {
        if((prompt.type == 0)||((prompt.type == 1)&&(!inCompose))||((prompt.type == 2)&&(inCompose))){
            addAction(prompt, promptsContainer)
        }
    });
    i18n.updateDocument();
});

