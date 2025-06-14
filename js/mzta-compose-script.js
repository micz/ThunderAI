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

browser.runtime.onMessage.addListener((message) => {
switch (message.command) {
  case "getSelectedText": {
    return Promise.resolve(window.getSelection().toString());
  }

  case "getSelectedHtml": {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return Promise.resolve('');
    }
    const range = selection.getRangeAt(0);
    const div = document.createElement('div');
    div.appendChild(range.cloneContents());
    return Promise.resolve(div.innerHTML);
  }

  case "replaceSelectedText": {
    const selectedText = window.getSelection().toString();
    let force_insert = false;
    if (selectedText === '') {
      if(!confirm(browser.i18n.getMessage("Replace_No_Selected_Text"))) {
        return Promise.resolve(false);
      }else{
        force_insert = true;
      }
    }
    const sel = window.getSelection();
    if (!sel || sel.type !== "Range" || !sel.rangeCount) {
      if(!force_insert) {
        return Promise.resolve(false);
      }
    }
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const parser = new DOMParser();
    const doc = parser.parseFromString(message.text, 'text/html');
    r.insertNode(doc.body);
    browser.runtime.sendMessage({command: "compose_reloadBody", tabId: message.tabId});
    return Promise.resolve(true);
  }

  case "getText": {
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
  }

  case "getTextOnly": {
      return Promise.resolve(window.document.body.innerText);
  }

  case "getFullHtml": {
      return Promise.resolve(window.document.body.innerHTML);
  }

  case "getOnlyTypedText": {
    let t = '';
    const children = window.document.body.childNodes;
    const selection = window.getSelection();

    let firstNode = null;
    let lastNode = null;

    for (const node of children) {
      if (node instanceof Element) {
        if (node.classList.contains('moz-cite-prefix')) { // quoted text in a reply
          break;
        }
        if (node.classList.contains('moz-forward-container')) { // quoted text in a forward
          break;
        }
      }
      t += node.textContent + " ";

      // Track the first and last nodes for range
      if (!firstNode) {
        firstNode = node;
      }
      if(node.textContent.trim() != '') {
        lastNode = node;
      }
    }

    if(!lastNode) {
      lastNode = firstNode;
    }

    //if(message.do_autoselect && selection.isCollapsed && firstNode && lastNode) {
      if(message.do_autoselect && firstNode && lastNode) {
      const range = document.createRange();
      range.setStartBefore(firstNode);
      range.setEndAfter(lastNode);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    return Promise.resolve(t);
  }

  case "getOnlyQuotedText": {
    let t = '';
    const children = window.document.body.childNodes;
    const selection = window.getSelection();
  
    let firstNode = null;
    let lastNode = null;
    let foundCitePrefix = false;
  
    for (const node of children) {
      if (!foundCitePrefix) {
        if (node instanceof Element && (node.classList.contains('moz-cite-prefix') || node.classList.contains('moz-forward-container'))) {
          foundCitePrefix = true;
        } else {
          continue;
        }
      }
  
      t += node.textContent + " ";
  
      if (!firstNode) {
        firstNode = node;
      }
      if (node.textContent.trim() !== '') {
        lastNode = node;
      }
    }
  
    if (!lastNode) {
      lastNode = firstNode;
    }
  
    if (message.do_autoselect && firstNode && lastNode) {
      const range = document.createRange();
      range.setStartBefore(firstNode);
      range.setEndAfter(lastNode);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  
    return Promise.resolve(t);
  }
  
  

  case 'sendAlert':
    //console.log(">>>>>> message.curr_tab_type: " + JSON.stringify(message.curr_tab_type));
    if(message.curr_tab_type == 'mail'){  // workaround for Thunderbird bug not showing the alert
      // CSS styles for Thunderbird with support for light and dark themes
      const style = document.createElement('style');
      style.textContent = `
        .mzta_dialog {
          display: flex;
          flex-direction: column;
          border: none;
          border-radius: 8px;
          padding: 0;
          width: 300px;
          max-width: 90%;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
          background-color: var(--dialog-bg-color, #fff);
          color: var(--dialog-text-color, #000);
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 1001;
        }

        .mzta_dialog_content {
          position: relative;
          padding: 10px;
          overflow-y: auto;
          overflow-x: clip;
          max-height: 80vh;
          flex: 1;
          margin-bottom: 34px;
        }

        .mzta_dialog_close {
          position: absolute;
          bottom: 2px;
          right: 2px;
          background: #007bff;
          border: none;
          color: #ffffff;
          font-size: 14px;
          padding: 4px 6px;
          cursor: pointer;
          border-radius: 4px;
        }

        .mzta_dialog_close:hover {
          background: #0056b3;
        }

        .mzta_dialog_message {
          margin-bottom: 40px;
        }

        h2.addtags{
          margin:0;
          font-size: 1.2em;
          text-align: center;
        }

        .div_btns{
          width: 90%;
          display: flex;
          justify-content: center;
          position: fixed;
          bottom: 4px;
        }

        :root {
          --dialog-bg-color: #ffffff;
          --dialog-text-color: #000000;
        }

        @media (prefers-color-scheme: dark) {
          :root {
            --dialog-bg-color: #2e2e2e;
            --dialog-text-color: #ffffff;
          }
        }
      `;
      document.head.appendChild(style);

      // Create dialog elements
      const dialog_sendAlert = window.document.createElement('dialog');
      dialog_sendAlert.classList.add('mzta_dialog');

      const title = document.createElement('h2');
      title.className = 'addtags';
      if(message.is_error){
        title.textContent = browser.i18n.getMessage("thunderai_error_title");
      }else{
        title.textContent = browser.i18n.getMessage("thunderai_warning_title");
      }
      dialog_sendAlert.appendChild(title);

      const content_sendAlert = window.document.createElement('div');
      content_sendAlert.classList.add('mzta_dialog_content');

      // Add a div for buttons
      const buttonsDiv = document.createElement('div');
      buttonsDiv.className = 'div_btns';

      // Create close button
      const closeButton_sendAlert = window.document.createElement('button');
      closeButton_sendAlert.classList.add('mzta_dialog_close');
      closeButton_sendAlert.id = 'mzta_dialog_close';
      closeButton_sendAlert.textContent = 'Close';
      buttonsDiv.appendChild(closeButton_sendAlert);

      // Create message element
      const message_sendAlert = window.document.createElement('div');
      message_sendAlert.classList.add('mzta_dialog_message');
      message_sendAlert.textContent = message.message;

      // Append elements to the dialog
      content_sendAlert.appendChild(message_sendAlert);
      dialog_sendAlert.appendChild(content_sendAlert);
      dialog_sendAlert.appendChild(buttonsDiv);
      window.document.body.appendChild(dialog_sendAlert);

      // Show the dialog
      dialog_sendAlert.showModal();

      // Close dialog on button click and remove elements from the DOM
      closeButton_sendAlert.onclick = () => {
        dialog_sendAlert.close();
        dialog_sendAlert.addEventListener('close', () => {
          dialog_sendAlert.remove();
          style.remove();
        });
      };

      const iframeHeight = window.innerHeight;
      const iframeWidth = window.innerWidth;

      const dialogRect = dialog_sendAlert.getBoundingClientRect();

      const top = Math.max(0, (iframeHeight - dialogRect.height) / 2);
      const left = Math.max(0, (iframeWidth - dialogRect.width) / 2);

      dialog_sendAlert.style.top = `${top}px`;
      dialog_sendAlert.style.left = `${left}px`;
      dialog_sendAlert.style.maxHeight = `${iframeHeight - 40}px`;

      dialog_sendAlert.style.transform = 'translate(0, 0)';

    }else{
      alert(message.message);
    }
    return Promise.resolve(true);
    break;

  case "getTags":
    // console.log(">>>>>>>>>>>>>> getTags: " + JSON.stringify(message.tags));

    // ===== These methods are also defined in the file /js/mzta-addatags-exclusion-list.js
    async function addTags_getExclusionList() {
      let prefs_excluded_tags = await browser.storage.local.get({add_tags_exclusions: []});
      // console.log(">>>>>>>>>>>>>>> addTags_getExclusionList prefs_excluded_tags: " + JSON.stringify(prefs_excluded_tags));
      return prefs_excluded_tags.add_tags_exclusions;
    }

    function addTags_setExclusionList(add_tags_exclusions) {
      browser.storage.local.set({add_tags_exclusions: add_tags_exclusions});
    }

    function checkExcludedTag(tag, excluded_word, exact_match = false) {
        // Check if the tag is in the exclusion list
        if (excluded_word === '') {
            return false; // No exclusion word, so no exclusion
        }
        if(exact_match) {
            return tag.toLowerCase() === excluded_word.toLowerCase();
        }
        return tag.toLowerCase().includes(excluded_word.toLowerCase());
    }
    // ===================================================================================

    // Create and append the styles
    const style = document.createElement('style');
    style.textContent = `
      .mzta_dialog {
        display: flex;
        flex-direction: column;
        border: none;
        border-radius: 8px;
        width: 300px;
        max-width: 90%;
        max-height: 90%;
        padding: 0.5em;
        overflow: hidden;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        background-color: var(--dialog-bg-color, #fff);
        color: var(--dialog-text-color, #000);
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 1001;
      }

      .mzta_dialog_content {
        position: relative;
        padding: 0;
        overflow-y: auto;
        max-height: 80vh;
        flex: 1;
        margin-bottom: 20px;
      }

      .mzta_dialog_btn {
        background: #007bff;
        border: none;
        color: #ffffff;
        font-size: 14px;
        padding: 4px 6px;
        cursor: pointer;
        border-radius: 4px;
        flex-shrink: 0;
      }

      .mzta_dialog_btn_margin{
        margin-right: 5px;
      }

      .mzta_dialog_btn:hover {
        background: #0056b3;
      }

      .mzta_dialog_message {
        margin-bottom: 40px;
        font-size: 14px;
      }

      .mzta_dialog_message2{
        margin: 20px auto;
      }

      .div_btns{
        width: 90%;
        display: flex;
        justify-content: center;
        position: fixed;
        bottom: 4px;
      }

      .tag_excluded{
        text-decoration: line-through;
      }

      h2.addtags{
        margin:0;
        font-size: 1.2em;
        text-align: center;
      }

      img.exclude-tag-icon{
        width: 16px;
        height: 16px;
        margin-right: 2px;
        margin-left: 2px;
        position: relative;
        top: 3px;
        cursor: pointer;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --dialog-bg-color: #2e2e2e;
          --dialog-text-color: #ffffff;
        }
      }
    `;
    document.head.appendChild(style);

    async function createDialog(inputTags, onSubmit) {
      // Create the dialog
      const tags_dialog = document.createElement('dialog');
      tags_dialog.className = 'mzta_dialog';

      const title = document.createElement('h2');
      title.className = 'addtags';
      title.textContent = browser.i18n.getMessage("addtags_dialog_title");
      tags_dialog.appendChild(title);

      // Create the content
      const content = document.createElement('div');
      content.className = 'mzta_dialog_content';

      let no_submit = false;

      // Fix the input array
      const words = inputTags.map(word => word.trim()).filter(word => word !== '');

      // console.log(">>>>>>>>>>>>> words: " + JSON.stringify(words));

      if(words.length == 0){
        const message = document.createElement('div');
        message.className = 'mzta_dialog_message2';
        message.textContent = browser.i18n.getMessage("addtags_no_tags_received");
        content.appendChild(message);
        no_submit = true;
      }

      let prefs_tags = await browser.storage.sync.get({add_tags_hide_exclusions: false, add_tags_exclusions_exact_match: false});
      let add_tags_exclusions_list = await addTags_getExclusionList();

      // console.log(">>>>>>>>>>>>> add_tags_exclusions_list: " + JSON.stringify(add_tags_exclusions_list));

      const words_final = words
        .filter(word => word !== '')
        .map(word => {
          const isExcluded = add_tags_exclusions_list.some(exclusion => 
            checkExcludedTag(word, exclusion, prefs_tags.add_tags_exclusions_exact_match)
          );

          return {
            tag: word,
            excluded: isExcluded ? 1 : 0
          };
        });

      // console.log(">>>>>>>>>>>>> words_final: " + JSON.stringify(words_final));

      // Create the form
      const form = document.createElement('form');

      let tags_shown = 0;

      words_final.forEach(word => {
        const label = document.createElement('label');
        label.style.display = 'block';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true; // Checked by default
        checkbox.value = word.tag;
        // Add an image to the checkbox label
        const img = document.createElement('img');
        img.src = browser.runtime.getURL("/images/exclude-tag.svg");
        img.alt = browser.i18n.getMessage("addtags_exclude_tag");
        img.title = browser.i18n.getMessage("addtags_exclude_tag");
        img.className = 'exclude-tag-icon';
        img.addEventListener('click', () => {
          if (!label.classList.contains('tag_excluded')) {
            label.classList.add('tag_excluded');
            if (!add_tags_exclusions_list.includes(word.tag)) {
              add_tags_exclusions_list.push(word.tag);
              addTags_setExclusionList(add_tags_exclusions_list);
            }
          } else {
            label.classList.remove('tag_excluded');
            const idx = add_tags_exclusions_list.indexOf(word.tag);
            if (idx > -1) {
              add_tags_exclusions_list.splice(idx, 1);
              addTags_setExclusionList(add_tags_exclusions_list);
            }
          }
        });

        label.appendChild(checkbox);
        label.appendChild(img);
        label.appendChild(document.createTextNode(` ${word.tag}`));
        if(!word.excluded || (word.excluded && !prefs_tags.add_tags_hide_exclusions)){
          tags_shown++;
          form.appendChild(label);
        }
        if(word.excluded){
          label.className = 'tag_excluded';
          checkbox.checked = false;
        }
      });

      if((!no_submit) && (tags_shown == 0)){
        const message = document.createElement('div');
        message.className = 'mzta_dialog_message2';
        message.textContent = browser.i18n.getMessage("addtags_no_valid_tags");
        content.appendChild(message);
        no_submit = true;
      }

      // Add a div for buttons
      const buttonsDiv = document.createElement('div');
      buttonsDiv.className = 'div_btns';
  
      // Add the close button
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.id = 'mzta_dialog_close';
      closeButton.textContent = 'Close';
      closeButton.className = 'mzta_dialog_btn mzta_dialog_btn_margin';
      closeButton.addEventListener('click', closeDialog);
      buttonsDiv.appendChild(closeButton);

      if(!no_submit){
        // Add the submit button
        const submitButton = document.createElement('button');
        submitButton.type = 'button';
        submitButton.id = 'mzta_dialog_submit';
        submitButton.textContent = 'Submit';
        submitButton.className = 'mzta_dialog_btn';
        submitButton.addEventListener('click', () => {
          const selected = Array.from(form.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
          onSubmit(selected);
          closeDialog();
        });
        buttonsDiv.appendChild(submitButton);
      }

      content.appendChild(form);
      tags_dialog.appendChild(content);
      tags_dialog.appendChild(buttonsDiv);
      document.body.appendChild(tags_dialog);

      function closeDialog() {
        tags_dialog.close();
        tags_dialog.addEventListener('close', () => {
          tags_dialog.remove();
          style.remove();
        });
      }

      tags_dialog.showModal();

      const iframeHeight = window.innerHeight;
      const iframeWidth = window.innerWidth;

      const dialogRect = tags_dialog.getBoundingClientRect();

      const top = Math.max(0, (iframeHeight - dialogRect.height) / 2);
      const left = Math.max(0, (iframeWidth - dialogRect.width) / 2);

      tags_dialog.style.top = `${top}px`;
      tags_dialog.style.left = `${left}px`;
      tags_dialog.style.maxHeight = `${iframeHeight - 40}px`;

      tags_dialog.style.transform = 'translate(0, 0)';

      return true;
    }

    return createDialog(message.tags, (selected) => {
      // console.log('>>>>>>>>>>>> Selected tags:', selected);
      browser.runtime.sendMessage({ command: "assign_tags", tags: selected, messageId: message.messageId });
    });

    break;

  default:
    // do nothing
    return Promise.resolve(false);
    break;
}
});