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
 *  The QNote integration [#980]: the note QNote attached to a message, read through QNote's
 *  read-only external API (runtime.sendMessage to QNote's id). See claude-spec/03-placeholders.md,
 *  "The QNote placeholders", and claude-spec/05-options.md, "QNote integration row".
 *
 *  No function here ever throws: a missing, old, hanging or refusing QNote must never break a
 *  prompt. Every one resolves to { ok: true, ... } or { ok: false, reason }, reason being one of
 *  QNOTE_REASONS.
 *
 *  requestQNoteAccess() opens QNote's MODAL dialog: only a user action in the options page may call
 *  it, never the background or an automatic path (they call getQNoteNotes() alone, and an access
 *  not granted simply means no note).
 */

import { taLogger } from './mzta-logger.js';
import { mztaPrefs } from './mzta-prefs.js';

export const QNOTE_ID = 'qnote@dqdp.net';
// The external API version this code speaks: a reply with a lower (or no) apiVersion is a QNote
// without the API.
export const QNOTE_API_VERSION = 1;
// For getStatus and getNotes, which QNote answers at once. requestAccess has none: it resolves
// only once the user has answered QNote's dialog.
export const QNOTE_TIMEOUT_MS = 3000;
// The most headerMessageIds QNote accepts in one getNotes call.
export const QNOTE_MAX_IDS = 1000;
export const QNOTE_ACCESS_STATES = ['unknown', 'pending', 'granted', 'denied'];
export const QNOTE_REASONS = {
    NOT_REACHABLE: 'not_reachable',   // not installed, disabled, or no answer in time
    UNSUPPORTED: 'unsupported',       // a QNote without the external API (apiVersion missing or < 1)
    ACCESS_NOT_GRANTED: 'access_not_granted',   // getNotes refused with "access-denied"
    ERROR: 'error',                   // any other error reply, or a reply of the wrong shape
};

const log = new taLogger('mzta-qnote', false);

class QNoteTimeout extends Error {}

// One message to QNote. Rejects like sendMessage itself (QNote missing) or with QNoteTimeout.
async function send(message, timeoutMs) {
    const call = browser.runtime.sendMessage(QNOTE_ID, message);
    if (!(timeoutMs > 0)) return await call;
    let timer;
    try {
        return await Promise.race([
            call,
            new Promise((resolve, reject) => {
                timer = setTimeout(() => reject(new QNoteTimeout('no answer within ' + timeoutMs + ' ms')), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

// The failure a reply stands for, or null when it is a usable reply of a supported API.
function replyProblem(reply) {
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return fail(QNOTE_REASONS.UNSUPPORTED);
    if (!(Number(reply.apiVersion) >= QNOTE_API_VERSION)) return fail(QNOTE_REASONS.UNSUPPORTED, { apiVersion: reply.apiVersion });
    if (reply.error !== undefined) {
        return fail(reply.error === 'access-denied' ? QNOTE_REASONS.ACCESS_NOT_GRANTED : QNOTE_REASONS.ERROR,
            { error: String(reply.error) });
    }
    return null;
}

// A getStatus / requestAccess call: { ok: true, apiVersion, access } or { ok: false, reason }.
async function accessCall(command, timeoutMs) {
    let reply;
    try {
        reply = await send({ command }, timeoutMs);
    } catch (e) {
        log.log('QNote ' + command + ': not reachable (' + (e?.message ?? e) + ').');
        return fail(QNOTE_REASONS.NOT_REACHABLE);
    }
    const problem = replyProblem(reply);
    if (problem) {
        logProblem('QNote ' + command, problem, reply);
        return problem;
    }
    if (!QNOTE_ACCESS_STATES.includes(reply.access)) {
        log.warn('QNote ' + command + ': unknown access state: ' + safeJson(reply.access));
        return fail(QNOTE_REASONS.ERROR);
    }
    return { ok: true, apiVersion: Number(reply.apiVersion), access: reply.access };
}

// An old QNote (no external API) and an access not granted are normal states of a user's setup,
// logged only with debug on; any other error reply is a warning.
function logProblem(what, problem, reply) {
    const text = what + ': ' + problem.reason + ' (' + safeJson(reply) + ').';
    if (problem.reason === QNOTE_REASONS.ERROR) log.warn(text);
    else log.log(text);
}

function safeJson(value) {
    try { return JSON.stringify(value); } catch (e) { return String(value); }
}

/** Whether ThunderAI may read the notes. Never prompts. */
export async function getQNoteStatus({ timeoutMs = QNOTE_TIMEOUT_MS } = {}) {
    return accessCall('getStatus', timeoutMs);
}

/**
 * Asks the user, through QNote's modal dialog, to let ThunderAI read the notes; returns the
 * current state at once when it is already decided. No time-out: it waits for the user.
 * ONLY from a user action in the options page.
 */
export async function requestQNoteAccess() {
    return accessCall('requestAccess', 0);
}

// A note as the placeholders use it, or null.
function normalizeNote(note) {
    if (!note || typeof note !== 'object') return null;
    if (typeof note.text !== 'string') return null;
    const ts = Number(note.ts);
    return { text: note.text, ts: Number.isFinite(ts) ? ts : null };
}

/**
 * The notes of the given messages, by headerMessageId: { ok: true, notes } where every requested
 * id maps to { text, ts } or null (no note), or { ok: false, reason, notes } with the notes read
 * before the failure. Chunked by QNOTE_MAX_IDS. Never prompts.
 */
export async function getQNoteNotes(headerMessageIds, { timeoutMs = QNOTE_TIMEOUT_MS } = {}) {
    const ids = [...new Set((Array.isArray(headerMessageIds) ? headerMessageIds : [])
        .filter(id => typeof id === 'string' && id !== ''))];
    const notes = {};
    for (let i = 0; i < ids.length; i += QNOTE_MAX_IDS) {
        const chunk = ids.slice(i, i + QNOTE_MAX_IDS);
        let reply;
        try {
            reply = await send({ command: 'getNotes', headerMessageIds: chunk }, timeoutMs);
        } catch (e) {
            log.log('QNote getNotes: not reachable (' + (e?.message ?? e) + ').');
            return fail(QNOTE_REASONS.NOT_REACHABLE, { notes });
        }
        const problem = replyProblem(reply);
        if (problem) {
            logProblem('QNote getNotes', problem, reply);
            return { ...problem, notes };
        }
        if (!reply.notes || typeof reply.notes !== 'object' || Array.isArray(reply.notes)) {
            log.warn('QNote getNotes: reply without a notes object: ' + safeJson(reply));
            return fail(QNOTE_REASONS.ERROR, { notes });
        }
        for (const id of chunk) {
            notes[id] = Object.hasOwn(reply.notes, id) ? normalizeNote(reply.notes[id]) : null;
        }
    }
    return { ok: true, notes };
}

/** Whether the user turned the integration on (the qnote_integration preference). */
export async function isQNoteEnabled() {
    try {
        return (await mztaPrefs.getPref('qnote_integration')) === true;
    } catch (e) {
        log.warn('Could not read qnote_integration: ' + e);
        return false;
    }
}

/**
 * The notes of many messages in as few getNotes calls as possible, for a batch that resolves the
 * QNote placeholders of each: { [headerMessageId]: note | null } with EVERY valid id present, so
 * getQNoteNoteFor() never asks again, not even after a failure (a hanging QNote would otherwise
 * cost one time-out per message). With the integration off every id maps to null and QNote is not
 * asked: the preference is read once for the batch, not once more per message.
 */
export async function prefetchQNoteNotes(headerMessageIds) {
    const result = await isQNoteEnabled() ? await getQNoteNotes(headerMessageIds) : { notes: {} };
    const out = {};
    for (const id of headerMessageIds || []) {
        if (typeof id === 'string' && id !== '') out[id] = result.notes?.[id] ?? null;
    }
    return out;
}

/**
 * The note of one message for the placeholders, or null: integration off, no headerMessageId (a
 * compose window), QNote missing, access not granted, no note, any failure. `prefetched` is the
 * map of prefetchQNoteNotes(), used when it holds the id.
 */
export async function getQNoteNoteFor(headerMessageId, prefetched = null) {
    if (typeof headerMessageId !== 'string' || headerMessageId === '') return null;
    if (prefetched && typeof prefetched === 'object' && Object.hasOwn(prefetched, headerMessageId)) {
        return prefetched[headerMessageId] ?? null;
    }
    if (!await isQNoteEnabled()) return null;
    const result = await getQNoteNotes([headerMessageId]);
    return result.notes?.[headerMessageId] ?? null;
}
