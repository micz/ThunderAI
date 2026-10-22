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

// Helpers for the batched spam check: many emails are analyzed in a single
// AI call (one numbered list in, one JSON array out) instead of one call
// per email. Pure string/parsing logic — no browser APIs — so it stays
// unit-testable.

import { extractJsonObject } from './mzta-utils.js';

// Upper bound for the body excerpt of a single email inside the batch prompt.
// Spam signals live mostly in sender, subject and the first part of the body.
export const SPAM_BATCH_BODY_MAX_CHARS = 4000;

/**
 * Builds the numbered prompt block for a single queued email.
 * @param {object} item - { message, fullMessage, body_text }
 * @param {number} index - zero-based position in the batch
 */
export function buildSpamBatchEmailBlock(item, index) {
    const headers = item.fullMessage?.headers || {};
    const body = (item.body_text || '').slice(0, SPAM_BATCH_BODY_MAX_CHARS);
    return [
        `### EMAIL ${index + 1}`,
        `From: ${headers.from || item.message?.author || ''}`,
        `Subject: ${headers.subject || ''}`,
        `Date: ${item.message?.date ? new Date(item.message.date).toISOString() : ''}`,
        'Body:',
        body,
    ].join('\n');
}

/**
 * Builds the complete numbered list of email blocks for one batch prompt.
 */
export function buildSpamBatchEmails(items) {
    return items.map((item, index) => buildSpamBatchEmailBlock(item, index)).join('\n\n');
}

/**
 * Decides what happens with a mail while building the batch spam queue.
 * @param {object} params
 * @param {object|null} params.existingReport - Stored spam report of the mail, or null.
 * @param {object|null} params.cachedSpam - Cached verdict for the sender, or null.
 * @param {boolean} params.senderCacheEnabled - Whether the sender cache is enabled.
 * @param {string} params.senderEmail - The sender address ('' when unknown).
 * @returns {'skip'|'cached'|'queue'}
 *   skip   — a usable verdict is already stored, the mail is left alone
 *            (error reports, spamValue < 0, don't count and get retried),
 *   cached — the sender verdict comes from the cache, no AI call needed,
 *   queue  — the mail has to be analyzed by the AI.
 */
export function spamQueueDecision({ existingReport, cachedSpam, senderCacheEnabled, senderEmail }) {
    if (existingReport && existingReport.spamValue >= 0) return 'skip';
    if (senderCacheEnabled && senderEmail && cachedSpam) return 'cached';
    return 'queue';
}

/**
 * Parses the AI response of a batched spam check.
 * @param {string} text - the raw AI response
 * @returns {Map<number, {spamValue: number, explanation: string}>|null}
 *          Map keyed by the 1-based email index, or null when the response
 *          cannot be parsed / contains no valid entries (caller falls back
 *          to the per-mail analysis).
 */
export function parseSpamBatchResponse(text) {
    try {
        const parsed = extractJsonObject(text);
        const results = parsed?.results;
        if (!Array.isArray(results)) return null;
        const map = new Map();
        for (const result of results) {
            const index = parseInt(result?.index, 10);
            const spamValue = Number(result?.spamValue);
            if (!Number.isInteger(index) || index < 1) continue;
            // null/undefined/'' must not be coerced to 0 — an entry without a
            // usable value is invalid and falls back to the per-mail analysis.
            if (result?.spamValue === null || result?.spamValue === undefined || result?.spamValue === '') continue;
            if (!Number.isFinite(spamValue)) continue;
            map.set(index, {
                spamValue: Math.max(0, Math.min(100, Math.round(spamValue))),
                explanation: String(result?.explanation || ''),
            });
        }
        return map.size > 0 ? map : null;
    } catch (e) {
        return null;
    }
}
