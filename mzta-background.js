/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2025  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { mzta_script } from './js/mzta-chatgpt.js';
import { prefs_default } from './options/mzta-options-default.js';
import { mzta_Menus } from './js/mzta-menus.js';
import { taLogger } from './js/mzta-logger.js';
import { getCurrentIdentity, getOriginalBody, replaceBody, setBody, i18nConditionalGet, generateCallID, migrateCustomPromptsStorage, migrateDefaultPromptsPropStorage, getGPTWebModelString, getTagsList, createTag, assignTagsToMessage, checkIfTagExists, getActiveSpecialPromptsIDs, checkSparksPresence } from './js/mzta-utils.js';

await migrateCustomPromptsStorage();
await migrateDefaultPromptsPropStorage();

var original_html = '';
var modified_html = '';

let prefs_init = await browser.storage.sync.get({do_debug: false, add_tags: true, get_calendar_event: true, connection_type: 'chatgpt_web'});
let taLog = new taLogger("mzta-background",prefs_init.do_debug);

let special_prompts_ids = getActiveSpecialPromptsIDs(prefs_init.add_tags, await doGetCalendarEvent(prefs_init.get_calendar_event), (prefs_init.connection_type === "chatgpt_web"));

browser.composeScripts.register({
    js: [{file: "/js/mzta-compose-script.js"}]
});

// Register the message display script for all newly opened message tabs.
messenger.messageDisplayScripts.register({
    js: [{ file: "js/mzta-compose-script.js" }],
});

// Inject script and CSS in all already open message tabs.
let openTabs = await messenger.tabs.query();
let messageTabs = openTabs.filter(
    tab => ["mail", "messageDisplay"].includes(tab.type)
);
for (let messageTab of messageTabs) {
    if((messageTab.url == undefined) || (["start.thunderbird.net","about:blank"].some(blockedUrl => messageTab.url.includes(blockedUrl)))) {
        continue;
    }
    try {
        await browser.tabs.executeScript(messageTab.id, {
            file: "js/mzta-compose-script.js"
        })
    } catch (error) {
        console.error("[ThunderAI] Error injecting message display script:", error);
        console.error("[ThunderAI] Message tab:", messageTab.url);
    }
}

browser.contentScripts.register({
    matches: ["https://*.chatgpt.com/*"],
    js: [{file: "js/mzta-chatgpt-loader.js"}],
    runAt: "document_idle"
  });

let ThunderAI_Shortcut = "Ctrl+Alt+A";

// Shortcut
messenger.commands.update({
    name: "_thunderai__do_action",
    shortcut: ThunderAI_Shortcut
}).then(() => {
    taLog.log('Shortcut [' + ThunderAI_Shortcut + '] registered successfully!');
}).catch((error) => {
    taLog.error('Error registering shortcut [' + ThunderAI_Shortcut + ']: ' + error);
});

// Listen for shortcut command
messenger.commands.onCommand.addListener((command, tab) => {
    if (command === "_thunderai__do_action") {
        handleShortcut(tab);
    }
});
    
async function handleShortcut(tab) {
    taLog.log("Shortcut triggered!");
    if(!["mail", "messageCompose","messageDisplay"].includes(tab.type)){
        return;
    }
    switch (tab.type) {
        case "mail":
        case "messageDisplay":
            browser.messageDisplayAction.openPopup();
            break;
        case "messageCompose":
            browser.composeAction.openPopup();
            break;
        default:
            break;
    }    
}

function preparePopupMenu(tab) {
    let output = {};
    output.lastShortcutTabId = tab.id;
    output.lastShortcutTabType = tab.type;
    output.lastShortcutPromptsData = menus.shortcutMenu;
    output.lastShortcutFiltering = 0;
    switch (tab.type) {
        case "mail":
        case "messageDisplay":
            output.lastShortcutFiltering = 1;
            break;
        case "messageCompose":
            output.lastShortcutFiltering = 2;
            break;
        default:
            break;
    }
    return output;
}

messenger.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Check what type of message we have received and invoke the appropriate
    // handler function.
    if (message && message.hasOwnProperty("command")){
        switch (message.command) {
            // case 'chatgpt_open':
            //         openChatGPT(message.prompt,message.action,message.tabId);
            //         return true;
            case 'chatgpt_close':
                    browser.windows.remove(message.window_id).then(() => {
                        taLog.log("ChatGPT window closed successfully.");
                        return true;
                    }).catch((error) => {
                        taLog.error("Error closing ChatGPT window:", error);
                        return false;
                    });
                    break;
            case 'chatgpt_replaceSelectedText':
                async function _replaceSelectedText(tabId, text) {
                    //console.log('chatgpt_replaceSelectedText: [' + tabId +'] ' + text)
                    original_html = await getOriginalBody(tabId);
                    await browser.tabs.sendMessage(tabId, { command: "replaceSelectedText", text: text, tabId: tabId });
                    return true;
                }
                return _replaceSelectedText(message.tabId, message.text);
            case 'chatgpt_replyMessage':
                async function _replyMessage(message) {
                    const paragraphsHtmlString = message.text;
                    //console.log(">>>>>>>>>>>> paragraphsHtmlString: " + paragraphsHtmlString);
                    let prefs = await browser.storage.sync.get({reply_type: 'reply_all'});
                    //console.log('reply_type: ' + prefs.reply_type);
                    let replyType = 'replyToAll';
                    if(prefs.reply_type === 'reply_sender'){
                        replyType = 'replyToSender';
                    }
                    //console.log('replyType: ' + replyType);
                    // browser.messageDisplay.getDisplayedMessage(message.tabId).then(async (mailMessage) => {
                    //     let reply_tab = await browser.compose.beginReply(mailMessage.id, replyType, {
                    //         type: "reply",
                    //         //body:  paragraphsHtmlString,
                    //         isPlainText: false,
                    //         identityId: await getCurrentIdentity(mailMessage),
                    //     })
                    //console.log(">>>>>>>>>>>> message.mailMessageId: " + message.mailMessageId);
                    let _mailMessage = await browser.messages.get(message.mailMessageId);
                    let curr_idn = await getCurrentIdentity(_mailMessage)
                    let reply_tab = await browser.compose.beginReply(_mailMessage.id, replyType, {
                        type: "reply",
                        //body:  paragraphsHtmlString,
                        isPlainText: false,
                        identityId: curr_idn,
                    })
                        // Wait for tab loaded.
                        await new Promise(resolve => {
                            const tabIsLoaded = tab => {
                                return tab.status == "complete" && tab.url != "about:blank";
                            };
                            const listener = (tabId, changeInfo, updatedTab) => {
                                if (tabIsLoaded(updatedTab)) {
                                    browser.tabs.onUpdated.removeListener(listener);
                                    //console.log(">>>>>>>>>>>> reply_tab: " + tabId);
                                    resolve();
                                }
                            }
                            // Early exit if loaded already
                            if (tabIsLoaded(reply_tab)) {
                                resolve();
                            } else {
                                browser.tabs.onUpdated.addListener(listener);
                            }
                        });
                        // we need to wait for the compose windows to load the content script
                        //setTimeout(() => browser.tabs.sendMessage(reply_tab.id, { command: "insertText", text: paragraphsHtmlString, tabId: reply_tab.id }), 500);
                        setTimeout(async () => await replaceBody(reply_tab.id, paragraphsHtmlString), 500);
                        return true;
                }
                return _replyMessage(message);
                break;
            case 'compose_reloadBody':
                async function _reloadBody(tabId) {
                    modified_html = await getOriginalBody(tabId);
                    await setBody(tabId, original_html);
                    await setBody(tabId, modified_html);
                    return true;
                }
                return _reloadBody(message.tabId);
                break;
            case 'reload_menus':
                async function _reload_menus() {
                    let prefs_reload = await browser.storage.sync.get({add_tags: true, get_calendar_event: false, connection_type: 'chatgpt_web'});
                    doGetCalendarEvent(prefs_reload.get_calendar_event).then(calendarEvent => {
                        const special_prompts_ids = getActiveSpecialPromptsIDs(prefs_reload.add_tags, calendarEvent, (prefs_reload.connection_type === "chatgpt_web"));
                        menus.reload(special_prompts_ids);
                    });
                    taLog.log("Reloading menus");
                    return true;
                }
                return _reload_menus();
                break;
            case 'shortcut_do_prompt':
                taLog.log("Executing shortcut, promptId: " + message.promptId);
                return menus.executeMenuAction(message.promptId);
                break;
            case 'popup_menu_ready':
                async function _popup_menu_ready() {
                    let tabs = await browser.tabs.query({ active: true, currentWindow: true });
                    if(tabs.length == 0){
                        return false;
                    }
                    return preparePopupMenu(tabs[0]);
                    //return true;
                }
                return _popup_menu_ready();
                break;
            case 'assign_tags':
                async function _assign_tags() {
                    let all_tags_list = await getTagsList();
                    all_tags_list = all_tags_list[1];
                    console.log(">>>>>>>>>>>>>>> all_tags_list: " + JSON.stringify(all_tags_list));
                    taLog.log("assign_tags data: " + JSON.stringify(message));
                    let new_tags = [];
                    for (const tag of message.tags) {
                        console.log(">>>>>>>>>>>>>>> tag: " + tag);
                        if (!checkIfTagExists(tag, all_tags_list)) {
                            taLog.log("Creating tag: " + tag);
                            await createTag(tag);
                        }
                        new_tags.push(tag);
                    }
                    await assignTagsToMessage(message.messageId, new_tags);
                    taLog.log("Assigned tags: " + JSON.stringify(new_tags));
                }
                return _assign_tags();
                break;
            default:
                break;
        }
    }
    // Return false if the message was not handled by this listener.
    return false;
});


async function openChatGPT(promptText, action, curr_tabId, prompt_name = '', do_custom_text = 0) {
    let prefs = await browser.storage.sync.get(prefs_default);
    taLog.changeDebug(prefs.do_debug);
    prefs = checkScreenDimensions(prefs);
    //console.log(">>>>>>>>>>>>>>>> prefs: " + JSON.stringify(prefs));
    taLog.log("Prompt length: " + promptText.length);
    if(promptText.length > prefs.max_prompt_length){
        // Prompt too long for ChatGPT
        let tabs = await browser.tabs.query({ active: true, currentWindow: true });
        browser.tabs.sendMessage(curr_tabId, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage('msg_prompt_too_long') });
        return;
    }

    let mailMessage = await browser.messageDisplay.getDisplayedMessage(curr_tabId);

    switch(prefs.connection_type){
        case 'chatgpt_web':
        // We are using the ChatGPT web interface

        let rand_call_id = '_chatgptweb_' + generateCallID();
        let call_opt = '';

        if(prefs.chatgpt_web_tempchat){
            call_opt += '&temporary-chat=true';
        }

        if(prefs.chatgpt_web_model != ''){
            call_opt += '&model=' + encodeURIComponent(prefs.chatgpt_web_model).toLowerCase();
        }

        taLog.log("[chatgpt_web] call_opt: " + call_opt);

        let win_options = {
            url: "https://chatgpt.com?call_id=" + rand_call_id + call_opt,
            type: "popup",
        }
        
        taLog.log("[chatgpt_web] prefs.chatgpt_win_width: " + prefs.chatgpt_win_width + ", prefs.chatgpt_win_height: " + prefs.chatgpt_win_height);

        if((prefs.chatgpt_win_width != '') && (prefs.chatgpt_win_height != '') && (prefs.chatgpt_win_width != 0) && (prefs.chatgpt_win_height != 0)){
            win_options.width = prefs.chatgpt_win_width,
            win_options.height = prefs.chatgpt_win_height
        }

        const listener = (message, sender, sendResponse) => {
            async function handleChatGptWeb(createdTab) {
                taLog.log("ChatGPT web interface script started...");

                let _gpt_model = getGPTWebModelString(prefs.chatgpt_web_model);

                taLog.log("prefs.chatgpt_web_model: " + prefs.chatgpt_web_model);
                taLog.log("_gpt_model: " + _gpt_model);
        
                let pre_script = `let mztaWinId = `+ createdTab.windowId +`;
                let mztaStatusPageDesc="`+ browser.i18n.getMessage("prefs_status_page") +`";
                let mztaForceCompletionDesc="`+ browser.i18n.getMessage("chatgpt_force_completion") +`";
                let mztaForceCompletionTitle="`+ browser.i18n.getMessage("chatgpt_force_completion_title") +`";
                let mztaDoCustomText=`+ do_custom_text +`;
                let mztaPromptName="[`+ i18nConditionalGet(prompt_name) +`]";
                let mztaPhDefVal="`+(prefs.placeholders_use_default_value?'1':'0')+`";
                let mztaGPTModel="`+ _gpt_model +`";
                let mztaDoDebug="`+(prefs.do_debug?'1':'0')+`";
                `;

                taLog.log("Waiting 1 sec");
                await new Promise(resolve => setTimeout(resolve, 1000));
                taLog.log("Waiting 1 sec done");
                
                await browser.tabs.executeScript(createdTab.id, { code: pre_script + mzta_script, matchAboutBlank: false });
                // let mailMessage = await browser.messageDisplay.getDisplayedMessage(curr_tabId);
                let mailMessageId = -1;
                if(mailMessage) mailMessageId = mailMessage.id;
                browser.tabs.sendMessage(createdTab.id, { command: "chatgpt_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId});
                taLog.log('[ChatGPT Web] Connection succeded!');
                taLog.log("[ThunderAI] ChatGPT Web script injected successfully");
                browser.runtime.onMessage.removeListener(listener);
            }
        
            if (message.command === "chatgpt_web_ready_" + rand_call_id) {
                return handleChatGptWeb(sender.tab)
            }
            return false;
        }

        browser.runtime.onMessage.addListener(listener);
        await browser.windows.create(win_options);
        break;  // chatgpt_web - END

    case 'chatgpt_api':
         // We are using the ChatGPT API

        let rand_call_id2 = '_openai_' + generateCallID();

        const listener2 = (message, sender, sendResponse) => {

            function handleChatGptApi(createdTab) {
                let mailMessageId2 = -1;
                if(mailMessage) mailMessageId2 = mailMessage.id;

                // check if the config is present, or give a message error
                if (prefs.chatgpt_api_key == '') {
                    browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('chatgpt_empty_apikey')});
                    return;
                }
                if (prefs.chatgpt_model == '') {
                    browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('chatgpt_empty_model')});
                    return;
                }
                //console.log(">>>>>>>>>> sender: " + JSON.stringify(sender));
                browser.tabs.sendMessage(createdTab.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId2, do_custom_text: do_custom_text});
                taLog.log('[OpenAI ChatGPT] Connection succeded!');
                browser.runtime.onMessage.removeListener(listener2);
            }

            if (message.command === "openai_api_ready_"+rand_call_id2) {
                return handleChatGptApi(sender.tab);
            }
            return false;
        }

        browser.runtime.onMessage.addListener(listener2);

        let win_options2 = {
            url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id2+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')),
            type: "popup",
        }

        taLog.log("[chatgpt_api] prefs.chatgpt_win_width: " + prefs.chatgpt_win_width + ", prefs.chatgpt_win_height: " + prefs.chatgpt_win_height);

        if((prefs.chatgpt_win_width != '') && (prefs.chatgpt_win_height != '') && (prefs.chatgpt_win_width != 0) && (prefs.chatgpt_win_height != 0)){
            win_options2.width = prefs.chatgpt_win_width,
            win_options2.height = prefs.chatgpt_win_height
        }

        await browser.windows.create(win_options2);

        break;  // chatgpt_api - END

        case 'google_gemini_api':
         // We are using the Google Gemini API

        let rand_call_id5 = '_google_gemini_' + generateCallID();

        const listener5 = (message, sender, sendResponse) => {

            function handleChatGptApi(createdTab) {
                let mailMessageId5 = -1;
                if(mailMessage) mailMessageId5 = mailMessage.id;

                // check if the config is present, or give a message error
                if (prefs.chatgpt_api_key == '') {
                    browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('google_gemini_empty_apikey')});
                    return;
                }
                if (prefs.chatgpt_model == '') {
                    browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('google_gemini_empty_model')});
                    return;
                }
                //console.log(">>>>>>>>>> sender: " + JSON.stringify(sender));
                browser.tabs.sendMessage(createdTab.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId5, do_custom_text: do_custom_text});
                taLog.log('[Google Gemini] Connection succeded!');
                browser.runtime.onMessage.removeListener(listener5);
            }

            if (message.command === "google_gemini_api_ready_"+rand_call_id5) {
                return handleChatGptApi(sender.tab);
            }
            return false;
        }

        browser.runtime.onMessage.addListener(listener5);

        let win_options5 = {
            url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id5+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')),
            type: "popup",
        }

        taLog.log("[chatgpt_api] prefs.chatgpt_win_width: " + prefs.chatgpt_win_width + ", prefs.chatgpt_win_height: " + prefs.chatgpt_win_height);

        if((prefs.chatgpt_win_width != '') && (prefs.chatgpt_win_height != '') && (prefs.chatgpt_win_width != 0) && (prefs.chatgpt_win_height != 0)){
            win_options5.width = prefs.chatgpt_win_width,
            win_options5.height = prefs.chatgpt_win_height
        }

        await browser.windows.create(win_options5);

        break;  // google_gemini_api - END

        case 'ollama_api':
             // We are using the Ollama API

            taLog.log("Ollama API window opening...");

            let rand_call_id3 = '_ollama_' + generateCallID();

            const listener3 = (message, sender, sendResponse) => {

                function handleOllamaApi(createdTab3) {
                    taLog.log("Ollama API window ready.");
                    taLog.log("message.window_id: " + message.window_id)
                    taLog.log("createdTab3.id: " + createdTab3.id)
                    // let mailMessage3 = await browser.messageDisplay.getDisplayedMessage(curr_tabId);
                    let mailMessageId3 = -1;
                    if(mailMessage) mailMessageId3 = mailMessage.id;
                    taLog.log("mailMessageId3: " + mailMessageId3)
            
                    // check if the config is present, or give a message error
                    if (prefs.ollama_host == '') {
                        browser.tabs.sendMessage(createdTab3.id, { command: "api_error", error: browser.i18n.getMessage('ollama_empty_host')});
                        return;
                    }
                    if (prefs.ollama_model == '') {
                        browser.tabs.sendMessage(createdTab3.id, { command: "api_error", error: browser.i18n.getMessage('ollama_empty_model')});
                        return;
                    }
                    browser.tabs.sendMessage(createdTab3.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId3, do_custom_text: do_custom_text});
                    taLog.log('[Ollama API] Connection succeded!');
                    browser.runtime.onMessage.removeListener(listener3);
                }

                if (message.command === "ollama_api_ready_"+rand_call_id3) {
                    return handleOllamaApi(sender.tab);
                }else{
                    return false;
                }
            }

            browser.runtime.onMessage.addListener(listener3);

            let win_options3 = {
                url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id3+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')),
                type: "popup",
            }

            taLog.log("[ollama_api] prefs.chatgpt_win_width: " + prefs.chatgpt_win_width + ", prefs.chatgpt_win_height: " + prefs.chatgpt_win_height);

            if((prefs.chatgpt_win_width != '') && (prefs.chatgpt_win_height != '') && (prefs.chatgpt_win_width != 0) && (prefs.chatgpt_win_height != 0)){
                win_options3.width = prefs.chatgpt_win_width,
                win_options3.height = prefs.chatgpt_win_height
            }

            await browser.windows.create(win_options3);

            break;  // ollama_api - END

            case 'openai_comp_api':
                // We are using the OpenAI Comp API
        
                let rand_call_id4 = '_openai_comp_api_' + generateCallID();

      
                const listener4 = (message, sender, sendResponse) => {

                    function handleOpenAICompApi(createdTab) {
                        let mailMessageId4 = -1;
                        if(mailMessage) mailMessageId4 = mailMessage.id;
        
                        // check if the config is present, or give a message error
                        if (prefs.openai_comp_host == '') {
                            browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('OpenAIComp_empty_host')});
                            return;
                        }
                        if (prefs.openai_comp_model == '') {
                            browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('OpenAIComp_empty_model')});
                            return;
                        }
        
                        browser.tabs.sendMessage(createdTab.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId4, do_custom_text: do_custom_text});
                        taLog.log('[OpenAI Comp API] Connection succeded!');
                        browser.runtime.onMessage.removeListener(listener4);
                    }

                    if (message.command === "openai_comp_api_ready_"+rand_call_id4) {
                        return handleOpenAICompApi(sender.tab);
                    }
                    return false;
                }
        
                browser.runtime.onMessage.addListener(listener4);

                let win_options4 = {
                    url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id4+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')),
                    type: "popup",
                }

                taLog.log("[openai_comp_api] prefs.chatgpt_win_width: " + prefs.chatgpt_win_width + ", prefs.chatgpt_win_height: " + prefs.chatgpt_win_height);

                if((prefs.chatgpt_win_width != '') && (prefs.chatgpt_win_height != '') && (prefs.chatgpt_win_width != 0) && (prefs.chatgpt_win_height != 0)){
                    win_options4.width = prefs.chatgpt_win_width,
                    win_options4.height = prefs.chatgpt_win_height
                }
        
                await browser.windows.create(win_options4);
        
                break;  // openai_comp_api - END
                default:
                    taLog.error("Unknown API connection type: " + prefs.connection_type);
                break;
    }
}

function checkScreenDimensions(prefs){
    let width = window.screen.width - 50;
    let height = window.screen.height - 50;

    if(prefs.chatgpt_win_height > height) prefs.chatgpt_win_height = height - 50;
    if(prefs.chatgpt_win_width > width) prefs.chatgpt_win_width = width - 50;
    
    return prefs;
}

async function doGetCalendarEvent(get_calendar_event) {
    if(get_calendar_event) {
        return await checkSparksPresence();
    } else {
        return false;
    }
}

async function reload_pref_init(){
    prefs_init = await await browser.storage.sync.get({do_debug: false, add_tags: true, get_calendar_event: true, connection_type: 'chatgpt_web'});
}


// Register the listener for storage changes
function setupStorageChangeListener() {
    browser.storage.onChanged.addListener((changes, areaName) => {
        // Check if the change happened in the 'sync' storage area
        if (areaName === 'sync') {
            // Process 'add_tags' changes
            if (changes.add_tags) {
                const newTags = changes.add_tags.newValue;
                doGetCalendarEvent(prefs_init.get_calendar_event).then(calendarEvent => {
                    const special_prompts_ids = getActiveSpecialPromptsIDs(newTags, calendarEvent, (prefs_init.connection_type === "chatgpt_web"));
                    menus.reload(special_prompts_ids);
                });
            }

            // Process 'get_calendar_event' changes
            if (changes.get_calendar_event) {
                const newCalendarEvent = changes.get_calendar_event.newValue;
                doGetCalendarEvent(newCalendarEvent).then(calendarEvent => {
                    const special_prompts_ids = getActiveSpecialPromptsIDs(prefs_init.add_tags, calendarEvent, (prefs_init.connection_type === "chatgpt_web"));
                    menus.reload(special_prompts_ids);
                });
            }

            // Process 'connection_type' changes
            if (changes.connection_type) {
                const newConnectionType = changes.connection_type.newValue;
                doGetCalendarEvent(prefs_init.get_calendar_event).then(calendarEvent => {
                    const special_prompts_ids = getActiveSpecialPromptsIDs(prefs_init.add_tags, calendarEvent, (newConnectionType !== "chatgpt_web"));
                    menus.reload(special_prompts_ids);
                });
            }
            reload_pref_init();
        }
    });
}

// Call the function to set up the listener
setupStorageChangeListener();


// Menus handling
const menus = new mzta_Menus(openChatGPT, prefs_init.do_debug);
menus.loadMenus(special_prompts_ids);