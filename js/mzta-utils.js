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

export async function getCurrentIdentity(msgHeader, getFull = false) {
  let identities_array = [];
  let fallback_identity = '';
  msgHeader = fixMsgHeader(msgHeader);
  let accounts = await browser.accounts.list();
     for (let account of accounts) {
        for (let identity of account.identities) {
          identities_array.push({id: identity.id, email:identity.email})
          if(fallback_identity === '') {
            fallback_identity = {id: identity.id, email:identity.email}
            // console.log(">>>>>>>>>> getCurrentIdentity fallback_identity: " + JSON.stringify(fallback_identity));
          }
        }
      }
  // check if the author is an identity
  let author = extractEmail(msgHeader.author);
  let author_identity = identities_array.find(identity => identity.email === author);
  if (author_identity) {
    // console.log(">>>>>>>>>> getCurrentIdentity author_identity: " + JSON.stringify(author_identity));
    return getFull ? author_identity : author_identity.id;
  }
  let correspondents_array = msgHeader.bccList.concat(msgHeader.ccList, msgHeader.recipients);
  correspondents_array = correspondents_array.map(correspondent => {
    correspondent = extractEmail(correspondent);
    let correspondent_identity = identities_array.find(identity => identity.email === author);
    if (correspondent_identity) {
      // console.log(">>>>>>>>>> getCurrentIdentity correspondent_identity: " + JSON.stringify(correspondent_identity));
      return getFull ? correspondent_identity : correspondent_identity.id;
    }
  });
  const matching_identity = correspondents_array.map(correspondent => identities_array.find(identity => identity.email === correspondent)).find(identity => identity !== undefined);
  if(matching_identity) {
    // console.log(">>>>>>>>>> getCurrentIdentity matching_identity: " + JSON.stringify(matching_identity));
    return getFull ? matching_identity : matching_identity.id;
  } else {  // no identity found. using the fallback one
    // console.log(">>>>>>>>>> getCurrentIdentity fallback_identity: " + JSON.stringify(fallback_identity));
    return getFull ? fallback_identity : fallback_identity.id;
  }
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

export async function getMailBody(fullMessage){
  let text = '';
  let html = '';

  // console.log(">>>>>>>>>> fullMessage.contentType.trim().toLowerCase(): " + fullMessage.contentType.trim().toLowerCase());
  // console.log(">>>>>>>>>> fullMessage.body: " + fullMessage.body);

  if (fullMessage.contentType.trim().toLowerCase() === "text/plain") {
    text = fullMessage.body;
  }
  if (fullMessage.contentType.trim().toLowerCase() === "text/html") {
    html = fullMessage.body;
  }

  if((text == undefined || text == null || text == '') && (html == undefined || html == null || html == '')) {
    for (let part of fullMessage.parts) {
      if (part.contentType.trim().toLowerCase() === "text/plain") {
        text = part.body;
      }
      if (part.contentType.trim().toLowerCase() === "text/html") {
        html = part.body;
      }
      if((text == undefined || text == null || text == '') && (html == undefined || html == null || html == '')) {
        for (let subpart of part.parts) {
          if (subpart.contentType.trim().toLowerCase() === "text/plain") {
            text = subpart.body;
          }
          if (subpart.contentType.trim().toLowerCase() === "text/html") {
            html = subpart.body;
          }
        }
      }
    }
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

export function getGPTWebModelString(model) {
  model = model.toLowerCase().trim();
  switch (model) {
    case 'GPT-4o':
    case 'gpt-4o':
      return '4o';
    case 'gpt-4o-mini':
      return '4o mini';
    case 'gpt-4':
      return 'gpt-4';
    case 'o1':
      return 'o1';
    case 'o3-mini':
      return 'o3-mini';
    case 'o3-mini-high':
      return 'o3-mini-high';
    default:
      return model;
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

export function checkIfTagExists(tag, tags_list) {
  return tags_list.hasOwnProperty("$ta-" + sanitizeString(tag)); 
}

export async function assignTagsToMessage(messageId, tags) {
  tags = tags.map(tag => `$ta-${sanitizeString(tag)}`);
  let msg_prop = await browser.messages.get(messageId);
  tags = tags.concat(msg_prop.tags || []);
  try {
    return browser.messages.update(messageId, {tags: tags});
  } catch (error) {
    console.error('[ThunderAI] Error assigning tag [messageId: ', messageId, ' - tag: ', tag, ']:', error);
  }
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

export function getActiveSpecialPromptsIDs(addtags = false, get_calendar_event = false, is_chatgpt_web = false) {
  let output = [];
  // console.log(">>>>>>>>>> getActiveSpecialPromptsIDs addtags: " + addtags + " get_calendar_event: " + get_calendar_event + " is_chatgpt_web: " + is_chatgpt_web);
  if(is_chatgpt_web){
    return output;
  }
  if(addtags){
    output.push('prompt_add_tags');
  }
  if(get_calendar_event){
    output.push('prompt_get_calendar_event');
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


// The following methods are a modified version derived from https://github.com/ali-raheem/Aify/blob/13ff87583bc520fb80f555ab90a90c5c9df797a7/plugin/content_scripts/compose.js

const insertHtml = function (replyHtml, fullBody_string) {
  const parser = new DOMParser();
  let fullBody = parser.parseFromString(fullBody_string, "text/html");
  let reply = parser.parseFromString(replyHtml, "text/html");
  
  // looking for the first quoted mail or the signature, which come first in case of "signature above the quote".
  const prefix_quote = fullBody.getElementsByClassName("moz-cite-prefix");
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

export async function getCustomPromptsUsedSpace(){
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