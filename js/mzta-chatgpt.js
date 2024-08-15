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


// Some original methods derived from https://github.com/KudoAI/chatgpt.js/blob/7eb8463cd61143fa9e1d5a8ec3c14d3c1b286e54/chatgpt.js
// Using a full string to inject it in the ChatGPT page to avoid any security error

export const mzta_script = `
let force_go = false;
let current_message = null;
let current_action = null;
let selectionChangeTimeout = null;
let isDragging = false;

async function chatgpt_sendMsg(msg, method ='') {       // return -1 send button not found, -2 textarea not found
    const textArea = document.querySelector('form textarea'),
            sendButton = document.querySelector('path[d*="M15.192 8.906a1.143"]')?.parentNode.parentNode  // post-GPT-4o;
            || document.querySelector('[data-testid="send-button"]'); // pre-GPT-4o
    //check if the textarea has been found
    if(!textArea) {
        return -2;
    }
    textArea.value = msg;
    textArea.dispatchEvent(new Event('input', { bubbles: true })); // enable send button
    //check if the sendbutton has been found
    if (!sendButton) {
        return -1;
    }
    const delaySend = setInterval(() => {
        if (!sendButton?.hasAttribute('disabled')) { // send msg
            method.toLowerCase() == 'click' ? sendButton.click()
                : textArea.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true }));
            clearInterval(delaySend);
        }
    }, 25);
    return 0;   //everything is ok
}

async function chatgpt_isIdle() {
    return new Promise(resolve => {
        const intervalId = setInterval(() => {
            if (chatgpt_getRegenerateButton()) {
                clearInterval(intervalId); resolve(true);
}}, 100);});}

function chatgpt_getRegenerateButton() {
    for (const mainSVG of document.querySelectorAll('main svg')) {
        if (mainSVG.querySelector('path[d*="M3.07 10.876C3.623"]')) // regen icon found
            return mainSVG.parentNode.parentNode;
    }
}

function chatpgt_scrollToBottom () {
    try { document.querySelector('button[class*="cursor"][class*="bottom"]').click(); }
    catch (err) { console.error('[ThunderAI] ', err); }
}

function addCustomDiv(prompt_action,tabId,mailMessageId) {
    // Create <style> element for the CSS
    var style = document.createElement('style');
    style.textContent = ".mzta-header-fixed {position: fixed;bottom: 0;left: 0;height:100px;width: 100%;background-color: #333;color: white;text-align: center;padding: 10px 0;z-index: 1000;border-top: 3px solid white;}"
    style.textContent += "body {padding-bottom: 100px;} [id^='headlessui-dialog-panel-:r']{padding-bottom: 100px;}";
    style.textContent += ".mzta-btn {background-color: #007bff;border: none;color: white;padding: 8px 15px;text-align: center;text-decoration: none;display: inline-block;font-size: 16px;margin: 4px 2px;transition-duration: 0.4s;cursor: pointer;border-radius: 5px;}";
    style.textContent += ".mzta-btn:hover {background-color:#0056b3;color:white;}";
    style.textContent += ".btn_disabled {background-color: #6a829b !important;color: white !important;cursor: not-allowed;}";
    style.textContent += ".btn_disabled:hover {background-color:#6a829b !important;color:white !important;}";
    style.textContent += "#mzta-loading{height:50px;display:inline-block;}";
    style.textContent += "#mzta-model_warn{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);max-height:100%px;min-width:30%;max-width:50%;padding:3px;border-radius:5px;text-align:center;background-color:#FFBABA;border:1px solid;font-size:13px;color:#D8000C;display:none;}#mzta-model_warn a{color:blue;text-decoration: underline;}";
    style.textContent += "#mzta-btn_gpt35 {background-color: #007bff;border: none;color: white;padding: 2px 4px;text-align: center;text-decoration: none;display: none;font-size: 13px;margin-left: 4px;transition-duration: 0.4s;cursor: pointer;border-radius: 2px;}";
    style.textContent += "#mzta-status-page{position:fixed;bottom:0;left:0;padding-left:5px;font-size:13px;font-style:italic;text-decoration:underline;color:#919191;}";
    style.textContent += "#mzta-force-completion{cursor:pointer;position:fixed;bottom:0;right:0;padding-right:5px;font-size:13px;font-style:italic;text-decoration:underline;color:#919191;}";
    style.textContent += "#mzta-status-page:hover, #mzta-force-completion:hover{color:#007bff;}";
    style.textContent += "#mzta-custom_text{padding:10px;width:auto;max-width:80%;height:auto;max-height:80%;border-radius:5px;overflow:auto;position:fixed;top:50%;left:50%;display:none;transform:translate(-50%,-50%);text-align:center;background:#333;color:white;border:3px solid white;}";
    style.textContent += "#mzta-custom_loading{height:50px;display:none;}";
    style.textContent += "#mzta-custom_textarea{color:black;padding:1px;font-size:15px;width:100%;}";
    style.textContent += "#mzta-custom_info{text-align:center;width:100%;padding-bottom:10px;font-size:15px;}";
    style.textContent += "#mzta-prompt-name{font-size:13px;font-style:italic;color:#919191;position:fixed;bottom:75px;;left:0;padding-left:5px;}";

    // Add <style> to the page's <head>
    document.head.appendChild(style);

    // Fixed div
    var fixedDiv = document.createElement('div');
    fixedDiv.classList.add('mzta-header-fixed');
    fixedDiv.textContent = '';

    // Model warning div
    var modelWarnDiv = document.createElement('div');
    modelWarnDiv.id = 'mzta-model_warn';
    modelWarnDiv.textContent = browser.i18n.getMessage("chatgpt_win_model_warning");
    fixedDiv.appendChild(modelWarnDiv);

    // GPT-3 Button
    var btn_gpt35 = document.createElement('button');
    btn_gpt35.id="mzta-btn_gpt35";
    btn_gpt35.textContent = browser.i18n.getMessage("chatgpt_use_gpt35");
    btn_gpt35.onclick = async function() {
        browser.storage.sync.set({chatpgt_use_gpt4: false});
        force_go = true;
    };
    modelWarnDiv.appendChild(btn_gpt35);
    
    //prompt name
    var prompt_name_div = document.createElement('div');
    prompt_name_div.id = 'mzta-prompt-name';
    prompt_name_div.title= browser.i18n.getMessage("currently_used_prompt");
    prompt_name_div.textContent = mztaPromptName;
    fixedDiv.appendChild(prompt_name_div);

    //status page
    var status_page_div = document.createElement('div');
    status_page_div.id = 'mzta-status-page';
    status_page_div.innerHTML = '<a href="https://micz.it/thunderbird-addon-thunderai/status/">'+ mztaStatusPageDesc +'</a>';
    fixedDiv.appendChild(status_page_div);

    //force completion
    var force_completion_div = document.createElement('div');
    force_completion_div.id = 'mzta-force-completion';
    force_completion_div.textContent = mztaForceCompletionDesc;
    force_completion_div.title = mztaForceCompletionTitle;
    force_completion_div.addEventListener('click', function() {
        operation_done();
    });
    fixedDiv.appendChild(force_completion_div);

    // span for the text
    var curr_msg = document.createElement('span');
    curr_msg.id='mzta-curr_msg';
    curr_msg.textContent = browser.i18n.getMessage("chatgpt_win_working");
    curr_msg.style.display = 'block';
    fixedDiv.appendChild(curr_msg);

    var loading = document.createElement('img');
    loading.src = browser.runtime.getURL("/images/loading.gif");
    loading.id = "mzta-loading";
    fixedDiv.appendChild(loading);

    var btn_ok = document.createElement('button');
    btn_ok.id="mzta-btn_ok";
    btn_ok.classList.add('mzta-btn');
    //console.log('default: '+prompt_action)
    switch(String(prompt_action)){ 
        default:
        case "0":     // close window
            btn_ok.textContent = browser.i18n.getMessage("chatgpt_win_close");
            btn_ok.onclick = async function() {
                browser.runtime.sendMessage({command: "chatgpt_close"});
            };
            break;
        case "1":     // do reply
            btn_ok.disabled = true;
            btn_ok.textContent = browser.i18n.getMessage("chatgpt_win_get_answer");
            btn_ok.onclick = async function() {
                const response = getSelectedHtml();
                browser.runtime.sendMessage({command: "chatgpt_replyMessage", text: response, tabId: tabId, mailMessageId: mailMessageId});
                //console.log(response);
                browser.runtime.sendMessage({command: "chatgpt_close"});
            };
            break;
        case "2":     // replace text
            btn_ok.disabled = true;
            btn_ok.textContent = browser.i18n.getMessage("chatgpt_win_get_answer");
            btn_ok.onclick = async function() {
                const response = getSelectedHtml();
                //console.log('replace text: '+tabId)
                browser.runtime.sendMessage({command: "chatgpt_replaceSelectedText", text: response, tabId: tabId, mailMessageId: mailMessageId});
                //console.log(response);
                browser.runtime.sendMessage({command: "chatgpt_close"});
            };
            break;
    }
    btn_ok.style.display = 'none';
    fixedDiv.appendChild(btn_ok);

    //div per custom text
    let customDiv = document.createElement('div');
    customDiv.id = 'mzta-custom_text';
    let customInfo = document.createElement('div');
    customInfo.id = 'mzta-custom_info';
    customInfo.textContent = browser.i18n.getMessage("chatgpt_win_custom_text");
    customDiv.appendChild(customInfo);
    let customTextArea = document.createElement('textarea');
    customTextArea.id = 'mzta-custom_textarea';
    customDiv.appendChild(customTextArea);
    let customLoading = document.createElement('img');
    customLoading.src = browser.runtime.getURL("/images/loading.gif");
    customLoading.id = "mzta-custom_loading";
    customDiv.appendChild(customLoading);
    let customBtn = document.createElement('button');
    customBtn.id = 'mzta-custom_btn';
    customBtn.textContent = browser.i18n.getMessage("chatgpt_win_send");
    customBtn.classList.add('mzta-btn');
    customBtn.addEventListener("click", () => { customTextBtnClick({customBtn:customBtn,customLoading:customLoading,customDiv:customDiv}) });
    customTextArea.addEventListener("keydown", (event) => { if(event.code == "Enter" && event.ctrlKey) customTextBtnClick({customBtn:customBtn,customLoading:customLoading,customDiv:customDiv}) });
    customDiv.appendChild(customBtn);
    fixedDiv.appendChild(customDiv);

    document.body.insertBefore(fixedDiv, document.body.firstChild);
}

function customTextBtnClick(args) {
    const customText = document.getElementById('mzta-custom_textarea').value;
    args.customBtn.disabled = true;
    args.customBtn.classList.add('disabled');
    args.customLoading.style.display = 'inline-block';
    args.customLoading.style.display = 'none';
    doProceed(current_message,customText);
    args.customDiv.style.display = 'none';
}

function checkGPT4Model() {
  return new Promise((resolve, reject) => {
    // Set up an interval that shows the warning after 2 seconds
    const intervalId2 = setTimeout(() => {
        document.getElementById('mzta-model_warn').style.display = 'inline-block';
        document.getElementById('mzta-btn_gpt35').style.display = 'inline';
    }, 2000);
    // Set up an interval that checks the value every 100 milliseconds
    const intervalId = setInterval(() => {
      // Get the '.text-token-text-secondary' element
     // const element = document.querySelector('div#radix-\\\\:ri2\\\\: > div > span.text-token-text-secondary');
     const elements = document.querySelectorAll('[id*=radix] span')

     for(element of elements){
      // Check if the element exists and its content is '4' or '4o'
      if ((element && element.textContent === '4')||(element && element.textContent === '4o')||(force_go)) {
        // console.log("[ThunderAI] The GPT Model is now '4' or '4o'");
        clearInterval(intervalId);
        clearTimeout(intervalId2);
        document.getElementById('mzta-model_warn').style.display = 'none';
        document.getElementById('mzta-btn_gpt35').style.display = 'none';
        resolve("GPT4");
        break;
      } else if (!element) {
        console.error("[ThunderAI] Element not found!");
        clearInterval(intervalId);
        reject("Element not found.");
      }
     }
    }, 200);
  });
}


function operation_done(){
    let curr_msg = document.getElementById('mzta-curr_msg');
    curr_msg.textContent = browser.i18n.getMessage("chatgpt_win_job_completed");
    if(current_action != '0'){
        curr_msg.textContent += " " + browser.i18n.getMessage("chatgpt_win_job_completed_select"); 
    }
    curr_msg.style.display = 'block';
    document.getElementById('mzta-btn_ok').style.display = 'inline';
    document.getElementById('mzta-loading').style.display = 'none';
    document.getElementById('mzta-force-completion').style.display = 'none';
    chatpgt_scrollToBottom();
}

function checkLoggedIn(){
    return !window.location.href.startsWith('https://chatgpt.com/auth/');
}

function showCustomTextField(){
    document.getElementById('mzta-custom_text').style.display = 'block';
}

async function doProceed(message, customText = ''){
    let prefs = await browser.storage.sync.get({chatpgt_use_gpt4:false});
    if(prefs.chatpgt_use_gpt4){
        await checkGPT4Model();
    }
    //await chatgpt.isLoaded();
    let send_result = await chatgpt_sendMsg(message.prompt+' '+customText,'click');
    switch(send_result){
        case -1:        // send button not found
            let curr_msg = document.getElementById('mzta-curr_msg');
            curr_msg.style.display = 'block';
            curr_msg.textContent = browser.i18n.getMessage("chatgpt_sendbutton_not_found_error");
            break;
        case -2:    // textarea not found
            let curr_model_warn = document.getElementById('mzta-model_warn');
            curr_model_warn.textContent = browser.i18n.getMessage("chatgpt_textarea_not_found_error");
            curr_model_warn.style.display = 'inline-block';
            document.getElementById('mzta-curr_msg').textContent = "";
            document.getElementById('mzta-loading').style.display = 'none';
            break;
    }
    await chatgpt_isIdle();
    operation_done();
}


function removeTagsAndReturnHTML(rootElement, removeTags, preserveTags) {
    const fragment = document.createDocumentFragment();

    function handleElement(element) {
        let child = element.firstChild;
        while (child) {
            const nextSibling = child.nextSibling;
            if (preserveTags.includes(child.nodeName.toLowerCase())) {
                //console.log(">>>>>>>>>>>> preserve child: " + child.tagName.toLowerCase());
                fragment.appendChild(child);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                //console.log(">>>>>>>>>>>> handleElement(child): " + child.tagName.toLowerCase());
                handleElement(child);
            }
            child = nextSibling;
        }
    }

    removeTags.forEach(tag => {
        const elements = Array.from(rootElement.getElementsByTagName(tag));
        elements.forEach(element => {
            handleElement(element);
            element.parentNode.insertBefore(fragment.cloneNode(true), element);
            element.parentNode.removeChild(element);
            //console.log(">>>>>>>>>>>> removeChild: " + element.tagName.toLowerCase());
        });
    });

    replaceNewlinesWithBr(rootElement);
    //console.log(">>>>>>>>>>>> rootElement.innerHTML: " + rootElement.innerHTML);
    // Return the updated HTML as a string
    return rootElement.innerHTML;
}

// Replace newline characters with <br> tags
function replaceNewlinesWithBr(node) {
    for (let child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            const parts = child.textContent.split('\\n');
            if (parts.length > 1) {
                const fragment = document.createDocumentFragment();
                parts.forEach((part, index) => {
                    fragment.appendChild(document.createTextNode(part));
                    if (index < parts.length - 1) {
                        fragment.appendChild(document.createElement('br'));
                    }
                });
                child.parentNode.replaceChild(fragment, child);
            }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            replaceNewlinesWithBr(child);
        }
    }
}

function getSelectedHtml() {
    // Get the Selection object
    var selection = window.getSelection();
    
    if (selection.rangeCount > 0) {
        // Get the first selected range
        var range = selection.getRangeAt(0);
        
        // Create a new temporary div
        var tempDiv = document.createElement("div");
        
        // Clone the contents of the range into the temporary div
        tempDiv.appendChild(range.cloneContents());
        
        // Return the HTML of the selected content
        return tempDiv.innerHTML.replace(/^<p>&quot;/, '<p>').replace(/&quot;<\\/p>$/, '</p>'); // strip quotation marks;
    }
    return "";
}

function isSomethingSelected() {
    // Get the Selection object
    var selection = window.getSelection();
    
    // Check if the selection range count is greater than 0 and the selection is not empty
    return selection.rangeCount > 0 && !selection.isCollapsed;
}

document.addEventListener("selectionchange", function() {
     // Clear any previous timeout to reset the delay
     clearTimeout(selectionChangeTimeout);
     if(current_action === '0'){
         return;
     }
     // Set a timeout to delay the execution of the callback
     selectionChangeTimeout = setTimeout(function() {
        let btn_ok = document.getElementById('mzta-btn_ok');
        if (isSomethingSelected()) {
            btn_ok.disabled = false;
            btn_ok.classList.remove('btn_disabled');
        } else {
            btn_ok.disabled = true;
            btn_ok.classList.add('btn_disabled');
        }
     }, 300); // Delay in milliseconds
});

function selectContentOnMouseDown(event) {
    // Reset the dragging flag when the mouse is pressed down
    isDragging = false;
}

function selectContentOnMouseMove(event) {
    // Set the dragging flag to true if the mouse moves
    isDragging = true;
}

function selectContentOnMouseUp(event) {
    var excludedArea = document.querySelector('.mzta-header-fixed');

    if (excludedArea && excludedArea.contains(event.target)) {
        // If the click was inside the excluded area, do nothing
        return;
    }

    if ((!isDragging)&&(!isSomethingSelected())) {
        // If no dragging has occurred, execute the selection code
        selectContentOnClick(event);
    }
    // Remove the event listeners to prevent future executions
    // document.removeEventListener('mousedown', selectContentOnMouseDown);
    // document.removeEventListener('mousemove', selectContentOnMouseMove);
    // document.removeEventListener('mouseup', selectContentOnMouseUp);
}

function selectContentOnClick(event) {
    if(current_action === '0'){
        return;
    }

    // Prevent the default behavior of the click
    event.preventDefault();

    // Get the element that was clicked
    var clickedElement = event.target;

    // Traverse the DOM upwards to find the nearest parent div
    var parentDiv = clickedElement.closest('div');

    if (parentDiv) {
        // Create a range object
        var range = document.createRange();

        // Select the contents of the div
        range.selectNodeContents(parentDiv);

        // Get the selection object
        var selection = window.getSelection();

        // Clear any existing selections
        selection.removeAllRanges();

        // Add the new range to the selection
        selection.addRange(range);
    }
}


// In the content script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.command === "chatgpt_send") {
        if(!checkLoggedIn()){
            // User not logged in
            alert(browser.i18n.getMessage("chatgpt_user_not_logged_in"));
        }else{
            current_action = message.action;
            addCustomDiv(message.action,message.tabId,message.mailMessageId);
            (async () => {
                if(mztaDoCustomText === 1){
                    current_message = message;
                    showCustomTextField();
                } else {
                    await doProceed(message);
                }
                    // Add an event listener to the document to detect clicks
                    document.addEventListener('mousedown', selectContentOnMouseDown);
                    document.addEventListener('mousemove', selectContentOnMouseMove);
                    document.addEventListener('mouseup', selectContentOnMouseUp);
            })();
        }
    }
});

`
