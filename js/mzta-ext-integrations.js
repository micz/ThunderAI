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
 *  The registry of the external add-on integrations: what the placeholders need to know about each
 *  one, so that js/mzta-placeholders.js and the prompt builders name none of them. A LEAF module:
 *  it imports only the integrations' own clients, never js/mzta-placeholders.js, which imports it
 *  (getPlaceholdersValues() resolves through createExtPlaceholderResolver(), and
 *  placeholdersUtils.prefetchExtIntegrationData() runs the batch prefetch over EXT_INTEGRATIONS).
 *
 *  Each integration's data travels in ext_integration_data, one object for all of them (see
 *  getPlaceholdersValues() and claude-spec/03-placeholders.md, "ext_integration_data"):
 *
 *    header_message_id   generic: the message the integrations look up when there is no curr_message
 *    qnote               { notes }: the QNote notes prefetched for a batch (js/mzta-qnote.js)
 *
 *  A new integration adds its entry to EXT_INTEGRATIONS below, its key to that object, and its
 *  placeholders to defaultPlaceholders in js/mzta-placeholders.js (still the source of the ids).
 */

import {
    getQNoteNoteFor,
    prefetchQNoteNotes
} from './mzta-qnote.js';

// Every integration:
//   key            its key in ext_integration_data
//   placeholders   the ids of the placeholders it resolves
//   read(headerMessageId, data)
//                  the message's data, read at most once per getPlaceholdersValues() call whatever
//                  the number of its tokens in the prompt; data is ext_integration_data[key]
//                  (undefined when nothing was supplied). May reject: that is "no data".
//   value(placeholderId, read)
//                  the placeholder's value from what read() resolved to (null with no data), or
//                  null for '' (failSafePlaceholders() applies)
//   prefetch(headerMessageIds)
//                  its data for a batch, read in one go, or null when there is nothing to hand on.
//                  QNote never resolves to null: with the integration off it maps every id to
//                  null, so no message of the batch reads the preference again.
export const EXT_INTEGRATIONS = [
    {
        key: 'qnote',
        placeholders: ['qnote_text', 'qnote_datetime'],
        read: (headerMessageId, data) => getQNoteNoteFor(headerMessageId, data?.notes),
        value(placeholderId, note) {
            if (placeholderId === 'qnote_text') return note?.text;
            // As {%mail_datetime%}: the Date's toString().
            const ts = note?.ts;
            return Number.isFinite(ts) ? new Date(ts).toString() : null;
        },
        async prefetch(headerMessageIds) {
            const notes = await prefetchQNoteNotes(headerMessageIds);
            return notes ? { notes } : null;
        },
    },
];

/** The integration that resolves the placeholder with this id, or undefined. */
export function findExtIntegration(placeholderId) {
    return EXT_INTEGRATIONS.find(integration => integration.placeholders.includes(placeholderId));
}

/**
 * A resolver for one getPlaceholdersValues() call: resolve(placeholderId) gives the value of an
 * integration placeholder (undefined for an id no integration owns), reading each integration's
 * data at most once and only when one of its placeholders is asked. Never rejects: any failure
 * is "no data", so the value is null.
 */
export function createExtPlaceholderResolver(headerMessageId, ext_integration_data = {}) {
    const ext_data = ext_integration_data || {};
    const reads = new Map();
    return async (placeholderId) => {
        const integration = findExtIntegration(placeholderId);
        if (!integration) return undefined;
        if (!reads.has(integration.key)) {
            reads.set(integration.key, Promise.resolve()
                .then(() => integration.read(headerMessageId, ext_data[integration.key]))
                .catch(() => null));
        }
        try {
            return integration.value(placeholderId, await reads.get(integration.key)) ?? null;
        } catch (e) {
            console.warn('[ThunderAI] Could not resolve {%' + placeholderId + '%}: ' + e);
            return null;
        }
    };
}
