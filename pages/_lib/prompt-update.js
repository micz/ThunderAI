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

/*
 *  The comparison of a special prompt's text with a newer default text
 *  (claude-spec/02-prompts.md "Default text updates"): the change picker of the API chat
 *  (<diff-picker>, api_webchat/diffPicker.js, claude-spec/07-diff-picker.md) in a modal box, the
 *  user's text as the original side and the new default as the proposed one. The user keeps the
 *  changes they want; the picker's "use" action gives the composed text back, which the editor
 *  takes (unsaved). bindSpecialPromptEditor()'s updateNotice.onCompare.
 *
 *  The page must load the picker's classic scripts first: js/lib/diff.js (the Diff global) and
 *  js/lib/mzta-html-lines.js (the rich-text projection). The picker module itself is imported on
 *  the first comparison only.
 */

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * A plain prompt text as the picker's block HTML: a <p> per line, an empty line as an empty
 * paragraph (<p><br></p>), which the picker keeps as the gap before the next block.
 */
export function textToPickerHtml(text) {
    return String(text ?? '').replace(/\r\n/g, '\n').split('\n')
        .map(line => line.trim() === '' ? '<p><br></p>' : '<p>' + escapeHtml(line) + '</p>')
        .join('');
}

/** The picker's composed block HTML back to plain text: a line per block, empty ones kept. */
export function pickerHtmlToText(html) {
    const doc = new DOMParser().parseFromString('<body>' + String(html ?? '') + '</body>', 'text/html');
    const blockText = el => {
        const copy = el.cloneNode(true);
        copy.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        const text = copy.textContent;
        // An empty paragraph (<p><br></p>) is one empty line, not two.
        return text.trim() === '' ? '' : text;
    };
    const lines = [];
    for (const node of doc.body.childNodes) {
        if (node.nodeType === 3) {
            if (node.textContent.trim() !== '') lines.push(node.textContent);
            continue;
        }
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'UL' || node.tagName === 'OL') {
            for (const li of node.querySelectorAll('li')) lines.push(blockText(li));
            continue;
        }
        lines.push(blockText(node));
    }
    return lines.join('\n');
}

/**
 * Show the picker with `currentText` (the user's) against `newDefault`. Resolves the composed
 * text when the user applies it, null when the box is closed.
 */
export async function openDefaultCompare(currentText, newDefault) {
    await import('../../api_webchat/diffPicker.js');
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'mzta_compare_overlay';
        const box = document.createElement('div');
        box.className = 'mzta_compare_box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        const title = document.createElement('div');
        title.className = 'mzta_prompt_title';
        title.id = 'mzta_compare_title';
        title.textContent = browser.i18n.getMessage('prompt_default_compare_title');
        box.setAttribute('aria-labelledby', title.id);
        const help = document.createElement('p');
        help.className = 'mzta_help';
        help.textContent = browser.i18n.getMessage('prompt_default_compare_info');

        const picker = document.createElement('diff-picker');
        picker.setGranularity('words');
        picker.setContent(textToPickerHtml(currentText), textToPickerHtml(newDefault));

        const buttons = document.createElement('div');
        buttons.className = 'btn_div';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'btn_secondary';
        close.id = 'mzta_compare_close';
        close.textContent = browser.i18n.getMessage('prompt_default_compare_close');
        buttons.appendChild(close);

        const onKey = (e) => { if (e.key === 'Escape') finish(null); };
        const finish = (value) => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            resolve(value);
        };
        picker.setUseAnswerHandler(() => finish(pickerHtmlToText(picker.composeResultHTML())));
        close.addEventListener('click', () => finish(null));
        document.addEventListener('keydown', onKey);

        box.append(title, help, picker, buttons);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        close.focus();
    });
}
