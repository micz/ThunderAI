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

// The single place a worker hands its captured usage to the chat window.
//
// Every provider worker ends a response in two or three different places (normal
// end of stream, user stop, provider-specific terminal event), and each of them
// posts 'tokensDone'. Routing the usage through one helper is what keeps those ten
// call sites from drifting apart.
//
// The 'usage' message is deliberately SEPARATE from 'tokensDone' and carries no
// text: the usage must never be concatenated into the response, and never enter
// conversationHistory. Nothing here touches either -- the workers keep their
// accumulators to themselves, and this module only reads the usage object.
//
// Ordering: post the usage BEFORE 'tokensDone'. The window renders the badge from
// the turn that 'tokensDone' then closes, so it has to arrive while that turn is
// still the current one. Worker messages are delivered in order, so this is enough.

import { isUsageDataEmpty } from '../api/mzta-api-usage.js';

// Set from the init message. False (the pref off, or a window that never sent the
// flag) means the extraction still runs and still reaches the debug log, but
// nothing is emitted -- which is exactly what the option promises.
let emit_usage = false;

// The per-response id the window uses to bind the badge to its assistant message.
// Bumped once per response, so a second turn cannot land its usage on the first.
let message_seq = 0;

/**
 * Read the show-usage flag out of a worker 'init' message.
 * @param {object} data the event.data of the init message
 */
export function initUsageEmitter(data) {
    emit_usage = (data !== null && typeof data === 'object' && data.chat_show_usage_data === true);
}

/**
 * The id of the assistant message a response is about to produce. Call once per
 * response, when the request is sent.
 * @returns {string}
 */
export function nextUsageMessageId() {
    message_seq += 1;
    return 'msg_' + message_seq;
}

/**
 * Post the usage for a finished response, when there is something to post.
 *
 * Silent when the option is off, when the provider reported nothing, or when every
 * numeric field is null: an empty badge is worse than no badge.
 *
 * @param {object|null} usage the normalized usage accumulated by the worker
 * @param {string} messageId the id returned by nextUsageMessageId() for this response
 */
export function postUsageData(usage, messageId) {
    if (!emit_usage) return;
    if (isUsageDataEmpty(usage)) return;
    postMessage({ type: 'usage', messageId: messageId, payload: usage });
}
