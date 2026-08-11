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

import {
  prefs_default,
  getDynamicSettingValue
} from '../options/mzta-options-default.js';

import { customMenuIconsPath } from '../pages/menu_order/mzta-custom-menu-icons.js'

const sparks_min = '1.2.0'; // Minimum version of ThunderAI-Sparks required for the add-on to work
const MICZ_IT_LOCALIZED_LANGS = ['es', 'de', 'fr', 'it'];

export const getMenuContextCompose = () => 'compose_action_menu';
export const getMenuContextDisplay = () => 'message_display_action_menu';

export const contextMenuID_GetCalendarEvent = 'mzta-get-calendar-event';
export const contextMenuID_GetCalendarEventFromClipboard = 'mzta-get-calendar-event-from-clipboard';
export const contextMenuID_GetTask = 'mzta-get-task';
export const contextMenuID_AddTags = 'mzta-add-tags';
export const contextMenuID_Spamfilter = 'mzta-spamfilter';
export const contextMenuID_Summarize = 'mzta-summarize';
export const contextMenuID_Translate = 'mzta-translate';
export const contextMenuIconsPath = {
  [contextMenuID_GetCalendarEvent]: 'moz-extension:images/context_menu/getcalendarevent.png',
  [contextMenuID_GetCalendarEventFromClipboard]: 'moz-extension:images/context_menu/getcalendareventfromclipboard.png',
  [contextMenuID_GetTask]: 'moz-extension:images/context_menu/gettask.png',
  [contextMenuID_AddTags]: 'moz-extension:images/context_menu/autotags.png',
  [contextMenuID_Spamfilter]: 'moz-extension:images/context_menu/spamfilter.png',
  [contextMenuID_Summarize]: 'moz-extension:images/context_menu/summarize.png',
  [contextMenuID_Translate]: 'moz-extension:images/context_menu/translate.png',
};

// Map from special prompt IDs to context menu IDs
export const specialPromptToContextMenuID = {
  'prompt_get_calendar_event': contextMenuID_GetCalendarEvent,
  'prompt_get_calendar_event_from_clipboard': contextMenuID_GetCalendarEventFromClipboard,
  'prompt_get_task': contextMenuID_GetTask,
  'prompt_add_tags': contextMenuID_AddTags,
  'prompt_spamfilter': contextMenuID_Spamfilter,
  'prompt_summarize': contextMenuID_Summarize,
  'prompt_translate_this': contextMenuID_Translate,
};

// Built-in icons for the default prompts that are not special prompts.
// These are shipped with the add-on (not in the user-selectable custom icons folder),
// and act as a fallback: an icon explicitly chosen on the Menu Order page wins.
// Special prompts get their built-in icon from contextMenuIconsPath instead.
export const defaultPromptIconsPath = {
  'prompt_proofread_this': 'moz-extension:images/context_menu/proofread.png',
  'prompt_classify': 'moz-extension:images/context_menu/classify.png',
  'prompt_this': 'moz-extension:images/context_menu/prompt_this.png',
  'prompt_rewrite_formal': 'moz-extension:images/context_menu/rewrite_formal.png',
  'prompt_rewrite_polite': 'moz-extension:images/context_menu/rewrite_polite.png',
  'prompt_reply_advanced': 'moz-extension:images/context_menu/prompt_reply_advanced.png',
  'prompt_reply': 'moz-extension:images/context_menu/prompt_reply.png',
  'prompt_reply_custom_command': 'moz-extension:images/context_menu/prompt_reply_custom_command.png',
};

// const defaultContextMenuIcon = 'moz-extension:images/icon-32px.png';
const defaultContextMenuIcon = '';

// The icon a prompt ships with, ignoring any user choice: the hard-coded icon for
// special prompts, otherwise the built-in default-prompt icon. '' when there is none.
// Used both by the resolver below and by the Menu Order icon picker, so that the
// "restore default" cell always previews exactly what clearing custom_icon yields.
export function getBuiltInPromptIcon(promptId) {
  const contextMenuId = specialPromptToContextMenuID[promptId];
  if (contextMenuId && contextMenuIconsPath[contextMenuId]) {
    return contextMenuIconsPath[contextMenuId];
  }
  return defaultPromptIconsPath[promptId] || '';
}

export function getContextMenuIcon(prompt) {
  // Back-compat: accept a plain id string too
  const promptId = (typeof prompt === 'string') ? prompt : prompt?.id;

  // A user-chosen icon always wins, for special and non-special prompts alike.
  if (typeof prompt === 'object' && prompt !== null && prompt.custom_icon) {
    return 'moz-extension:' + customMenuIconsPath + prompt.custom_icon;
  }

  const builtIn = getBuiltInPromptIcon(promptId);
  if (builtIn) {
    return builtIn;
  }

  return defaultContextMenuIcon;
}

export function getLanguageDisplayName(languageCode) {
   const languageDisplay = new Intl.DisplayNames([languageCode], {type: 'language'});
   let lang_string = languageDisplay.of(languageCode);
   return lang_string.charAt(0).toUpperCase() + lang_string.slice(1);
}

export function getMiczItUrl(path) {
  const lang = browser.i18n.getUILanguage().split('-')[0];
  const prefix = MICZ_IT_LOCALIZED_LANGS.includes(lang) ? `${lang}/` : '';
  return `https://micz.it/${prefix}${path}`;
}

function fixMsgHeader(msgHeader) {
  if (!msgHeader.bccList) {
    msgHeader.bccList = [];
  }
  if (!msgHeader.ccList) {
    msgHeader.ccList = [];
  }
  if (!msgHeader.recipients) {
    msgHeader.recipients = [];
  }
  return msgHeader;
}

export async function getAccountsList() {
  let accounts = await browser.accounts.list();
  let accounts_array = [];
  for (let account of accounts) {
    let account_id = account.id;
    let account_name = account.name;
    accounts_array.push({id: account_id, name: account_name});
  }
  return accounts_array;
}

export async function getCurrentIdentity(msgHeader, getFull = false) {
  let identities = [];
  let fallbackIdentity = null;

  msgHeader = fixMsgHeader(msgHeader);

  const accounts = await browser.accounts.list();
  for (const account of accounts) {
    for (const identity of account.identities) {
      const entry = { id: identity.id, email: identity.email };
      identities.push(entry);
      if (!fallbackIdentity) fallbackIdentity = entry;
    }
  }

  // Check if author is a known identity
  const authorEmail = extractEmail(msgHeader.author);
  const authorIdentity = identities.find(identity => identity.email === authorEmail);
  if (authorIdentity) {
    return getFull ? authorIdentity : authorIdentity.id;
  }

  // Check if any of the recipients (to/cc/bcc) are a known identity
  const allRecipients = [...msgHeader.recipients, ...msgHeader.ccList, ...msgHeader.bccList];
  for (const recipient of allRecipients) {
    const email = extractEmail(recipient);
    const identity = identities.find(id => id.email === email);
    if (identity) {
      return getFull ? identity : identity.id;
    }
  }

  // Check the account that the folder of the message belongs to
  if (msgHeader.folder && msgHeader.folder.accountId) {
    const account = accounts.find(a => a.id === msgHeader.folder.accountId);
    if (account && account.identities && account.identities.length > 0) {
      // Just return the first identity of the account.
      const identity = account.identities[0];
      console.log(">>>>>>>>>> got from folder");
      return getFull ? { id: identity.id, email: identity.email } : identity.id;
    }
  }

  // Fallback
  return getFull ? fallbackIdentity : fallbackIdentity?.id || null;
}


function extractEmail(text) {
  if((text=='')||(text==undefined)) return '';
  const emailRegex = /[\w.-]+@[\w.-]+\.\w+/;
  const match = text.match(emailRegex);
  return match ? match[0] : '';
}

export async function getMailSubject(tab){
  // console.log(">>>>>>>>>> getMailSubject tab: " + JSON.stringify(tab));
  if(!["mail", "messageCompose","messageDisplay"].includes(tab.type)){
    return "";
  }
  switch(tab.type){
    case "mail":
      let messages_list = await browser.mailTabs.getSelectedMessages(tab.id);
      return messages_list.messages[0].subject;
    case "messageDisplay":
      let message = await messenger.messageDisplay.getDisplayedMessage(tab.id);
      return message.subject;
    case "messageCompose":
      let msg_details = await browser.compose.getComposeDetails(tab.id)
      return msg_details.subject;
    default:
      return "";
  }
}

function extractTextParts(fullMessage) {
  const textParts = []
  function walkParts(parts) {
    for (const part of parts) {
      if (part.parts && part.parts.length > 0) {
        walkParts(part.parts)
      }
      // console.log(">>>>>>>>>>>> extractTextParts: part.contentType: " + part.contentType + ", part.decryptionStatus: " + part.decryptionStatus + ", part.body: " + part.body);
      if (part.contentType && part.contentType.startsWith('text/')) {
        textParts.push(part)
      }
    }
  }
  if (fullMessage.parts && fullMessage.parts.length > 0) {
    walkParts(fullMessage.parts)
  }
  return textParts
}

function smartDecode(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    return new TextDecoder('windows-1252').decode(buf);
  }
}
  
export async function getMailBody(fullMessage, messageId) {
  const textParts = extractTextParts(fullMessage);
  let text = "";
  let html = "";
  // console.log(">>>>>>>>>>>>>> getMailBody: textParts: " + JSON.stringify(textParts));
  // console.log(">>>>>>>>>>>>>> getMailBody: fullMessage: " + JSON.stringify(fullMessage));
  for (const part of textParts) {
    let body = part.body;
    if ((body === undefined || body === "") && messageId && part.partName) {
      const file = await browser.messages.getAttachmentFile(messageId, part.partName);
      const buf = await file.arrayBuffer();
      //const buf = new TextDecoder('utf-8').decode(buf);
      body = smartDecode(buf);
    }
    if (part.contentType === "text/plain") {
      // console.log(">>>>>>>>>>>>>> getMailBody: part.body (TEXT): " + body);
      text += body ?? "";
    } else if (part.contentType === "text/html") {
      // console.log(">>>>>>>>>>>>>> getMailBody: part.body (HTML): " + (body ? body.substring(0, 80) : body));
      html += body ?? "";
    }
  }
  if(html === "") {
    html = text.replace(/\n/g, "<br>");
  } else {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    removeMozMainHeader(doc.body);
    html = doc.body.innerHTML;
  }
  return {text, html};
}

// Is this compose window composing in plain text?
//
// The compose format is a property of the single window, which Thunderbird
// reports authoritatively — it is deliberately NOT a global preference, because
// the same user can have one identity set to plain text and another to HTML.
//
// The try/catch is not gratuitous defensiveness: getComposeDetails rejects on a
// tab that is not (or no longer) a compose tab, and the tabId reaching here
// arrives by message from the webchat window, so it can be stale.
export async function isPlainTextCompose(tabId){
  try {
    let composeDetails = await messenger.compose.getComposeDetails(tabId);
    return composeDetails.isPlainText === true;
  } catch (e) {
    // HTML is the historical assumption.
    return false;
  }
}

// On a plain text compose window the body lives in `plainTextBody`, not `body`.
// Writing `body` there makes Thunderbird convert the HTML down to text, which
// collapses every bare \n as HTML whitespace and loses the line structure —
// so each of the helpers below has to pick the field that matches the window.
export async function reloadBody(tabId){
  let composeDetails = await messenger.compose.getComposeDetails(tabId);
  if(composeDetails.isPlainText){
    // The trailing space is what makes the value differ from the current one,
    // which is what forces the editor to re-read it.
    await messenger.compose.setComposeDetails(tabId, {plainTextBody: composeDetails.plainTextBody + " "});
    return;
  }
  let originalHtmlBody = composeDetails.body + " ";
  await messenger.compose.setComposeDetails(tabId, {body: originalHtmlBody});
}

export async function getOriginalBody(tabId){
  let composeDetails = await messenger.compose.getComposeDetails(tabId);
  if(composeDetails.isPlainText){
    return composeDetails.plainTextBody;
  }
  return composeDetails.body;
}

export async function setBody(tabId, fullBody, isPlainText = false){
  if(isPlainText){
    await messenger.compose.setComposeDetails(tabId, {plainTextBody: fullBody});
    return;
  }
  await messenger.compose.setComposeDetails(tabId, {body: fullBody});
}

export async function replaceBody(tabId, replyHtml) {
  let composeDetails = await messenger.compose.getComposeDetails(tabId);
  if(composeDetails.isPlainText){
    // Plain text: no DOM to splice into, so the reply is prepended to the
    // existing text (quote and signature included) with a blank line between.
    let originalTextBody = composeDetails.plainTextBody ?? "";
    let fullTextBody = stripHtmlKeepLines(replyHtml) + (originalTextBody.trim() === "" ? "" : "\n\n" + originalTextBody);
    await messenger.compose.setComposeDetails(tabId, {plainTextBody: fullTextBody});
    return;
  }
  let originalHtmlBody = composeDetails.body;
  //console.log('originalHtmlBody: ' + originalHtmlBody);
  let fullBody = insertHtml(replyHtml, originalHtmlBody);
  //console.log('fullBody: ' + fullBody);
  await messenger.compose.setComposeDetails(tabId, {body: fullBody});
}

export async function getMailHeader(curr_message, mail_header_id = false) {
  let mail_header_value = "";
  let full_message = await browser.messages.getFull(curr_message.id);
  // console.log(">>>>>>>>>>>> getMailHeader full_message: " + JSON.stringify(full_message));
  if(full_message.hasOwnProperty("headers")) {
    if(mail_header_id) {
      if(Object.keys(full_message.headers).some(header => header.toLowerCase() === mail_header_id.toLowerCase())){
        const raw_value = full_message.headers[Object.keys(full_message.headers).find(header => header.toLowerCase() === mail_header_id.toLowerCase())];
        mail_header_value = Array.isArray(raw_value) ? raw_value.join(", ") : raw_value;
      }
    } else {
      mail_header_value = Object.entries(full_message.headers)
        .map(([key, value]) => key + ": " + (Array.isArray(value) ? value.join(", ") : value))
        .join("\n");
    }
  }
  // console.log(">>>>>>>>>>>> getMailHeader mail_header_value: " + mail_header_value)
  return mail_header_value;
}

export function sanitizeHtml(input) {
  // Keep only <br> tags and remove all other HTML tags
  return input.replace(/<(?!br\s*\/?)[^>]+>/gi, '');
}

export function sanitizeMailHeaders(input){
  // console.log(">>>>>>>>>>>> sanitizeMailHeaders input: " + JSON.stringify(input));
  if(!input) return '';
  return input.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// HTML → plain text for the "compose in plain text" preference.
//
// The line structure is carried by the TAGS, not by the source newlines: the
// markdown renderer emits "<br>\n" and "</p>\n<p>", so a newline in the source
// is almost always just pretty-printing next to a tag that already means a
// break. Counting both would double every line — a single <br> would come out
// as a blank line and be indistinguishable from a paragraph break.
export function stripHtmlKeepLines(htmlString) {
  return htmlString
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>[ \t]*\n?/gi, '\n')  // <br> IS the break: eat the source newline after it
    .replace(/&lt;br\s*\/?&gt;[ \t]*\n?/gi, '\n') // literal <br> that survived HTML escaping
    .replace(/\n?[ \t]*<p>/gi, '')           // removes <p> tags
    .replace(/<\/p>[ \t]*\n?/gi, '\n\n')     // a paragraph boundary is a blank line
    .replace(/<\/(li|tr|div|h[1-6]|blockquote)>[ \t]*\n?/gi, '\n')  // one block = one line
    .replace(/\n?[ \t]*<(li|tr|div|h[1-6]|blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]*>[ \t]*\n?/g, '')        // removes any other HTML tag (and its trailing newline)
    .replace(/\n{3,}/g, '\n\n')              // never more than one blank line
    .trim();                                 // removes leading/trailing whitespace
}
export function htmlBodyToPlainText(htmlString) {
	// Create a new DOMParser instance
	const parser = new DOMParser();
	// Parse the HTML string
	const doc = parser.parseFromString(htmlString, 'text/html');

  removeMozMainHeader(doc.body);

  // remove invisible elements https://stackoverflow.com/questions/39813081/queryselector-where-display-is-not-none
   // return doc;
  doc.querySelectorAll('[style*="display:none"]').forEach(e => e.remove());//.querySelector('html').children.not(':visible').remove()
  doc.querySelectorAll('style').forEach(e => e.remove());//.querySelector('html').children.not(':visible').remove()
  
  // Extract text content
  const textContent = doc.body.textContent || "";
	// Trim whitespace
	return textContent
  .replace(/\r\n/g, '\n')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{2,}/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/&nbsp;/gi,"")
  .trim();
}

export function removeMozMainHeader(root) {
  for (const table of root.querySelectorAll('table.moz-main-header')) {
    let sibling = table.previousElementSibling;
    while (sibling && sibling.tagName === 'DIV') {
      const toRemove = sibling;
      sibling = sibling.previousElementSibling;
      toRemove.remove();
    }
    table.remove();
  }
}

export function cleanupNewlines(text) {
  return text
  .replace(/\r\n/g, '\n')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{2,}/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/&nbsp;/gi,' ')
  .trim();
}

// Extract and strip inline <think>...</think> blocks from a model response.
// Some models emit their reasoning inline in the content stream instead of in a
// dedicated API field (Ollama without ollama_think, several OpenAI-compatible
// servers), so the reasoning must be separated from the answer regardless of any
// connection preference.
//
// Returns { text, thinking }:
//   text:     the response with every <think> block removed
//   thinking: the extracted reasoning, multiple blocks joined by a newline ('' if none)
//
// `truncateUnterminated` handles a response that ends with an unclosed <think>
// (a truncated reply): when true, everything from the dangling <think> onward is
// dropped, so callers that parse the response never receive raw reasoning.
// Streaming callers leave it false and instead defer the flush until the closing
// tag arrives.
export function stripThinkTags(text, truncateUnterminated = false) {
  if (!text) {
    return { text: '', thinking: '' };
  }

  let thinking = '';
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
  let match;
  while ((match = thinkRegex.exec(text)) !== null) {
    thinking += (thinking ? '\n' : '') + match[1];
  }
  let out = text.replace(thinkRegex, '');

  // A <think> left open after the complete blocks were removed means the reply
  // was cut off mid-reasoning.
  if (truncateUnterminated) {
    const dangling = out.search(/<think>/i);
    if (dangling !== -1) {
      thinking += (thinking ? '\n' : '') + out.slice(dangling).replace(/<think>/i, '');
      out = out.slice(0, dangling);
    }
  }

  return { text: out.replace(/^\s+/, ''), thinking: thinking };
}

// Only for PLAIN text. Applying this to already-formed HTML injects spurious <br>
// at every source newline (indentation, line breaks between tags) — use
// normalizeHtmlSourceNewlines() for HTML instead.
export function convertNewlinesToBr(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
}

// Collapses the source newlines of an HTML string without turning them into markup.
// In HTML the source newlines are not line breaks: the line structure is carried by
// the tags (<div>, <p>, and any <br> already present in the body), so collapsing them
// to a space preserves the semantics and keeps spurious <br> out of the AI prompt.
export function normalizeHtmlSourceNewlines(html) {
  if (!html) return '';
  return html
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, ' ')
    .replace(/[ \t]{2,}/g, ' ');
}

export function convertNewlinesToParagraphs(input) {
  return input
    .split('\n')
    .map(line => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


// This method is used to convert the model string id used in the URL
// to the model string used in the webpage
export function getGPTWebModelString(model) {
  if (!model) return '';
  model = model.toLowerCase().trim();
  switch (model) {
    case 'gpt-5':
      return '5';
    case 'gpt-5-instant':
      return '5 Fast';
    case 'gpt-5-t-mini':
      return '5 Thinking mini';
    case 'gpt-5-thinking':
      return '5 Thinking';
    default:
      return model;
  }
}

export function openTab(url){
  // check if the tab is already there
  browser.tabs.query({url: browser.runtime.getURL(url)}).then((tabs) => {
    if (tabs.length > 0) {
      // if the tab is already there, focus it
      browser.tabs.update(tabs[0].id, {active: true});
    } else {
      // if the tab is not there, create it
      browser.tabs.create({url: browser.runtime.getURL(url)});
    }
  })
}

// Open (or focus) the Menu Order page and ask it to highlight a specific prompt.
// openTab dedups by exact URL and only focuses an already-open tab (it does not
// re-run the page load), so we coordinate a refresh + highlight explicitly:
//  - tab already open: focus it and send a message telling it to reload then highlight.
//  - tab not open: stash the target in session storage and create the tab; the page
//    reads and clears the stash after its initial load.
// The bare URL is used for browser.tabs.create so openTab's dedup keeps working elsewhere.
export async function revealPromptInMenuOrder(promptId) {
  const path = '/pages/menu_order/mzta-menu-order.html';
  const fullUrl = browser.runtime.getURL(path);
  const tabs = await browser.tabs.query({ url: fullUrl });
  if (tabs.length > 0) {
    await browser.tabs.update(tabs[0].id, { active: true });
    // Page is already loaded; ask it to refresh + highlight (it must reload first).
    await browser.runtime.sendMessage({ command: 'menu_order_highlight', promptId });
  } else {
    // Stash the target so the page can pick it up after its initial load.
    await browser.storage.session.set({ menu_order_highlight_target: promptId });
    await browser.tabs.create({ url: fullUrl });
  }
}

export function i18nConditionalGet(str) {
  // if we are getting a string that starts with '__MSG_' and ends with '__' we return the translated string
  // using the browser.i18n API
  // else we return the original string
  // Check if the string starts with '__MSG_' and ends with '__'
  if (str.startsWith('__MSG_') && str.endsWith('__')) {
      // Remove '__MSG_' from the beginning and '__' from the end
      return browser.i18n.getMessage(str.substring(6, str.length - 2));
  }
  return str; // Return the original string if the conditions are not met
}

function compareThunderbirdVersions(v1, v2) {
  const v1parts = v1.split('.').map(Number);
  const v2parts = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
    const v1part = v1parts[i] || 0;
    const v2part = v2parts[i] || 0;
    if (v1part > v2part) return 1;
    if (v1part < v2part) return -1;
  }
  return 0;
}

export function generateCallID(length = 10) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

export async function getTagsList(){
  let messageTags = [];
  // without the tags related permissions, we can't get the tags list
  messageTags = await browser.messages.tags.list();

  const output = messageTags.map(tag => tag.tag).join(', ');

  const output2 = messageTags.reduce((acc, messageTag) => {
    acc[messageTag.key] = {
        tag: messageTag.tag,
        color: messageTag.color,
        key: messageTag.key,
        ordinal: messageTag.ordinal,
    };
    return acc;
  }, {});

  return [output, output2]; // Return the list of tags and the list of tags objects as an array
}

export async function createTag(tag) {
  let prefs_tag = await browser.storage.sync.get({ add_tags_first_uppercase: prefs_default.add_tags_first_uppercase });
  if(prefs_tag.add_tags_first_uppercase) tag = tag.toLowerCase().charAt(0).toUpperCase() + tag.toLowerCase().slice(1);
  try {
    const tagKey = '$ta-' + generateCallID(16) + '-' + sanitizeString(tag); // Ensure uniqueness with a longer random ID
    return browser.messages.tags.create(tagKey, tag, generateHexColorForTag());
  } catch (error) {
    console.error('[ThunderAI] Error creating tag:', error);
  }
}

// export function checkIfTagExists(tag, tags_list) {
//   console.log(">>>>>>>>>>> checkIfTagExists tags_list: " + JSON.stringify(tags_list));
//   console.log(">>>>>>>>>>> checkIfTagExists tag: " + tag);
//   return tags_list.hasOwnProperty("$ta-" + sanitizeString(tag)); 
// }

export function checkIfTagLabelExists(tag_label, tags_list) {
  // console.log(">>>>>>>>>>> checkIfTagExists tags_list: " + JSON.stringify(tags_list));
  // console.log(">>>>>>>>>>> checkIfTagExists tag_label: " + tag_label);
  const lowerTagLabel = tag_label.toLowerCase();
  return Object.values(tags_list).some(label => label.tag.toLowerCase() === lowerTagLabel);
}

// export async function assignTagsToMessage(messageId, tags) {
//   console.log(">>>>>>>>>>> assignTagsToMessage messageId: tags: " + JSON.stringify(tags));
//   tags = tags.map(tag => `$ta-${sanitizeString(tag)}`);
//   let msg_prop = await browser.messages.get(messageId);
//   tags = tags.concat(msg_prop.tags || []);
//   try {
//     return browser.messages.update(messageId, {tags: tags});
//   } catch (error) {
//     console.error('[ThunderAI] Error assigning tag [messageId: ', messageId, ' - tag: ', tag, ']:', error);
//   }
// }

export async function assignTagsToMessage(messageId, tags) {
  // console.log(">>>>>>>>>>> assignTagsToMessage tags: " + JSON.stringify(tags));
  let all_tags_list = await getTagsList();
  all_tags_list = all_tags_list[1];
  tags = getTagsKeyFromLabel(tags, all_tags_list);
  // console.log(">>>>>>>>>>> assignTagsToMessage tags after conversion: " + JSON.stringify(tags));
  let msg_prop = await browser.messages.get(messageId);
  // console.log(">>>>>>>>>>> assignTagsToMessage msg_prop.tags: " + JSON.stringify(msg_prop.tags));
  tags = tags.concat(msg_prop.tags || []);
  tags = [...new Set(tags)];
  // console.log(">>>>>>>>>>> assignTagsToMessage tags after concat: " + JSON.stringify(tags));
  try {
    await browser.messages.update(messageId, {tags: tags});
    return tags; // Return the updated tags for confirmation
  } catch (error) {
    console.error('[ThunderAI] Error assigning tag [messageId: ', messageId, ' - tag: ', tag, ']:', error);
  }
}

function getTagsKeyFromLabel(tag_names, all_tags_list) {
  const result = [];

  tag_names.forEach(name => {
    const lowerName = name.toLowerCase();
    const match = Object.entries(all_tags_list).find(
      ([, value]) => value.tag.toLowerCase() === lowerName
    );
    if (match) {
      result.push(match[0]);
    }
  });

  return result;
}

function sanitizeString(input) {
  // Replaces accented characters with their non-accented version
  input = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Define the regex to match valid characters
  const validChar = /^[^ ()/{%*<>"]+$/;
  // Filter out invalid characters from the string
  let sanitized = '';
  for (const char of input) {
    const cp = char.codePointAt(0);
    if (cp > 0x7F) {
      // Encode non-ASCII characters (e.g. Chinese, emoji) as uXXXX
      sanitized += 'u' + cp.toString(16);
    } else {
      if (validChar.test(char)) {
        sanitized += char;
      }
      // else: discard blacklisted ASCII chars
    }
  }
  // Truncate to fit the 50-char total key limit:
  // $ta- (4) + callID (16) + - (1) + sanitized (max 29) = 50
  return sanitized.toLowerCase().slice(0, 29);
}

/* returnType:
  0: string comma separated (default)
  1: string \n separated
  2: array
*/
export function normalizeStringList(list, returnType = 0) {
  let _array_new = list.split(/[\n,]+/);
  _array_new = Array.from(new Set(_array_new.map(item => item.trim().toLowerCase()))).sort();
  switch(returnType) {
    case 0:
      return _array_new.join(', ');
    case 1:
      return _array_new.join('\n');
    case 2:
      return _array_new;
    default:
      return _array_new.join(', ');
  }
}

export function prepareOriginURL(url) {
  return url.endsWith('/') ? `${url}*` : `${url}/*`;
}

function generateHexColorForTag() {
  const red = Math.floor(Math.random() * 256);
  const green = Math.floor(Math.random() * 256);
  const blue = Math.floor(Math.random() * 256);

  const hexColor = `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;

  return hexColor;
}

export async function transformTagsLabels(labels, tags_list) {
  // console.log(">>>>>>>>> transformTagsLabels labels: " + labels);
  // console.log(">>>>>>>>> transformTagsLabels tags_list: " + tags_list);
  let output = [];
  for(let label of labels) {
      output.push(tags_list[label].tag);
  }
  return output;
}

export function setTomSelectBorder(el){
  if (el.getValue() === "") {
      el.control.style.border = '2px solid red';
  } else {
      el.control.style.border = '1px solid #d0d0d0';
  }
}

export function getAPIsInitMessageString(args = {}) {
  const {
    api_string = '',
    model_string = '',
    host_string = '',
    version_string = '',
    additional_messages = []
  } = args;

  let output = "<i class='info_obj'>" + browser.i18n.getMessage("_api_connecting", api_string) + "</i>";
  if (model_string !== '') {
    output += "\n<span class='info_obj'>" + browser.i18n.getMessage("_api_connecting_model") + ":</span> " + model_string;
  }
  if (host_string !== '') {
    output += "\n<span class='info_obj'>" + browser.i18n.getMessage("_api_connecting_host") + ":</span> " + host_string;
  }
  if (version_string !== '') {
    output += "\n<span class='info_obj'>" + browser.i18n.getMessage("_api_connecting_version") + ":</span> " + version_string;
  }
  let additional_message = '';
  if (additional_messages.length > 0) {
    additional_message = additional_messages.map(msg => "<span class='info_obj'>" + msg.label + ":</span> " + msg.value).join("\n");
  }
  if (additional_message !== '') {
    output += "\n" + additional_message;
  }

  return output;
}

export function getActiveSpecialPromptsIDs(args = {}) {
  const {
    addtags = false,
    addtags_api = false,
    get_calendar_event = false,
    get_calendar_event_from_clipboard = false,
    get_task = false,
    spamfilter = false,
    summarize = false,
    translate = false,
    is_chatgpt_web = false,
    no_connection = false
  } = args;
  let output = [];
  // console.log(">>>>>>>>>> getActiveSpecialPromptsIDs args: " + JSON.stringify(args));
  // No AI connection chosen yet: no special prompt can work, so advertise none.
  if (no_connection) {
    return output;
  }
  if (is_chatgpt_web) {
    if (addtags_api && addtags) {
      output.push('prompt_add_tags');
    }
    return output;
  }
  if (addtags) {
    output.push('prompt_add_tags');
  }
  if (get_calendar_event) {
    output.push('prompt_get_calendar_event');
    if (get_calendar_event_from_clipboard) {
      output.push('prompt_get_calendar_event_from_clipboard');
    }
  }
  if (get_task) {
    output.push('prompt_get_task');
  }
  if (spamfilter) {
    output.push('prompt_spamfilter');
  }
  if (summarize) {
    output.push('prompt_summarize');
  }
  if (translate) {
    output.push('prompt_translate_this');
  }
  // console.log(">>>>>>>>>> getActiveSpecialPromptsIDs output: " + JSON.stringify(output));
  return output;
}

// True when the user has not chosen an AI connection yet (fresh install).
// The default value of the connection_type pref is empty on purpose, so the
// setup wizard can guide the first configuration instead of forcing a provider.
export function hasNoConnectionSelected(connection_type){
  return (connection_type == null) || (String(connection_type).trim() === '');
}

export function hasSpecificIntegration(use, conntype){
  return use && (conntype != null) && (conntype !== '');
}

export function extractJsonObject(inputString) {
  try {
    const jsonMatch = inputString.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonObject = JSON.parse(jsonMatch[0]);
      // console.log(">>>>>>>>>> Extracted JSON object:", jsonObject);
      return jsonObject;
    } else {
      console.error("[ThunderAI] No JSON object found in the input string.");
      throw new Error("No JSON object found in the input string.");
      return null;
    }
  } catch (error) {
    console.error("[ThunderAI] Error extracting JSON object:", error);
    throw new Error("Error extracting JSON object: " + error.message);
    return null;
  }
}

export function normalizeDateTimeString(str) {
  if (!str || typeof str !== 'string') return null;
  str = str.trim();
  // Accept any non-digit separator (or none) between date/time components
  const match = str.match(/^(\d{4})\D?(\d{2})\D?(\d{2})\D?(\d{2})\D?(\d{2})\D?(\d{2})(Z?)$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, z] = match;
  return `${y}${mo}${d}T${h}${mi}${s}${z}`;
}

export function isAPIKeyValue(id){
  return id.endsWith('_api_key');
}

export function getConnectionType(prefs, prompt, prefix = null) {
    let defaultType = '';
    let specificType = '';

    if (prefs !== null) {
        defaultType = prefs.connection_type;
        if (typeof prefix === 'string' && prefix) {
            const useSpecific = getDynamicSettingValue(prefs, prefix, 'use_specific_integration');
            if (useSpecific) {
                specificType = getDynamicSettingValue(prefs, prefix, 'connection_type');
            }
        }
    }

    if (specificType && specificType !== '') return specificType;
    if (prompt) {
        if (prompt.api_type && prompt.api_type !== '') return prompt.api_type;
    }
    return defaultType;
}

export async function checkSparksPresence() {
  try {
    let sparks_current = await browser.runtime.sendMessage('thunderai-sparks@micz.it',{action: "checkPresence"});
    if(sparks_current === undefined || sparks_current === null) {
      return -1;
    }
    if (compareThunderbirdVersions(sparks_current, sparks_min) < 0) {
      return 0;
    }else{
      return 1;
    }
  } catch (error) {
    return -1;
  }
}

export function validateChatGPTWebCustomData(data) {
  return /^\/g\/[a-zA-Z0-9/-]+$/.test(data) || data == '';
}

export function sanitizeChatGPTModelData(input) {
  if(!input) return '';
  return encodeURIComponent(input).toLowerCase()
}

export function sanitizeChatGPTWebCustomData(input) {
  if(!input) return '';
  // Removes all characters that are not letters, numbers, dashes, or slashes
  return input.replace(/[^\p{L}\p{N}\/-]+/gu, '');
}

export function validateCustomData_ChatGPTWeb(event) {
  let is_valid = validateChatGPTWebCustomData(event.target.value);
  event.target.style.borderColor = is_valid ? 'green' : 'red';
  document.getElementById(event.target.id + '_info').style.color = is_valid ? '' : 'red';
}

// From https://thunderbird.topicbox.com/groups/addons/Tafa58394231a18f8-M3e565a75287313ea4395ff5f
// Thanks to John Bieling
export async function requestSitePermission(url) {
  // Normalize the origin to ensure it ends with /*
  const origin = url.replace(/\/?\*?$/, '/*');

  const hasPermission = await browser.permissions.contains({
    origins: [origin],
  });

  if (hasPermission) {
    // Permission already granted — safe to save and use the URL.
    return true;
  }

  const granted = await browser.permissions.request({
    origins: [origin],
  });

  // If not granted, it's not safe to save or use the URL,
  // since the user explicitly denied access.
  return granted;
}

// The following methods are a modified version derived from https://github.com/ali-raheem/Aify/blob/13ff87583bc520fb80f555ab90a90c5c9df797a7/plugin/content_scripts/compose.js

// Thunderbird's signature block ships its own leading <br>
// (<div class="moz-signature"><br>...), while the cite-prefix block starts
// directly with text (<div class="moz-cite-prefix">Am ... schrieb:<br></div>).
// That asymmetry is the whole reason the spacer in insertHtml is conditional:
// adding a <br> before a block that already begins with one yields a double
// blank line. Whitespace-only text nodes are skipped, since the compose body
// is pretty-printed. [#849]
const startsWithBreak = function (element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  let node = element.firstChild;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent.trim() === "") {
        node = node.nextSibling;
        continue;
      }
      return false;
    }
    return node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === "br";
  }
  return false;
}

const insertHtml = function (replyHtml, fullBody_string) {
  const parser = new DOMParser();
  let fullBody = parser.parseFromString(fullBody_string, "text/html");
  let reply = parser.parseFromString(replyHtml, "text/html");
  
  // looking for the first quoted mail (reply or forward) or the signature, which come first in case of "signature above the quote".
  let prefix_quote = fullBody.getElementsByClassName("moz-cite-prefix");
  if(prefix_quote.length == 0){
    prefix_quote = fullBody.getElementsByClassName("moz-forward-container");
  }
  const prefix_sign = fullBody.getElementsByClassName("moz-signature");

  let firstElement = null;
  if (prefix_quote.length > 0 && prefix_sign.length > 0) {
    firstElement = prefix_quote[0].compareDocumentPosition(prefix_sign[0]) & Node.DOCUMENT_POSITION_FOLLOWING ? prefix_quote[0] : prefix_sign[0];
    //console.log('>>>>>>>>>>>>>>> quote and signature found: ' + JSON.stringify(firstElement.innerHTML))
    //console.log('>>>>>>>>>>>>>>> DocPosition: ' + prefix_quote[0].compareDocumentPosition(prefix_sign[0]))
  } else if (prefix_quote.length > 0) {
    firstElement = prefix_quote[0];
    //console.log('>>>>>>>>>>>>>>> quote found')
  } else if (prefix_sign.length > 0) {
    firstElement = prefix_sign[0];
    //console.log('>>>>>>>>>>>>>>> signature found')
  }
  if (firstElement) {
    let sibling = firstElement.previousSibling;
    while (sibling) {
      fullBody.body.removeChild(sibling);
      sibling = firstElement.previousSibling;
    }
  }

  // Context-aware spacer at body level: exactly one blank line between the inserted
  // answer and whatever follows it, but only when that block does not already begin
  // with a <br> of its own (see startsWithBreak above). A <p><br><br></p> was used
  // here unconditionally, but its paragraph margins stacked with the answer's block
  // markup, producing a large gap, especially in body-text compose mode
  // (mail.compose.default_to_paragraph=false). [#849]
  // When there is neither a quote nor a signature (firstElement is null, e.g. a brand
  // new compose) the answer lands before whatever the body already starts with, and
  // that node drives the same decision. If the body is empty there is no following
  // node at all: no spacer is added, since a trailing <br> after the answer would be a
  // stray blank line rather than a separation.
  const followingBlock = firstElement || fullBody.body.firstChild;
  if (followingBlock && !startsWithBreak(followingBlock)) {
    fullBody.body.insertBefore(document.createElement("br"), fullBody.body.firstChild);
  }
  //fullBody.body.insertBefore(reply, fullBody.body.firstChild);
  let fragment = document.createDocumentFragment();
  Array.from(reply.body.childNodes).forEach(node => {
    if (node.parentNode === reply.body) {
      fragment.appendChild(node.cloneNode(true));
    }
  });
  fullBody.body.insertBefore(fragment, fullBody.body.firstChild);
  return fullBody.body.innerHTML;
}

export async function getLocalStorageUsedSpace(){
  // we can't use this, see: https://bugzilla.mozilla.org/show_bug.cgi?id=1385832
  //let customprompts_space = await browser.storage.local.getBytesInUse("_custom_prompt");
  //let's use a workaround
  let customprompts_space = Object.entries(await browser.storage.local.get(["_custom_prompt", "_default_prompts_properties"])).map(([key, value]) => key.length + JSON.stringify(value).length).reduce((acc, x) => acc + x, 0)
  return formatBytes(customprompts_space);
}

export async function getCacheStorageUsedSpace(){
  let all = await browser.storage.local.get(null);
  let cacheSpace = Object.entries(all)
    .filter(([key]) => key.startsWith('msg:'))
    .map(([key, value]) => key.length + JSON.stringify(value).length)
    .reduce((acc, x) => acc + x, 0);
  return formatBytes(cacheSpace);
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const step = 1024;
  const suffixes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const index = Math.floor(Math.log(bytes) / Math.log(step));
  const value = bytes / Math.pow(step, index);
  // Ensure the index does not exceed the suffix array length
  const suffix = suffixes[index] || suffixes[suffixes.length - 1];
  return `${value.toFixed(decimals)} ${suffix}`;
}

// We need to migrate the Custom Prompts storage from storage.sync to storage.local
// because the storage.sync has a too narrow limit, see https://github.com/micz/ThunderAI/issues/129
export async function migrateCustomPromptsStorage(){
  //check if storage.sync has custom prompts
  let custom_prompts_sync = await browser.storage.sync.get({_custom_prompt: null});
  if(custom_prompts_sync._custom_prompt === null){
    // There are no custom prompts in storage.sync, nothing to do
    // console.log("migrateCustomPromptsStorage: no custom prompts in storage.sync, nothing to do");
    return;
  }

  //check if storage.local has custom prompts
  let custom_prompts_local = await browser.storage.local.get({_custom_prompt: null});
  if(custom_prompts_local._custom_prompt !== null){
    // There are custom prompts in storage.local, nothing to do
    // console.log("migrateCustomPromptsStorage: there are custom prompts in storage.local, nothing to do");
    return;
  }

  //copy custom prompts from storage.sync to storage.local
  await browser.storage.local.set({_custom_prompt: custom_prompts_sync._custom_prompt});
  await browser.storage.sync.remove("_custom_prompt");
  // console.log("migrateCustomPromptsStorage: migrated custom prompts from storage.sync to storage.local");
}

// Do the same for the default prompts properties
export async function migrateDefaultPromptsPropStorage(){
  //check if storage.sync has default prompts properties
  let default_prompts_properties_sync = await browser.storage.sync.get({_default_prompts_properties: null});
  if(default_prompts_properties_sync._default_prompts_properties === null){
    // There are no default prompts properties in storage.sync, nothing to do
    // console.log("migrateDefaultPromptsPropStorage: no default prompts properties in storage.sync, nothing to do");
    return;
  }

  //check if storage.local has default prompts properties
  let default_prompts_properties_local = await browser.storage.local.get({_default_prompts_properties: null});
  if(default_prompts_properties_local._default_prompts_properties !== null){
    // There are default prompts properties in storage.local, nothing to do
    // console.log("migrateDefaultPromptsPropStorage: there are default prompts properties in storage.local, nothing to do");
    return;
  }

  //copy default prompts properties from storage.sync to storage.local
  await browser.storage.local.set({_default_prompts_properties: default_prompts_properties_sync._default_prompts_properties});
  await browser.storage.sync.remove("_default_prompts_properties");
  // console.log("migrateDefaultPromptsPropStorage: migrated default prompts properties from storage.sync to storage.local");
}

export async function* getMessages(list) {
  let page = await list;
  for (let message of page.messages) {
    yield message;
  }

  while (page.id) {
    page = await messenger.messages.continueList(page.id);
    for (let message of page.messages) {
      yield message;
    }
  }
}
