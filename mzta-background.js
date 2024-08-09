/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024  Mic (m@micz.it)

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
import { getCurrentIdentity, getOriginalBody, replaceBody, setBody, i18nConditionalGet } from './js/mzta-utils.js';

var createdWindowID = null;
var original_html = '';
var modified_html = '';

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
    browser.tabs.executeScript(messageTab.id, {
        file: "js/mzta-compose-script.js"
    })
}

messenger.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    // Check what type of message we have received and invoke the appropriate
    // handler function.
    if (message && message.hasOwnProperty("command")){
        switch (message.command) {
            // case 'chatgpt_open':
            //         openChatGPT(message.prompt,message.action,message.tabId);
            //         return true;
            case 'chatgpt_close':
                    browser.windows.remove(createdWindowID).then(() => {
                        console.log("[ThunderAI] ChatGPT window closed successfully.");
                        return true;
                    }).catch((error) => {
                        console.error("[ThunderAI] Error closing ChatGPT window:", error);
                        return false;
                    });
                    break;
            case 'chatgpt_replaceSelectedText':
                    //console.log('chatgpt_replaceSelectedText: [' + message.tabId +'] ' + message.text)
                    original_html = await getOriginalBody(message.tabId);
                    await browser.tabs.sendMessage(message.tabId, { command: "replaceSelectedText", text: message.text, tabId: message.tabId });
                    return true;
            case 'chatgpt_replyMessage':
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
                browser.messages.get(message.mailMessageId).then(async (mailMessage) => {
                let curr_idn = await getCurrentIdentity(mailMessage)
                let reply_tab = await browser.compose.beginReply(mailMessage.id, replyType, {
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
                });
                break;
            case 'compose_reloadBody':
                modified_html = await getOriginalBody(message.tabId);
                await setBody(message.tabId, original_html);
                await setBody(message.tabId, modified_html);
                break;
            case 'reload_menus':
                await menus.reload();
                console.log('[ThunderAI] Reloaded menus');
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
    prefs = checkScreenDimensions(prefs);
    //console.log(">>>>>>>>>>>>>>>> prefs: " + JSON.stringify(prefs));
    console.log('[ThunderAI] Prompt length: ' + promptText.length);
    if(promptText.length > 30000 ){
        // Prompt too long for ChatGPT
        browser.tabs.sendMessage(curr_tabId, { command: "promptTooLong" });
        return;
    }

    if(prefs.connection_type === 'chatgpt_api'){
        // check if the API is present, otherwise open the web interface
        if (prefs.chatgpt_api_key == '') {
            showNotification(browser.i18n.getMessage('error'),browser.i18n.getMessage('chatgpt_empty_apikey'));
            prefs.connection_type = 'chatgpt_web';
        }
        if (prefs.chatgpt_model == '') {
            showNotification(browser.i18n.getMessage('error'),browser.i18n.getMessage('chatgpt_empty_model'));
            prefs.connection_type = 'chatgpt_web';
}
    }

    switch(prefs.connection_type){
        case 'chatgpt_web':
        // We are using the ChatGPT web interface
        let newWindow = await browser.windows.create({
            url: "https://chatgpt.com",
            type: "popup",
            width: prefs.chatgpt_win_width,
            height: prefs.chatgpt_win_height
        });

        console.log("[ThunderAI] ChatGPT web interface script started...");
        createdWindowID = newWindow.id;
        let createdTab = newWindow.tabs[0];

        // Wait for tab loaded.
        await new Promise(resolve => {
            const tabIsLoaded = tab => {
                return tab.status == "complete" && tab.url != "about:blank";
            };
            const listener = (tabId, changeInfo, updatedTab) => {
                if (tabIsLoaded(updatedTab)) {
                    browser.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            }
            // Early exit if loaded already
            if (tabIsLoaded(createdTab)) {
                resolve();
            } else {
                browser.tabs.onUpdated.addListener(listener);
            }
        });

        let pre_script = `let mztaStatusPageDesc="`+ browser.i18n.getMessage("prefs_status_page") +`";
        let mztaForceCompletionDesc="`+ browser.i18n.getMessage("chatgpt_force_completion") +`";
        let mztaForceCompletionTitle="`+ browser.i18n.getMessage("chatgpt_force_completion_title") +`";
        let mztaDoCustomText=`+ do_custom_text +`;
        let mztaKeepFormatting=`+ prefs.chatgpt_keep_formatting +`;
        let mztaPromptName="[`+ i18nConditionalGet(prompt_name) +`]";
        `;

        browser.tabs.executeScript(createdTab.id, { code: pre_script + mzta_script, matchAboutBlank: false })
            .then(async () => {
                console.log("[ThunderAI] ChatGPT web interface script injected successfully");
                let mailMessage = await browser.messageDisplay.getDisplayedMessage(curr_tabId);
                let mailMessageId = -1;
                if(mailMessage) mailMessageId = mailMessage.id;
                browser.tabs.sendMessage(createdTab.id, { command: "chatgpt_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId});
            })
            .catch(err => {
                console.error("[ThunderAI] ChatGPT web interface error injecting the script: ", err);
            });
    break;  // chatgpt_web
    case 'chatgpt_api':
        // We are using the ChatGPT API
        let newWindow2 = await browser.windows.create({
            url: browser.runtime.getURL('api_webchat/index.html'),
            type: "popup",
            width: prefs.chatgpt_win_width,
            height: prefs.chatgpt_win_height
        });

        createdWindowID = newWindow2.id;
        let createdTab2 = newWindow2.tabs[0];

        // Wait for tab loaded.         // TODO This is needed in 128+, but doesn't work in 115
        // await new Promise(resolve => {
        //     const tabIsLoaded2 = tab => {
        //         return tab.status == "complete" && tab.url != "about:blank";
        //     };
        //     const listener2 = (tabId, changeInfo, updatedTab) => {
        //         if (tabIsLoaded2(updatedTab)) {
        //             browser.tabs.onUpdated.removeListener(listener2);
        //             resolve();
        //         }
        //     }
        //     // Early exit if loaded already
        //     if (tabIsLoaded2(createdTab2)) {
        //         resolve();
        //     } else {
        //         browser.tabs.onUpdated.addListener(listener2);
        //     }
        // });

        let mailMessage = await browser.messageDisplay.getDisplayedMessage(curr_tabId);
        let mailMessageId = -1;
        if(mailMessage) mailMessageId = mailMessage.id;

        browser.tabs.sendMessage(createdTab2.id, { command: "chatgpt_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId, do_custom_text: do_custom_text});
        break;  // chatgpt_api
    }
}

function checkScreenDimensions(prefs){
    let width = window.screen.width - 50;
    let height = window.screen.height - 50;

    if(prefs.chatgpt_win_height > height) prefs.chatgpt_win_height = height - 50;
    if(prefs.chatgpt_win_width > width) prefs.chatgpt_win_width = width - 50;
    
    return prefs;
}

function showNotification(title, message) {
    browser.notifications.create({
        "type": "basic",
        "title": title,
        "iconUrl": browser.extension.getURL("images/icon.png"),
        "message": message
    });
}

// Menus handling
const menus = new mzta_Menus(openChatGPT);
menus.loadMenus();