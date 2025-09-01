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

const sparks_min = '1.2.0'; // Minimum version of ThunderAI-Sparks required for the add-on to work
export const ChatGPTWeb_models = ['gpt-5','gpt-5-instant','gpt-5-t-mini','gpt-5-thinking'];  // List of models available in ChatGPT Web

export const getMenuContextCompose = () => 'compose_action_menu';
export const getMenuContextDisplay = () => 'message_display_action_menu';

export const contextMenuID_AddTags = 'mzta-add-tags';
export const contextMenuID_Spamfilter = 'mzta-spamfilter';

export function getLanguageDisplayName(languageCode) {
   const languageDisplay = new Intl.DisplayNames([languageCode], {type: 'language'});
   let lang_string = languageDisplay.of(languageCode);
   return lang_string.charAt(0).toUpperCase() + lang_string.slice(1);
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
  const textParts = [];

  function walkParts(parts) {
    for (const part of parts) {
      if (part.parts && part.parts.length > 0) {
        // Recursively walk through sub-parts
        walkParts(part.parts);
      } else {
        // Check if contentType starts with "text/"
        if (part.contentType && part.contentType.startsWith("text/")) {
          textParts.push(part);
        }
      }
    }
  }

  if (fullMessage.parts && fullMessage.parts.length > 0) {
    walkParts(fullMessage.parts);
  }

  return textParts;
}
  
export function getMailBody(fullMessage){
  const textParts = extractTextParts(fullMessage);
  let text = "";
  let html = "";
  for (const part of textParts) {
    if (part.contentType === "text/plain") {
      text += part.body;
    } else if (part.contentType === "text/html") {
      html += part.body;
    }
  }
  if(html === "") {
    html = text.replace(/\n/g, "<br>");
  }
  return {text, html};
}

export async function reloadBody(tabId){
  let composeDetails = await messenger.compose.getComposeDetails(tabId);
  let originalHtmlBody = composeDetails.body + " ";
  await messenger.compose.setComposeDetails(tabId, {body: originalHtmlBody});
}

export async function getOriginalBody(tabId){
  let composeDetails = await messenger.compose.getComposeDetails(tabId);
  return composeDetails.body;
}

export async function setBody(tabId, fullHtmlBody){
  await messenger.compose.setComposeDetails(tabId, {body: fullHtmlBody});
}

export async function replaceBody(tabId, replyHtml) {
  let composeDetails = await messenger.compose.getComposeDetails(tabId);
  let originalHtmlBody = composeDetails.body;
  //console.log('originalHtmlBody: ' + originalHtmlBody);
  let fullBody = insertHtml(replyHtml, originalHtmlBody);
  //console.log('fullBody: ' + fullBody);
  await messenger.compose.setComposeDetails(tabId, {body: fullBody});
}

export function sanitizeHtml(input) {
  // Keep only <br> tags and remove all other HTML tags
  return input.replace(/<(?!br\s*\/?)[^>]+>/gi, '');
}

export function stripHtmlKeepLines(htmlString) {
  // Replaces <p> tags with a newline at the beginning
  // and removes all other HTML tags
  return convertBrToNewlines(htmlString)
    .replace(/<p>/gi, '')                  // removes <p> tags
    .replace(/<\/p>/gi, '\n')              // replaces </p> tags with newline
    .replace(/<[^>]*>/g, '')               // removes any other HTML tags
    .trim();                               // removes leading/trailing whitespace
}
export function htmlBodyToPlainText(htmlString) {
	// Create a new DOMParser instance
	const parser = new DOMParser();
	// Parse the HTML string
	const doc = parser.parseFromString(htmlString, 'text/html');
	
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
 
export function cleanupNewlines(text) {
  return text
  .replace(/\r\n/g, '\n')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{2,}/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/&nbsp;/gi,' ')
  .trim();
}

export function convertNewlinesToBr(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
}

function convertBrToNewlines(html) {
  return html.replace(/<br\s*\/?>/gi, '\n');
}

export function convertNewlinesToParagraphs(input) {
  return input
    .split('\n')
    .map(line => `<p>${line}</p>`)
    .join('');
}


// This method is used to convert the model string id used in the URL
// to the model string used in the webpage
export function getGPTWebModelString(model) {
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

export function getChatGPTWebModelsList_HTML(values, targetRowId) {
  const rowElement = document.getElementById(targetRowId);
  if (!rowElement) return;

  // Clears any existing td elements
  rowElement.innerHTML = '';

  // First TD: label
  const labelTd = document.createElement('td');
  const label = document.createElement('i');
  label.className = 'small_info';
  const labelNobr = document.createElement('nobr');
  labelNobr.textContent = browser.i18n.getMessage("AllowedValues") + ":";
  label.appendChild(labelNobr);
  labelTd.appendChild(label);

  // Second TD: values
  const valuesTd = document.createElement('td');
  const valuesContainer = document.createElement('i');
  valuesContainer.className = 'small_info';

  values.forEach(value => {
    const nbspBefore = document.createTextNode(' \u00A0 '); // " &nbsp; "
    const valueNobr = document.createElement('nobr');
    valueNobr.className = 'conntype_chatgpt_web_option';
    valueNobr.textContent = value;
    const nbspAfter = document.createTextNode(' \u00A0 ');

    valuesContainer.appendChild(nbspBefore);
    valuesContainer.appendChild(valueNobr);
    valuesContainer.appendChild(nbspAfter);
  });

  valuesTd.appendChild(valuesContainer);

  // Adds the td elements to the row
  rowElement.appendChild(labelTd);
  rowElement.appendChild(valuesTd);
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

export async function isThunderbird128OrGreater(){
  try {
    const info = await browser.runtime.getBrowserInfo();
    const version = info.version;
    return compareThunderbirdVersions(version, '128.0') >= 0;
  } catch (error) {
    console.error('[ThunderAI] Error retrieving browser information:', error);
    return false;
  }
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
  if(await isThunderbird128OrGreater()) {
    // without the tags related permissions, we can't get the tags list
      messageTags = await browser.messages.tags.list();
  } else {
      messageTags = await browser.messages.listTags();
  }
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
  let prefs_tag = await browser.storage.sync.get({add_tags_first_uppercase: true});
  if(prefs_tag.add_tags_first_uppercase) tag = tag.toLowerCase().charAt(0).toUpperCase() + tag.toLowerCase().slice(1);
  try {
    if(await isThunderbird128OrGreater()) {
      return browser.messages.tags.create('$ta-'+sanitizeString(tag), tag, generateHexColorForTag());
    }else{
      return browser.messages.createTag('$ta-'+sanitizeString(tag), tag, generateHexColorForTag());
    }
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
  input = input.toLowerCase();
  // Define the regex to match valid characters
  const regex = /^[^ ()/{%*<>"]+$/;
  // Filter out invalid characters from the string
  let sanitized = '';
  for (const char of input) {
    // Check if the character is valid according to the regex
    if (regex.test(char)) {
      sanitized += char;
    }
  }

  return sanitized;
}

export function normalizeStringList(list) {
  let _array_new = list.split(/[\n,]+/);
  _array_new = Array.from(new Set(_array_new.map(item => item.trim().toLowerCase()))).sort();
  return _array_new.join('\n');
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
  const { addtags = false, get_calendar_event = false, get_task = false, is_chatgpt_web = false } = args;
  let output = [];
  // console.log(">>>>>>>>>> getActiveSpecialPromptsIDs args: " + JSON.stringify(args));
  if (is_chatgpt_web) {
    return output;
  }
  if (addtags) {
    output.push('prompt_add_tags');
  }
  if (get_calendar_event) {
    output.push('prompt_get_calendar_event');
  }
  if (get_task) {
    output.push('prompt_get_task');
  }
  // console.log(">>>>>>>>>> getActiveSpecialPromptsIDs output: " + JSON.stringify(output));
  return output;
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
  return encodeURIComponent(input).toLowerCase()
}

export function sanitizeChatGPTWebCustomData(input) {
  // Removes all characters that are not letters, numbers, dashes, or slashes
  return input.replace(/[^\p{L}\p{N}\/-]+/gu, '');
}

export function validateCustomData_ChatGPTWeb(event) {
  let is_valid = validateChatGPTWebCustomData(event.target.value);
  event.target.style.borderColor = is_valid ? 'green' : 'red';
  document.getElementById(event.target.id + '_info').style.color = is_valid ? '' : 'red';
}


// The following methods are a modified version derived from https://github.com/ali-raheem/Aify/blob/13ff87583bc520fb80f555ab90a90c5c9df797a7/plugin/content_scripts/compose.js

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

  let final_p = document.createElement("p");
  let br1 = document.createElement("br");
  let br2 = document.createElement("br");
  final_p.appendChild(br1);
  final_p.appendChild(br2);
  fullBody.body.insertBefore(final_p, fullBody.body.firstChild);
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