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

// CSS selectors for DOM elements injected by ThunderAI.
// These are stripped when retrieving the email body content
// to avoid contaminating placeholder values sent to AI providers.
// Add new selectors here when new UI elements are injected into the email DOM.
const MZTA_INJECTED_SELECTORS = [
  '#mzta-container',
  '.mzta_dialog',
];

function getCleanBodyHtml() {
  const clone = document.body.cloneNode(true);
  for (const selector of MZTA_INJECTED_SELECTORS) {
    for (const el of clone.querySelectorAll(selector)) {
      el.remove();
    }
  }
  for (const table of clone.querySelectorAll('table.moz-main-header')) {
    let sibling = table.previousElementSibling;
    while (sibling && sibling.tagName === 'DIV') {
      const toRemove = sibling;
      sibling = sibling.previousElementSibling;
      toRemove.remove();
    }
    table.remove();
  }
  return clone;
}

// ── Theme colors ────────────────────────────────────────────────────
function _getThemeColors(spamValue, spamThreshold) {
    const isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const colors = {
        isDark,
        toolbar:     { bg: isDark ? '#1e1e1e' : '#f5f5f5', text: isDark ? '#ddd' : '#333', border: isDark ? '#444' : '#ddd' },
        spamLoading: { bg: isDark ? '#003366' : '#e6f2ff', text: isDark ? '#cce5ff' : '#004085', border: isDark ? '#004085' : '#b8daff' },
        summary:     { bg: isDark ? '#2a2a2a' : '#f0f0f0', text: isDark ? '#e0e0e0' : '#333', border: isDark ? '#444' : '#ddd' },
        summaryErr:  { bg: isDark ? '#3a1a1a' : '#f7e6e6', text: isDark ? '#ffcccc' : '#660000', border: '#660000' },
        translation: { bg: isDark ? '#1a2e2a' : '#e8f5e9', text: isDark ? '#c8e6c9' : '#1b5e20', border: isDark ? '#2e5740' : '#a5d6a7' },
        translErr:   { bg: isDark ? '#3a1a1a' : '#f7e6e6', text: isDark ? '#ffcccc' : '#660000', border: '#660000' },
        linkColor:   isDark ? '#6db3f2' : '#1a5fa8',
    };
    // Spam colors depend on the score
    if (spamValue !== undefined) {
        const threshold = spamThreshold || 50;
        if (spamValue == -999) {
            colors.spam = { bg: isDark ? '#332701' : '#fff3cd', text: isDark ? '#ffeb80' : '#856404', border: isDark ? '#664d03' : '#ffeeba' };
        } else if (spamValue >= threshold) {
            colors.spam = { bg: isDark ? '#5a1a1a' : '#ffe6e6', text: isDark ? '#ffcccc' : '#cc0000', border: '#cc0000' };
        } else {
            colors.spam = { bg: isDark ? '#1a401a' : '#e6ffe6', text: isDark ? '#ccffcc' : '#006600', border: '#006600' };
        }
    }
    return colors;
}

// ── Container / Toolbar / Panels management ─────────────────────────
function _ensureContainer() {
    let container = document.getElementById('mzta-container');
    if (!container) {
        const colors = _getThemeColors();
        container = document.createElement('div');
        container.id = 'mzta-container';
        container.style.cssText = 'font-family: system-ui, -apple-system, sans-serif;';
        document.body.insertBefore(container, document.body.firstChild);

        const toolbar = document.createElement('div');
        toolbar.id = 'mzta-toolbar';
        toolbar.style.cssText = `display: none; align-items: center; gap: 8px; padding: 6px 0.5rem; background-color: ${colors.toolbar.bg}; border-bottom: 1px solid ${colors.toolbar.border}; font-size: 13px; color: ${colors.toolbar.text};`;
        container.appendChild(toolbar);

        const panels = document.createElement('div');
        panels.id = 'mzta-panels';
        panels.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding: 4px 0;';
        container.appendChild(panels);
    }
    return {
        toolbar: document.getElementById('mzta-toolbar'),
        panels: document.getElementById('mzta-panels'),
    };
}

function _updateToolbarVisibility() {
    const toolbar = document.getElementById('mzta-toolbar');
    if (!toolbar) return;
    const hasItems = toolbar.querySelector('#mzta-toolbar-spam, #mzta-toolbar-summary, #mzta-toolbar-translation');
    toolbar.style.display = hasItems ? 'flex' : 'none';
    // Push the first button (summary or translation) to the right
    const summary = document.getElementById('mzta-toolbar-summary');
    const translation = document.getElementById('mzta-toolbar-translation');
    const firstBtn = summary || translation;
    if (summary) summary.style.marginLeft = (firstBtn === summary) ? 'auto' : '';
    if (translation) translation.style.marginLeft = (firstBtn === translation) ? 'auto' : '';
}

const _TOOLBAR_SLOT_ORDER = ['mzta-toolbar-spam', 'mzta-toolbar-summary', 'mzta-toolbar-translation'];

function _addToolbarItem(id, element) {
    const { toolbar } = _ensureContainer();
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    element.id = id;

    const myIndex = _TOOLBAR_SLOT_ORDER.indexOf(id);
    let insertBefore = null;
    for (let i = myIndex + 1; i < _TOOLBAR_SLOT_ORDER.length; i++) {
        const later = document.getElementById(_TOOLBAR_SLOT_ORDER[i]);
        if (later) { insertBefore = later; break; }
    }
    if (insertBefore) toolbar.insertBefore(element, insertBefore);
    else toolbar.appendChild(element);

    _updateToolbarVisibility();
}

function _removeToolbarItem(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
    _updateToolbarVisibility();
}

const _PANEL_ORDER = [
    'mzta-spam-check-progress', 'mzta-spam-report-banner',
    'mzta-translation-generating', 'mzta-translation-banner',
    'mzta-summary-generating', 'mzta-summary-banner'
];

function _addPanel(id, element) {
    const { panels } = _ensureContainer();
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    element.id = id;

    const myIndex = _PANEL_ORDER.indexOf(id);
    let insertBefore = null;
    for (let i = myIndex + 1; i < _PANEL_ORDER.length; i++) {
        const later = document.getElementById(_PANEL_ORDER[i]);
        if (later) { insertBefore = later; break; }
    }
    if (insertBefore) panels.insertBefore(element, insertBefore);
    else panels.appendChild(element);

    _updatePanelMargins();
}

function _removePanel(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
    _updatePanelMargins();
}

function _updatePanelMargins() {
    const panels = document.getElementById('mzta-panels');
    if (!panels) return;
    let lastPanel = null;
    for (const child of panels.children) {
        child.style.marginBottom = '';
        lastPanel = child;
    }
    if (lastPanel) lastPanel.style.marginBottom = '1rem';
}

function _isHtml(text) {
    return /<[a-z][^>]*>/i.test(text);
}

function _renderSafeHtml(container, html) {
    container.textContent = '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('script, img').forEach(el => el.remove());
    while (doc.body.firstChild) {
        container.appendChild(doc.body.firstChild);
    }
    container.querySelectorAll('p').forEach(p => { p.style.marginBlockStart = '0'; });
}

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
    const children = getCleanBodyHtml().childNodes;
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
      return Promise.resolve(getCleanBodyHtml().innerText);
  }

  case "getFullHtml": {
      return Promise.resolve(getCleanBodyHtml().innerHTML);
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

    case "showSpamCheckInProgress": {
      _removePanel('mzta-spam-report-banner');
      _removeToolbarItem('mzta-toolbar-spam');
      if (document.getElementById('mzta-spam-check-progress')) return Promise.resolve(true);

      const colors = _getThemeColors();

      // Loading badge in toolbar
      const badge = document.createElement('div');
      badge.style.cssText = `background-color: ${colors.spamLoading.bg}; color: ${colors.spamLoading.text}; border: 1px solid ${colors.spamLoading.border}; border-radius: 4px; padding: 2px 8px; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;`;
      const badgeLoading = document.createElement('img');
      badgeLoading.src = browser.runtime.getURL("/images/loading.gif");
      badgeLoading.style.cssText = "height: 14px; width: 14px;";
      badge.appendChild(badgeLoading);
      const badgeText = document.createElement('span');
      badgeText.textContent = browser.i18n.getMessage("spam_check_in_progress");
      badge.appendChild(badgeText);
      _addToolbarItem('mzta-toolbar-spam', badge);
      return Promise.resolve(true);
    }

  case "showSpamReport": {
    _removePanel('mzta-spam-check-progress');
    _removeToolbarItem('mzta-toolbar-spam');

    const data = message.data;
    if (document.getElementById('mzta-spam-report-banner')) return Promise.resolve(true);

    const colors = _getThemeColors(data.spamValue, data.SpamThreshold);
    const sc = colors.spam;

    // Spam badge in toolbar (clickable to toggle explanation panel)
    const badge = document.createElement('div');
    badge.title = browser.i18n.getMessage("spam_badge_tooltip");
    badge.style.cssText = `background-color: ${sc.bg}; color: ${sc.text}; border: 1px solid ${sc.border}; border-radius: 4px; padding: 2px 8px; font-size: 12px; font-weight: bold; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; transition: opacity 0.2s;`;
    if (data.spamValue == -999) {
        badge.textContent = browser.i18n.getMessage("apiwebchat_error");
    } else {
        badge.textContent = ((data.spamValue >= (data.SpamThreshold || 50)) ? "\u26A0\uFE0F " + browser.i18n.getMessage("Spam") : "\uD83D\uDEE1\uFE0F " + browser.i18n.getMessage("Valid")) + " [" + data.spamValue + "/100]";
    }
    const chevron = document.createElement('span');
    chevron.textContent = ' \u25BC';
    chevron.style.cssText = 'font-size: 10px; transition: transform 0.2s; transform: rotate(-90deg);';
    badge.appendChild(chevron);

    let spamExpanded = false;
    badge.onclick = () => {
        const panel = document.getElementById('mzta-spam-report-banner');
        if (panel) {
            spamExpanded = !spamExpanded;
            panel.style.display = spamExpanded ? 'flex' : 'none';
            chevron.style.transform = spamExpanded ? '' : 'rotate(-90deg)';
        }
    };
    badge.onmouseover = () => { badge.style.opacity = '0.8'; };
    badge.onmouseout = () => { badge.style.opacity = '1'; };

    _addToolbarItem('mzta-toolbar-spam', badge);

    // Explanation panel (collapsed by default)
    const panel = document.createElement('div');
    panel.style.cssText = `background-color: ${sc.bg}; color: ${sc.text}; border: 1px solid ${sc.border}; border-radius: 4px; padding: 8px 0.5rem; font-size: 13px; display: none; align-items: center; gap: 15px; width: 100%; box-sizing: border-box;`;

    const reasonText = document.createElement('span');
    if (data.spamValue == -999) {
        reasonText.textContent = data.explanation;
    } else {
        reasonText.textContent = browser.i18n.getMessage("Explanation") + ": " + data.explanation;
    }

    const spamMenu = createThreeDotsMenu(colors.isDark, [
        {
            icon: '\u21BB',
            label: browser.i18n.getMessage("spamfilter_refresh") || 'Refresh spam report',
            hoverColor: colors.isDark ? '#4d9de0' : '#1a5fa8',
            disableAfterClick: true,
            onClick: () => {
                browser.runtime.sendMessage({ command: "refreshSpamReport", headerMessageId: data.headerMessageId });
            }
        },
        {
            icon: '\u00D7',
            label: browser.i18n.getMessage("spamfilter_delete") || 'Delete spam report',
            hoverColor: '#cc0000',
            onClick: () => {
                _removePanel('mzta-spam-report-banner');
                _removeToolbarItem('mzta-toolbar-spam');
                browser.runtime.sendMessage({ command: "removeSpamReport", headerMessageId: data.headerMessageId });
            }
        }
    ], { bg: sc.bg, border: sc.border, text: sc.text });

    const rightGroup = document.createElement('span');
    rightGroup.style.cssText = 'margin-left: auto; display: flex; align-items: center; gap: 5px;';
    const branding = document.createElement('span');
    branding.textContent = browser.i18n.getMessage("antispam_by") + " ThunderAI";
    branding.style.cssText = 'font-style: italic; font-size: 10px; opacity: 0.5;';
    rightGroup.appendChild(branding);
    rightGroup.appendChild(spamMenu);

    panel.appendChild(reasonText);
    panel.appendChild(rightGroup);

    _addPanel('mzta-spam-report-banner', panel);
    return Promise.resolve(true);
  }

  case "showSummary": {
    _removePanel('mzta-summary-generating');
    _removePanel('mzta-summary-banner');
    _removeToolbarItem('mzta-toolbar-summary');

    const summaryData = message.data;
    const colors = _getThemeColors();
    const sc = summaryData.error ? colors.summaryErr : colors.summary;

    const summaryContainer = document.createElement('div');
    summaryContainer.className = 'thunderai-summary-pane';
    summaryContainer.style.cssText = `background-color: ${sc.bg}; color: ${sc.text}; padding: 0.5rem; border-radius: 4px; border: 1px solid ${sc.border}; font-size: 14px;`;

    const summaryMenu = createThreeDotsMenu(colors.isDark, [
        {
            icon: '\u21BB',
            label: browser.i18n.getMessage("summarize_refresh") || 'Refresh summary',
            hoverColor: colors.isDark ? '#4d9de0' : '#1a5fa8',
            disableAfterClick: true,
            onClick: () => {
                browser.runtime.sendMessage({ command: "refreshSummary", headerMessageId: summaryData.headerMessageId });
            }
        },
        {
            icon: '\u00D7',
            label: browser.i18n.getMessage("summarize_delete") || 'Delete summary',
            hoverColor: '#cc0000',
            onClick: () => {
                _removePanel('mzta-summary-banner');
                browser.runtime.sendMessage({ command: "removeSummary", headerMessageId: summaryData.headerMessageId });
            }
        }
    ], { bg: sc.bg, border: sc.border, text: sc.text });

    const summaryBranding = document.createElement('span');
    summaryBranding.textContent = browser.i18n.getMessage("summary_by") + " ThunderAI";
    summaryBranding.style.cssText = 'font-style: italic; font-size: 10px; opacity: 0.5; white-space: nowrap;';

    const summaryRightGroup = document.createElement('span');
    summaryRightGroup.style.cssText = 'display: flex; align-items: center; gap: 5px; float: right; margin-left: 10px;';
    summaryRightGroup.appendChild(summaryMenu);

    const summaryIcon = document.createElement('img');
    summaryIcon.src = browser.runtime.getURL("/images/ai_summary.png");
    summaryIcon.style.cssText = `height: 16px; width: 16px; flex-shrink: 0; margin-top: 2px;${colors.isDark ? ' filter: invert(1);' : ''}`;

    const summaryTextWrapper = document.createElement('div');
    summaryTextWrapper.style.cssText = 'flex: 1; min-width: 0;';
    summaryTextWrapper.appendChild(summaryRightGroup);

    const summaryText = document.createElement('div');
    summaryText.className = 'thunderai-summary-content';
    const hasHtml = !!summaryData.summary_html && !summaryData.stripFormatting;

    function setSummaryHtml(element, html) {
        element.textContent = '';
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        while (doc.body.firstChild) {
            element.appendChild(doc.body.firstChild);
        }
        element.querySelectorAll('p').forEach(p => { p.style.marginBlockStart = '0'; });
    }

    if (summaryData.error) {
        summaryText.textContent = summaryData.message || browser.i18n.getMessage("summarize_error");
    } else if (hasHtml) {
        setSummaryHtml(summaryText, summaryData.summary_html);
    } else {
        summaryText.textContent = summaryData.summary;
    }
    summaryText.style.cssText = 'font-size: 14px; line-height: 1.4;';
    summaryTextWrapper.appendChild(summaryText);

    const maxLen = summaryData.maxDisplayLength || 0;
    const fullText = summaryData.summary;
    if (!summaryData.error && maxLen > 0 && fullText && fullText.length > maxLen) {
        summaryText.style.overflow = 'hidden';
        summaryText.style.transition = 'max-height 0.2s ease';

        if (!hasHtml) {
            let cutPos = fullText.lastIndexOf(' ', maxLen);
            if (cutPos <= 0) cutPos = maxLen;
            const truncated = fullText.substring(0, cutPos) + '\u2026';
            summaryText.textContent = truncated;

            requestAnimationFrame(() => {
                summaryText.style.maxHeight = summaryText.scrollHeight + 'px';
            });

            const toggleLink = document.createElement('a');
            toggleLink.textContent = browser.i18n.getMessage("summarize_see_more") || "See more";
            toggleLink.href = '#';
            toggleLink.style.cssText = `display: inline-block; margin-top: 4px; font-size: 13px; color: ${colors.linkColor}; cursor: pointer; text-decoration: underline;`;

            let expanded = false;
            toggleLink.addEventListener('click', (e) => {
                e.preventDefault();
                if (!expanded) {
                    summaryText.textContent = fullText;
                    summaryText.style.maxHeight = summaryText.scrollHeight + 'px';
                    toggleLink.textContent = browser.i18n.getMessage("summarize_see_less") || "See less";
                } else {
                    summaryText.textContent = truncated;
                    const collapsedHeight = summaryText.scrollHeight;
                    summaryText.textContent = fullText;
                    summaryText.style.maxHeight = summaryText.scrollHeight + 'px';
                    requestAnimationFrame(() => {
                        summaryText.style.maxHeight = collapsedHeight + 'px';
                    });
                    summaryText.addEventListener('transitionend', function handler() {
                        summaryText.removeEventListener('transitionend', handler);
                        summaryText.textContent = truncated;
                    });
                    toggleLink.textContent = browser.i18n.getMessage("summarize_see_more") || "See more";
                }
                expanded = !expanded;
            });
            const toggleContainer = document.createElement('div');
            toggleContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 8px; justify-content: space-between;';
            toggleContainer.appendChild(toggleLink);
            toggleContainer.appendChild(summaryBranding);
            summaryBranding.style.marginRight = '0px';
            summaryBranding.style.marginBottom = '0px';
            summaryTextWrapper.appendChild(toggleContainer);
        } else {
            const collapsedMaxHeight = '4.2em';
            summaryText.style.maxHeight = collapsedMaxHeight;

            const toggleLink = document.createElement('a');
            toggleLink.textContent = browser.i18n.getMessage("summarize_see_more") || "See more";
            toggleLink.href = '#';
            toggleLink.style.cssText = `display: inline-block; margin-top: 4px; font-size: 13px; color: ${colors.linkColor}; cursor: pointer; text-decoration: underline;`;

            let expanded = false;
            toggleLink.addEventListener('click', (e) => {
                e.preventDefault();
                if (!expanded) {
                    summaryText.style.maxHeight = summaryText.scrollHeight + 'px';
                    toggleLink.textContent = browser.i18n.getMessage("summarize_see_less") || "See less";
                } else {
                    summaryText.style.maxHeight = collapsedMaxHeight;
                    toggleLink.textContent = browser.i18n.getMessage("summarize_see_more") || "See more";
                }
                expanded = !expanded;
            });

            requestAnimationFrame(() => {
                if (summaryText.scrollHeight > summaryText.clientHeight) {
                    const toggleContainer = document.createElement('div');
                    toggleContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: -6px; justify-content: space-between;';
                    toggleContainer.appendChild(toggleLink);
                    toggleContainer.appendChild(summaryBranding);
                    summaryBranding.style.marginRight = '-4px';
                    summaryBranding.style.marginBottom = '-6px';
                    summaryTextWrapper.appendChild(toggleContainer);
                } else {
                    summaryText.style.maxHeight = '';
                    summaryText.style.overflow = '';
                    // No toggle, branding goes directly after text
                    const brandingContainer = document.createElement('div');
                    brandingContainer.style.cssText = 'display: flex; justify-content: flex-end; margin-right: -4px; margin-bottom: -6px;';
                    brandingContainer.appendChild(summaryBranding);
                    summaryTextWrapper.appendChild(brandingContainer);
                }
            });
        }
    } else {
        // No truncation, branding goes directly after text
        const brandingContainer = document.createElement('div');
        brandingContainer.style.cssText = 'display: flex; justify-content: flex-end; margin-right: -4px; margin-bottom: -6px;';
        brandingContainer.appendChild(summaryBranding);
        summaryTextWrapper.appendChild(brandingContainer);
    }

    const summaryBody = document.createElement('div');
    summaryBody.style.cssText = 'display: flex; gap: 8px; align-items: flex-start;';
    summaryBody.appendChild(summaryIcon);
    summaryBody.appendChild(summaryTextWrapper);
    summaryContainer.appendChild(summaryBody);

    _addPanel('mzta-summary-banner', summaryContainer);
    return Promise.resolve(true);
  }

  case "showSummaryGenerating": {
    if (document.getElementById('mzta-summary-generating')) return Promise.resolve(true);

    _removePanel('mzta-summary-banner');
    _removeToolbarItem('mzta-toolbar-summary');

    const colors = _getThemeColors();
    const genContainer = document.createElement('div');
    genContainer.className = 'thunderai-summary-pane';
    genContainer.style.cssText = `background-color: ${colors.summary.bg}; color: ${colors.summary.text}; padding: 0.5rem; border-radius: 4px; border: 1px solid ${colors.summary.border}; font-size: 14px; display: flex; align-items: center; gap: 10px;`;

    const genIcon = document.createElement('img');
    genIcon.src = browser.runtime.getURL("/images/ai_summary.png");
    genIcon.style.cssText = `height: 16px; width: 16px; flex-shrink: 0;${colors.isDark ? ' filter: invert(1);' : ''}`;

    const genLoading = document.createElement('img');
    genLoading.src = browser.runtime.getURL("/images/loading.gif");
    genLoading.style.cssText = "height: 16px; width: 16px;";

    const genTitle = document.createElement('span');
    genTitle.className = 'thunderai-summary-title';
    genTitle.textContent = browser.i18n.getMessage("summarize_generating");
    genTitle.style.cssText = 'font-size: 14px;';

    genContainer.appendChild(genIcon);
    genContainer.appendChild(genLoading);
    genContainer.appendChild(genTitle);

    _addPanel('mzta-summary-generating', genContainer);
    return Promise.resolve(true);
  }

  case "showSummaryButton": {
    if (document.getElementById('mzta-toolbar-summary')) return Promise.resolve(true);

    const colors = _getThemeColors();
    const triggerBtn = document.createElement('div');
    triggerBtn.title = browser.i18n.getMessage("summarize_click_to_generate");
    triggerBtn.style.cssText = `background-color: ${colors.summary.bg}; border: 1px solid ${colors.summary.border}; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px; font-style: italic; opacity: 0.7; transition: opacity 0.2s; color: ${colors.summary.text}; display: inline-flex; align-items: center; gap: 6px;`;

    const triggerIcon = document.createElement('img');
    triggerIcon.src = browser.runtime.getURL("/images/ai_summary.png");
    triggerIcon.style.cssText = `height: 14px; width: 14px;${colors.isDark ? ' filter: invert(1);' : ''}`;
    triggerBtn.appendChild(triggerIcon);

    const triggerLabel = document.createElement('span');
    triggerLabel.textContent = browser.i18n.getMessage("get_ai_summary");
    triggerBtn.appendChild(triggerLabel);

    triggerBtn.onmouseover = () => { triggerBtn.style.opacity = '1'; };
    triggerBtn.onmouseout = () => { triggerBtn.style.opacity = '0.7'; };
    triggerBtn.onclick = () => {
        _removeToolbarItem('mzta-toolbar-summary');
        browser.runtime.sendMessage({
            command: message.webchat ? "triggerSummaryWebchat" : "triggerSummaryGeneration",
            headerMessageId: message.headerMessageId
        });
    };

    _addToolbarItem('mzta-toolbar-summary', triggerBtn);
    return Promise.resolve(true);
  }

  case "showTranslation": {
    _removePanel('mzta-translation-generating');
    _removePanel('mzta-translation-banner');
    _removeToolbarItem('mzta-toolbar-translation');

    const translationData = message.data;
    const colors = _getThemeColors();
    const tc = translationData.error ? colors.translErr : colors.translation;

    const translationContainer = document.createElement('div');
    translationContainer.className = 'thunderai-translation-pane';
    translationContainer.style.cssText = `background-color: ${tc.bg}; color: ${tc.text}; padding: 0.5rem; border-radius: 4px; border: 1px solid ${tc.border}; font-size: 14px;`;

    const translationHeader = document.createElement('div');
    translationHeader.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';

    const translationIcon = document.createElement('img');
    translationIcon.src = browser.runtime.getURL("/images/ai_translate.png");
    translationIcon.style.cssText = `height: 16px; width: 16px; flex-shrink: 0;${colors.isDark ? ' filter: invert(1);' : ''}`;

    const translationTitleSpan = document.createElement('span');
    translationTitleSpan.style.cssText = `font-weight: bold; font-size: 14px; color: ${tc.text}; flex-grow: 1;`;
    translationTitleSpan.textContent = browser.i18n.getMessage("translate_banner_title") || "AI Translation";
    
    const translationMenu = createThreeDotsMenu(colors.isDark, [
        {
            icon: '\u21BB',
            label: browser.i18n.getMessage("translate_refresh") || 'Refresh translation',
            hoverColor: colors.isDark ? '#4d9de0' : '#1a5fa8',
            disableAfterClick: true,
            onClick: () => {
                browser.runtime.sendMessage({ command: "refreshTranslation", headerMessageId: translationData.headerMessageId });
            }
        },
        {
            icon: '\u00D7',
            label: browser.i18n.getMessage("translate_delete") || 'Delete translation',
            hoverColor: '#cc0000',
            onClick: () => {
                _removePanel('mzta-translation-banner');
                browser.runtime.sendMessage({ command: "removeTranslation", headerMessageId: translationData.headerMessageId });
            }
        }
    ], { bg: tc.bg, border: tc.border, text: tc.text });

    const translationBranding = document.createElement('span');
    translationBranding.textContent = browser.i18n.getMessage("translate_by") + " ThunderAI";
    translationBranding.style.cssText = 'font-style: italic; font-size: 10px; opacity: 0.5; white-space: nowrap;';

    translationHeader.appendChild(translationIcon);
    translationHeader.appendChild(translationTitleSpan);
    translationHeader.appendChild(translationMenu);
    translationContainer.appendChild(translationHeader);

    const translationTextWrapper = document.createElement('div');
    translationTextWrapper.style.cssText = 'flex-grow: 1;';

    const translationText = document.createElement('div');
    translationText.style.cssText = 'white-space: pre-wrap; line-height: 1.5;';
    if (translationData.error) {
        translationText.textContent = translationData.message || browser.i18n.getMessage("translate_error");
    } else if (translationData.translation_status === '-1') {
        translationText.textContent = browser.i18n.getMessage("translate_skipped");
    } else {
        if (translationData.translated_subject) {
            // const subjectEl = document.createElement('div');
            // subjectEl.style.cssText = 'font-weight: bold; margin-bottom: 4px;';
            if (translationData.lang) {
              translationTitleSpan.textContent = '[' + translationData.lang + '] ';
            }
            translationTitleSpan.textContent += translationData.translated_subject;
            // translationTextWrapper.appendChild(subjectEl);
        }
        const bodyText = translationData.translated_text || '';
        const bodyIsHtml = _isHtml(bodyText);
        if (bodyIsHtml) {
            translationText.style.whiteSpace = '';
            _renderSafeHtml(translationText, bodyText);
        } else {
            translationText.textContent = bodyText;
        }
    }
    translationTextWrapper.appendChild(translationText);

    const maxLenTranslation = translationData.maxDisplayLength || 0;
    const fullTranslationText = translationData.translated_text || '';
    const fullTranslationIsHtml = _isHtml(fullTranslationText);
    if (!translationData.error && translationData.translation_status !== '-1' && maxLenTranslation > 0 && fullTranslationText.length > maxLenTranslation) {
        translationText.style.overflow = 'hidden';
        translationText.style.transition = 'max-height 0.2s ease';

        const toggleLink = document.createElement('a');
        toggleLink.textContent = browser.i18n.getMessage("translate_see_more") || "See more";
        toggleLink.href = '#';
        toggleLink.style.cssText = `display: inline-block; margin-top: 4px; font-size: 13px; color: ${colors.linkColor}; cursor: pointer; text-decoration: underline;`;

        if (fullTranslationIsHtml) {
            const collapsedMaxHeight = '4.2em';
            translationText.style.maxHeight = collapsedMaxHeight;

            let expanded = false;
            toggleLink.addEventListener('click', (e) => {
                e.preventDefault();
                if (!expanded) {
                    translationText.style.maxHeight = translationText.scrollHeight + 'px';
                    toggleLink.textContent = browser.i18n.getMessage("translate_see_less") || "See less";
                } else {
                    translationText.style.maxHeight = collapsedMaxHeight;
                    toggleLink.textContent = browser.i18n.getMessage("translate_see_more") || "See more";
                }
                expanded = !expanded;
            });

            requestAnimationFrame(() => {
                if (translationText.scrollHeight > translationText.clientHeight) {
                    const toggleContainer = document.createElement('div');
                    toggleContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: -6px; justify-content: space-between;';
                    toggleContainer.appendChild(toggleLink);
                    toggleContainer.appendChild(translationBranding);
                    translationBranding.style.marginRight = '-4px';
                    translationBranding.style.marginBottom = '-6px';
                    translationTextWrapper.appendChild(toggleContainer);
                } else {
                    translationText.style.maxHeight = '';
                    translationText.style.overflow = '';
                    // No toggle, branding goes directly after text
                    const brandingContainer = document.createElement('div');
                    brandingContainer.style.cssText = 'display: flex; justify-content: flex-end; margin-right: -4px; margin-bottom: -6px;';
                    brandingContainer.appendChild(translationBranding);
                    translationTextWrapper.appendChild(brandingContainer);
                }
            });
        } else {
            let cutPos = fullTranslationText.lastIndexOf(' ', maxLenTranslation);
            if (cutPos <= 0) cutPos = maxLenTranslation;
            const truncatedTranslation = fullTranslationText.substring(0, cutPos) + '\u2026';
            translationText.textContent = truncatedTranslation;

            requestAnimationFrame(() => {
                translationText.style.maxHeight = translationText.scrollHeight + 'px';
            });

            let expanded = false;
            toggleLink.addEventListener('click', (e) => {
                e.preventDefault();
                if (!expanded) {
                    translationText.textContent = fullTranslationText;
                    translationText.style.maxHeight = translationText.scrollHeight + 'px';
                    toggleLink.textContent = browser.i18n.getMessage("translate_see_less") || "See less";
                } else {
                    translationText.textContent = truncatedTranslation;
                    const collapsedHeight = translationText.scrollHeight;
                    translationText.textContent = fullTranslationText;
                    translationText.style.maxHeight = translationText.scrollHeight + 'px';
                    requestAnimationFrame(() => {
                        translationText.style.maxHeight = collapsedHeight + 'px';
                    });
                    translationText.addEventListener('transitionend', function handler() {
                        translationText.removeEventListener('transitionend', handler);
                        translationText.textContent = truncatedTranslation;
                    });
                    toggleLink.textContent = browser.i18n.getMessage("translate_see_more") || "See more";
                }
                expanded = !expanded;
            });
            const toggleContainer = document.createElement('div');
            toggleContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: -6px; justify-content: space-between;';
            toggleContainer.appendChild(toggleLink);
            toggleContainer.appendChild(translationBranding);
            translationBranding.style.marginRight = '-4px';
            translationBranding.style.marginBottom = '-6px';
            translationTextWrapper.appendChild(toggleContainer);
        }
    } else {
        // No truncation, branding goes directly after text
        const brandingContainer = document.createElement('div');
        brandingContainer.style.cssText = 'display: flex; justify-content: flex-end; margin-right: -4px; margin-bottom: -6px;';
        brandingContainer.appendChild(translationBranding);
        translationTextWrapper.appendChild(brandingContainer);
    }

    translationContainer.appendChild(translationTextWrapper);

    _addPanel('mzta-translation-banner', translationContainer);
    return Promise.resolve(true);
  }

  case "showTranslationGenerating": {
    if (document.getElementById('mzta-translation-generating')) return Promise.resolve(true);

    _removePanel('mzta-translation-banner');
    _removeToolbarItem('mzta-toolbar-translation');

    const colors = _getThemeColors();
    const genContainer = document.createElement('div');
    genContainer.className = 'thunderai-translation-pane';
    genContainer.style.cssText = `background-color: ${colors.translation.bg}; color: ${colors.translation.text}; padding: 0.5rem; border-radius: 4px; border: 1px solid ${colors.translation.border}; font-size: 14px; display: flex; align-items: center; gap: 10px;`;

    const genIcon = document.createElement('img');
    genIcon.src = browser.runtime.getURL("/images/ai_translate.png");
    genIcon.style.cssText = `height: 16px; width: 16px; flex-shrink: 0;${colors.isDark ? ' filter: invert(1);' : ''}`;

    const genLoading = document.createElement('img');
    genLoading.src = browser.runtime.getURL("/images/loading.gif");
    genLoading.style.cssText = "height: 16px; width: 16px;";

    const genTitle = document.createElement('span');
    genTitle.textContent = browser.i18n.getMessage("translate_generating") || "Translating...";
    genTitle.style.cssText = 'font-size: 14px;';

    genContainer.appendChild(genIcon);
    genContainer.appendChild(genLoading);
    genContainer.appendChild(genTitle);

    _addPanel('mzta-translation-generating', genContainer);
    return Promise.resolve(true);
  }

  case "showTranslationButton": {
    if (document.getElementById('mzta-toolbar-translation')) return Promise.resolve(true);

    const colors = _getThemeColors();
    const triggerBtn = document.createElement('div');
    triggerBtn.title = browser.i18n.getMessage("translate_click_to_generate") || "Click to translate this email";
    triggerBtn.style.cssText = `background-color: ${colors.translation.bg}; border: 1px solid ${colors.translation.border}; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px; font-style: italic; opacity: 0.7; transition: opacity 0.2s; color: ${colors.translation.text}; display: inline-flex; align-items: center; gap: 6px;`;

    const triggerIcon = document.createElement('img');
    triggerIcon.src = browser.runtime.getURL("/images/ai_translate.png");
    triggerIcon.style.cssText = `height: 14px; width: 14px;${colors.isDark ? ' filter: invert(1);' : ''}`;
    triggerBtn.appendChild(triggerIcon);

    const triggerLabel = document.createElement('span');
    triggerLabel.textContent = browser.i18n.getMessage("get_ai_translation") || "Get AI Translation";
    triggerBtn.appendChild(triggerLabel);

    triggerBtn.onmouseover = () => { triggerBtn.style.opacity = '1'; };
    triggerBtn.onmouseout = () => { triggerBtn.style.opacity = '0.7'; };
    triggerBtn.onclick = () => {
        _removeToolbarItem('mzta-toolbar-translation');
        browser.runtime.sendMessage({
            command: "triggerTranslationGeneration",
            headerMessageId: message.headerMessageId
        });
    };

    _addToolbarItem('mzta-toolbar-translation', triggerBtn);
    return Promise.resolve(true);
  }

  default:
    // do nothing
    return Promise.resolve(false);
    break;
}
});

browser.runtime.sendMessage({ command: "checkSpamReport" });
browser.runtime.sendMessage({ command: "initSummary" });
browser.runtime.sendMessage({ command: "initTranslation" });