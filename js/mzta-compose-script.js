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

browser.runtime.onMessage.addListener(async (message) => {
switch (message.command) {
  case "getSelectedText":
    return Promise.resolve(window.getSelection().toString());

  case "replaceSelectedText":
    const selectedText = window.getSelection().toString();
    if (selectedText === '') {
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.type !== "Range" || !sel.rangeCount) {
      return;
    }
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const parser = new DOMParser();
    const doc = parser.parseFromString(message.text, 'text/html');
    r.insertNode(doc.body);
    browser.runtime.sendMessage({command: "compose_reloadBody", tabId: message.tabId});
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

  case 'promptTooLong':
    alert(browser.i18n.getMessage('msg_prompt_too_long'));
    break;

  case 'sendAlert':
    alert(message.message);
    break;

  case 'searchPrompt':
    searchPrompt();
    break;

  default:
    // do nothing
    break;
}
});

const autocompleteData = [
  'Apple',
  'Apricot',
  'Avocado',
  'Banana',
  'Blackberry',
  'Blueberry',
  'Cherry',
  'Coconut',
  'Date',
  'Dragonfruit',
  'Elderberry',
  'Fig',
  'Grape',
  'Grapefruit',
  'Guava',
  'Honeydew',
  'Jackfruit',
  'Kiwi',
  'Lemon',
  'Lime',
  'Mango',
  'Melon',
  'Nectarine',
  'Orange',
  'Papaya',
  'Peach',
  'Pear',
  'Pineapple',
  'Plum',
  'Pomegranate',
  'Raspberry',
  'Strawberry',
  'Watermelon'
];

function searchPrompt(){
  const banner = document.createElement('div');
  banner.id = 'mzta_search_banner';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'mzta_search_input';
  input.placeholder = 'Search a prompt...';
  banner.appendChild(input);

  const autocompleteList = document.createElement('div');
  autocompleteList.classList.add('mzta_autocomplete-items');
  autocompleteList.style.display = 'none';
  banner.appendChild(autocompleteList);

  // Function to filter and display autocomplete suggestions
  input.addEventListener('input', function() {
    const query = this.value.trim().toLowerCase();
    autocompleteList.innerHTML = ''; // Clear previous suggestions

    if (query === '') {
        autocompleteList.style.display = 'none';
        return;
    }

    // Filter data based on the query
    const filteredData = autocompleteData.filter(item => item.toLowerCase().startsWith(query));

    if (filteredData.length === 0) {
        autocompleteList.style.display = 'none';
        return;
    }

    // Create a div for each filtered result
    filteredData.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('mzta_autocomplete-item');
        itemDiv.textContent = item;

        // Add a mousedown event to select the item
        itemDiv.addEventListener('mousedown', function(e) { // Use mousedown instead of click
            e.preventDefault(); // Prevents the input from losing focus
            input.value = item;
            autocompleteList.style.display = 'none';
        });

        autocompleteList.appendChild(itemDiv);
    });

    autocompleteList.style.display = 'block';
  });

  // Handle the input field losing focus to hide the banner
  input.addEventListener('blur', function() {
    // Use a timeout to allow clicking on suggestions before hiding
    setTimeout(() => {
        banner.remove();
    }, 200);
  });

  document.body.insertBefore(banner, document.body.firstChild);
  input.focus();
}