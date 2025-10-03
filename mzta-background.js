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
import {
    getCurrentIdentity,
    getOriginalBody,
    replaceBody,
    setBody,
    i18nConditionalGet,
    generateCallID,
    migrateCustomPromptsStorage,
    migrateDefaultPromptsPropStorage,
    getGPTWebModelString,
    getTagsList,
    createTag,
    assignTagsToMessage,
    checkIfTagLabelExists,
    getActiveSpecialPromptsIDs,
    checkSparksPresence,
    getMessages,
    getMailBody,
    extractJsonObject,
    contextMenuID_AddTags,
    contextMenuID_Spamfilter,
    contextMenuIconsPath,
    sanitizeChatGPTModelData,
    sanitizeChatGPTWebCustomData,
    stripHtmlKeepLines,
    htmlBodyToPlainText,
    convertNewlinesToParagraphs,
    getConnectionType,
    checkAPIIntegration,
    hasSpecificIntegration,
     } from './js/mzta-utils.js';
import { taPromptUtils } from './js/mzta-utils-prompt.js';
import { mzta_specialCommand } from './js/mzta-special-commands.js';
import { getSpamFilterPrompt } from './js/mzta-prompts.js';
import { taSpamReport } from './js/mzta-spamreport.js';
import { taWorkingStatus } from './js/mzta-working-status.js';
import { addTags_getExclusionList, checkExcludedTag } from './js/mzta-addatags-exclusion-list.js';

browser.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
    // console.log(">>>>>>>>>>> onInstalled: " + JSON.stringify(reason) + ", previousVersion: " + previousVersion);
    if (reason === "install" 
       || (reason === "update" && (previousVersion.startsWith("2.") || previousVersion.startsWith("1.")))
       || (reason === "update" && ((previousVersion.startsWith("3.") && parseInt(previousVersion.split(".")[1]) <= 2)))
       //|| (reason === "update") // only for testing
       ) {
        browser.tabs.create({ url: "/pages/onboarding/onboarding.html" });
    }
});

await migrateCustomPromptsStorage();
await migrateDefaultPromptsPropStorage();

var original_html = '';
var modified_html = '';

let _process_incoming = false;
let _sparks_presence = false;

let prefs_init = {};
await reload_pref_init();

let taLog = new taLogger("mzta-background",prefs_init.do_debug);
taWorkingStatus.taLog = taLog;

let special_prompts_ids = getActiveSpecialPromptsIDs({
    addtags: prefs_init.add_tags,
    addtags_api: hasSpecificIntegration(prefs_init.add_tags_use_specific_integration, prefs_init.add_tags_connection_type),
    get_calendar_event: doGetSparkFeature(prefs_init.get_calendar_event),
    get_task: doGetSparkFeature(prefs_init.get_task),
    is_chatgpt_web: (prefs_init.connection_type === "chatgpt_web")
  });

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

async function _reload_menus() {
    let prefs_reload = await browser.storage.sync.get({add_tags: prefs_default.add_tags, get_calendar_event: prefs_default.get_calendar_event, get_task: prefs_default.get_task, connection_type: prefs_default.connection_type});
    let getCalendarEvent = doGetSparkFeature(prefs_reload.get_calendar_event);
    let getTask = doGetSparkFeature(prefs_reload.get_task);
    const special_prompts_ids = getActiveSpecialPromptsIDs({
        addtags: prefs_reload.add_tags,
        addtags_api: hasSpecificIntegration(prefs_init.add_tags_use_specific_integration, prefs_init.add_tags_connection_type),
        get_calendar_event: getCalendarEvent,
        get_task: getTask,
        is_chatgpt_web: (prefs_reload.connection_type === "chatgpt_web")
      });
    menus.reload(special_prompts_ids);
    taLog.log("Reloading menus");
    return true;
}

async function _assign_tags(_data, create_new_tags = true, exclusions_exact_match = false) {
    let all_tags_list = await getTagsList();
    all_tags_list = all_tags_list[1];
    // console.log(">>>>>>>>>>>>>>> all_tags_list: " + JSON.stringify(all_tags_list));
    taLog.log("assign_tags data: " + JSON.stringify(_data));
    let new_tags = [];
    let add_tags_exclusions_list = await addTags_getExclusionList();
    taLog.log("add_tags_exclusions_list: " + JSON.stringify(add_tags_exclusions_list));
    const tags_final = _data.tags.filter(tag =>
        !add_tags_exclusions_list.some(exclusion =>
            checkExcludedTag(tag, exclusion, exclusions_exact_match)
        )
    );
    if(!create_new_tags){
        taLog.log("Not creating new tags, only assigning existing ones...");
    }
    for (const tag of tags_final) {
        // console.log(">>>>>>>>>>>>>>> tag: " + JSON.stringify(tag));
        if (create_new_tags && !checkIfTagLabelExists(tag, all_tags_list)) {
            taLog.log("Creating tag: " + tag);
            await createTag(tag);
        }
        new_tags.push(tag);
    }
    let added_tags = await assignTagsToMessage(_data.messageId, new_tags);
    taLog.log("Assigned tags: " + JSON.stringify(added_tags));
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
                    taLog.log("chatgpt_replaceSelectedText text: " + text);
                    original_html = await getOriginalBody(tabId);
                    let prefs_repl = await browser.storage.sync.get({composing_plain_text: prefs_default.composing_plain_text});
                    if(prefs_repl.composing_plain_text){
                        text = stripHtmlKeepLines(text);
                    }
                    await browser.tabs.sendMessage(tabId, { command: "replaceSelectedText", text: text, tabId: tabId });
                    return true;
                }
                return _replaceSelectedText(message.tabId, message.text);
            case 'chatgpt_replyMessage':
                async function _replyMessage(message) {
                    let paragraphsHtmlString = message.text;
                    //console.log(">>>>>>>>>>>> paragraphsHtmlString: " + paragraphsHtmlString);
                    taLog.log("paragraphsHtmlString: " + paragraphsHtmlString);
                    let prefs_reply = await browser.storage.sync.get({reply_type: prefs_default.reply_type, composing_plain_text: prefs_default.composing_plain_text});
                    if(prefs_reply.composing_plain_text){
                        paragraphsHtmlString = stripHtmlKeepLines(paragraphsHtmlString);
                    }
                    //console.log('reply_type: ' + prefs_reply.reply_type);
                    let replyType = 'replyToAll';
                    // console.log(">>>>>>>>>>> chatgpt_replyMessage replyType: " + message.replyType);
                    if (typeof message.replyType === "undefined" || message.replyType === null || message.replyType === "") {
                        message.replyType = prefs_reply.reply_type;
                    }
                    if(message.replyType === 'reply_sender'){
                        replyType = 'replyToSender';
                    }
                    taLog.log("Reply type: " + replyType);
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
                async function _do_assign_tags(message) {
                    let prefs_assign_tags = await browser.storage.sync.get({add_tags_exclusions_exact_match: prefs_default.add_tags_exclusions_exact_match});
                    return _assign_tags(message,true, prefs_assign_tags.add_tags_exclusions_exact_match);
                }
                return _do_assign_tags(message);
                break;
            case 'api_send_custom_text':
                browser.tabs.sendMessage(message.tabId, { command: "api_send_custom_text", custom_text: message.custom_text });
                break;
            default:
                break;
        }
    }
    // Return false if the message was not handled by this listener.
    return false;
});

// Listen for messages from ThunderAI-Sparks
browser.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'reload_menus':
            return _reload_menus();
            break;
    }
});

async function openChatGPT(promptText, action, curr_tabId, prompt_name = '', do_custom_text = 0, prompt_info = {}) {
    let prefs = await browser.storage.sync.get(prefs_default);
    taLog.changeDebug(prefs.do_debug);
    prefs = checkScreenDimensions(prefs);
    //console.log(">>>>>>>>>>>>>>>> prefs: " + JSON.stringify(prefs));
    // console.log(">>>>>>>>>>>>>>>> prompt_info: " + JSON.stringify(prompt_info));
    taLog.log("Prompt length: " + promptText.length);
    let _max_prompt_length = prefs.max_prompt_length;
    if(prefs.connection_type == 'chatgpt_web'){
        _max_prompt_length = prefs_default.max_prompt_length;
    }
    if((_max_prompt_length > 0) && (promptText.length > _max_prompt_length)){
        // Prompt too long
        let tabs = await browser.tabs.query({ active: true, currentWindow: true });
        browser.tabs.sendMessage(curr_tabId, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage('msg_prompt_too_long') });
        return;
    }

    let mailMessage = await browser.messageDisplay.getDisplayedMessage(curr_tabId);

    switch(prefs.connection_type){
        case 'chatgpt_web':
        {
            // We are using the ChatGPT web interface

            let rand_call_id = '_chatgptweb_' + generateCallID();
            let call_opt = '';

            let _wait_time = 1000;
            let _base_url = "https://chatgpt.com";
            let _webproject_set = false;
            let _custom_gpt_set = false;
            let _use_prompt_info_custom_gpt = false;
            let _custom_model = sanitizeChatGPTModelData(prompt_info.chatgpt_web_model != '' ? prompt_info.chatgpt_web_model : prefs.chatgpt_web_model);
            let _web_project = sanitizeChatGPTWebCustomData(prompt_info.chatgpt_web_project != '' ? prompt_info.chatgpt_web_project : prefs.chatgpt_web_project)
            let _custom_gpt = sanitizeChatGPTWebCustomData(prompt_info.chatgpt_web_custom_gpt != '' ? prompt_info.chatgpt_web_custom_gpt : prefs.chatgpt_web_custom_gpt)

            if(prefs.chatgpt_web_tempchat){
                call_opt += '&temporary-chat=true';
            }

            if((prompt_info.chatgpt_web_model != '') || (prefs.chatgpt_web_model != '')){
                call_opt += '&model=' + _custom_model;
            }

            taLog.log("[chatgpt_web] call_opt: " + call_opt);

            // If there is a custom gpt on the prompt, but also a web_project on the prefs, we need to use the custom gpt
            _use_prompt_info_custom_gpt = (prompt_info.chatgpt_web_custom_gpt != '' && prompt_info.chatgpt_web_project == '');

            if(!_use_prompt_info_custom_gpt && ((prompt_info.chatgpt_web_project != '') || (prefs.chatgpt_web_project != ''))){
                _base_url += _web_project;
                _webproject_set = true;
                _wait_time = 2000;
            }
            if(!_webproject_set && ((prompt_info.chatgpt_web_custom_gpt != '') || (prefs.chatgpt_web_custom_gpt != ''))){
                _base_url += _custom_gpt;
                _custom_gpt_set = true;
            }

            let win_options = {
                url: _base_url + "?call_id=" + rand_call_id + call_opt,
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

                    let _gpt_model = getGPTWebModelString(_custom_model);

                    taLog.log("_custom_model: " + _custom_model);
                    taLog.log("_gpt_model: " + _gpt_model);

                    let originalText = prompt_info.selection_text;
                    if((originalText == null) || (originalText == "")) {
                        originalText = prompt_info.body_text;
                    }
                    let reply_type_pref = await browser.storage.sync.get({ reply_type: prefs_default.reply_type });
                    //console.log(">>>>>>>>>> prompt_info: " + JSON.stringify(prompt_info));
                    let pre_script = `let mztaWinId = `+ createdTab.windowId +`;
                    let mztaStatusPageDesc="`+ browser.i18n.getMessage("prefs_status_page") +`";
                    let mztaForceCompletionDesc="`+ browser.i18n.getMessage("chatgpt_force_completion") +`";
                    let mztaForceCompletionTitle="`+ browser.i18n.getMessage("chatgpt_force_completion_title") +`";
                    let mztaDoCustomText="`+ do_custom_text +`";
                    let mztaPromptName="[`+ i18nConditionalGet(prompt_name) +`]";
                    let mztaPhDefVal="`+(prefs.placeholders_use_default_value?'1':'0')+`";
                    let mztaGPTModel="`+ (_custom_gpt_set ? '' : _gpt_model) +`";
                    let mztaDoDebug="`+(prefs.do_debug?'1':'0')+`";
                    let mztaUseDiffViewer="`+(prompt_info.use_diff_viewer=='1'?'1':'0')+`";
                    let mztaOriginalText="`+ JSON.stringify(originalText).slice(1, -1) +`";
                    let mztaReplyType="`+ reply_type_pref.reply_type + `";
                    `;

                    taLog.log("pre_script: " + pre_script);
                    taLog.log("Waiting " + _wait_time + " millisec");
                    await new Promise(resolve => setTimeout(resolve, _wait_time));
                    taLog.log("Waiting " + _wait_time + " millisec done");
                    
                    await browser.tabs.executeScript(createdTab.id, { code: pre_script + mzta_script, matchAboutBlank: false });
                    // let mailMessage = await browser.messageDisplay.getDisplayedMessage(curr_tabId);
                    let mailMessageId = -1;
                    if(mailMessage) mailMessageId = mailMessage.id;
                    promptText = convertNewlinesToParagraphs(promptText);
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
        }
        break;  // chatgpt_web - END

        case 'chatgpt_api':
        {
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
                    browser.tabs.sendMessage(createdTab.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId2, do_custom_text: do_custom_text, prompt_info: prompt_info});
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
                url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id2+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')+'&prompt_id='+encodeURIComponent(prompt_info.id) + '&prompt_name=' + encodeURIComponent(i18nConditionalGet(prompt_info.name))),
                type: "popup",
            }

            taLog.log("[chatgpt_api] prefs.chatgpt_win_width: " + prefs.chatgpt_win_width + ", prefs.chatgpt_win_height: " + prefs.chatgpt_win_height);

            if((prefs.chatgpt_win_width != '') && (prefs.chatgpt_win_height != '') && (prefs.chatgpt_win_width != 0) && (prefs.chatgpt_win_height != 0)){
                win_options2.width = prefs.chatgpt_win_width,
                win_options2.height = prefs.chatgpt_win_height
            }

            await browser.windows.create(win_options2);
        }
        break;  // chatgpt_api - END

        case 'google_gemini_api':
        {
            // We are using the Google Gemini API

            let rand_call_id5 = '_google_gemini_' + generateCallID();

            const listener5 = (message, sender, sendResponse) => {

                function handleChatGptApi(createdTab) {
                    let mailMessageId5 = -1;
                    if(mailMessage) mailMessageId5 = mailMessage.id;

                    // check if the config is present, or give a message error
                    if (prefs.google_gemini_api_key == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('google_gemini_empty_apikey')});
                        return;
                    }
                    if (prefs.google_gemini_model == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('google_gemini_empty_model')});
                        return;
                    }
                    //console.log(">>>>>>>>>> sender: " + JSON.stringify(sender));
                    browser.tabs.sendMessage(createdTab.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId5, do_custom_text: do_custom_text, prompt_info: prompt_info});
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
                url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id5+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')+'&prompt_id='+encodeURIComponent(prompt_info.id) + '&prompt_name=' + encodeURIComponent(i18nConditionalGet(prompt_info.name))),
                type: "popup",
            }

            taLog.log("[google_gemini_api] prefs.chatgpt_win_width: " + prefs.chatgpt_win_width + ", prefs.chatgpt_win_height: " + prefs.chatgpt_win_height);

            if((prefs.chatgpt_win_width != '') && (prefs.chatgpt_win_height != '') && (prefs.chatgpt_win_width != 0) && (prefs.chatgpt_win_height != 0)){
                win_options5.width = prefs.chatgpt_win_width,
                win_options5.height = prefs.chatgpt_win_height
            }

            await browser.windows.create(win_options5);
        }
        break;  // google_gemini_api - END

        case 'ollama_api':
        {
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
                    browser.tabs.sendMessage(createdTab3.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId3, do_custom_text: do_custom_text, prompt_info: prompt_info});
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
                url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id3+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')+'&prompt_id='+encodeURIComponent(prompt_info.id) + '&prompt_name=' + encodeURIComponent(i18nConditionalGet(prompt_info.name))),
                type: "popup",
            }

            taLog.log("[ollama_api] prefs.chatgpt_win_width: " + prefs.chatgpt_win_width + ", prefs.chatgpt_win_height: " + prefs.chatgpt_win_height);

            if((prefs.chatgpt_win_width != '') && (prefs.chatgpt_win_height != '') && (prefs.chatgpt_win_width != 0) && (prefs.chatgpt_win_height != 0)){
                win_options3.width = prefs.chatgpt_win_width,
                win_options3.height = prefs.chatgpt_win_height
            }

            await browser.windows.create(win_options3);

        }
        break;  // ollama_api - END

        case 'openai_comp_api':
        {
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
    
                    browser.tabs.sendMessage(createdTab.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId4, do_custom_text: do_custom_text, prompt_info: prompt_info});
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
                url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id4+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')+'&prompt_id='+encodeURIComponent(prompt_info.id) + '&prompt_name=' + encodeURIComponent(i18nConditionalGet(prompt_info.name))),
                type: "popup",
            }

            taLog.log("[openai_comp_api] prefs.chatgpt_win_width: " + prefs.chatgpt_win_width + ", prefs.chatgpt_win_height: " + prefs.chatgpt_win_height);

            if((prefs.chatgpt_win_width != '') && (prefs.chatgpt_win_height != '') && (prefs.chatgpt_win_width != 0) && (prefs.chatgpt_win_height != 0)){
                win_options4.width = prefs.chatgpt_win_width,
                win_options4.height = prefs.chatgpt_win_height
            }
    
            await browser.windows.create(win_options4);
        }
        break;  // openai_comp_api - END

        case 'anthropic_api':
        {
            // We are using the Anthropic API

            let rand_call_id5 = '_anthropic_' + generateCallID();

            const listener5 = (message, sender, sendResponse) => {

                function handleAnthropicApi(createdTab) {
                    let mailMessageId5 = -1;
                    if(mailMessage) mailMessageId5 = mailMessage.id;

                    // check if the config is present, or give a message error
                    if (prefs.anthropic_api_key == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('anthropic_empty_apikey')});
                        return;
                    }
                    if (prefs.anthropic_model == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('anthropic_empty_model')});
                        return;
                    }
                    if (prefs.anthropic_version == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('anthropic_empty_version')});
                        return;
                    }
                    //console.log(">>>>>>>>>> sender: " + JSON.stringify(sender));
                    browser.tabs.sendMessage(createdTab.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId5, do_custom_text: do_custom_text, prompt_info: prompt_info});
                    taLog.log('[OpenAI ChatGPT] Connection succeded!');
                    browser.runtime.onMessage.removeListener(listener5);
                }

                if (message.command === "anthropic_api_ready_"+rand_call_id5) {
                    return handleAnthropicApi(sender.tab);
                }
                return false;
            }

            browser.runtime.onMessage.addListener(listener5);

            let win_options5 = {
                url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id5+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')+'&prompt_id='+encodeURIComponent(prompt_info.id) + '&prompt_name=' + encodeURIComponent(i18nConditionalGet(prompt_info.name))),
                type: "popup",
            }

            taLog.log("[chatgpt_api] prefs.chatgpt_win_width: " + prefs.chatgpt_win_width + ", prefs.chatgpt_win_height: " + prefs.chatgpt_win_height);

            if((prefs.chatgpt_win_width != '') && (prefs.chatgpt_win_height != '') && (prefs.chatgpt_win_width != 0) && (prefs.chatgpt_win_height != 0)){
                win_options5.width = prefs.chatgpt_win_width,
                win_options5.height = prefs.chatgpt_win_height
            }

            await browser.windows.create(win_options5);
        }
        break;  // anthropic_api - END

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

function doGetSparkFeature(spark_feature_active) {
    if(spark_feature_active) {
        return (_sparks_presence == 1);
    } else {
        return false;
    }
}

async function reload_pref_init(){
    prefs_init = await browser.storage.sync.get({
        do_debug: prefs_default.do_debug,
        add_tags: prefs_default.add_tags,
        get_calendar_event: prefs_default.get_calendar_event,
        get_task: prefs_default.get_task,
        connection_type: prefs_default.connection_type,
        add_tags_auto: prefs_default.add_tags_auto,
        add_tags_auto_force_existing: prefs_default.add_tags_auto_force_existing,
        add_tags_auto_only_inbox: prefs_default.add_tags_auto_only_inbox,
        spamfilter: prefs_default.spamfilter,
        spamfilter_threshold: prefs_default.spamfilter_threshold,
        dynamic_menu_force_enter: prefs_default.dynamic_menu_force_enter,
        add_tags_context_menu: prefs_default.add_tags_context_menu,
        spamfilter_context_menu: prefs_default.spamfilter_context_menu,
        add_tags_use_specific_integration: prefs_default.add_tags_use_specific_integration,
        add_tags_connection_type: prefs_default.add_tags_connection_type,
        spamfilter_use_specific_integration: prefs_default.spamfilter_use_specific_integration,
        spamfilter_connection_type: prefs_default.spamfilter_connection_type
    });
    _process_incoming = prefs_init.add_tags_auto || prefs_init.spamfilter;
    _sparks_presence = await checkSparksPresence();
}


// Register the listener for storage changes
function setupStorageChangeListener() {
    browser.storage.onChanged.addListener((changes, areaName) => {
        // Check if the change happened in the 'sync' storage area
        if (areaName === 'sync') {
            // Process 'add_tags' changes
            if (changes.add_tags) {
                const newTags = changes.add_tags.newValue;
                let getCalendarEvent = doGetSparkFeature(prefs_init.get_calendar_event);
                let getTask = doGetSparkFeature(prefs_init.get_task);
                const special_prompts_ids = getActiveSpecialPromptsIDs({
                    addtags: newTags,
                    addtags_api: hasSpecificIntegration(prefs_init.add_tags_use_specific_integration, prefs_init.add_tags_connection_type),
                    get_calendar_event: getCalendarEvent,
                    get_task: getTask,
                    is_chatgpt_web: (prefs_init.connection_type === "chatgpt_web")
                  });
                menus.reload(special_prompts_ids);
            }

            // Process 'get_calendar_event' changes
            if (changes.get_calendar_event) {
                const newCalendarEvent = changes.get_calendar_event.newValue;
                let getCalendarEvent = doGetSparkFeature(newCalendarEvent);
                let getTask = doGetSparkFeature(prefs_init.get_task);
                const special_prompts_ids = getActiveSpecialPromptsIDs({
                    addtags: prefs_init.add_tags,
                    addtags_api: hasSpecificIntegration(prefs_init.add_tags_use_specific_integration, prefs_init.add_tags_connection_type),
                    get_calendar_event: getCalendarEvent,
                    get_task: getTask,
                    is_chatgpt_web: (prefs_init.connection_type === "chatgpt_web")
                  });                  
                menus.reload(special_prompts_ids);
            }

            // Process 'get_task' changes
            if (changes.get_task) {
                const newTask = changes.get_task.newValue;
                let getCalendarEvent = doGetSparkFeature(prefs_init.get_calendar_event);
                let getTask = doGetSparkFeature(newTask);
                const special_prompts_ids = getActiveSpecialPromptsIDs({
                    addtags: prefs_init.add_tags,
                    addtags_api: hasSpecificIntegration(prefs_init.add_tags_use_specific_integration, prefs_init.add_tags_connection_type),
                    get_calendar_event: getCalendarEvent,
                    get_task: getTask,
                    is_chatgpt_web: (prefs_init.connection_type === "chatgpt_web")
                  });                  
                menus.reload(special_prompts_ids);
            }

            // Process 'connection_type' changes
            if (changes.connection_type) {
                const newConnectionType = changes.connection_type.newValue;
                let getCalendarEvent = doGetSparkFeature(prefs_init.get_calendar_event);
                let getTask = doGetSparkFeature(prefs_init.get_task);
                const special_prompts_ids = getActiveSpecialPromptsIDs({
                    addtags: prefs_init.add_tags,
                    addtags_api: hasSpecificIntegration(prefs_init.add_tags_use_specific_integration, prefs_init.add_tags_connection_type),
                    get_calendar_event: getCalendarEvent,
                    get_task: getTask,
                    is_chatgpt_web: (newConnectionType === "chatgpt_web")
                  });                  
                menus.reload(special_prompts_ids);

                if(newConnectionType === "chatgpt_web"){
                    removeContextMenu(contextMenuID_AddTags);
                    removeContextMenu(contextMenuID_Spamfilter);
                }
                addContextMenuItems();
            }

            // context menu changes for add_tags and spamfilter
            if (changes.add_tags_context_menu) {
                if(changes.add_tags_context_menu.newValue){
                    addContextMenu(contextMenuID_AddTags);
                }else{
                    removeContextMenu(contextMenuID_AddTags);
                }
            }
            if (changes.add_tags) {
                if(changes.add_tags.newValue){
                    if(prefs_init.add_tags_context_menu){
                        addContextMenu(contextMenuID_AddTags);
                    }
                }else{
                    removeContextMenu(contextMenuID_AddTags);
                }
            }
            if (changes.spamfilter_context_menu) {
                if(changes.spamfilter_context_menu.newValue){
                    addContextMenu(contextMenuID_Spamfilter);
                }else{
                    removeContextMenu(contextMenuID_Spamfilter);
                }
            }
            if (changes.spamfilter) {
                if(changes.spamfilter.newValue){
                    if(prefs_init.spamfilter_context_menu){
                        addContextMenu(contextMenuID_Spamfilter);
                    }
                }else{
                    removeContextMenu(contextMenuID_Spamfilter);
                }
            }
            reload_pref_init();
        }
    });
}

// Call the function to set up the listener
setupStorageChangeListener();

// Register the listener for removed permissions
function setupPermissionsRemovedListener() {
    browser.permissions.onRemoved.addListener((permissions) => {
        // console.log(">>>>>>>>>>> Permissions onRemoved permissions: " + JSON.stringify(permissions));
        // Process 'tags' permissions removal
        if (["messagesTags", "messagesUpdate"].some(permission => permissions.permissions.includes(permission))) {
            // console.log(">>>>>>>>>>> Permissions onRemoved: tags");
            browser.storage.sync.set({add_tags: false});
        }
        // Process 'spamfilter' permissions removal
        if (["messagesMove", "messagesUpdate"].some(permission => permissions.permissions.includes(permission))) {
            // console.log(">>>>>>>>>>> Permissions onRemoved: spamfilter");
            browser.storage.sync.set({spamfilter: false});
        }
    });
}

// Call the function to set up the listener
setupPermissionsRemovedListener();

// Menus handling
const menus = new mzta_Menus(openChatGPT, prefs_init.do_debug);
menus.loadMenus(special_prompts_ids);

// Context Menus
function addContextMenu(menu_id) {
    browser.menus.remove(menu_id);
    browser.menus.create({
        id: menu_id,
        title: browser.i18n.getMessage("context_menu_" + menu_id),
        contexts: ["message_list"],
        icons: contextMenuIconsPath[menu_id],
    });
    taLog.log("Context menu added: " + menu_id);
    // console.log(">>>>>>> contextMenuIconsPath[menu_id]: " + contextMenuIconsPath[menu_id]);
}

function removeContextMenu(menu_id) {
    browser.menus.remove(menu_id);
    taLog.log("Context menu removed: " + menu_id);
}

function addContextMenuItems() {
    // Add Context menu: Add tags
    if(prefs_init.add_tags && prefs_init.add_tags_context_menu && checkAPIIntegration(prefs_init.connection_type, prefs_init.add_tags_use_specific_integration,prefs_init.add_tags_connection_type)){
        addContextMenu(contextMenuID_AddTags);
    }

    // Add Context menu: Spamfilter
    if(prefs_init.spamfilter && prefs_init.spamfilter_context_menu && checkAPIIntegration(prefs_init.connection_type, prefs_init.spamfilter_use_specific_integration,prefs_init.spamfilter_connection_type)){
        addContextMenu(contextMenuID_Spamfilter);
    }
}

addContextMenuItems();

// Listen for context menu item clicks
browser.menus.onClicked.addListener( (info, tab) => {
    let _add_tags = false
    let _spamfilter = false
    if(info.menuItemId === contextMenuID_AddTags){
        _add_tags = true;
    }
    if(info.menuItemId === contextMenuID_Spamfilter){
        _spamfilter = true;
    }
    if(_add_tags || _spamfilter){
        processEmails(getMessages(info.selectedMessages), _add_tags, _spamfilter);
    }
});


// Listening for new received emails
const newEmailListener = (folder, messagesList) => {

    if(!_process_incoming){
        return;
    }

    taLog.log("New mail received");
    taLog.log(`Folder: ${folder.name}`);

    async function _newEmailListener(){
        let messages = getMessages(messagesList);

        taSpamReport.logger = taLog;

        let add_tags_auto_enabled = prefs_init.add_tags && prefs_init.add_tags_auto;

        await processEmails(messages, add_tags_auto_enabled, prefs_init.spamfilter);

        if(prefs_init.spamfilter){
            taSpamReport.truncReportData();
        }
    }

    return _newEmailListener();
}

async function processEmails(messages, addTagsAuto, spamFilter) {
    taWorkingStatus.startWorking();
    
    let prefs_aats = await browser.storage.sync.get({
        add_tags_maxnum: prefs_default.add_tags_maxnum,
        connection_type: prefs_default.connection_type,
        add_tags_force_lang: prefs_default.add_tags_force_lang,
        default_chatgpt_lang: prefs_default.default_chatgpt_lang,
        add_tags_auto_force_existing: prefs_default.add_tags_auto_force_existing,
        add_tags_enabled_accounts: prefs_default.add_tags_enabled_accounts,
        add_tags_exclusions_exact_match: prefs_default.add_tags_exclusions_exact_match,
        add_tags_auto_uselist: prefs_default.add_tags_auto_uselist,
        add_tags_auto_uselist_list: prefs_default.add_tags_auto_uselist_list,
        spamfilter_enabled_accounts: prefs_default.spamfilter_enabled_accounts,
        add_tags_use_specific_integration: prefs_default.add_tags_use_specific_integration,
        spamfilter_use_specific_integration: prefs_default.spamfilter_use_specific_integration,
        do_debug: prefs_default.do_debug,
    });

    for await (let message of messages) {
        let curr_fullMessage = null;
        let msg_text = null;
        let body_text = '';

        if (addTagsAuto || spamFilter) {
            curr_fullMessage = await browser.messages.getFull(message.id);
            msg_text = getMailBody(curr_fullMessage);
            taLog.log("Starting from the HTML body if present and converting to plain text...");
            body_text = htmlBodyToPlainText(msg_text.html);
            if( body_text.length == 0 ){
                taLog.log("No HTML found in the message body, using plain text...");
                body_text = msg_text.text.replace(/\s+/g, ' ').trim();
            }
        }

        if (addTagsAuto) {
            if(prefs_aats.add_tags_enabled_accounts.length > 0){
                let accountId = message.folder.accountId;
                if(!prefs_aats.add_tags_enabled_accounts.includes(accountId)){
                    taLog.log("Account " + accountId + " not enabled for add_tags, skipping...");
                    continue;
                }
            }
            let specialFullPrompt_add_tags = '';
            let curr_prompt_add_tags = menus.allPrompts.find(p => p.id === 'prompt_add_tags');
            let tags_full_list = await getTagsList();
            //  console.log(">>>>>>>>>>>>> curr_prompt_add_tags: " + JSON.stringify(curr_prompt_add_tags));
            let chatgpt_lang = await taPromptUtils.getDefaultLang(curr_prompt_add_tags);
            specialFullPrompt_add_tags = await taPromptUtils.preparePrompt({
                curr_prompt: curr_prompt_add_tags,
                curr_message: message,
                chatgpt_lang: chatgpt_lang,
                body_text: body_text,
                subject_text: curr_fullMessage.headers.subject,
                msg_text: msg_text,
                tags_full_list: tags_full_list
            });
            specialFullPrompt_add_tags = taPromptUtils.finalizePrompt_add_tags(specialFullPrompt_add_tags, prefs_aats.add_tags_maxnum, prefs_aats.add_tags_force_lang, prefs_aats.default_chatgpt_lang, prefs_aats.add_tags_auto_uselist, prefs_aats.add_tags_auto_uselist_list);
            taLog.log("Special prompt: " + specialFullPrompt_add_tags);
            // console.log(">>>>>>>>>> curr_prompt_add_tags.model: " + curr_prompt_add_tags.model);
            let cmd_addTags = new mzta_specialCommand({
                prompt: specialFullPrompt_add_tags,
                llm: getConnectionType(prefs_aats.connection_type, curr_prompt_add_tags, prefs_aats.add_tags_use_specific_integration),
                custom_model: curr_prompt_add_tags.model ? curr_prompt_add_tags.model : '',
                do_debug: prefs_aats.do_debug
            });
            await cmd_addTags.initWorker();
            let tags_current_email = [];
            try {
                tags_current_email = taPromptUtils.getTagsFromResponse(await cmd_addTags.sendPrompt(), prefs_aats.add_tags_auto_uselist, prefs_aats.add_tags_auto_uselist_list);
            } catch (err) {
                console.error("[ThunderAI | Auto add_tags] Error getting tags: ", err);
            }
            taLog.log("tags_current_email: " + JSON.stringify(tags_current_email));
            let _data = { messageId: message.id, tags: tags_current_email };
            _assign_tags(_data, !prefs_aats.add_tags_auto_force_existing, prefs_aats.add_tags_exclusions_exact_match);
        }

        if (spamFilter) {
            if(prefs_aats.spamfilter_enabled_accounts.length > 0){
                let accountId = message.folder.accountId;
                if(!prefs_aats.spamfilter_enabled_accounts.includes(accountId)){
                    taLog.log("Account " + accountId + " not enabled for spamfilter, skipping...");
                    continue;
                }
            }
            let curr_prompt_spamfilter = await getSpamFilterPrompt();
            // console.log(">>>>>>>>>>>>> curr_prompt_spamfilter: " + JSON.stringify(curr_prompt_spamfilter));
            let chatgpt_lang = await taPromptUtils.getDefaultLang(curr_prompt_spamfilter);
            let specialFullPrompt_spamfilter = await taPromptUtils.preparePrompt({
                curr_prompt: curr_prompt_spamfilter,
                curr_message: message,
                chatgpt_lang: chatgpt_lang,
                body_text: body_text,
                subject_text: curr_fullMessage.headers.subject,
                msg_text: msg_text
            });
            taLog.log("Special prompt: " + specialFullPrompt_spamfilter);
            // console.log(">>>>>>>> Special prompt for spamfilter: " + specialFullPrompt_spamfilter);
            let cmd_spamfilter = new mzta_specialCommand({
                prompt: specialFullPrompt_spamfilter,
                llm: getConnectionType(prefs_aats.connection_type, curr_prompt_spamfilter, prefs_aats.spamfilter_use_specific_integration),
                custom_model: curr_prompt_spamfilter.model ? curr_prompt_spamfilter.model : '',
                do_debug: prefs_aats.do_debug
            });
            await cmd_spamfilter.initWorker();
            let spamfilter_result = '';
            taLog.log("Sending the prompt...");
            try {
                spamfilter_result = (await cmd_spamfilter.sendPrompt()).trim();
            } catch (err) {
                console.error("[ThunderAI | SpamFilter] Error getting spamfilter: ", err);
            }
            taLog.log("spamfilter_result: " + spamfilter_result);
            let jsonObj = {};
            taLog.log("Decoding the AI response...");
            try {
                jsonObj = extractJsonObject(spamfilter_result);
            } catch (e) {
                console.error("[ThunderAI | SpamFilter] Error extracting JSON from AI response: ", e);
            }
            taLog.log("SpamFilter jsonObj: " + JSON.stringify(jsonObj));

            let report_data = {};
            report_data.report_date = new Date();
            report_data.headerMessageId = message.headerMessageId;
            report_data.spamValue = jsonObj.spamValue;
            report_data.explanation = jsonObj.explanation;
            report_data.subject = curr_fullMessage.headers.subject;
            report_data.from = curr_fullMessage.headers.from;
            report_data.message_date = new Date(message.date);
            report_data.moved = false;
            report_data.SpamThreshold = prefs_init.spamfilter_threshold;

            if (jsonObj.spamValue >= prefs_init.spamfilter_threshold) {
                taLog.log("Marking as spam [" + message.headerMessageId + "]");
                messenger.messages.update(message.id, { junk: true });
                let spamFolder = await messenger.folders.query({ accountId: message.folder.accountId, specialUse: ['junk'] });
                messenger.messages.move([message.id], spamFolder[0].id);
                report_data.moved = true;
                taLog.log("Marked as spam [" + message.headerMessageId + "]");
            }

            taSpamReport.saveReportData(report_data, message.headerMessageId);
        }
    }
    taWorkingStatus.stopWorking();
}



try {
    browser.messages.onNewMailReceived.addListener(newEmailListener, !prefs_init.add_tags_auto_only_inbox);
} catch (e) {
    taLog.log("Using browser.messages.onNewMailReceived.addListener with one agrument for Thunderbird 115.");
    browser.messages.onNewMailReceived.addListener(newEmailListener);
}
