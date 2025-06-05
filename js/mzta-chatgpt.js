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


// Some original methods derived from https://github.com/KudoAI/chatgpt.js/blob/7eb8463cd61143fa9e1d5a8ec3c14d3c1b286e54/chatgpt.js
// Using a full string to inject it in the ChatGPT page to avoid any security error

export const mzta_script = `
let force_go = false;
let do_force_completion = false;
let current_message = null;
let current_action = null;
let current_tabId = null;
let current_mailMessageId = null;
let selectionChangeTimeout = null;
let isDragging = false;

async function chatgpt_sendMsg(msg, method ='') {       // return -1 send button not found, -2 textarea not found
    let textArea = document.getElementById('prompt-textarea')
    let old_textArea = false;
    if(!textArea){
        textArea = document.querySelector('form textarea');
        old_textArea = true;
    }
    //check if the textarea has been found
    if(!textArea) {
        console.error("[ThunderAI] Textarea not found!");
        return -2;
    }
    if(old_textArea){
        textArea.value = msg;
        textArea.dispatchEvent(new Event('input', { bubbles: true })); // enable send button
    } else {    // from sept 2024
        textArea.innerText = msg;
        textArea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    //wait for the button to change from the audio button to the send button (from nov-2024)
    await new Promise(resolve => setTimeout(resolve, 1000));
    let sendButton = document.querySelector('[data-testid="send-button"]') // pre-GPT-4o
        || document.querySelector('path[d*="M15.1918 8.90615C15.6381"]')?.parentNode.parentNode  // from sept-2024;
        || document.querySelector('path[d*="M15.192 8.906a1.143"]')?.parentNode.parentNode;  // post-GPT-4o;
    //check if the sendbutton has been found
    if (!sendButton) {
        console.error("[ThunderAI] Send button not found!");
        return -1;
    }
    const delaySend = setInterval(() => {
        //console.log(">>>>>>>>>> sendButton disabled: " + sendButton?.hasAttribute('disabled'));
        if (!sendButton?.hasAttribute('disabled')) { // send msg
            method.toLowerCase() == 'click' ? sendButton.click()
                : textArea.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true }));
            clearInterval(delaySend);
        }else{
            //console.error(">>>>>>>>>> The sendButton seems to be disabled! Trying again...");
         sendButton = document.querySelector('path[d*="M15.192 8.906a1.143"]')?.parentNode.parentNode  // post-GPT-4o;
            || document.querySelector('[data-testid="send-button"]');
        }
    }, 25);
    return 0;   //everything is ok
}

async function chatgpt_isIdle() {
    return new Promise(resolve => {
        const intervalId = setInterval(() => {
            if (chatgpt_getRegenerateButton() || do_force_completion) {
                clearInterval(intervalId); resolve(true);
}}, 100);});}

function chatgpt_getRegenerateButton() {
    for (const mainSVG of document.querySelectorAll('main svg.icon-md')) {
        if (mainSVG.querySelector('path[d^="M3.06957"]')){ // regen icon found
            //console.log(">>>>>>>>>> found regen icon!");
            return mainSVG.parentNode.parentNode;
        }
    }
    for (const mainSVG of document.querySelectorAll('main svg.icon-md-heavy')) {
        if (mainSVG.querySelector('path[d^="M11 4.9099C11 4.47485"]')){ // read aloud icon found
            //console.log(">>>>>>>>>> found read aloud icon!");
            return mainSVG.parentNode.parentNode;
        }
    }
}

function chatpgt_scrollToBottom () {
    try { 
        //document.querySelector('button[class*="cursor"][class*="bottom"]').click();
        document.querySelector('path[d^="M12 21C11.7348"]')?.parentNode?.parentNode?.click();
    }
    catch (err) { console.error('[ThunderAI] ', err); }
}

function addCustomDiv(prompt_action,tabId,mailMessageId) {
    // Create <style> element for the CSS
    var style = document.createElement('style');
    style.textContent = ".mzta-header-fixed {position:fixed;bottom:0;left: 0;height:100px;width:100%;background-color: #333;color: white;text-align: center;padding: 10px 0;z-index: 1000;border-top: 3px solid white;}"
    style.textContent += "body {padding-bottom: 100px !important;} [id^='headlessui-dialog-panel-:r']{padding-bottom: 100px !important;} [data-testid='screen-thread']{padding-bottom: 100px !important;} [slot='content']{padding-bottom: 100px !important;}";
    style.textContent += ".mzta-btn {background-color: #007bff;border: none;color: white;padding: 8px 15px;text-align: center;text-decoration: none;display: inline-block;font-size: 16px;margin: 4px 2px;transition-duration: 0.4s;cursor: pointer;border-radius: 5px;}";
    style.textContent += ".mzta-btn:hover {background-color:#0056b3;color:white;}";
    style.textContent += ".btn_disabled {background-color: #6a829b !important;color: white !important;cursor: not-allowed;}";
    style.textContent += ".btn_disabled:hover {background-color:#6a829b !important;color:white !important;}";
    style.textContent += "#mzta-loading{height:50px;display:inline-block;}";
    style.textContent += "#mzta-model_warn{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);max-height:100%px;min-width:30%;max-width:50%;padding:3px;border-radius:5px;text-align:center;background-color:#FFBABA;border:1px solid;font-size:13px;color:#D8000C;display:none;}#mzta-model_warn a{color:blue;text-decoration: underline;}";
    style.textContent += "#mzta-btn_model {background-color: #007bff;border: none;color: white;padding: 2px 4px;text-align: center;text-decoration: none;display: none;font-size: 13px;margin-left: 4px;transition-duration: 0.4s;cursor: pointer;border-radius: 2px;}";
    style.textContent += "#mzta-status-page{position:fixed;bottom:0;left:0;padding-left:5px;font-size:13px;font-style:italic;text-decoration:underline;color:#919191;}";
    style.textContent += "#mzta-force-completion{cursor:pointer;position:fixed;bottom:0;right:0;padding-right:5px;font-size:13px;font-style:italic;text-decoration:underline;color:#919191;}";
    style.textContent += "#mzta-status-page:hover, #mzta-force-completion:hover{color:#007bff;}";
    style.textContent += "#mzta-custom_text{padding:10px;width:auto;max-width:80%;height:auto;max-height:80%;border-radius:5px;overflow:auto;position:fixed;top:50%;left:50%;display:none;transform:translate(-50%,-50%);text-align:center;background:#333;color:white;border:3px solid white;}";
    style.textContent += "#mzta-custom_loading{height:50px;display:none;}";
    style.textContent += "#mzta-custom_textarea{color:black;padding:1px;font-size:15px;width:100%;}";
    style.textContent += "#mzta-custom_info{text-align:center;width:100%;padding-bottom:10px;font-size:15px;}";
    style.textContent += "#mzta-prompt-name{font-size:13px;font-style:italic;color:#919191;position:fixed;bottom:75px;;left:0;padding-left:5px;}";
    style.textContent += "#mzta-diff-overlay{position: fixed;top:0;left:0;width:100vw;height:100vh;background: rgba(0, 0, 0, 0.5);display:flex;justify-content:center;align-items:center;z-index:999;}";
    style.textContent += "#mzta-diff{padding:10px;border:2px solid white;border-radius:1em;position:fixed;top:50%;left:50%;width:80%;height:30em;transform:translate(-50%,-50%);z-index:9999;background-color: #333;color: white;}";
    style.textContent += "#mzta-diff_title{font-size:16px;font-weight:bold;text-align:center;padding-bottom:10px;}";
    style.textContent += "#mzta-diff_content{overflow-y:scroll;text-align:justify;width:100%;height:22.5em;}";
    style.textContent += "#mzta-diff span.added{background-color: rgb(0, 94, 0);display:inline;} #mzta-diff span.removed{background-color: rgb(90, 0, 0);display:inline;text-decoration:line-through;}";
    style.textContent += "#mzta-btn_close_diff{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);}";

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

    // GPT Model Button
    var btn_model = document.createElement('button');
    btn_model.id="mzta-btn_model";
    btn_model.textContent = browser.i18n.getMessage("chatgpt_btn_model");
    btn_model.onclick = async function() {
        force_go = true;
        document.getElementById('mzta-model_warn').style.display = 'none';
    };
    modelWarnDiv.appendChild(btn_model);
    
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
        do_force_completion = true;
    });
    fixedDiv.appendChild(force_completion_div);

    // span for the text
    var curr_msg = document.createElement('span');
    curr_msg.id='mzta-curr_msg';
    curr_msg.textContent = browser.i18n.getMessage("chatgpt_win_working");
    curr_msg.style.display = 'block';
    fixedDiv.appendChild(curr_msg);

    // loading gif
    var loading = document.createElement('img');
    loading.src = browser.runtime.getURL("/images/loading.gif");
    loading.id = "mzta-loading";
    fixedDiv.appendChild(loading);

    // OK button
    var btn_ok = document.createElement('button');
    btn_ok.id="mzta-btn_ok";
    btn_ok.classList.add('mzta-btn');
    //console.log('>>>>>>>>>>>>>>> default: '+prompt_action)
    switch(String(prompt_action)){ 
        default:
        case "0":     // close window
            btn_ok.textContent = browser.i18n.getMessage("chatgpt_win_close");
            btn_ok.onclick = async function() {
                browser.runtime.sendMessage({command: "chatgpt_close", window_id: mztaWinId});
            };
            break;
        case "1":     // do reply
            btn_ok.disabled = true;
            btn_ok.textContent = browser.i18n.getMessage("chatgpt_win_get_answer");
            btn_ok.onclick = async function() {
                const response = getSelectedHtml();
                await browser.runtime.sendMessage({command: "chatgpt_replyMessage", text: response, tabId: tabId, mailMessageId: mailMessageId});
                browser.runtime.sendMessage({command: "chatgpt_close", window_id: mztaWinId});
            };
            break;
        case "2":     // replace text
            btn_ok.disabled = true;
            btn_ok.textContent = browser.i18n.getMessage("chatgpt_win_get_answer");
            btn_ok.onclick = async function() {
                const response = getSelectedHtml();
                //console.log('replace text: '+tabId)
                await browser.runtime.sendMessage({command: "chatgpt_replaceSelectedText", text: response, tabId: tabId, mailMessageId: mailMessageId});
                browser.runtime.sendMessage({command: "chatgpt_close", window_id: mztaWinId});
            };
            break;
    }
    btn_ok.style.display = 'none';
    fixedDiv.appendChild(btn_ok);

    if(mztaUseDiffViewer == '1'){
        // diff overlay div
        var diffOverlay = document.createElement('div');
        diffOverlay.id = 'mzta-diff-overlay';
        diffOverlay.style.display = 'none';
        // diff div
        var diffDiv = document.createElement('div');
        diffDiv.id = 'mzta-diff';
        // diff div title
        var diffTitle = document.createElement('div');
        diffTitle.id = 'mzta-diff_title';
        diffTitle.textContent = browser.i18n.getMessage('chatgpt_win_diff_title');
        diffDiv.appendChild(diffTitle);
        // diff div content
        var diffContent = document.createElement('div');
        diffContent.id = 'mzta-diff_content';
        diffDiv.appendChild(diffContent);
        // diff div close button
        var btn_close_diff = document.createElement('button');
        btn_close_diff.id = 'mzta-btn_close_diff';
        btn_close_diff.classList.add('mzta-btn');
        btn_close_diff.textContent = browser.i18n.getMessage('chatgpt_win_close');
        btn_close_diff.onclick = function() {
            document.getElementById('mzta-diff-overlay').style.display = 'none';
        };
        diffDiv.appendChild(btn_close_diff);
        diffOverlay.appendChild(diffDiv);
        fixedDiv.appendChild(diffOverlay);

        // diff viewer button
        var btn_diff = document.createElement('button');
        btn_diff.id='mzta-btn_diff';
        btn_diff.classList.add('mzta-btn');
        btn_diff.textContent = browser.i18n.getMessage('btn_show_differences');
        btn_diff.style.display = 'none';
        btn_diff.disabled = true;
        btn_diff.onclick = async function() {
            diffContent.innerHTML = '';
            const response = getSelectedHtml();
            const wordDiff = Diff.diffWords(mztaOriginalText, response.replace(/<\\/?[^>]+(>|$)/g, ''));
            wordDiff.forEach(part => {
                const diffElement = document.createElement('span');
            
                // Apply a different class depending on whether the word is added, removed, or unchanged
                if (part.added) {
                  diffElement.className = 'added';
                  diffElement.textContent = part.value;
                } else if (part.removed) {
                  diffElement.className = 'removed';
                  diffElement.textContent = part.value;
                } else {
                  diffElement.textContent = part.value;
                }
            
                // Add the element to the container
                diffContent.appendChild(diffElement);
                diffOverlay.style.display = 'block';
              });
        };
        fixedDiv.appendChild(btn_diff);
    }

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

function checkGPTModel(model) {
    if(model == '') return Promise.resolve();
    doLog("checkGPTModel model: " + model);
  return new Promise((resolve, reject) => {
    // Set up an interval that shows the warning after 2 seconds
    const intervalId2 = setTimeout(() => {
        let modelWarn = document.getElementById('mzta-model_warn');
        let btnModel = document.getElementById('mzta-btn_model');
        if (modelWarn) modelWarn.style.display = 'inline-block';
        if (btnModel) btnModel.style.display = 'inline';
    }, 2000);
    // Set up an interval that checks the value every 100 milliseconds
    const intervalId = setInterval(() => {
      // Get the '.text-token-text-secondary' element
     // const element = document.querySelector('div#radix-\\\\:ri2\\\\: > div > span.text-token-text-secondary');
     const elements = document.querySelectorAll('[id*=radix] span')

     // If there are no elements, we are using a free account, so go on immediately
     if (elements.length === 0) {
        doLog("checkGPTModel no model found in DOM, we are using free account.");
        clearInterval(intervalId);
        clearTimeout(intervalId2);
        resolve('free');
        return;
      }

     // Loop through the elements to find the one with the specified text content
     for(let element of elements){
      // Check if the element exists and its content is '4' or '4o'
      doLog("checkGPTModel model found in DOM: " + element.textContent);
      if ((element && element.textContent === model)||(force_go)) {
        doLog("The GPT Model is now " + model);
        clearInterval(intervalId);
        clearTimeout(intervalId2);
        resolve(model);
        break;
      } else if (!element) {
        console.error("[ThunderAI | ChatGPT Web] Model string element not found! [" + model + "]");
        clearInterval(intervalId);
        reject("Model string element not found: " + model);
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
    if(mztaUseDiffViewer == '1'){
        document.getElementById('mzta-btn_diff').style.display = 'inline';
    }
    document.getElementById('mzta-loading').style.display = 'none';
    document.getElementById('mzta-force-completion').style.display = 'none';
    chatpgt_scrollToBottom();
}

function checkLoggedIn(){
    return !window.location.href.startsWith('https://chatgpt.com/auth/');
}

function showCustomTextField(){
    document.getElementById('mzta-custom_text').style.display = 'block';
    document.getElementById('mzta-custom_textarea').focus();
}

async function doProceed(message, customText = ''){
    let _gpt_model = mztaGPTModel;
    doLog("doProceed _gpt_model: " + JSON.stringify(_gpt_model));
    if(_gpt_model != ''){
        await checkGPTModel(_gpt_model);
    }
    let final_prompt = message.prompt;
// console.log(">>>>>>>>>>>> doProceed customText: " + customText);
// console.log(">>>>>>>>>>>> doProceed final_prompt: " + final_prompt);
// console.log(">>>>>>>>>>>> doProceed mztaPhDefVal: " + JSON.stringify(mztaPhDefVal));
    //check if there is the additional_text placeholder
    if(final_prompt.includes('{%additional_text%}')){
        // console.log(">>>>>>>>>>>> found ph customText: " + customText);
        final_prompt = final_prompt.replace('{%additional_text%}', customText || (mztaPhDefVal == '1'?'':'{%additional_text%}'));
    }else{
        if(customText != ''){
            final_prompt += ' '+customText;
        }
    }

    let send_result = await chatgpt_sendMsg(final_prompt,'click');
    //console.log(">>>>>>>>>>> send_result: " + send_result);
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
            let btn_retry = document.createElement('button');
            btn_retry.id="mzta-btn_retry";
            btn_retry.classList.add('mzta-btn');
            btn_retry.style.position = 'absolute';
            btn_retry.style.top = '5px';
            btn_retry.style.right = '5px';
            btn_retry.textContent = browser.i18n.getMessage("chatgpt_btn_retry");
            btn_retry.addEventListener('click', function() {
                doRetry();
            });
            curr_model_warn.insertAdjacentElement('afterend', btn_retry);
            break;
    }
    await chatgpt_isIdle();
    operation_done();
}

function doRetry(){
    document.getElementById('mzta-model_warn').style.display = 'none';
    document.getElementById('mzta-btn_retry').remove();
    document.getElementById('mzta-loading').style.display = 'inline-block';
    document.getElementById('mzta-curr_msg').textContent = browser.i18n.getMessage("chatgpt_win_working");
    doProceed(current_message);
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
        let btn_diff = document.getElementById('mzta-btn_diff');
        if (isSomethingSelected()) {
            btn_ok.disabled = false;
            btn_ok.classList.remove('btn_disabled');
            if(mztaUseDiffViewer == '1'){
                btn_diff.disabled = false;
                btn_diff.classList.remove('btn_disabled');
            }
        } else {
            btn_ok.disabled = true;
            btn_ok.classList.add('btn_disabled');
            if(mztaUseDiffViewer == '1'){
                btn_diff.disabled = true;
                btn_diff.classList.add('btn_disabled');
            }
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

function doLog(msg){
    if(mztaDoDebug == 1){
        console.log("[ThunderAI | ChatGPT Web] " + msg);
    }
}

function run(){
    if(!checkLoggedIn()){
        // User not logged in
        alert(browser.i18n.getMessage("chatgpt_user_not_logged_in"));
    }else{
        addCustomDiv(current_action,current_tabId,current_mailMessageId);
        (async () => {
            if(mztaDoCustomText === 1){
                showCustomTextField();
            } else {
                await doProceed(current_message);
            }
            // Add an event listener to the document to detect clicks
            document.addEventListener('mousedown', selectContentOnMouseDown);
            document.addEventListener('mousemove', selectContentOnMouseMove);
            document.addEventListener('mouseup', selectContentOnMouseUp);
        })();
    }
}

// In the content script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    //console.log(">>>>>>>>>>>>> content.js onMessage: " + JSON.stringify(message));
    switch(message.command) {
        case "chatgpt_send":
            current_action = message.action;
            current_message = message;
            current_tabId = message.tabId;
            current_mailMessageId = message.mailMessageId;
            if((current_mailMessageId == -1) && (current_action == '1')) {    // we are using the reply from the compose window!
                current_action = '2'; // replace text
            }
            run();
            break;
        case "chatgpt_alive":
            sendResponse({isAlive: true});
            break;
    }
});

let checkTab = setInterval(() => {
    let customDiv = document.getElementById('mzta-custom_text');
    if(customDiv){
        clearInterval(checkTab);
    }else{
        run();
    }
}, 1000);

`
