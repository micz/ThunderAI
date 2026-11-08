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
/**
 * The states of an operation. drafted: an operation of the chat with deliverInChat (compose)
 * whose text is ready and not delivered yet (the session's current draft is the latest one).
 */
export const OPERATION_STATES = Object.freeze(['running', 'pending_confirmation', 'drafted', 'done', 'error', 'cancelled']);
/** The final states of an operation. */
export const FINAL_OPERATION_STATES = Object.freeze(['drafted', 'done', 'error', 'cancelled']);
/** The sources of a record: the bar in the message pane, or the chat started from it. */
export const RECORD_SOURCES = Object.freeze(['bar', 'chat']);

/** The longest rawResponse and answer kept (characters). */
export const RAW_RESPONSE_CAP = 8000;
export const ANSWER_CAP = 20000;
/** The most records of a session the chat loads (the last ones). */
export const CHAT_SESSION_LIMIT = 50;

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
 *   source       'bar' or 'chat'
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
        source: RECORD_SOURCES.includes(source) ? source : 'bar',
        instruction: String(instruction ?? ''),
        state: 'running',
        unrecognized: null,
        routerContext: [],
        error: null,
        errorType: null,
        rawResponse: null,
        retryAt: null,
        operations: [],
        // The chat only: the free-text answer of a message no operation covers (capped), and the
        // draft its compose operation wrote ({ type, subject, body, groupId }).
        answer: null,
        draft: null,
    };
}

/**
 * The current draft of a session: the latest operation still 'drafted' among its records
 * (oldest first, as smartbarSessionRecords() gives them), with its record. Null when none.
 * @returns {{ record, op, draft: { type, subject, body, groupId } } | null}
 */
export function currentDraft(records) {
    const list = Array.isArray(records) ? records : [];
    for (let r = list.length - 1; r >= 0; r--) {
        const ops = list[r]?.operations || [];
        for (let i = ops.length - 1; i >= 0; i--) {
            const op = ops[i];
            if (op?.state === 'drafted' && op.result && typeof op.result === 'object') {
                return {
                    record: list[r],
                    op: op,
                    draft: {
                        type: op.result.type,
                        subject: op.result.subject || '',
                        body: op.result.body || '',
                        groupId: list[r].groupId,
                    },
                };
            }
        }
    }
    return null;
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
    /** The last CHAT_SESSION_LIMIT records of a session, oldest first, and the session's count. */
    async sessionRecords(sessionId, limit = CHAT_SESSION_LIMIT) {
        return taStorage.smartbarSessionRecords(sessionId, limit);
    },
    async recentInstructions(limit) {
        return taStorage.smartbarRecentInstructions(limit);
    },
    async markInterrupted() {
        return taStorage.smartbarMarkInterrupted();
    },
    /** The Activity tab's page of records, newest first: { records, more }. */
    async list(options = {}) {
        return taStorage.smartbarList(options);
    },
    /** The records in one state. */
    async byState(state) {
        return taStorage.smartbarByState(state);
    },
    /** Remove one record (never a running one); the removed record, or null. */
    async remove(id) {
        return taStorage.smartbarDelete(id);
    },
    /** Remove every record in state 'error' but `exceptIds`; their { id, messageId }. */
    async removeErrors(exceptIds = []) {
        return taStorage.smartbarDeleteErrors(exceptIds);
    },
};

/**
 * The operations a record counts on the badge (claude-spec/10-smartbar.md "Badge"):
 *   running  the operations running, and the router (or the chat's free answer) still at work
 *            (a record with no operation yet and no error) as one;
 *   errors   the operations in error and the instruction-level error, not dismissed, and not
 *            stopped by the user (errorType 'aborted': a Stop is no failure to act on).
 * A pending confirmation counts in neither. Only the records running or in error count: a
 * replaced or interrupted record is history.
 */
export function badgeCounts(record) {
    const out = { running: 0, errors: 0 };
    if (!record || !['running', 'error'].includes(record.state)) return out;
    const ops = Array.isArray(record.operations) ? record.operations : [];
    if (record.state === 'running' && ops.length === 0 && !record.errorType) out.running++;
    if (record.errorType && record.errorType !== 'aborted' && !record.dismissed?.error) out.errors++;
    for (const op of ops) {
        if (op?.state === 'running') out.running++;
        else if (op?.state === 'error' && op.errorType !== 'aborted' && !op.dismissed) out.errors++;
    }
    return out;
}
