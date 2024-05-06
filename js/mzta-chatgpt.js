/*
 *  ThunderAI [https://micz.it/thunderdbird-addon-thunderai/]
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

async function chatgpt_sendMsg(msg, method ='') {
    const textArea = document.querySelector('form textarea'),
        sendButton = document.querySelector('form button[class*="bottom"]');
    textArea.value = msg;
    textArea.dispatchEvent(new Event('input', { bubbles: true })); // enable send button
    const delaySend = setInterval(() => {
        if (!sendButton?.hasAttribute('disabled')) { // send msg
            method.toLowerCase() == 'click' ? sendButton.click()
                : textArea.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true }));
            clearInterval(delaySend);
        }
    }, 25);
}

async function chatgpt_isIdle() {
    return new Promise(resolve => {
        const intervalId = setInterval(() => {
            if (chatgpt_getRegenerateButton()) {
                clearInterval(intervalId); resolve(true);
}}, 100);});}

function chatgpt_getRegenerateButton() {
    for (const mainSVG of document.querySelectorAll('main svg')) {
        if (mainSVG.querySelector('path[d*="M4.5 2.5C5.05228"]')) // regen icon found
            return mainSVG.parentNode.parentNode;
    }
}

async function chatgpt_getFromDOM(pos) {
    const responseDivs = document.querySelectorAll('div[data-testid*="conversation-turn"]:nth-child(odd)'),
          strPos = pos.toString().toLowerCase();
    let response = '';
    if (responseDivs.length) {
        if (/last|final/.test(strPos)){ // get last response
            responseDivs[responseDivs.length - 1].innerHTML = responseDivs[responseDivs.length - 1].innerHTML.replace(/<\\/p>/g, '</p>\\n\\n').replace(/<br\\s*\\/?>/g, '<br>\\n');
            // Removing the new buttons that let the user change model and insert a number (4 or 3.5 at the end of the text)
            let parser = new DOMParser();
            let doc = parser.parseFromString(responseDivs[responseDivs.length - 1].innerHTML, 'text/html');
            // Select the div with class 'empty:hidden'
            let divToRemove = doc.querySelector('div.empty\\\\:hidden');
            if (divToRemove) {
                divToRemove.remove();
            }
            // Extract the new HTML string
            responseDivs[responseDivs.length - 1].innerHTML = doc.body.innerHTML;
            response = responseDivs[responseDivs.length - 1].textContent;
            //console.log('chatgpt_getFromDOM: '+response);
            //console.log('chatgpt_getFromDOM: [HTML] ' + responseDivs[responseDivs.length - 1].innerHTML.replace(/<div[^>]*>/gi, '').replace(/<\\/div>/gi, '').replace(/<svg[^>]*>/gi, '').replace(/<\\/svg>/gi, '').replace(/<path[^>]*>/gi, '').replace(/<\\/path>/gi, '').replace(/<text[^>]*>/gi, '').replace(/<\\/text>/gi, '').replace(/<span[^>]*>/gi, '').replace(/<\\/span>/gi, '').replace(/<button[^>]*>/gi, '').replace(/<\\/button>/gi, ''));
        } else { // get nth response
            const nthOfResponse = (

                // Calculate base number
                Number.isInteger(pos) ? pos : // do nothing for integers
                /^\d+/.test(strPos) ? /^\d+/.exec(strPos)[0] : // extract first digits for strings w/ them
                ( // convert words to integers for digitless strings
                    /^(?:1|one|fir)(?:st)?$/.test(strPos) ? 1
                    : /^(?:2|tw(?:o|en|el(?:ve|f))|seco)(?:nd|t[yi])?(?:e?th)?$/.test(strPos) ? 2
                    : /^(?:3|th(?:ree|ir?))(?:rd|teen|t[yi])?(?:e?th)?$/.test(strPos) ? 3
                    : /^(?:4|fou?r)(?:teen|t[yi])?(?:e?th)?$/.test(strPos) ? 4
                    : /^(?:5|fi(?:ve|f))(?:teen|t[yi])?(?:e?th)?$/.test(strPos) ? 5
                    : /^(?:6|six)(?:teen|t[yi])?(?:e?th)?$/.test(strPos) ? 6
                    : /^(?:7|seven)(?:teen|t[yi])?(?:e?th)?$/.test(strPos) ? 7
                    : /^(?:8|eight?)(?:teen|t[yi])?(?:e?th)?$/.test(strPos) ? 8
                    : /^(?:9|nine?)(?:teen|t[yi])?(?:e?th)?$/.test(strPos) ? 9
                    : /^(?:10|ten)(?:th)?$/.test(strPos) ? 10 : 1 )

                // Transform base number if suffixed
                * ( /(ty|ieth)$/.test(strPos) ? 10 : 1 ) // x 10 if -ty/ieth
                + ( /teen(th)?$/.test(strPos) ? 10 : 0 ) // + 10 if -teen/teenth

            );
            response = responseDivs[nthOfResponse - 1].textContent;
        }
        response = response.replace(/^ChatGPTChatGPT/, ''); // strip sender name
        response = response.trim().replace(/^"|"$/g, ''); // strip quotation marks
        //console.log('chatgpt_getFromDOM: ' + response);
    }
    return response;
}

function chatpgt_scrollToBottom () {
    try { document.querySelector('button[class*="cursor"][class*="bottom"]').click(); }
    catch (err) { console.error('', err); }
}

function addCustomDiv(prompt_action,tabId) {
    // Create <style> element for the CSS
    var style = document.createElement('style');
    style.innerHTML = ".mzta-header-fixed {position: fixed;bottom: 0;left: 0;height:100px;width: 100%;background-color: #333;color: white;text-align: center;padding: 10px 0;z-index: 1000;border-top: 3px solid white;}"
    style.innerHTML += "body {padding-bottom: 100px;} [id^='headlessui-dialog-panel-:r']{padding-bottom: 100px;}";
    style.innerHTML += ".mzta-btn {background-color: #007bff;border: none;color: white;padding: 8px 15px;text-align: center;text-decoration: none;display: inline-block;font-size: 16px;margin: 4px 2px;transition-duration: 0.4s;cursor: pointer;border-radius: 5px;}";
    style.innerHTML += ".mzta-btn:hover {background-color:#0056b3;color:white;}";
    style.innerHTML += "#mzta-loading{height:50px;display:inline-block;}";
    style.innerHTML += "#mzta-model_warn{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);max-height:100%px;min-width:30%;max-width:50%;padding:3px;border-radius:5px;text-align:center;background-color:#FFBABA;border:1px solid;font-size:13px;color:#D8000C;display:none;}";
    style.innerHTML += "#mzta-btn_gpt35 {background-color: #007bff;border: none;color: white;padding: 2px 4px;text-align: center;text-decoration: none;display: none;font-size: 13px;margin-left: 4px;transition-duration: 0.4s;cursor: pointer;border-radius: 2px;}";
    style.innerHTML += "#mzta-status-page{position:fixed;bottom:0;left:0;padding-left:5px;font-size:13px;font-style:italic;text-decoration:underline;color:#919191;}";
    style.innerHTML += "#mzta-status-page:hover{color:#007bff;}";
    style.innerHTML += "#mzta-custom_text{padding:10px;width:auto;max-width:80%;height:auto;max-height:80%;border-radius:5px;overflow:auto;position:fixed;top:50%;left:50%;display:none;transform:translate(-50%,-50%);text-align:center;background:#333;color:white;border:3px solid white;}";
    style.innerHTML += "#mzta-custom_loading{height:50px;display:none;}";
    style.innerHTML += "#mzta-custom_textarea{color:black;padding:1px;font-size:15px;width:100%;}";
    style.innerHTML += "#mzta-custom_info{text-align:center;width:100%;padding-bottom:10px;font-size:15px;}";
    // Add <style> to the page's <head>
    document.head.appendChild(style);

    // Fixed div
    var fixedDiv = document.createElement('div');
    fixedDiv.classList.add('mzta-header-fixed');
    fixedDiv.textContent = '';

    // Model warning div
    var modelWarnDiv = document.createElement('div');
    modelWarnDiv.id = 'mzta-model_warn';
    modelWarnDiv.innerHTML = browser.i18n.getMessage("chatgpt_win_model_warning");
    fixedDiv.appendChild(modelWarnDiv);

    // GPT-3 Button
    var btn_gpt35 = document.createElement('button');
    btn_gpt35.id="mzta-btn_gpt35";
    btn_gpt35.innerHTML = browser.i18n.getMessage("chatgpt_use_gpt35");
    btn_gpt35.onclick = async function() {
        browser.storage.sync.set({chatpgt_use_gpt4: false});
        force_go = true;
    };
    modelWarnDiv.appendChild(btn_gpt35);

    //status page
    var status_page_div = document.createElement('div');
    status_page_div.id = 'mzta-status-page';
    status_page_div.innerHTML = '<a href="https://micz.it/thunderdbird-addon-thunderai/status/">'+ mztaStatusPageDesc +'</a>';
    fixedDiv.appendChild(status_page_div);

    // span for the text
    var curr_msg = document.createElement('span');
    curr_msg.id='mzta-curr_msg';
    curr_msg.innerHTML = browser.i18n.getMessage("chatgpt_win_working")+"<br>";
    fixedDiv.appendChild(curr_msg);

    var loading = document.createElement('img');
    loading.src = browser.runtime.getURL("/images/loading.gif");
    loading.id = "mzta-loading";
    fixedDiv.appendChild(loading);

    var btn_ok = document.createElement('button');
    btn_ok.id="mzta-btn_ok";
    btn_ok.classList.add('mzta-btn');
    //console.log('default: '+prompt_action)
    switch(prompt_action){ 
        default:
        case 0:     // close window
            btn_ok.innerHTML = browser.i18n.getMessage("chatgpt_win_close");
            btn_ok.onclick = async function() {
                browser.runtime.sendMessage({command: "chatgpt_close"});
            };
            break;
        case 1:     // do reply
            btn_ok.innerHTML = browser.i18n.getMessage("chatgpt_win_get_answer");
            btn_ok.onclick = async function() {
                const response = await chatgpt_getFromDOM('last');
                browser.runtime.sendMessage({command: "chatgpt_replyMessage", text: response, tabId: tabId});
                //console.log(response);
                browser.runtime.sendMessage({command: "chatgpt_close"});
            };
            break;
        case 2:     // replace text
            btn_ok.innerHTML = browser.i18n.getMessage("chatgpt_win_get_answer");
            btn_ok.onclick = async function() {
                const response = await chatgpt_getFromDOM('last');
                //console.log('replace text: '+tabId)
                browser.runtime.sendMessage({command: "chatgpt_replaceSelectedText", text: response, tabId: tabId});
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
    customInfo.innerHTML = browser.i18n.getMessage("chatgpt_win_custom_text");
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
    customBtn.innerHTML = browser.i18n.getMessage("chatgpt_win_send");
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
    // Set up an interval that shows the waring after 2 seconds
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
      // Check if the element exists and its content is '4'
      if ((element && element.textContent === '4')||(force_go)) {
        console.log("The GPT Model is now '4'");
        clearInterval(intervalId);
        clearTimeout(intervalId2);
        document.getElementById('mzta-model_warn').style.display = 'none';
        document.getElementById('mzta-btn_gpt35').style.display = 'none';
        resolve("GPT4");
        break;
      } else if (!element) {
        console.log("Element not found!");
        clearInterval(intervalId);
        reject("Element not found.");
      }
     }
    }, 200);
  });
}


function operation_done(){
    document.getElementById('mzta-curr_msg').innerHTML = browser.i18n.getMessage("chatgpt_win_job_completed")+"<br>";
    document.getElementById('mzta-btn_ok').style.display = 'inline';
    document.getElementById('mzta-loading').style.display = 'none';
    chatpgt_scrollToBottom();
}

function checkLoggedIn(){
    return !window.location.href.startsWith('https://chat.openai.com/auth/');
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
    await chatgpt_sendMsg(message.prompt+' '+customText,'click');
    await chatgpt_isIdle();
    operation_done();
}

// Nello script di contenuto
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.command === "chatgpt_send") {
        if(!checkLoggedIn()){
            // User not logged in
            alert(browser.i18n.getMessage("chatgpt_user_not_logged_in"));
        }else{
            addCustomDiv(message.action,message.tabId);
            (async () => {
                if(mztaDoCustomText === 1){
                    current_message = message;
                    showCustomTextField();
                } else {
                    // let prefs = await browser.storage.sync.get({chatpgt_use_gpt4:false});
                    // if(prefs.chatpgt_use_gpt4){
                    //     await checkGPT4Model();
                    // }
                    //await chatgpt.isLoaded();
                    // await chatgpt_sendMsg(message.prompt,'click');
                    // await chatgpt_isIdle();
                    // operation_done();
                    await doProceed(message);
                }
            })();
        }
    }
});

`
