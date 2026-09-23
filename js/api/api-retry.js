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

// Automatic retry with exponential backoff for the API classes in this
// directory. Like api-utils.js, this module must stay free of any WebExtension
// or DOM dependency: it runs inside the Web Workers in js/workers/.

import { taLogger } from '../mzta-logger.js';

export const RETRY_DEFAULTS = {
    maxRetries: 5,
    // Wait before each retry; the last value is reused for the remaining ones
    // (5 s, 10 s, 20 s, 30 s, 30 s). An overloaded model or a rate limit usually
    // lasts tens of seconds, so a short 1-2-4 s schedule would give up too early.
    retryDelaysMs: [5000, 10000, 20000, 30000],
    retryAfterCapMs: 30000,
    // Covers only the wait for the response headers, see fetchWithRetry().
    timeoutMs: 60000,
};

// 529 is Anthropic's "overloaded". 400/401/403/404 and every other status are
// returned at once: repeating a request the server rejected cannot help.
export const RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504, 529];

const defaultLogger = new taLogger('api-retry', false);

/**
 * fetch() with automatic retry on transient failures.
 *
 * Retries network exceptions, per-attempt timeouts and RETRYABLE_STATUSES,
 * waiting with exponential backoff and jitter, or for the Retry-After header
 * when the server sends one. The retry happens only before the body is
 * consumed: a failure in the middle of a stream is not retried.
 *
 * Always either returns a Response (possibly a non-ok one, unread, when the
 * status is not retryable or the retries are used up) or throws.
 *
 * The URL is never logged: some providers carry the API key in the query string.
 *
 * @param {string} url
 * @param {object} options the fetch() options; any `signal` is replaced
 * @param {object} retryConfig overrides for RETRY_DEFAULTS, plus:
 *   signal  - AbortSignal of a user-initiated abort; it is never retried
 *   onRetry - called before each wait with {attempt, maxRetries, delayMs, status, reason}
 *   logger  - a taLogger
 *   label   - provider name used in the log lines
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, retryConfig = {}) {
    const cfg = { ...RETRY_DEFAULTS, ...retryConfig };
    const { signal, onRetry, label = 'API' } = cfg;
    const logger = cfg.logger || defaultLogger;
    const maxRetries = Math.max(0, parseInt(cfg.maxRetries) || 0);
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) throw signal.reason;

        // A dedicated controller rather than AbortSignal.timeout(): the timer is
        // cleared as soon as the headers arrive, whereas a timeout signal would
        // stay attached to the body and cut off any stream longer than timeoutMs.
        // Without a timeout a hung connection never produces a 408/504, so no
        // retry would ever fire.
        const timeoutCtrl = new AbortController();
        const timer = setTimeout(() => {
            timeoutCtrl.abort(new DOMException("The request timed out after " + (Math.round(cfg.timeoutMs / 100) / 10) + " s", 'TimeoutError'));
        }, cfg.timeoutMs);
        const attemptSignal = signal ? AbortSignal.any([signal, timeoutCtrl.signal]) : timeoutCtrl.signal;

        let response = null;
        let reason = 'http';
        try {
            response = await fetch(url, { ...options, signal: attemptSignal });
        } catch (error) {
            if (signal?.aborted) throw error;
            lastError = timeoutCtrl.signal.aborted ? timeoutCtrl.signal.reason : error;
            if (attempt === maxRetries) throw lastError;
            reason = timeoutCtrl.signal.aborted ? 'timeout' : 'network';
        } finally {
            clearTimeout(timer);
        }

        if (response !== null) {
            if (!RETRYABLE_STATUSES.includes(response.status) || attempt === maxRetries) {
                return response;
            }
            // Release the connection: this response will never be read.
            response.body?.cancel().catch(() => {});
        }

        const retryAfterMs = response !== null ? parseRetryAfter(response.headers.get('Retry-After'), cfg.retryAfterCapMs) : null;
        const delayMs = retryAfterMs !== null ? retryAfterMs : backoffDelay(attempt, cfg);
        const status = response !== null ? response.status : null;

        logger.log(label + " request failed (" + (status !== null ? "HTTP " + status : reason)
            + (lastError && response === null ? ": " + lastError : "")
            + "), retry " + (attempt + 1) + " of " + maxRetries + " in " + delayMs + " ms"
            + (retryAfterMs !== null ? " (Retry-After)" : ""));

        if (typeof onRetry === 'function') {
            try {
                onRetry({ attempt: attempt + 1, maxRetries, delayMs, status, reason });
            } catch (e) {
                logger.warn("onRetry callback failed: " + e);
            }
        }

        await sleep(delayMs, signal);
    }

    // Unreachable: the last attempt always returns or throws. Kept so a future
    // change to the loop can never make the caller receive undefined.
    throw lastError ?? new Error(label + " request failed after " + maxRetries + " retries");
}

/**
 * Increasing backoff with jitter: a random value between 80% and 100% of
 * retryDelaysMs[attempt], the last entry being reused once the list runs out.
 * The jitter keeps many clients failing together from retrying in lockstep.
 */
function backoffDelay(attempt, cfg) {
    const delays = Array.isArray(cfg.retryDelaysMs) && cfg.retryDelaysMs.length > 0
        ? cfg.retryDelaysMs : RETRY_DEFAULTS.retryDelaysMs;
    const base = delays[Math.min(attempt, delays.length - 1)];
    return Math.round(base * (0.8 + Math.random() * 0.2));
}

/**
 * Parse a Retry-After header, in either the delta-seconds or the HTTP-date form.
 * @returns {number|null} the delay in ms clamped to [0, capMs], or null if absent/unparsable
 */
export function parseRetryAfter(value, capMs = RETRY_DEFAULTS.retryAfterCapMs) {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    if (trimmed === '') return null;
    let ms;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
        ms = parseFloat(trimmed) * 1000;
    } else {
        const date = Date.parse(trimmed);
        if (Number.isNaN(date)) return null;
        ms = date - Date.now();
    }
    return Math.round(Math.min(capMs, Math.max(0, ms)));
}

// setTimeout as a promise, rejected with the signal's reason on abort.
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
