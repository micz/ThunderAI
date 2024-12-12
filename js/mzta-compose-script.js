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

browser.runtime.onMessage.addListener((message) => {
switch (message.command) {
  case "getSelectedText":
    return Promise.resolve(window.getSelection().toString());

  case "replaceSelectedText":
    const selectedText = window.getSelection().toString();
    if (selectedText === '') {
      return Promise.resolve(false);
    }
    const sel = window.getSelection();
    if (!sel || sel.type !== "Range" || !sel.rangeCount) {
      return Promise.resolve(false);
    }
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const parser = new DOMParser();
    const doc = parser.parseFromString(message.text, 'text/html');
    r.insertNode(doc.body);
    browser.runtime.sendMessage({command: "compose_reloadBody", tabId: message.tabId});
    return Promise.resolve(true);
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

  case "getFullHtml":
      return Promise.resolve(window.document.body.innerHTML);

  case 'sendAlert':
    //console.log(">>>>>> message.curr_tab_type: " + JSON.stringify(message.curr_tab_type));
    if(message.curr_tab_type == 'mail'){  // workaround for Thunderbird bug not showing the alert
      // Create dialog elements
      const dialog_sendAlert = window.document.createElement('dialog');
      dialog_sendAlert.classList.add('mzta_dialog');

      const content_sendAlert = window.document.createElement('div');
      content_sendAlert.classList.add('mzta_dialog_content');

      // Create close button
      const closeButton_sendAlert = window.document.createElement('button');
      closeButton_sendAlert.classList.add('mzta_dialog_close');
      closeButton_sendAlert.id = 'mzta_dialog_close';
      closeButton_sendAlert.textContent = 'Close';

      // Create message element
      const message_sendAlert = window.document.createElement('div');
      message_sendAlert.classList.add('mzta_dialog_message');
      message_sendAlert.textContent = message.message;

      // Append elements to the dialog
      content_sendAlert.appendChild(message_sendAlert);
      content_sendAlert.appendChild(closeButton_sendAlert);
      dialog_sendAlert.appendChild(content_sendAlert);
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

      // CSS styles for Thunderbird with support for light and dark themes
      const style = document.createElement('style');
      style.textContent = `
        .mzta_dialog {
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
          padding: 20px;
        }

        .mzta_dialog_close {
          position: absolute;
          bottom: 10px;
          right: 10px;
          background: #007bff;
          border: none;
          color: #ffffff;
          font-size: 14px;
          padding: 8px 12px;
          cursor: pointer;
          border-radius: 4px;
        }

        .mzta_dialog_close:hover {
          background: #0056b3;
        }

        .mzta_dialog_message {
          margin-bottom: 40px;
          font-size: 14px;
        }

        /* Theme support */
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

    }else{
      alert(message.message);
    }
    return Promise.resolve(true);
    break;

  case "getTags":
    console.log(">>>>>>>>>>>>>> getTags: " + JSON.stringify(message.tags));
    // Create and append the styles
    const style = document.createElement('style');
    style.textContent = `
      .mzta_dialog {
        border: none;
        border-radius: 8px;
        width: 300px;
        max-width: 90%;
        max-height: 90%;
        padding: 1em;
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
      }

      .mzta_dialog_btn {
        background: #007bff;
        border: none;
        color: #ffffff;
        font-size: 14px;
        padding: 8px 12px;
        cursor: pointer;
        border-radius: 4px;
      }

      .mzta_dialog_btn:hover {
        background: #0056b3;
      }

      .mzta_dialog_message {
        margin-bottom: 40px;
        font-size: 14px;
      }

      .div_btns{
        width: 100%;
        display: flex;
        justify-content: space-between;
        margin-top: 20px;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --dialog-bg-color: #2e2e2e;
          --dialog-text-color: #ffffff;
        }
      }
    `;
    document.head.appendChild(style);

    function createDialog(inputString, onSubmit) {
      // Create the dialog
      const tags_dialog = document.createElement('dialog');
      tags_dialog.className = 'mzta_dialog';

      // Create the content
      const content = document.createElement('div');
      content.className = 'mzta_dialog_content';

      // Parse the input string into labels
      const words = inputString.split(',').map(word => word.trim());

      // Create the form
      const form = document.createElement('form');

      words.forEach(word => {
        const label = document.createElement('label');
        label.style.display = 'block';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true; // Checked by default
        checkbox.value = word;
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${word}`));
        form.appendChild(label);
      });

      // Add a div for buttons
      const buttonsDiv = document.createElement('div');
      buttonsDiv.className = 'div_btns';
      form.appendChild(buttonsDiv);

      // Add the close button
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.textContent = 'Close';
      closeButton.className = 'mzta_dialog_btn';
      closeButton.addEventListener('click', closeDialog);
      buttonsDiv.appendChild(closeButton);

      // Add the submit button
      const submitButton = document.createElement('button');
      submitButton.type = 'button';
      submitButton.textContent = 'Submit';
      submitButton.className = 'mzta_dialog_btn';
      submitButton.addEventListener('click', () => {
        const selected = Array.from(form.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
        onSubmit(selected);
        closeDialog();
      });
      buttonsDiv.appendChild(submitButton);

      content.appendChild(form);
      tags_dialog.appendChild(content);
      document.body.appendChild(tags_dialog);

      function closeDialog() {
        tags_dialog.close();
        tags_dialog.addEventListener('close', () => {
          tags_dialog.remove();
          style.remove();
        });
      }

      tags_dialog.showModal();

      // Calcola la posizione centrata nel viewport dell'iframe
      const iframeHeight = window.innerHeight; // Altezza visibile dell'iframe
      const iframeWidth = window.innerWidth;   // Larghezza visibile dell'iframe

      const dialogRect = tags_dialog.getBoundingClientRect();

      // Assicurati che il dialog sia centrato nel viewport dell'iframe
      const top = Math.max(0, (iframeHeight - dialogRect.height) / 2);
      const left = Math.max(0, (iframeWidth - dialogRect.width) / 2);

      tags_dialog.style.top = `${top}px`;
      tags_dialog.style.left = `${left}px`;
      tags_dialog.style.maxHeight = `${iframeHeight - 40}px`;

      tags_dialog.style.transform = 'translate(0, 0)';

    }

    // Example usage
    createDialog(message.tags, (selected) => {
      console.log('Selected:', selected);
    });

    return Promise.resolve(true);
    break;

  default:
    // do nothing
    return Promise.resolve(false);
    break;
}    
});