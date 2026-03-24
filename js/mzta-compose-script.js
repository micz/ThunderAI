/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

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

function createThreeDotsMenu(isDark, menuItems, panelColors) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position: relative; display: inline-flex; align-items: center;';

    const dotsBtn = document.createElement('span');
    dotsBtn.textContent = '\u22EE';
    dotsBtn.style.cssText = 'cursor: pointer; opacity: 0.7; font-size: 18px; padding: 2px 7px; line-height: 1; user-select: none; transition: opacity 0.2s; display: flex; align-items: center;';
    dotsBtn.onmouseover = () => dotsBtn.style.opacity = '1';
    dotsBtn.onmouseout = () => dotsBtn.style.opacity = '0.7';

    const dropdown = document.createElement('div');
    const dropdownBg = panelColors.bg;
    const dropdownBorder = panelColors.border;
    const defaultTextColor = panelColors.text;
    dropdown.style.cssText = `display: none; position: absolute; right: 0; top: 100%; z-index: 9999; min-width: 180px; background-color: ${dropdownBg}; border: 1px solid ${dropdownBorder}; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); overflow: hidden;`;

    menuItems.forEach(item => {
        const row = document.createElement('div');
        row.style.cssText = `display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; font-size: 13px; color: ${defaultTextColor}; transition: background-color 0.15s, color 0.15s;`;

        const iconSpan = document.createElement('span');
        iconSpan.textContent = item.icon;
        iconSpan.style.cssText = 'font-size: 15px; width: 18px; text-align: center;';

        const labelSpan = document.createElement('span');
        labelSpan.textContent = item.label;

        row.appendChild(iconSpan);
        row.appendChild(labelSpan);

        const hoverBg = item.hoverColor === '#cc0000'
            ? (isDark ? 'rgba(204,0,0,0.2)' : 'rgba(204,0,0,0.1)')
            : (isDark ? 'rgba(77,157,224,0.2)' : 'rgba(26,95,168,0.1)');

        row.onmouseover = () => {
            row.style.backgroundColor = hoverBg;
            row.style.color = item.hoverColor;
        };
        row.onmouseout = () => {
            row.style.backgroundColor = '';
            row.style.color = defaultTextColor;
        };

        row.onclick = (e) => {
            e.stopPropagation();
            dropdown.style.display = 'none';
            if (item.disableAfterClick) {
                row.onclick = null;
                row.style.opacity = '0.5';
                row.style.pointerEvents = 'none';
            }
            item.onClick();
        };

        dropdown.appendChild(row);
    });

    dotsBtn.onclick = (e) => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    };

    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dropdown.style.display !== 'none') {
            dropdown.style.display = 'none';
        }
    });

    wrapper.appendChild(dotsBtn);
    wrapper.appendChild(dropdown);
    return wrapper;
}

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

    case "showSpamCheckInProgress":
      const oldBanner = document.getElementById('mzta-spam-report-banner');
      if(oldBanner) oldBanner.remove();

      if(document.getElementById('mzta-spam-check-progress')) return Promise.resolve(true);

      const containerProgress = document.createElement('div');
      containerProgress.id = 'mzta-spam-check-progress';
      
      const isDarkProgress = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      
      let bgColorProgress = isDarkProgress ? '#003366' : '#e6f2ff';
      let textColorProgress = isDarkProgress ? '#cce5ff' : '#004085';
      let borderColorProgress = isDarkProgress ? '#004085' : '#b8daff';

      containerProgress.style.cssText = `background-color: ${bgColorProgress}; color: ${textColorProgress}; border-bottom: 1px solid ${borderColorProgress}; padding: 8px 12px; font-family: system-ui, -apple-system, sans-serif; font-size: 13px; display: flex; align-items: center; gap: 15px; width: 100%; box-sizing: border-box;`;

      const textProgress = document.createElement('strong');
      textProgress.textContent = browser.i18n.getMessage("spam_check_in_progress");
      
      const loadingImg = document.createElement('img');
      loadingImg.src = browser.runtime.getURL("/images/loading.gif");
      loadingImg.style.cssText = "height: 16px; width: 16px;";

      const brandingProgress = document.createElement('span');
      brandingProgress.textContent = browser.i18n.getMessage("antispam_by") + " ThunderAI";
      brandingProgress.style.cssText = 'margin-left: auto; font-style: italic; font-size: 11px; opacity: 0.7;';

      containerProgress.appendChild(loadingImg);
      containerProgress.appendChild(textProgress);
      containerProgress.appendChild(brandingProgress);

      document.body.insertBefore(containerProgress, document.body.firstChild);

      // Reposition summary trigger button if it exists as fixed
      const existingFixedTriggerProgress = document.getElementById('mzta-summary-trigger');
      if (existingFixedTriggerProgress && !document.getElementById('mzta-summary-trigger-wrapper')) {
          existingFixedTriggerProgress.style.position = '';
          existingFixedTriggerProgress.style.top = '';
          existingFixedTriggerProgress.style.right = '';
          existingFixedTriggerProgress.style.zIndex = '';
          existingFixedTriggerProgress.style.marginLeft = 'auto';
          existingFixedTriggerProgress.style.marginTop = '4px';
          const reposTriggerWrapperProgress = document.createElement('div');
          reposTriggerWrapperProgress.id = 'mzta-summary-trigger-wrapper';
          reposTriggerWrapperProgress.style.cssText = 'display: flex; justify-content: flex-end; padding: 4px 0.5rem;';
          reposTriggerWrapperProgress.appendChild(existingFixedTriggerProgress);
          document.body.insertBefore(reposTriggerWrapperProgress, containerProgress.nextSibling);
      }

      return Promise.resolve(true);

  case "showSpamReport":
    const progressBanner = document.getElementById('mzta-spam-check-progress');
    if(progressBanner) progressBanner.remove();

    const data = message.data;
    if(document.getElementById('mzta-spam-report-banner')) return Promise.resolve(true);

    const container = document.createElement('div');
    container.id = 'mzta-spam-report-banner';
    
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    let bgColor = '#f8f9fa';
    let textColor = '#333';
    let borderColor = '#ccc';
    
    if (data.spamValue == -999) {
        bgColor = isDark ? '#332701' : '#fff3cd';
        textColor = isDark ? '#ffeb80' : '#856404';
        borderColor = isDark ? '#664d03' : '#ffeeba';
    } else if (data.spamValue >= (data.SpamThreshold || 50)) {
        bgColor = isDark ? '#5a1a1a' : '#ffe6e6';
        textColor = isDark ? '#ffcccc' : '#cc0000';
        borderColor = '#cc0000';
    } else {
        bgColor = isDark ? '#1a401a' : '#e6ffe6';
        textColor = isDark ? '#ccffcc' : '#006600';
        borderColor = '#006600';
    }

    container.style.cssText = `background-color: ${bgColor}; color: ${textColor}; border-bottom: 1px solid ${borderColor}; border-radius:4px; padding: 8px 0.5rem; font-family: system-ui, -apple-system, sans-serif; font-size: 13px; display: flex; align-items: center; gap: 15px; width: 100%; box-sizing: border-box;`;

    const scoreText = document.createElement('strong');
    if (data.spamValue == -999) {
        scoreText.textContent = browser.i18n.getMessage("apiwebchat_error");
    } else {
        scoreText.textContent = ((data.spamValue >= (data.SpamThreshold || 50)) ? "⚠️ " + browser.i18n.getMessage("Spam") : "🛡️ " + browser.i18n.getMessage("Valid")) + " [" + data.spamValue + "/100]";
    }
    
    const reasonText = document.createElement('span');
    if (data.spamValue == -999) {
        reasonText.textContent = data.explanation;
    } else {
        reasonText.textContent = browser.i18n.getMessage("Explanation") + ": " + data.explanation;
    }

    const branding = document.createElement('span');
    branding.textContent = browser.i18n.getMessage("antispam_by") + " ThunderAI";
    branding.style.cssText = 'margin-left: auto; font-style: italic; font-size: 10px; opacity: 0.5;';

    const spamMenu = createThreeDotsMenu(isDark, [
        {
            icon: '↻',
            label: browser.i18n.getMessage("spamfilter_refresh") || 'Refresh spam report',
            hoverColor: isDark ? '#4d9de0' : '#1a5fa8',
            disableAfterClick: true,
            onClick: () => {
                browser.runtime.sendMessage({ command: "refreshSpamReport", headerMessageId: data.headerMessageId });
            }
        },
        {
            icon: '×',
            label: browser.i18n.getMessage("spamfilter_delete") || 'Delete spam report',
            hoverColor: '#cc0000',
            onClick: () => {
                container.remove();
                browser.runtime.sendMessage({ command: "removeSpamReport", headerMessageId: data.headerMessageId });
            }
        }
    ], { bg: bgColor, border: borderColor, text: textColor });

    const spamRightGroup = document.createElement('span');
    spamRightGroup.style.cssText = 'margin-left: auto; margin-right:1px; display: flex; align-items: center; gap: 5px;';
    branding.style.cssText = 'font-style: italic; font-size: 10px; opacity: 0.5;';
    spamRightGroup.appendChild(branding);
    spamRightGroup.appendChild(spamMenu);

    container.appendChild(scoreText);
    container.appendChild(reasonText);
    container.appendChild(spamRightGroup);

    document.body.insertBefore(container, document.body.firstChild);

    // Reposition summary trigger button if it exists as fixed
    const existingFixedTrigger = document.getElementById('mzta-summary-trigger');
    if (existingFixedTrigger && !document.getElementById('mzta-summary-trigger-wrapper')) {
        existingFixedTrigger.style.position = '';
        existingFixedTrigger.style.top = '';
        existingFixedTrigger.style.right = '';
        existingFixedTrigger.style.zIndex = '';
        existingFixedTrigger.style.marginLeft = 'auto';
        existingFixedTrigger.style.marginTop = '4px';
        const reposTriggerWrapper = document.createElement('div');
        reposTriggerWrapper.id = 'mzta-summary-trigger-wrapper';
        reposTriggerWrapper.style.cssText = 'display: flex; justify-content: flex-end; padding: 4px 0.5rem;';
        reposTriggerWrapper.appendChild(existingFixedTrigger);
        document.body.insertBefore(reposTriggerWrapper, container.nextSibling);
    }

    return Promise.resolve(true);

  case "showSummary":
    const generatingBanner = document.getElementById('mzta-summary-generating');
    if(generatingBanner) generatingBanner.remove();
    
    const existingTriggerWrapper = document.getElementById('mzta-summary-trigger-wrapper');
    if(existingTriggerWrapper) existingTriggerWrapper.remove();
    const existingTriggerBtn = document.getElementById('mzta-summary-trigger');
    if(existingTriggerBtn) existingTriggerBtn.remove();

    const summaryBanner = document.getElementById('mzta-summary-banner');
    if(summaryBanner) summaryBanner.remove();

    const summaryData = message.data;
    const summaryContainer = document.createElement('div');
    summaryContainer.id = 'mzta-summary-banner';
    
    const isDarkSummary = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    let bgColorSummary = isDarkSummary ? '#2a2a2a' : '#f0f0f0';
    let textColorSummary = isDarkSummary ? '#e0e0e0' : '#333';
    let borderColorSummary = isDarkSummary ? '#444' : '#ddd';

    if (summaryData.error) {
        bgColorSummary = isDarkSummary ? '#3a1a1a' : '#f7e6e6';
        textColorSummary = isDarkSummary ? '#ffcccc' : '#660000';
        borderColorSummary = '#660000';
    }

    summaryContainer.className = 'thunderai-summary-pane';
    summaryContainer.style.cssText = `background-color: ${bgColorSummary}; color: ${textColorSummary}; padding: 0.5rem; margin-bottom: 1rem; border-radius: 4px; border: 1px solid ${borderColorSummary}; font-family: system-ui, -apple-system, sans-serif; font-size: 14px;`;

    const summaryMenu = createThreeDotsMenu(isDarkSummary, [
        {
            icon: '↻',
            label: browser.i18n.getMessage("summarize_refresh") || 'Refresh summary',
            hoverColor: isDarkSummary ? '#4d9de0' : '#1a5fa8',
            disableAfterClick: true,
            onClick: () => {
                browser.runtime.sendMessage({
                    command: "refreshSummary",
                    headerMessageId: summaryData.headerMessageId
                });
            }
        },
        {
            icon: '×',
            label: browser.i18n.getMessage("summarize_delete") || 'Delete summary',
            hoverColor: '#cc0000',
            onClick: () => {
                summaryContainer.remove();
                browser.runtime.sendMessage({ command: "removeSummary", headerMessageId: summaryData.headerMessageId });
            }
        }
    ], { bg: bgColorSummary, border: borderColorSummary, text: textColorSummary });

    const summaryBranding = document.createElement('span');
    summaryBranding.textContent = browser.i18n.getMessage("summary_by") + " ThunderAI";
    summaryBranding.style.cssText = 'font-style: italic; font-size: 10px; opacity: 0.5; white-space: nowrap;';

    const summaryRightGroup = document.createElement('span');
    summaryRightGroup.style.cssText = 'display: flex; align-items: center; gap: 5px; float: right; margin-left: 10px;';
    summaryRightGroup.appendChild(summaryBranding);
    summaryRightGroup.appendChild(summaryMenu);

    const summaryIcon = document.createElement('img');
    summaryIcon.src = browser.runtime.getURL("/images/ai_summary.png");
    summaryIcon.style.cssText = `height: 16px; width: 16px; flex-shrink: 0; margin-top: 2px;${isDarkSummary ? ' filter: invert(1);' : ''}`;

    const summaryTextWrapper = document.createElement('div');
    summaryTextWrapper.style.cssText = 'flex: 1; min-width: 0;';

    summaryTextWrapper.appendChild(summaryRightGroup);

    const summaryText = document.createElement('div');
    summaryText.className = 'thunderai-summary-content';
    if (summaryData.error) {
        summaryText.textContent = summaryData.message || browser.i18n.getMessage("summarize_error");
    } else {
        summaryText.textContent = summaryData.summary;
    }
    summaryText.style.cssText = `font-size: 14px; line-height: 1.4;`;

    summaryTextWrapper.appendChild(summaryText);

    const maxLen = summaryData.maxDisplayLength || 0;
    const fullText = summaryData.summary;
    if (!summaryData.error && maxLen > 0 && fullText && fullText.length > maxLen) {
        let cutPos = fullText.lastIndexOf(' ', maxLen);
        if (cutPos <= 0) cutPos = maxLen;
        const truncated = fullText.substring(0, cutPos) + '\u2026';
        summaryText.textContent = truncated;

        // Set up animated expand/collapse via max-height transition
        summaryText.style.overflow = 'hidden';
        summaryText.style.transition = 'max-height 0.2s ease';

        // Measure truncated height after layout
        requestAnimationFrame(() => {
            const collapsedHeight = summaryText.scrollHeight;
            summaryText.style.maxHeight = collapsedHeight + 'px';
        });

        const toggleLink = document.createElement('a');
        toggleLink.textContent = browser.i18n.getMessage("summarize_see_more") || "See more";
        toggleLink.href = '#';
        toggleLink.style.cssText = 'display: inline-block; margin-top: 4px; font-size: 13px; color: ' +
            (isDarkSummary ? '#6db3f2' : '#1a5fa8') + '; cursor: pointer; text-decoration: underline;';

        let expanded = false;
        toggleLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (!expanded) {
                // Expand: set full text, measure, animate to full height
                summaryText.textContent = fullText;
                const fullHeight = summaryText.scrollHeight;
                summaryText.style.maxHeight = fullHeight + 'px';
                toggleLink.textContent = browser.i18n.getMessage("summarize_see_less") || "See less";
            } else {
                // Collapse: measure current truncated height, then animate down
                summaryText.textContent = truncated;
                // Force layout to get the target height before animating
                const collapsedHeight = summaryText.scrollHeight;
                summaryText.textContent = fullText;
                // Set explicit current height so transition has a starting point
                summaryText.style.maxHeight = summaryText.scrollHeight + 'px';
                requestAnimationFrame(() => {
                    summaryText.style.maxHeight = collapsedHeight + 'px';
                });
                // Swap text after transition ends
                summaryText.addEventListener('transitionend', function handler() {
                    summaryText.removeEventListener('transitionend', handler);
                    summaryText.textContent = truncated;
                });
                toggleLink.textContent = browser.i18n.getMessage("summarize_see_more") || "See more";
            }
            expanded = !expanded;
        });

        summaryTextWrapper.appendChild(toggleLink);
    }

    const summaryBody = document.createElement('div');
    summaryBody.style.cssText = 'display: flex; gap: 8px; align-items: flex-start;';
    summaryBody.appendChild(summaryIcon);
    summaryBody.appendChild(summaryTextWrapper);
    summaryContainer.appendChild(summaryBody);

    const spamBanner = document.getElementById('mzta-spam-report-banner') || document.getElementById('mzta-spam-check-progress');
    document.body.insertBefore(summaryContainer, spamBanner ? spamBanner.nextSibling : document.body.firstChild);
    return Promise.resolve(true);

  case "showSummaryGenerating":
    const existingGenerating = document.getElementById('mzta-summary-generating');
    if(existingGenerating) return Promise.resolve(true);

    const existingSummary = document.getElementById('mzta-summary-banner');
    if(existingSummary) existingSummary.remove();

    const existingTriggerWrap = document.getElementById('mzta-summary-trigger-wrapper');
    if(existingTriggerWrap) existingTriggerWrap.remove();
    const existingTrigger = document.getElementById('mzta-summary-trigger');
    if(existingTrigger) existingTrigger.remove();

    const isDarkGen = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    let bgColorGen = isDarkGen ? '#2a2a2a' : '#f0f0f0';
    let textColorGen = isDarkGen ? '#e0e0e0' : '#333';
    let borderColorGen = isDarkGen ? '#444' : '#ddd';
    let titleColorGen = isDarkGen ? '#ff6b6b' : '#d70022';

    const generatingContainer = document.createElement('div');
    generatingContainer.id = 'mzta-summary-generating';
    generatingContainer.className = 'thunderai-summary-pane';
    generatingContainer.style.cssText = `background-color: ${bgColorGen}; color: ${textColorGen}; padding: 0.5rem; margin-bottom: 1rem; border-radius: 4px; border: 1px solid ${borderColorGen}; font-family: system-ui, -apple-system, sans-serif; font-size: 14px; display: flex; align-items: center; gap: 10px;`;

    const generatingIcon = document.createElement('img');
    generatingIcon.src = browser.runtime.getURL("/images/ai_summary.png");
    generatingIcon.style.cssText = `height: 16px; width: 16px; flex-shrink: 0;${isDarkGen ? ' filter: invert(1);' : ''}`;

    const generatingLoadingImg = document.createElement('img');
    generatingLoadingImg.src = browser.runtime.getURL("/images/loading.gif");
    generatingLoadingImg.style.cssText = "height: 16px; width: 16px;";

    const generatingTitle = document.createElement('span');
    generatingTitle.className = 'thunderai-summary-title';
    generatingTitle.textContent = browser.i18n.getMessage("summarize_generating");
    generatingTitle.style.cssText = `font-size: 14px;`;

    generatingContainer.appendChild(generatingIcon);
    generatingContainer.appendChild(generatingLoadingImg);
    generatingContainer.appendChild(generatingTitle);

    const spamBannerGen = document.getElementById('mzta-spam-report-banner') || document.getElementById('mzta-spam-check-progress');
    document.body.insertBefore(generatingContainer, spamBannerGen ? spamBannerGen.nextSibling : document.body.firstChild);
    return Promise.resolve(true);

  case "showSummaryButton":
    const existingButton = document.getElementById('mzta-summary-trigger');
    if(existingButton) return Promise.resolve(true);

    const isDarkBtn = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    let bgColorBtn = isDarkBtn ? '#2a2a2a' : '#f0f0f0';
    let textColorBtn = isDarkBtn ? '#e0e0e0' : '#333';
    let borderColorBtn = isDarkBtn ? '#444' : '#ddd';

    const spamBannerTrigger = document.getElementById('mzta-spam-report-banner') || document.getElementById('mzta-spam-check-progress');
    const triggerBtn = document.createElement('div');
    triggerBtn.id = 'mzta-summary-trigger';
    triggerBtn.title = browser.i18n.getMessage("summarize_click_to_generate");
    const triggerBtnBase = `background-color: ${bgColorBtn}; border: 1px solid ${borderColorBtn}; border-radius: 4px; padding: 6px 10px; cursor: pointer; font-family: system-ui, -apple-system, sans-serif; font-size: 12px; font-style: italic; opacity: 0.7; transition: opacity 0.2s; color: ${textColorBtn}; display: inline-flex; align-items: center; gap: 6px; width: fit-content;`;
    if (spamBannerTrigger) {
        triggerBtn.style.cssText = triggerBtnBase + ' margin-left: auto; margin-top: 4px;';
    } else {
        triggerBtn.style.cssText = triggerBtnBase + ' position: fixed; top: 8px; right: 8px; z-index: 9998;';
    }

    const triggerIcon = document.createElement('img');
    triggerIcon.src = browser.runtime.getURL("/images/ai_summary.png");
    triggerIcon.style.cssText = `height: 14px; width: 14px;${isDarkBtn ? ' filter: invert(1);' : ''}`;
    triggerBtn.appendChild(triggerIcon);

    const triggerLabel = document.createElement('span');
    triggerLabel.textContent = browser.i18n.getMessage("get_ai_summary");
    triggerBtn.appendChild(triggerLabel);
    triggerBtn.onmouseover = () => { triggerBtn.style.opacity = '1'; };
    triggerBtn.onmouseout = () => { triggerBtn.style.opacity = '0.7'; };
    triggerBtn.onclick = async () => {
        triggerBtn.onclick = null;
        triggerBtn.style.cursor = 'default';
        triggerBtn.style.opacity = '0.7';
        triggerBtn.onmouseover = null;
        triggerBtn.onmouseout = null;
        const wrapper = document.getElementById('mzta-summary-trigger-wrapper');
        if (wrapper) wrapper.remove(); else triggerBtn.remove();
        browser.runtime.sendMessage({
            command: message.webchat ? "triggerSummaryWebchat" : "triggerSummaryGeneration",
            headerMessageId: message.headerMessageId
        });
    };

    if (spamBannerTrigger) {
        const triggerWrapper = document.createElement('div');
        triggerWrapper.id = 'mzta-summary-trigger-wrapper';
        triggerWrapper.style.cssText = 'display: flex; justify-content: flex-end; padding: 4px 0.5rem;';
        triggerWrapper.appendChild(triggerBtn);
        document.body.insertBefore(triggerWrapper, spamBannerTrigger.nextSibling);
    } else {
        document.body.appendChild(triggerBtn);
    }
    return Promise.resolve(true);

  default:
    // do nothing
    return Promise.resolve(false);
    break;
}
});

browser.runtime.sendMessage({ command: "checkSpamReport" });
browser.runtime.sendMessage({ command: "initSummary" });