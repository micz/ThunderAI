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

// Shared helpers for the API classes in this directory. This module must stay
// free of any WebExtension or DOM dependency: it is imported by the API classes,
// which in turn run inside the Web Workers in js/workers/.

/**
 * Parse a user-supplied JSON snippet used to extend an API request body.
 * The options UI only warns about invalid input without preventing the save, so
 * a malformed value can reach this point: the extra data is advisory and must
 * never break the request, hence the fallback to an empty object.
 * @param {string} extra_body The raw preference value.
 * @returns {object} The parsed JSON object, or {} if unusable.
 */
export function parseExtraBody(extra_body) {
    if (typeof extra_body !== 'string' || extra_body.trim() === '') return {};
    try {
        const parsed = JSON.parse(extra_body);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            console.warn("[ThunderAI] The extra body data is not a JSON object, it will be ignored.");
            return {};
        }
        return parsed;
    } catch (error) {
        console.warn("[ThunderAI] The extra body data is not valid JSON, it will be ignored: " + error);
        return {};
    }
}

// The request headers fetch() refuses to set: the forbidden request-header names of
// the Fetch standard (https://fetch.spec.whatwg.org/#forbidden-request-header), plus
// every name starting with `proxy-` or `sec-`. fetch() drops them silently, so an
// extra header among them would look accepted while never reaching the server.
const FORBIDDEN_REQUEST_HEADERS = new Set([
    'accept-charset', 'accept-encoding', 'access-control-request-headers',
    'access-control-request-method', 'connection', 'content-length', 'cookie',
    'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin', 'referer',
    'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'
]);

// An HTTP field name is a token (RFC 9110, section 5.1).
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Why one entry of a user-supplied extra headers object cannot be sent, or ''.
 * Shared by the request builders (parseExtraHeaders()), the advisory check of the
 * connection panel and the policy validation, so the three always agree.
 * @param {string} name The header name.
 * @param {*} value The header value.
 * @returns {string} '' | 'invalid_name' | 'forbidden' | 'not_string' | 'invalid_value'
 */
export function extraHeaderProblem(name, value) {
    if (!HTTP_TOKEN.test(name)) return 'invalid_name';
    const lower = name.toLowerCase();
    if (FORBIDDEN_REQUEST_HEADERS.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) return 'forbidden';
    // Strings only, never coerced: a number written without quotes is reported, so
    // what the user reads in the field is exactly what is sent.
    if (typeof value !== 'string') return 'not_string';
    // fetch() throws on these, which would fail the whole request.
    if (/[\0\r\n]/.test(value)) return 'invalid_value';
    return '';
}

/**
 * Parse a user-supplied JSON object of extra request headers. Same contract as
 * parseExtraBody(): the value is advisory and must never break the request, so
 * unusable input gives {}, and an unusable entry is dropped on its own.
 * The warnings name the header, never its value: it may carry a secret.
 * @param {string} extra_headers The raw preference value.
 * @returns {object} The usable headers, or {}.
 */
export function parseExtraHeaders(extra_headers) {
    if (typeof extra_headers !== 'string' || extra_headers.trim() === '') return {};
    let parsed;
    try {
        parsed = JSON.parse(extra_headers);
    } catch (error) {
        console.warn("[ThunderAI] The extra headers are not valid JSON, they will be ignored: " + error);
        return {};
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn("[ThunderAI] The extra headers are not a JSON object, they will be ignored.");
        return {};
    }
    const headers = {};
    for (const [name, value] of Object.entries(parsed)) {
        const problem = extraHeaderProblem(name, value);
        if (problem !== '') {
            console.warn("[ThunderAI] The extra header " + JSON.stringify(name) + " will be ignored (" + problem + ").");
            continue;
        }
        headers[name] = value;
    }
    return headers;
}

/**
 * The headers of a request: the extra ones first, then the ones ThunderAI manages on
 * top. Header names are case-insensitive, so an extra `authorization` neither replaces
 * nor duplicates a managed `Authorization`. A header ThunderAI does not send (no API
 * key, no Authorization) is free to come from the extra ones.
 * @param {object} extra The parsed extra headers (parseExtraHeaders()).
 * @param {object} managed The headers ThunderAI sets.
 * @returns {object} The merged headers.
 */
export function mergeHeaders(extra, managed) {
    const byName = new Map();
    for (const source of [extra, managed]) {
        for (const [name, value] of Object.entries(source || {})) {
            byName.set(name.toLowerCase(), [name, value]);
        }
    }
    return Object.fromEntries(byName.values());
}

// Header names that usually carry a credential: Authorization, Proxy-Authorization,
// X-API-Key, api-key, X-Auth-Token, X-Amz-Security-Token, X-Client-Secret...
const CREDENTIAL_HEADER = /auth|key|token|secret|passw|credential|signature|cookie/i;

/**
 * True when a header's value should be hidden wherever it would be shown, judged from
 * its name only. A heuristic for display: a credential under another name is not
 * caught, so it never replaces masking the values in the logs.
 * @param {string} name The header name.
 * @returns {boolean}
 */
export function isCredentialHeader(name) {
    return CREDENTIAL_HEADER.test(name);
}
