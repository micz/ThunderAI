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
    style.innerHTML = ".mzta-header-fixed {position: fixed;bottom: 0;left: 0;height:100px;width: 100%;background-color: #333;color: white;text-align: center;padding: 10px 0;z-index: 1000;}"
    style.innerHTML += "body {padding-bottom: 100px;} [id^='headlessui-dialog-panel-:r']{padding-bottom: 100px;}";
    style.innerHTML += "#mzta-ok_btn {background-color: #007bff;border: none;color: white;padding: 8px 15px;text-align: center;text-decoration: none;display: inline-block;font-size: 16px;margin: 4px 2px;transition-duration: 0.4s;cursor: pointer;border-radius: 5px;}";
    style.innerHTML += "#mzta-ok_btn:hover {background-color: #0056b3;color: white;}";
    style.innerHTML += "#mzta-loading{height:50px;display:inline-block;}";
    // Add <style> to the page's <head>
    document.head.appendChild(style);

    // Fixed div
    var divFisso = document.createElement('div');
    divFisso.classList.add('mzta-header-fixed');
    divFisso.textContent = '';

    // span for the text
    var curr_msg = document.createElement('span');
    curr_msg.id='mzta-curr_msg';
    curr_msg.innerHTML = browser.i18n.getMessage("chatgpt_win_working")+"<br>";
    divFisso.appendChild(curr_msg);

    var loading = document.createElement('img');
    loading.src = browser.runtime.getURL("/images/loading.gif");
    loading.id = "mzta-loading";
    divFisso.appendChild(loading);

    var pulsante = document.createElement('button');
    pulsante.id="mzta-ok_btn";
    //console.log('default: '+prompt_action)
    switch(prompt_action){ 
        default:
        case 0:     // close window
            pulsante.innerHTML = browser.i18n.getMessage("chatgpt_win_close");
            pulsante.onclick = async function() {
                browser.runtime.sendMessage({command: "chatgpt_close"});
            };
            break;
        case 1:     // do reply
            pulsante.innerHTML = browser.i18n.getMessage("chatgpt_win_get_answer");
            pulsante.onclick = async function() {
                const response = await chatgpt_getFromDOM('last');
                browser.runtime.sendMessage({command: "chatgpt_replyMessage", text: response, tabId: tabId});
                //console.log(response);
                browser.runtime.sendMessage({command: "chatgpt_close"});
            };
            break;
        case 2:     // replace text
            pulsante.innerHTML = browser.i18n.getMessage("chatgpt_win_get_answer");
            pulsante.onclick = async function() {
                const response = await chatgpt_getFromDOM('last');
                //console.log('replace text: '+tabId)
                browser.runtime.sendMessage({command: "chatgpt_replaceSelectedText", text: response, tabId: tabId});
                //console.log(response);
                browser.runtime.sendMessage({command: "chatgpt_close"});
            };
            break;
    }
    pulsante.style.display = 'none';
    divFisso.appendChild(pulsante);

    document.body.insertBefore(divFisso, document.body.firstChild);
}

function operation_done(){
    document.getElementById('mzta-curr_msg').innerHTML = browser.i18n.getMessage("chatgpt_win_job_completed")+"<br>";
    document.getElementById('mzta-ok_btn').style.display = 'inline';
    document.getElementById('mzta-loading').style.display = 'none';
    chatpgt_scrollToBottom();
}

function checkLoggedIn(){
    return !window.location.href.startsWith('https://chat.openai.com/auth/');
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
                //await chatgpt.isLoaded();
                await chatgpt_sendMsg(message.prompt,'click');
                await chatgpt_isIdle();
                // console.log(response);
                operation_done();
            })();
        }
    }
});

`
