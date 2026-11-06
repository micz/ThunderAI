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
 *  The Smart bar's records (claude-spec/10-smartbar.md "Storage"): one per instruction the user
 *  typed, in the smartbar store of js/mzta-storage.js (not mirrored in storage.local).
 *
 *  This module builds the record, derives its state from its operations and caps what can grow.
 *  The background writes it ONLY at the meaningful points: created (state running), an operation
 *  reaching pending_confirmation, an operation reaching a final state, a retryAt set, the
 *  instruction replaced. Progress and reasoning are never stored.
 */

import { taStorage } from './mzta-storage.js';

/** The states of a record. replaced and interrupted are set by the background. */
export const RECORD_STATES = Object.freeze(['running', 'pending_confirmation', 'error', 'done', 'interrupted', 'replaced']);
/** The states of an operation. drafted is reserved for the deliver_draft operation (phase 3). */
export const OPERATION_STATES = Object.freeze(['running', 'pending_confirmation', 'drafted', 'done', 'error', 'cancelled']);
/** The final states of an operation. */
export const FINAL_OPERATION_STATES = Object.freeze(['drafted', 'done', 'error', 'cancelled']);

/** The longest rawResponse and answer kept (characters). */
export const RAW_RESPONSE_CAP = 8000;
export const ANSWER_CAP = 20000;

/** A text cut to `max` characters (null stays null). */
function cap(text, max) {
    if (text === null || text === undefined) return null;
    const s = String(text);
    return s.length > max ? s.slice(0, max) : s;
}

/** A random id (the groupId of an instruction, the sessionId of a bar). */
export function newId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

/**
 * A new record, in state 'running'.
 * @param {object} o
 *   messageId    the header Message-ID
 *   metadata     { subject, from, message_date } (buildMessageMetadata())
 *   sessionId    the bar's session on this message
 *   groupId      this instruction's id, carried by each of its jobs
 *   instruction  what the user typed
 *   source       'bar' ('chat' in phase 3)
 */
export function newRecord({ messageId, metadata = {}, sessionId, groupId, instruction, source = 'bar', now = Date.now() }) {
    return {
        messageId: messageId,
        createdAt: now,
        subject: metadata.subject ?? [],
        from: metadata.from ?? [],
        message_date: metadata.message_date instanceof Date ? metadata.message_date.toISOString() : (metadata.message_date ?? ''),
        groupId: groupId,
        sessionId: sessionId,
        source: source,
        instruction: String(instruction ?? ''),
        state: 'running',
        unrecognized: null,
        routerContext: [],
        error: null,
        errorType: null,
        rawResponse: null,
        retryAt: null,
        operations: [],
        // Reserved for phase 3 (chat mode, deliver_draft): always null now.
        answer: null,
        draft: null,
    };
}

/** An operation as the record stores it, from a planned line (js/mzta-smartbar-registry.js). */
export function recordOperation(line) {
    return {
        index: line.index,
        id: line.id,
        params: line.params ?? {},
        state: line.state === 'queued' ? 'running' : line.state,
        result: line.result ?? null,
        error: line.error ?? null,
        errorType: line.errorType ?? null,
        rawResponse: cap(line.rawResponse, RAW_RESPONSE_CAP),
        retryAt: line.retryAt ?? null,
        dependsOn: Array.isArray(line.dependsOn) ? [...line.dependsOn] : [],
        finishedAt: line.finishedAt ?? null,
    };
}

/**
 * The state of a record from its operations, once the router has answered:
 *   replaced / interrupted     kept (the background's own)
 *   an instruction-level error 'error'
 *   an operation running       'running'
 *   one pending confirmation   'pending_confirmation'
 *   one in error               'error'
 *   otherwise                  'done' (also with no operation at all)
 */
export function deriveState(record) {
    if (record.state === 'replaced' || record.state === 'interrupted') return record.state;
    if (record.errorType) return 'error';
    const states = (record.operations || []).map(op => op.state);
    if (states.includes('running')) return 'running';
    if (states.includes('pending_confirmation')) return 'pending_confirmation';
    if (states.includes('error')) return 'error';
    return 'done';
}

/** The record as stored: caps applied, state derived unless `keepState`. */
export function finishRecord(record, { keepState = false } = {}) {
    const out = { ...record };
    out.rawResponse = cap(out.rawResponse, RAW_RESPONSE_CAP);
    out.answer = cap(out.answer, ANSWER_CAP);
    out.operations = (out.operations || []).map(op => ({ ...op, rawResponse: cap(op.rawResponse, RAW_RESPONSE_CAP) }));
    if (!keepState) out.state = deriveState(out);
    return out;
}

/**
 * A record replaced by a new instruction on the same message: 'replaced', and its operations
 * still running or waiting for a confirmation 'cancelled'.
 */
export function markReplaced(record, now = Date.now()) {
    return {
        ...record,
        state: 'replaced',
        operations: (record.operations || []).map(op => FINAL_OPERATION_STATES.includes(op.state)
            ? op
            : { ...op, state: 'cancelled', finishedAt: now }),
    };
}

/** Whether a record still holds errors the user has not acted on. */
export function hasErrors(record) {
    return !!record?.errorType || (record?.operations || []).some(op => op.state === 'error');
}

/** The store itself: thin calls over taStorage's smartbar methods. */
export const taSmartbarStore = {
    /** Store a new record; resolves it with its id. */
    async create(record) {
        return taStorage.smartbarAdd(finishRecord(record, { keepState: true }));
    },
    /** Rewrite a record (with its id), its state derived unless keepState. Null when it is gone. */
    async save(record, options = {}) {
        return taStorage.smartbarPut(finishRecord(record, options));
    },
    async get(id) {
        return taStorage.smartbarGet(id);
    },
    async latest(messageId) {
        return taStorage.smartbarLatestForMessage(messageId);
    },
    async recentInstructions(limit) {
        return taStorage.smartbarRecentInstructions(limit);
    },
    async markInterrupted() {
        return taStorage.smartbarMarkInterrupted();
    },
};
