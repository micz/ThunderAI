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

// Idle timeout for the streaming loops of the API workers (#999).
// fetchWithRetry() times each attempt only until the response headers arrive, so
// a server that goes silent in the middle of the answer would leave the worker
// waiting on reader.read() for ever. Like api-retry.js, this module must stay
// free of any WebExtension or DOM dependency: it runs inside the Web Workers.

// Generous on purpose: a reasoning model, or Ollama loading a model, can stay
// silent for a long time while still working.
export const STREAM_IDLE_TIMEOUT_DEFAULT_MS = 120000;

/**
 * The api_stream_idle_timeout preference as a usable value: a non-negative number
 * of ms, 0 meaning "no idle timeout". Anything else (not a number, negative,
 * not finite, missing) falls back to STREAM_IDLE_TIMEOUT_DEFAULT_MS.
 */
export function resolveIdleTimeoutMs(value) {
    if (typeof value === 'string' && value.trim() !== '') value = Number(value);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return STREAM_IDLE_TIMEOUT_DEFAULT_MS;
    }
    return Math.floor(value);
}

/**
 * A resettable timer that calls onIdle() once, after timeoutMs without a touch().
 * With timeoutMs 0 it never fires.
 *   start() - arm it (again)
 *   touch() - push the deadline back; does nothing once stopped or fired
 *   stop()  - disarm it for good (until the next start())
 *   fired   - true once onIdle() was called
 */
export function createIdleTimer(timeoutMs, onIdle) {
    let timer = null;
    let fired = false;
    const arm = () => {
        clearTimeout(timer);
        timer = null;
        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                timer = null;
                fired = true;
                onIdle();
            }, timeoutMs);
        }
    };
    return {
        start: arm,
        touch() {
            if (timer !== null) arm();
        },
        stop() {
            clearTimeout(timer);
            timer = null;
        },
        get fired() {
            return fired;
        },
    };
}

/** The abort reason of a stream cut by the idle timeout, kept apart from a user Stop. */
export function idleTimeoutReason(timeoutMs) {
    return new DOMException("No data received for " + Math.round(timeoutMs / 1000) + " s", 'IdleTimeoutError');
}

/**
 * The user-visible text of an idle timeout, from the error_stream_idle_timeout
 * string the worker received with the literal $SECONDS$ (a worker has no browser.i18n).
 */
export function idleTimeoutMessage(i18nStrings, timeoutMs) {
    return String(i18nStrings?.error_stream_idle_timeout ?? '').replace('$SECONDS$', String(Math.round(timeoutMs / 1000)));
}
