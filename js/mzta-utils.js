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

export const getMenuContextCompose = () => 'compose_action_menu';
export const getMenuContextDisplay = () => 'message_display_action_menu';


export function getLanguageDisplayName(languageCode) {
   const languageDisplay = new Intl.DisplayNames([languageCode], {type: 'language'});
   let lang_string = languageDisplay.of(languageCode);
   return lang_string.charAt(0).toUpperCase() + lang_string.slice(1);
}

export async function getCurrentIdentity(msgHeader) {
  let identities_array = [];
  let fallback_identity = '';
  let accounts = await browser.accounts.list();
     for (let account of accounts) {
        for (let identity of account.identities) {
          identities_array.push({id: identity.id, email:identity.email})
          if(fallback_identity === '') {
            fallback_identity = {id: identity.id, email:identity.email}
          }
        }
      }
  // check if the author is an identity
  let author = extractEmail(msgHeader.author);
  let author_identity = identities_array.find(identity => identity.email === author);
  if (author_identity) {
    return author_identity.id;
  }
  let correspondents_array = msgHeader.bccList.concat(msgHeader.ccList, msgHeader.recipients);
  correspondents_array = correspondents_array.map(correspondent => {
    correspondent = extractEmail(correspondent);
    return correspondent;
  });
  const matching_identity = correspondents_array.map(correspondent => identities_array.find(identity => identity.email === correspondent)).find(identity => identity !== undefined);
  if(matching_identity) {
    return matching_identity.id;
  } else {  // no identity found. using the fallback one
    return fallback_identity.id;
  }
}

function extractEmail(text) {
  const emailRegex = /[\w.-]+@[\w.-]+\.\w+/;
  const match = text.match(emailRegex);
  return match ? match[0] : '';
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
