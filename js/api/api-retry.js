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
    // Longest wait the server may ask for (Retry-After, Gemini's RetryInfo). A per-minute
    // window can need up to ~60 s; a longer request means the limit will not clear
    // soon (hourly/daily quota), so the retries stop and the 429 is returned at once.
    retryAfterCapMs: 60000,
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
 * A failure that retrying cannot fix is returned at once instead: a 429 whose
 * body reports a used-up quota or spend limit (see classifyRateLimitBody()), or
 * any response asking for a wait longer than retryAfterCapMs.
 *
 * Redirects are followed. A caller that passes onRedirect (the custom endpoints,
 * Ollama and OpenAI Compatible) is told the redirect outcome of the call (see
 * checkRedirected()); for it a followed redirect that ends in an error, and a
 * network failure that answersWithRedirect() finds to be a redirect (asked once
 * per call, before the first retry), throw a RedirectFailedError at once, with
 * no retry.
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
 *   onRedirect - the custom endpoints only: called with the redirect outcome of the
 *             call, see checkRedirected()
 *   logger  - a taLogger
 *   label   - provider name used in the log lines
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, retryConfig = {}) {
    const cfg = { ...RETRY_DEFAULTS, ...retryConfig };
    const { signal, onRetry, onRedirect, label = 'API' } = cfg;
    const logger = cfg.logger || defaultLogger;
    const maxRetries = Math.max(0, parseInt(cfg.maxRetries) || 0);
    let lastError = null;
    let probed = false;

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
            clearTimeout(timer);
            if (signal?.aborted) throw error;
            const timedOut = timeoutCtrl.signal.aborted;
            lastError = timedOut ? timeoutCtrl.signal.reason : error;
            // A redirect that could not be followed (a target that is unreachable or does
            // not allow CORS) looks like any network failure. Asked once per call: a
            // redirect will not go away by retrying, so it ends the request at once.
            if (typeof onRedirect === 'function' && !timedOut && !probed) {
                probed = true;
                if (await answersWithRedirect(url, signal)) {
                    logger.log(label + " request failed: the server answered with a redirect that could not be followed");
                    reportRedirect(onRedirect, { redirected: true, url: '', failed: true }, logger);
                    throw new RedirectFailedError();
                }
                if (signal?.aborted) throw signal.reason;
            }
            if (attempt === maxRetries) throw lastError;
            reason = timedOut ? 'timeout' : 'network';
        } finally {
            clearTimeout(timer);
        }

        let retryAfterMs = null;
        let serverBody = '';
        let serverMessage = '';
        if (response !== null) {
            if (typeof onRedirect === 'function') checkRedirected(response, onRedirect, logger, label);
            if (!RETRYABLE_STATUSES.includes(response.status) || attempt === maxRetries) {
                return response;
            }
            let bodyInfo = { terminal: false, reason: '', retryAfterMs: null, text: null };
            if (response.status === 429) {
                bodyInfo = await inspectRateLimitBody(response);
                // A user abort errors the body, which the inspection reads as "no
                // information": it must end the request, not be reported as a retry.
                if (signal?.aborted) throw signal.reason;
                if (bodyInfo.terminal) {
                    logger.log(label + " request failed (HTTP 429, " + bodyInfo.reason + "), not retrying: waiting cannot help");
                    return response;
                }
            }
            // The Retry-After header wins over the body's own hint.
            retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'), Infinity);
            if (retryAfterMs === null) retryAfterMs = bodyInfo.retryAfterMs;
            if (retryAfterMs !== null && retryAfterMs > cfg.retryAfterCapMs) {
                logger.log(label + " request failed (HTTP " + response.status + "), the server asks to wait "
                    + Math.round(retryAfterMs / 1000) + " s, more than " + Math.round(cfg.retryAfterCapMs / 1000) + " s: not retrying");
                // Non-standard expando: the workers forward it with the error, so the
                // user is told when the provider will accept requests again.
                response.retryAfterMs = retryAfterMs;
                return response;
            }
            // The caller never sees this response. With debug on its body is read for
            // the log lines: the server's own explanation ("The model is overloaded")
            // and the whole body; reading it to the end also releases the connection.
            // With debug off nothing would show them, so it is cancelled at once.
            // A 429 body was already read through its clone: that text is reused,
            // so a stalled 429 waits for the read limit once, not twice.
            if (bodyInfo.text !== null) {
                response.body?.cancel().catch(() => {});
                if (logger.do_debug === true) serverBody = bodyInfo.text;
            } else if (logger.do_debug === true) {
                serverBody = await readResponseBody(response);
                if (signal?.aborted) throw signal.reason;
            } else {
                response.body?.cancel().catch(() => {});
            }
            serverMessage = extractErrorMessage(serverBody);
        }

        const delayMs = retryAfterMs !== null ? retryAfterMs : backoffDelay(attempt, cfg);
        const status = response !== null ? response.status : null;

        logger.log(label + " request failed (" + (status !== null ? "HTTP " + status : reason)
            + (lastError && response === null ? ": " + lastError : "")
            + "), retry " + (attempt + 1) + " of " + maxRetries + " in " + delayMs + " ms"
            + (retryAfterMs !== null ? " (asked by the server)" : "")
            + (serverMessage ? " - server message: " + serverMessage : ""));
        if (serverBody) {
            logger.log(label + " response body: " + serverBody);
        }

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
 * Thrown, for a caller that tracks redirects (onRedirect), instead of the network
 * error or the error response when the request failed because of a redirect: one
 * that could not be followed, or one that ended in an error (a 301/302 turns the
 * POST into a GET with no body, which the final server rejects). The provider
 * classes flag their error result with is_redirect (see isRedirectFailed()), so
 * the user is told to enter the final address instead of a meaningless error.
 */
export class RedirectFailedError extends Error {
    constructor() {
        super("the server answered with a redirect that could not be followed: use the final URL directly");
        this.name = 'RedirectFailedError';
    }
}

export function isRedirectFailed(error) {
    return error instanceof RedirectFailedError;
}

// Hand the redirect outcome of a call to the caller's onRedirect. A failing callback
// never breaks the request.
function reportRedirect(onRedirect, info, logger) {
    try {
        onRedirect(info);
    } catch (e) {
        logger.warn("onRedirect callback failed: " + e);
    }
}

/**
 * The redirect outcome of a response, reported through onRedirect:
 * - {redirected: true, url, failed} when fetch() followed a redirect, url being the
 *   final address (response.url) and failed telling whether the answer is an error;
 *   an error throws a RedirectFailedError, as retrying cannot help;
 * - {redirected: false} for a success with no redirect: the server no longer
 *   redirects;
 * - nothing for an error with no redirect, which says nothing either way.
 * The probe of answersWithRedirect() reports {redirected: true, url: '', failed: true}.
 */
function checkRedirected(response, onRedirect, logger, label) {
    if (response.redirected === true) {
        reportRedirect(onRedirect, { redirected: true, url: response.url || '', failed: !response.ok }, logger);
        if (!response.ok) {
            response.body?.cancel().catch(() => {});
            logger.log(label + " request failed (HTTP " + response.status + " after a redirect): the redirect could not be followed");
            throw new RedirectFailedError();
        }
    } else if (response.ok) {
        reportRedirect(onRedirect, { redirected: false }, logger);
    }
}

// Longest wait for the redirect check of answersWithRedirect().
const REDIRECT_PROBE_TIMEOUT_MS = 2000;

/**
 * Whether the URL answers with a redirect. A redirect fetch() could not follow (a
 * target that is unreachable, or that does not allow CORS) rejects with the same
 * TypeError as an unreachable server, so after such a failure the URL is asked
 * again, this time as a bare GET: no headers (no API key), no body (no email
 * content), no credentials, and redirect: 'manual', so the redirect is reported and
 * not followed. A browser reports it as an 'opaqueredirect' response.
 * Never throws: any failure, timeout or other answer means "not a redirect".
 */
export async function answersWithRedirect(url, signal = null) {
    const probeCtrl = new AbortController();
    const timer = setTimeout(() => probeCtrl.abort(), REDIRECT_PROBE_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'manual',
            credentials: 'omit',
            cache: 'no-store',
            signal: signal ? AbortSignal.any([signal, probeCtrl.signal]) : probeCtrl.signal,
        });
        response.body?.cancel().catch(() => {});
        return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
    } catch (e) {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * A single fetch() with no retry and no timeout, for the direct probes of Ollama
 * (/api/version, /api/show, /api/ps), with the same redirect tracking as
 * fetchWithRetry(): onRedirect is told the outcome, and a redirect that could not be
 * followed or ended in an error throws a RedirectFailedError.
 *
 * @param {string} url
 * @param {object} options the fetch() options
 * @param {{onRedirect: Function, logger?: object, label?: string}} redirectConfig
 */
export async function fetchDirect(url, options = {}, { onRedirect, logger = defaultLogger, label = 'API' } = {}) {
    let response;
    try {
        response = await fetch(url, options);
    } catch (error) {
        if (options.signal?.aborted || typeof onRedirect !== 'function') throw error;
        if (await answersWithRedirect(url, options.signal)) {
            logger.log(label + " request failed: the server answered with a redirect that could not be followed");
            reportRedirect(onRedirect, { redirected: true, url: '', failed: true }, logger);
            throw new RedirectFailedError();
        }
        throw error;
    }
    if (typeof onRedirect === 'function') checkRedirected(response, onRedirect, logger, label);
    return response;
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
 * Read a 429 body through a clone, so the Response itself stays unread for the
 * worker's error formatting. The read has the same limit as the log read
 * (readResponseBody()). Any read or parse failure, or a body that does not
 * arrive in time, means "no information": the 429 is then retried as before.
 * `text` is the body read ('' when it gave nothing), reused for the log lines.
 */
async function inspectRateLimitBody(response) {
    const text = await readResponseBody(response.clone());
    let info = { terminal: false, reason: '', retryAfterMs: null };
    try {
        info = classifyRateLimitBody(JSON.parse(text));
    } catch (e) {
        // Not JSON, or nothing read: no information.
    }
    return { ...info, text };
}

// Longest server message put in a retry log line, and longest wait for its body.
const SERVER_MESSAGE_MAX_LENGTH = 500;
const SERVER_BODY_READ_TIMEOUT_MS = 5000;

/**
 * Read a response body as text within SERVER_BODY_READ_TIMEOUT_MS: the body of a
 * response that is about to be retried (for the log lines, the 429 inspection),
 * and, in the workers, the body of an HTTP error before it is reported.
 * Never throws: an unreadable body, or one that does not arrive within
 * SERVER_BODY_READ_TIMEOUT_MS, gives '' (and its stream is cancelled).
 * Read through its own reader rather than response.text(): text() locks the
 * stream, and a locked stream cannot be cancelled from outside.
 */
export async function readResponseBody(response) {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const readAll = async () => {
        let text = '';
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return text + decoder.decode();
            text += decoder.decode(value, { stream: true });
        }
    };
    let timer;
    try {
        return await Promise.race([
            readAll(),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('timeout')), SERVER_BODY_READ_TIMEOUT_MS);
            }),
        ]);
    } catch (e) {
        reader.cancel().catch(() => {});
        return '';
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The human-readable part of an error body: error.message (OpenAI, Anthropic,
 * Gemini, also array-wrapped), a string error (Ollama), a top-level message,
 * otherwise the raw text (an HTML page from a proxy, plain text), with the
 * whitespace collapsed and cut at SERVER_MESSAGE_MAX_LENGTH.
 */
export function extractErrorMessage(text) {
    let message = String(text ?? '');
    try {
        const parsed = JSON.parse(message);
        const body = Array.isArray(parsed) ? parsed[0] : parsed;
        const error = body?.error;
        if (typeof error === 'string') {
            message = error;
        } else if (typeof error?.message === 'string') {
            message = error.message;
        } else if (typeof body?.message === 'string') {
            message = body.message;
        }
    } catch (e) {
        // Not JSON: the raw text is used.
    }
    message = message.replace(/\s+/g, ' ').trim();
    return message.length > SERVER_MESSAGE_MAX_LENGTH
        ? message.slice(0, SERVER_MESSAGE_MAX_LENGTH) + '...'
        : message;
}

/**
 * Tell a 429 that clears in seconds (per-minute rate limit) from one that
 * retrying cannot fix before the quota resets. Recognised bodies:
 * - OpenAI (and compatible servers): error.code 'insufficient_quota' (no credit
 *   or monthly budget reached); 'rate_limit_exceeded' is the transient one.
 * - Anthropic: error.details.error_code 'enforced_spend_limit_reached' (monthly
 *   spend cap; it comes without a retry-after header).
 * - Google Gemini: a google.rpc.QuotaFailure detail whose quotaId names a daily
 *   window (e.g. GenerateRequestsPerDayPerProjectPerModel-FreeTier). The
 *   RetryInfo.retryDelay sent with it is just a few seconds, so it is not trusted
 *   there; for the other quotas it is returned as the wait.
 *
 * @returns {{terminal: boolean, reason: string, retryAfterMs: number|null}}
 */
export function classifyRateLimitBody(body) {
    const result = { terminal: false, reason: '', retryAfterMs: null };
    // Some Gemini endpoints wrap the error object in an array.
    const error = (Array.isArray(body) ? body[0] : body)?.error;
    if (!error || typeof error !== 'object') return result;

    if (error.code === 'insufficient_quota') {
        return { ...result, terminal: true, reason: 'insufficient_quota' };
    }
    if (error.details?.error_code === 'enforced_spend_limit_reached') {
        return { ...result, terminal: true, reason: 'enforced_spend_limit_reached' };
    }
    if (Array.isArray(error.details)) {
        for (const detail of error.details) {
            const type = String(detail?.['@type'] || '');
            if (type.endsWith('google.rpc.QuotaFailure') && Array.isArray(detail.violations)) {
                const daily = detail.violations.find(v => /PerDay|Daily/i.test(String(v?.quotaId || '')));
                if (daily) {
                    return { ...result, terminal: true, reason: 'daily quota ' + daily.quotaId };
                }
            }
            if (type.endsWith('google.rpc.RetryInfo')) {
                // A protobuf Duration in its JSON form: "34s", "34.07s".
                const m = /^(\d+(?:\.\d+)?)s$/.exec(String(detail.retryDelay || '').trim());
                if (m) result.retryAfterMs = Math.round(parseFloat(m[1]) * 1000);
            }
        }
    }
    return result;
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
