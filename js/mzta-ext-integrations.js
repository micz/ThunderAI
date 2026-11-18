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
 *  (getPlaceholdersValues() resolves through createExtPlaceholderResolver()).
 *
 *  Each integration's data travels in ext_integration_data, one object for all of them (see
 *  getPlaceholdersValues() and claude-spec/03-placeholders.md, "ext_integration_data"):
 *
 *    header_message_id   generic: the message the integrations look up when there is no curr_message
 *    batch               generic: createExtBatch() of the messages processed together (a summary of
 *                        several messages, a processEmails() run), so each integration reads the
 *                        data of all of them in one go, the first time a message needs it
 *    qnote               { notes }: QNote notes already read ({ [headerMessageId]: note | null })
 *
 *  A new integration adds its entry to EXT_INTEGRATIONS below, its key to that object, and its
 *  placeholders to defaultPlaceholders in js/mzta-placeholders.js (still the source of the ids).
 */

import {
    getQNoteNoteFor,
    isQNoteEnabled,
    prefetchQNoteNotes
} from './mzta-qnote.js';

// Every integration:
//   key            its key in ext_integration_data
//   placeholders   the ids of the placeholders it resolves
//   enabled()      whether the user turned it on: the autocomplete offers its placeholders only
//                  then (withoutDisabledExtPlaceholders()). May reject: that is "off".
//   read(headerMessageId, data)
//                  the message's data, read at most once per getPlaceholdersValues() call whatever
//                  the number of its tokens in the prompt; data is ext_integration_data[key]
//                  (undefined when nothing was supplied). May reject: that is "no data".
//   value(placeholderId, read)
//                  the placeholder's value from what read() resolved to (null with no data), or
//                  null for '' (failSafePlaceholders() applies)
//   prefetch(headerMessageIds)
//                  its data for a batch (createExtBatch()), read in one go, in the shape of
//                  ext_integration_data[key], or null when there is nothing to hand on (each
//                  message then reads its own). QNote never resolves to null: with the integration
//                  off it maps every id to null, so no message of the batch reads the preference
//                  again.
export const EXT_INTEGRATIONS = [
    {
        key: 'qnote',
        placeholders: ['qnote_text', 'qnote_datetime'],
        enabled: () => isQNoteEnabled(),
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
 * The placeholders an autocomplete offers: the list without those of an integration switched off
 * (read when called, so a page offers what was on when it loaded). Only the suggestions: the
 * highlighting and the validation keep the full list, a token of an integration switched off is
 * still a valid placeholder (it resolves to '').
 */
export async function withoutDisabledExtPlaceholders(placeholders) {
    const off = new Set();
    for (const integration of EXT_INTEGRATIONS) {
        let on = false;
        try {
            on = (await integration.enabled()) === true;
        } catch (e) {
            console.warn('[ThunderAI] Could not tell whether ' + integration.key + ' is on: ' + e);
        }
        if (!on) integration.placeholders.forEach(id => off.add(id));
    }
    return placeholders.filter(p => !off.has(p.id));
}

/**
 * The messages processed together, for ext_integration_data.batch: the first message whose prompt
 * needs an integration's data has it read for ALL of them, with one prefetch() per integration
 * shared by the whole batch (concurrent messages wait for the same one), so a hanging add-on costs
 * one time-out per batch, not one per message. Lazy: an integration no prompt of the batch uses is
 * never asked. Never rejects: a failed prefetch is null, and each message then reads its own.
 */
export function createExtBatch(headerMessageIds) {
    const ids = [...new Set((Array.isArray(headerMessageIds) ? headerMessageIds : [])
        .filter(id => typeof id === 'string' && id !== ''))];
    const prefetched = new Map();
    return {
        headerMessageIds: ids,
        has: headerMessageId => ids.includes(headerMessageId),
        dataFor(integration) {
            if (!prefetched.has(integration.key)) {
                prefetched.set(integration.key, Promise.resolve()
                    .then(() => integration.prefetch(ids))
                    .catch(e => {
                        console.warn('[ThunderAI] Could not prefetch the ' + integration.key + ' data: ' + e);
                        return null;
                    }));
            }
            return prefetched.get(integration.key);
        },
    };
}

/**
 * A resolver for one getPlaceholdersValues() call: resolve(placeholderId) gives the value of an
 * integration placeholder (undefined for an id no integration owns), reading each integration's
 * data at most once and only when one of its placeholders is asked: the data supplied under its
 * key, else the batch's prefetch when the message is in ext_integration_data.batch, else its own
 * read. Never rejects: any failure is "no data", so the value is null.
 */
export function createExtPlaceholderResolver(headerMessageId, ext_integration_data = {}) {
    const ext_data = ext_integration_data || {};
    const reads = new Map();
    return async (placeholderId) => {
        const integration = findExtIntegration(placeholderId);
        if (!integration) return undefined;
        if (!reads.has(integration.key)) {
            reads.set(integration.key, (async () => {
                let data = ext_data[integration.key];
                if (data === undefined && ext_data.batch?.has?.(headerMessageId)) {
                    data = (await ext_data.batch.dataFor(integration)) ?? undefined;
                }
                return integration.read(headerMessageId, data);
            })().catch(() => null));
        }
        try {
            return integration.value(placeholderId, await reads.get(integration.key)) ?? null;
        } catch (e) {
            console.warn('[ThunderAI] Could not resolve {%' + placeholderId + '%}: ' + e);
            return null;
        }
    };
}
