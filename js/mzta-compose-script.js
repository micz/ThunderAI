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
    searchPrompt(message._prompts_data, message.tab_type);
    break;

  default:
    // do nothing
    break;
}
});


async function searchPrompt(allPrompts, tabType){
  console.log(">>>>>>>>>>>>>> allPrompts: " + JSON.stringify(allPrompts));
  console.log(">>>>>>>>>>>>>>> tabType: " + tabType);
  const banner = document.createElement('div');
  banner.id = 'mzta_search_banner';

  const img = document.createElement('img');
  img.src = browser.runtime.getURL('images/icon-16px.png');
  img.id="mzta_search_icon";
  img.title = "ThunderAI";
  img.width = 16;
  img.height = 16;
  banner.appendChild(img);

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'mzta_search_input';
  input.placeholder = browser.i18n.getMessage('SearchPrompt');
  banner.appendChild(input);

  const autocompleteList = document.createElement('div');
  autocompleteList.id = 'mzta_autocomplete-items';
  autocompleteList.style.display = 'none';
  banner.appendChild(autocompleteList);

  // Initialize variables to track focus and selection
  let currentFocus = -1; // Tracks the currently highlighted item
  let selectedId = null; // Tracks the ID of the selected item

  // Function to filter and display autocomplete suggestions
  input.addEventListener('input', function() {
    const query = this.value.trim().toLowerCase();
    autocompleteList.innerHTML = ''; // Clear previous suggestions
    currentFocus = -1; // Reset the highlighted index
    selectedId = null; // Reset the selected ID since input has changed

    // Uncomment the following lines if you want to hide suggestions when input is empty
    /*
    if (query === '') {
        autocompleteList.style.display = 'none';
        return;
    }
    */

    // Filter data based on the query
    const filteredData = allPrompts.filter(item => 
      item.label.toLowerCase().startsWith(query)
    );

    if (filteredData.length === 0) {
        autocompleteList.style.display = 'none';
        return;
    }

    // Create a div for each filtered result
    filteredData.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('mzta_autocomplete-item');
        itemDiv.textContent = item.label;
        itemDiv.setAttribute('data-id', item.id);

        // Add a mousedown event to select the item
        itemDiv.addEventListener('mousedown', function(e) { // Use mousedown instead of click
            e.preventDefault(); // Prevents the input from losing focus
            input.value = item.label;
            selectedId = item.id; // Store the selected item's ID
            console.log('>>>>>>>>>>>>> mousedown selectedId:', selectedId);
            autocompleteList.style.display = 'none';
        });

        autocompleteList.appendChild(itemDiv);
    });

    autocompleteList.style.display = 'block';
  });

  // Add a keydown event listener to handle arrow navigation and selection
  input.addEventListener('keydown', function (e) {
      const items = autocompleteList.getElementsByClassName('mzta_autocomplete-item');
      if ((autocompleteList.style.display === 'none' || items.length === 0) && (e.key !== 'Enter')) {
          return; // Do nothing if the autocomplete list is not visible
      }

      if (e.key === 'ArrowDown') {
          // Navigate down the list
          currentFocus++;
          if (currentFocus >= items.length) currentFocus = 0; // Wrap to the first item
          addActive(items);
          e.preventDefault(); // Prevent cursor from moving to the end
      } else if (e.key === 'ArrowUp') {
          // Navigate up the list
          currentFocus--;
          if (currentFocus < 0) currentFocus = items.length - 1; // Wrap to the last item
          addActive(items);
          e.preventDefault(); // Prevent cursor from moving to the start
      } else if (e.key === 'Enter') {
          console.log(">>>>>>>>>>>>>> keydown == enter selectedId: " + selectedId);
          if (selectedId) {
            // If an item is already selected, call sendPrompt with the selected ID
            e.preventDefault();
            sendPrompt(selectedId); // Call your sendPrompt function
            banner.remove(); // Optionally remove the banner after sending the prompt
        } else {
          // If no item is selected yet, select the highlighted item
          // Select the highlighted item, or the first item if none is highlighted
          e.preventDefault(); // Prevent form submission if inside a form
          if (currentFocus > -1) {
              if (items[currentFocus]) {
                  items[currentFocus].dispatchEvent(new Event('mousedown')); // Trigger the mousedown event
              }
          } else if (items.length > 0) {
              // If no item is highlighted, select the first item
              items[0].dispatchEvent(new Event('mousedown'));
          }
        }
      }
  });

  // Function to add the "active" class to the current item
  function addActive(items) {
      removeActive(items); // Remove the "active" class from all items
      if (currentFocus >= items.length) currentFocus = 0;
      if (currentFocus < 0) currentFocus = items.length - 1;
      items[currentFocus].classList.add('mzta_autocomplete-item-active'); // Add "active" class to the current item
  }

  // Function to remove the "active" class from all items
  function removeActive(items) {
      for (let i = 0; i < items.length; i++) {
          items[i].classList.remove('mzta_autocomplete-item-active');
      }
  }

  // Handle the input field losing focus to hide the banner
  input.addEventListener('blur', function() {
    // Use a timeout to allow clicking on suggestions before hiding
    setTimeout(() => {
        banner.remove();
    }, 200);
  });

  document.body.insertBefore(banner, document.body.firstChild);
  setTimeout(() => {
    input.focus();
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }, 100);
}

function sendPrompt(prompt_id){
  console.log(">>>>>>>>>>>>> [ThunderAI] sendPrompt: " + prompt_id);
}