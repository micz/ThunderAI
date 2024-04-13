import { mzta_script } from './js/mzta-chatgpt.js';
import { prefs_default } from './options/mzta-options-default.js';

var createdWindowID = null;

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
            case 'chatgpt_open':
                    openChatGPT(message.prompt,message.action,message.tabId);
                    return true;
            case 'chatgpt_close':
                    browser.windows.remove(createdWindowID).then(() => {
                        console.log("ChatGPT window closed successfully.");
                        return true;
                    }).catch((error) => {
                        console.error("Error closing ChatGPT window:", error);
                        return false;
                    });
                    break;
            case 'chatgpt_replaceSelectedText':
                    //console.log('chatgpt_replaceSelectedText: [' + message.tabId +'] ' + message.text)
                    browser.tabs.sendMessage(message.tabId, { command: "replaceSelectedText", text: message.text });
                    return true;
            case 'chatgpt_replyMessage':
                const paragraphsHtmlString = message.text;
                let prefs = await browser.storage.sync.get({reply_type: 'reply_all'});
                console.log('reply_type: ' + prefs.reply_type);
                let replyType = 'replyToAll';
                if(prefs.reply_type === 'reply_sender'){
                    replyType = 'replyToSender';
                }
                console.log('replyType: ' + replyType);
                browser.messageDisplay.getDisplayedMessage(message.tabId).then(async (mailMessage) => {
                    let reply_tab = await browser.compose.beginReply(mailMessage.id, replyType, {
                        type: "reply",
                        //body:  paragraphsHtmlString,
                        isPlainText: false,
                    })
                    
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
                        if (tabIsLoaded(reply_tab)) {
                            resolve();
                        } else {
                            browser.tabs.onUpdated.addListener(listener);
                        }
                    });
                    // we need to wait for the compose windows to load the content script
                    setTimeout(() => browser.tabs.sendMessage(reply_tab.id, { command: "insertText", text: paragraphsHtmlString }), 500);
                    return true;
                });
                break;
            default:
                break;
        }
    }
    // Return false if the message was not handled by this listener.
    return false;
});


async function openChatGPT(promptText, action, curr_tabId) {
    let prefs = await browser.storage.sync.get(prefs_default);
    prefs = checkScreenDimensions(prefs);
    console.log('Prompt length: ' + promptText.length);
    if(promptText.length > 30000 ){
        // Prompt too long for ChatGPT
        browser.tabs.sendMessage(curr_tabId, { command: "promptTooLong" });
        return;
    }
    let newWindow = await browser.windows.create({
        url: "https://chat.openai.com",
        type: "popup",
        width: prefs.chatgpt_win_width,
        height: prefs.chatgpt_win_height
    });

    console.log("Script started...");
    createdWindowID = newWindow.id;
    const createdTab = newWindow.tabs[0];

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

    browser.tabs.executeScript(createdTab.id, { code: mzta_script, matchAboutBlank: false })
        .then(async () => {
            console.log("Script injected successfully");
            browser.tabs.sendMessage(createdTab.id, { command: "chatgpt_send", prompt: promptText, action: action, tabId: curr_tabId });
        })
        .catch(err => {
            console.error("Error injecting the script: ", err);
        });
}

function checkScreenDimensions(prefs){
    let width = window.screen.width;
    let height = window.screen.height;

    if(prefs.chatgpt_win_height > height) prefs.chatgpt_win_height = height - 50;
    if(prefs.chatgpt_win_width > width) prefs.chatgpt_win_width = width - 50;
    
    return prefs;
}
