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