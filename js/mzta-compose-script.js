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

browser.runtime.onMessage.addListener((message) => {
switch (message.command) {
  case "getSelectedText":
    return Promise.resolve(window.getSelection().toString());

  case "replaceSelectedText":
    const selectedText = window.getSelection().toString();
    if (selectedText === '') {
      return false;
    }
    const sel = window.getSelection();
    if (!sel || sel.type !== "Range" || !sel.rangeCount) {
      return false;
    }
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const parser = new DOMParser();
    const doc = parser.parseFromString(message.text, 'text/html');
    r.insertNode(doc.body);
    browser.runtime.sendMessage({command: "compose_reloadBody", tabId: message.tabId});
    return Promise.resolve(true);
    break;

  case "getText":
    let t = '';
    const children = window.document.body.childNodes;
    for (const node of children) {
      if (node instanceof Element) {
        if (node.classList.contains('moz-signature')) {
          continue;
        }
      }
      t += node.textContent;
    }
    return Promise.resolve(t);

  case "getTextOnly":
      return Promise.resolve(window.document.body.innerText);

  case "getFullHtml":
      return Promise.resolve(window.document.body.innerHTML);

  case 'promptTooLong':
    const dialog1 = window.document.createElement('dialog');
    dialog1.classList.add('mzta_dialog');
    const overlay1 = window.document.createElement('div');
    overlay1.classList.add('mzta_dialog_overlay');

    const content1 = window.document.createElement('div');
    content1.classList.add('mzta_dialog_content');

    const closeButton1 = window.document.createElement('div');
    closeButton1.classList.add('mzta_dialog_close');
    closeButton1.id = 'mzta_dialog_close';
    closeButton1.textContent = 'x';

    const message1 = window.document.createElement('div');
    message1.textContent = browser.i18n.getMessage('msg_prompt_too_long');

    content1.appendChild(closeButton1);
    content1.appendChild(message1);
    dialog1.appendChild(overlay1);
    dialog1.appendChild(content1);
    window.document.body.appendChild(dialog1);
    dialog1.showModal();
    const closeDialog1 = window.document.getElementById('mzta_dialog_close');
    closeDialog1.onclick = () => {
      dialog1.close();
    };
    // alert(browser.i18n.getMessage('msg_prompt_too_long'));
    return Promise.resolve(true);
    break;

  case 'sendAlert':
    console.log(">>>>>> message.curr_tab_type: " + JSON.stringify(message.curr_tab_type));
    if(message.curr_tab_type == 'mail'){  // workaround for Thunderbird bug not showing the alert
      const dialog2 = window.document.createElement('dialog');
      dialog2.classList.add('mzta_dialog');
      const overlay2 = window.document.createElement('div');
      overlay2.classList.add('mzta_dialog_overlay');

      const content2 = window.document.createElement('div');
      content2.classList.add('mzta_dialog_content');

      const closeButton2 = window.document.createElement('div');
      closeButton2.classList.add('mzta_dialog_close');
      closeButton2.id = 'mzta_dialog_close';
      closeButton2.textContent = 'x';

      const message2 = window.document.createElement('div');
      message2.textContent = message.message;

      content2.appendChild(closeButton2);
      content2.appendChild(message2);
      dialog2.appendChild(overlay2);
      dialog2.appendChild(content2);
      window.document.body.appendChild(dialog2);
      dialog2.showModal();
      const closeDialog2 = window.document.getElementById('mzta_dialog_close');
      closeDialog2.onclick = () => {
        dialog2.close();
      };
    }else{
      alert(message.message);
    }
    return Promise.resolve(true);
    break;

  default:
    // do nothing
    return false;
    break;
}    
});