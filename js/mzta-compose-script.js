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


// Modified version derived from https://github.com/ali-raheem/Aify/blob/13ff87583bc520fb80f555ab90a90c5c9df797a7/plugin/content_scripts/compose.js

const makeParagraphs = (text, func) => {
  const chunks = text.split(/\n{2,}/);
  if (chunks.length == 1) {
    return func(document.createTextNode(text));
  }
  const paragraphs = chunks.map((t) => {
    const p = document.createElement("p");
    p.innerText = t;
    return p;
  });
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    func(paragraphs[i]);
  }
};


const insert = function (text) {
  const prefix = window.document.body.getElementsByClassName("moz-cite-prefix");
  if (prefix.length > 0) {
    const divider = prefix[0];
    let sibling = divider.previousSibling;
    while (sibling) {
      window.document.body.removeChild(sibling);
      sibling = divider.previousSibling;
    }
  }
  return makeParagraphs(text, function (p) {
    window.document.body.insertBefore(p, window.document.body.firstChild);
  });
}

/*const insertReply = function (text) {
  const prefix = window.document.body.getElementsByClassName("moz-cite-prefix");
  if (prefix.length > 0) {
    const divider = prefix[0];
    let sibling = divider.previousSibling;
    return makeParagraphs(text, function (p) {
      window.document.body.insertBefore(p, sibling);
    });
  }
}*/


browser.runtime.onMessage.addListener((message) => {
switch (message.command) {
  case "getSelectedText":
    return Promise.resolve(window.getSelection().toString());

  case "replaceSelectedText":
    const selectedText = window.getSelection().toString();
    if (selectedText === '') {
      return insert(message.text);
    }
    const sel = window.getSelection();
    if (!sel || sel.type !== "Range" || !sel.rangeCount) {
      return;
    }
    const r = sel.getRangeAt(0);
    r.deleteContents();
    makeParagraphs(message.text, function (p) {
      r.insertNode(p);
    });
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

  case "insertText":
    insert(message.text);
    break;

  case 'promptTooLong':
    alert(browser.i18n.getMessage('msg_prompt_too_long'));
    break;

  case 'sendAlert':
    alert(message.message);
    break;

  default:
    // do nothing
    break;
}    
});