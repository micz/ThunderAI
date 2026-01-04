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

export function textareaAutocomplete(textarea, suggestions, type_value = -1) {
    const container = textarea.closest('.autocomplete-container');
    const autocompleteList = container.querySelector('.autocomplete-list');
    let activeIndex = -1;

    textarea.addEventListener('input', () => {
      const cursorPosition = textarea.selectionStart;
      const text = textarea.value.substring(0, cursorPosition);
      const match = text.match(/{%[^\s]*$/);

      if (match) {
        const lastWord = match[0];
        let type = type_value;
        if(type_value === -1) {
            const tr = textarea.parentNode.parentNode.parentNode;
            type = tr.querySelector('.type_output').value
        }
        // console.log(">>>>>>>>> type: " + type);
        //  console.log(">>>>>>>>> suggestions: " + JSON.stringify(suggestions));
        // console.log(">>>>>>>>> lastWord: " + lastWord);
        const matches = suggestions.filter(s => s.command.startsWith(lastWord) && (String(s.type) == String(type) || String(s.type) == '0' )).map(s => s.command);
        // console.log(">>>>>>>>> matches: " + JSON.stringify(matches));
        showSuggestions(matches, autocompleteList);
      } else {
        hideSuggestions(autocompleteList);
      }
    });

    textarea.addEventListener('keydown', (e) => {
      if (autocompleteList.classList.contains('hidden')) {
        return;
      }
      const items = autocompleteList.querySelectorAll('li');
      if (items.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIndex = (activeIndex + 1) % items.length;
          updateActiveSuggestion(items, activeIndex);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIndex = (activeIndex - 1 + items.length) % items.length;
          updateActiveSuggestion(items, activeIndex);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if(activeIndex === -1) activeIndex = 0;
          if (activeIndex >= 0 && activeIndex < items.length) {
            insertAutocomplete(items[activeIndex].textContent, textarea);
            hideSuggestions(autocompleteList);
          }
        } else if (e.key === 'Escape') {
          hideSuggestions(autocompleteList);
        }
      }
    });

    function showSuggestions(matches, autocompleteList) {
      autocompleteList.innerHTML = '';
      activeIndex = -1;
      if (matches.length === 0) {
        hideSuggestions(autocompleteList);
        return;
      }
      matches.forEach(match => {
        const li = document.createElement('li');
        li.textContent = match;
        li.addEventListener('click', () => {
          insertAutocomplete(match, textarea);
          hideSuggestions(autocompleteList);
        });
        autocompleteList.appendChild(li);
      });
      autocompleteList.classList.remove('hidden');
    }

    function hideSuggestions(autocompleteList) {
      autocompleteList.classList.add('hidden');
      activeIndex = -1;
    }

    function updateActiveSuggestion(items, activeIndex) {
      items.forEach((item, index) => {
        item.classList.remove('active');
        if (index === activeIndex) {
          item.classList.add('active');
          item.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    function insertAutocomplete(suggestion, textarea) {
      // console.log(">>>>>>>>> insertAutocomplete suggestion: " + JSON.stringify(suggestion));
      const cursorPosition = textarea.selectionStart;
      const textBefore = textarea.value.substring(0, cursorPosition);
      const textAfter = textarea.value.substring(cursorPosition);
      const match = textBefore.match(/{%[^\s]*$/);
      if (match) {
        const lastWord = match[0];
        const completion = suggestion.substring(lastWord.length);
        const newText = textBefore + completion + textAfter;
        textarea.value = newText;
        const newCursorPosition = cursorPosition + completion.length - (suggestion.endsWith(':%}') ? 2 : 0);
        textarea.setSelectionRange(newCursorPosition, newCursorPosition);
      }
    }

    document.addEventListener('click', (e) => {
        // Check if the click was outside the textarea or suggestion list
        const isClickInsideTextarea = e.target.closest('.editor');
        const isClickInsideAutocompleteList = e.target.closest('.autocomplete-list');
      
        if (!isClickInsideTextarea && !isClickInsideAutocompleteList) {
            const container = textarea.closest('.autocomplete-container');
            const autocompleteList = container.querySelector('.autocomplete-list');
            hideSuggestions(autocompleteList);
        }
    });

}