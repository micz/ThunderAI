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

// The rules a custom API endpoint (Ollama, OpenAI Compatible) must follow before
// any request is sent to it [#1000]:
//  - only http: and https: URLs;
//  - no user name or password in the URL;
//  - plain http: only to a loopback host, or to an origin the user approved
//    (js/mzta-endpoint-approvals.js keeps that list).
//
// Pure functions, with no WebExtension or DOM dependency: the API classes in js/api/
// call them inside the Web Workers too. Nothing here ever logs a URL.
//
// The approach (an allowlist of approved http: origins, the loopback rule, refusing
// credentials in the URL) follows Pedro Madruga's endpoint policy in his ThunderAI fork,
// https://github.com/pmadruga/thunderai-sidebar/blob/12255dfc75a1b6eeeb0ab92e90865c14c29ee796/js/endpoint-policy.js
// (GPL-3.0), adapted to this codebase.

export const ENDPOINT_PROBLEM = {
    INVALID: 'invalid',          // empty, or not a URL at all
    SCHEME: 'scheme',            // a URL, but neither http: nor https:
    CREDENTIALS: 'credentials',  // a user name or a password in the URL
    INSECURE: 'insecure',        // http: to a non-loopback host not yet approved
};

/**
 * Parse an endpoint as typed in a host field.
 *
 * @param {string} value
 * @returns {{ok: true, url: URL} | {ok: false, problem: string}} problem is one of
 *   ENDPOINT_PROBLEM.INVALID, SCHEME or CREDENTIALS
 */
export function parseEndpoint(value) {
    const text = String(value ?? '').trim();
    if (text === '') return { ok: false, problem: ENDPOINT_PROBLEM.INVALID };
    let url;
    try {
        url = new URL(text);
    } catch (e) {
        return { ok: false, problem: ENDPOINT_PROBLEM.INVALID };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, problem: ENDPOINT_PROBLEM.SCHEME };
    }
    if (url.username !== '' || url.password !== '') {
        return { ok: false, problem: ENDPOINT_PROBLEM.CREDENTIALS };
    }
    return { ok: true, url };
}

/**
 * True for a host that can only be this machine: localhost (any case, with or
 * without the trailing dot), any 127.0.0.0/8 address, and ::1 (with or without
 * the brackets URL.hostname keeps). 0.0.0.0, the private LAN ranges and *.local
 * are other machines, or may be: they are not loopback.
 *
 * @param {string} hostname a URL.hostname
 */
export function isLoopbackHost(hostname) {
    let host = String(hostname ?? '').trim().toLowerCase();
    if (host.endsWith('.')) host = host.slice(0, -1);
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
    if (host === 'localhost' || host === '::1') return true;
    const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    return m !== null && m.slice(1).every(n => Number(n) <= 255);
}

/**
 * True when the endpoint is a valid http: URL to a host that is not loopback: the
 * requests would travel unencrypted to another machine, which the user has to
 * accept first. False for anything else, an unusable URL included (parseEndpoint()
 * says why that one cannot be used).
 *
 * @param {string|URL} value
 */
export function needsInsecureConfirmation(value) {
    const parsed = parseEndpoint(value instanceof URL ? value.href : value);
    return parsed.ok && parsed.url.protocol === 'http:' && !isLoopbackHost(parsed.url.hostname);
}

/**
 * The origin an approval is stored under, or '' when the value is not a usable URL.
 *
 * @param {string} value
 */
export function endpointOrigin(value) {
    const parsed = parseEndpoint(value);
    return parsed.ok ? parsed.url.origin : '';
}

/**
 * Whether a request may be sent to this endpoint.
 *
 * @param {string} value the host as configured
 * @param {string[]} approvedOrigins the approved http: origins (URL.origin form)
 * @returns {{ok: true, url: URL} | {ok: false, problem: string, origin: string}}
 *   origin is set for ENDPOINT_PROBLEM.INSECURE only, so the caller can ask about it
 */
export function checkEndpoint(value, approvedOrigins = []) {
    const parsed = parseEndpoint(value);
    if (!parsed.ok) return { ok: false, problem: parsed.problem, origin: '' };
    const url = parsed.url;
    if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)
        && !(Array.isArray(approvedOrigins) && approvedOrigins.includes(url.origin))) {
        return { ok: false, problem: ENDPOINT_PROBLEM.INSECURE, origin: url.origin };
    }
    return { ok: true, url };
}

/**
 * The text with the user name and password of every URL in it masked, for a log line:
 * a host field may hold an address with credentials, which are never logged.
 *
 * @param {string} text a URL, or any text holding one (a JSON-encoded value)
 */
export function maskUrlCredentials(text) {
    return String(text).replace(/(\/\/)[^\/?#@\s"']*@/g, '$1****@');
}

// English text of a problem, for the API classes' error results: a Web Worker has no
// browser.i18n. The pages and the background show the localized messages of
// js/mzta-endpoint-approvals.js instead, before a request is ever attempted.
export function endpointProblemText(problem) {
    switch (problem) {
        case ENDPOINT_PROBLEM.SCHEME:
            return 'the server address must start with http:// or https://';
        case ENDPOINT_PROBLEM.CREDENTIALS:
            return 'the server address must not contain a user name or password';
        case ENDPOINT_PROBLEM.INSECURE:
            return 'the unencrypted (http://) connection to this server has not been confirmed in the ThunderAI settings';
        default:
            return 'the server address is not a valid URL';
    }
}
