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
 *  The external add-on integrations seen from the prompt builders: what they need to know without
 *  naming any integration. Each integration's data travels in ext_integration_data, one object
 *  for all of them (see getPlaceholdersValues() in js/mzta-placeholders.js and
 *  claude-spec/03-placeholders.md, "ext_integration_data"):
 *
 *    header_message_id   generic: the message the integrations look up when there is no curr_message
 *    qnote               { notes }: the QNote notes prefetched for a batch (js/mzta-qnote.js)
 *
 *  A new integration adds its entry to EXT_INTEGRATIONS below and its key to that object.
 */

import { placeholdersUtils } from './mzta-placeholders.js';
import { prefetchQNoteNotes } from './mzta-qnote.js';

// Every integration whose data a batch can read in one go: its key in ext_integration_data, the
// placeholders that need it, and prefetch(headerMessageIds) resolving to its data, or null when
// there is nothing to hand on (QNote never does: with the integration off it maps every id to null,
// so no message reads the preference again).
const EXT_INTEGRATIONS = [
    {
        key: 'qnote',
        placeholders: ['qnote_text', 'qnote_datetime'],
        async prefetch(headerMessageIds) {
            const notes = await prefetchQNoteNotes(headerMessageIds);
            return notes ? { notes } : null;
        },
    },
];

/**
 * The ext_integration_data of a batch: for every integration whose placeholders the prompt text
 * uses (custom placeholders expanded first, as preparePrompt() will), its data for all the
 * messages, read once. {} when the prompt needs none: each message then reads its own, if any.
 * Never throws: an integration that fails is simply left out.
 */
export async function prefetchExtIntegrationData(promptText, headerMessageIds) {
    const data = {};
    let text = String(promptText ?? '');
    if (placeholdersUtils.hasCustomPlaceholder(text)) {
        text = await placeholdersUtils.replaceCustomPlaceholders(text);
    }
    for (const integration of EXT_INTEGRATIONS) {
        if (!integration.placeholders.some(id => placeholdersUtils.hasPlaceholder(text, id))) continue;
        try {
            const value = await integration.prefetch(headerMessageIds);
            if (value) data[integration.key] = value;
        } catch (e) {
            console.warn('[ThunderAI] Could not prefetch the ' + integration.key + ' data: ' + e);
        }
    }
    return data;
}
