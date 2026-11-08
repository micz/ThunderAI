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
 *  The texts of the Smart bar's result lines (claude-spec/10-smartbar.md "Result lines"), shared
 *  by the bar in the message pane (js/mzta-smartbar-script.js) and the chat window in Smart bar
 *  mode (api_webchat/smartbarChat.js), so a line reads the same in both.
 *
 *  A CLASSIC script, like js/lib/mzta-html-lines.js: the bar is a classic content script, which
 *  cannot import a module. It defines one global, mztaSmartbarLines; the message display loads it
 *  before the bar, the chat window injects it only in Smart bar mode.
 *
 *  The texts are i18n strings of the add-on, never the model's words.
 */
(function () {
  const msg = (key, subs) => browser.i18n.getMessage(key, subs) || key;

  const OP_LABEL_KEYS = {
    tag: 'smartbar_op_tag',
    summarize: 'smartbar_op_summarize',
    translate: 'smartbar_op_translate',
    deliver_draft: 'smartbar_op_deliver_draft',
  };
  // The compose operation is named by its message type ("Reply to all"), its params' only field.
  const COMPOSE_LABEL_KEYS = {
    reply: 'smartbar_op_compose_reply',
    reply_all: 'smartbar_op_compose_reply_all',
    forward: 'smartbar_op_compose_forward',
    new: 'smartbar_op_compose_new',
  };
  const STATE_ICON = Object.freeze({ running: '⏳', pending_confirmation: '❓', done: '✔', error: '⚠', cancelled: '–', drafted: '✎' });

  /** The name of an operation as a line shows it. */
  function opLabel(id, params = {}) {
    if (id === 'compose') return msg(COMPOSE_LABEL_KEYS[params?.type] || 'smartbar_op_compose');
    return OP_LABEL_KEYS[id] ? msg(OP_LABEL_KEYS[id]) : id;
  }

  /** "Reply: compose window opened", with the recipient the instruction named as a reminder. */
  function composeOpenedText(type, recipient) {
    const label = msg(COMPOSE_LABEL_KEYS[type] || 'smartbar_op_compose');
    const r = String(recipient || '').trim();
    // The add-on never fills the recipients: the one the instruction named is a reminder.
    return r !== ''
      ? msg('smartbar_result_compose_opened_recipient', [label, r])
      : msg('smartbar_result_compose_opened', [label]);
  }

  /** The text of an operation's line, from its state and result. */
  function opText(op) {
    const label = opLabel(op.id, op.params);
    switch (op.state) {
      case 'running': return msg('smartbar_line_running', [label]);
      case 'pending_confirmation': return msg('smartbar_line_pending', [label]);
      case 'cancelled': return msg('smartbar_line_cancelled', [label]);
      case 'error': return msg('smartbar_line_error', [label, String(op.error || '')]);
      case 'drafted': return msg('smartbar_line_drafted', [label]);
      case 'done':
        if (op.id === 'tag') {
          const tags = op.result?.tags || [];
          let text = tags.length > 0 ? msg('smartbar_result_tags_added', [tags.join(', ')]) : msg('smartbar_result_tags_none');
          if ((op.result?.skipped || []).length > 0) text += ' ' + msg('smartbar_result_tags_skipped', [op.result.skipped.join(', ')]);
          return text;
        }
        if (op.id === 'summarize') return msg('smartbar_result_summary_ready');
        if (op.id === 'translate') return msg('smartbar_result_translation_ready');
        if (op.id === 'compose') return composeOpenedText(op.params?.type, op.result?.recipient);
        // deliver_draft: the window of the draft it created, named by the draft's type.
        if (op.id === 'deliver_draft' && op.result?.type) return composeOpenedText(op.result.type, op.result.recipient);
        return msg('smartbar_line_done', [label]);
      default: return label;
    }
  }

  globalThis.mztaSmartbarLines = Object.freeze({ STATE_ICON, opLabel, opText });
})();
