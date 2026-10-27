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

// The redirects of the custom endpoints (Ollama, OpenAI Compatible) [#1000], kept in
// browser.storage.local so the connection panels can tell the user that the configured
// address redirects, and where to. One entry per configured host:
//   { to: '<destination>' | '', failed: boolean, method: 'POST' | 'GET' | '', at: <timestamp> }
// `to` is the address to enter instead (redirectTarget()), empty when it cannot be
// known (a redirect found by the probe of js/api/api-retry.js). `method` is the one of
// the request the entry comes from: a 301/302/303 turns a POST into a GET with no body
// and a 307/308 keeps it, and the code is never visible, so only a POST tells whether
// the chat works through the redirect. The outcome comes from the API classes'
// redirect_info.
//
// For the extension pages and the background only: a Web Worker forwards the outcome
// with an 'endpoint_redirect' message and its owner calls saveEndpointRedirect().

import { parseEndpoint } from './mzta-endpoint-policy.js';

// Leading underscore: not a preference (spec 05 "Overview").
export const ENDPOINT_REDIRECTS_KEY = '_endpoint_redirects';

/** A host as the API classes keep it: trimmed, with no trailing slashes. */
export function normalizeEndpointHost(host) {
    return String(host ?? '').trim().replace(/\/+$/, '');
}

/**
 * The destination stored for a redirect, the address to enter instead of the host:
 * - another server: the origin of the final address;
 * - the same server, another path: the new base address, i.e. the final address
 *   without the API path the class added to the host (requested
 *   http://h/api/version, answered from http://h/v2/api/version: http://h/v2), so
 *   it is the same whichever endpoint was called; when the final path does not end
 *   with that API path, the final address without its query;
 * - '' when the final address is unknown or not an http(s) URL, or is the host itself.
 * Never a user name or a password, never a query string.
 *
 * @param {string} host the configured host
 * @param {string} finalUrl response.url
 * @param {string} requestUrl the address requested ('' when unknown)
 */
export function redirectTarget(host, finalUrl, requestUrl = '') {
    let url;
    try {
        url = new URL(String(finalUrl ?? ''));
    } catch (e) {
        return '';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    const configured = parseEndpoint(normalizeEndpointHost(host));
    if (!configured.ok || configured.url.origin !== url.origin) return url.origin;
    const hostPath = configured.url.pathname.replace(/\/+$/, '');
    let path = url.pathname;
    let requested = null;
    try {
        requested = new URL(String(requestUrl ?? ''));
    } catch (e) {
        // Unknown: the final address is kept whole.
    }
    if (requested !== null && requested.pathname.startsWith(hostPath)) {
        const apiPath = requested.pathname.slice(hostPath.length);
        if (apiPath !== '' && apiPath !== '/' && path.endsWith(apiPath)) path = path.slice(0, -apiPath.length);
    }
    const target = url.origin + path.replace(/\/+$/, '');
    return target === url.origin + hostPath ? '' : target;
}

async function readAll() {
    const stored = await browser.storage.local.get({ [ENDPOINT_REDIRECTS_KEY]: {} });
    const all = stored[ENDPOINT_REDIRECTS_KEY];
    return (all !== null && typeof all === 'object' && !Array.isArray(all)) ? { ...all } : {};
}

/** The entry of a configured host, or null when it is not known to redirect. */
export async function getEndpointRedirect(host) {
    const entry = (await readAll())[normalizeEndpointHost(host)];
    if (entry === null || typeof entry !== 'object') return null;
    return {
        to: typeof entry.to === 'string' ? entry.to : '',
        failed: entry.failed === true,
        method: typeof entry.method === 'string' ? entry.method : '',
        at: entry.at,
    };
}

/**
 * Save the redirect outcome of a request (an API class's redirect_info):
 * - {redirected: true, failed: true}, a redirect that failed, stores the entry;
 * - {redirected: true, failed: false} from a POST stores it: the requests with a body
 *   survive the redirect (a 307/308);
 * - {redirected: true, failed: false} from any other method (a GET: the model list,
 *   the version) only tells where the server redirects, not whether a POST survives
 *   it: it never replaces a failure, nor a POST success to the same destination;
 * - {redirected: false}, a success with no redirect, removes it: the server no longer
 *   redirects, so the warning must not stay;
 * - null or anything else changes nothing.
 * The storage is written only when the entry really changes: every chat message
 * reports an outcome. A host that is not a usable address (credentials in it, an
 * invalid URL) is never stored. Never throws: a storage failure only loses the warning.
 *
 * @param {string} host the configured host
 * @param {{redirected: boolean, url?: string, from?: string, method?: string, failed?: boolean}|null} info
 */
export async function saveEndpointRedirect(host, info) {
    if (info === null || typeof info !== 'object' || typeof info.redirected !== 'boolean') return;
    const key = normalizeEndpointHost(host);
    if (!parseEndpoint(key).ok) return;
    try {
        const all = await readAll();
        const current = all[key];
        if (info.redirected) {
            const to = redirectTarget(key, info.url, info.from);
            const failed = info.failed === true;
            const method = typeof info.method === 'string' ? info.method.toUpperCase() : '';
            if (current && !failed && method !== 'POST'
                && (current.failed === true || (current.method === 'POST' && current.to === to))) return;
            if (current && current.to === to && current.failed === failed && current.method === method) return;
            all[key] = { to, failed, method, at: Date.now() };
        } else {
            if (current === undefined) return;
            delete all[key];
        }
        await browser.storage.local.set({ [ENDPOINT_REDIRECTS_KEY]: all });
    } catch (e) {
        console.warn("[ThunderAI] The endpoint redirect could not be saved: " + e);
    }
}

/** Forget the entry of a host: the user changed the address in its field. */
export async function clearEndpointRedirect(host) {
    try {
        const all = await readAll();
        const key = normalizeEndpointHost(host);
        if (all[key] === undefined) return;
        delete all[key];
        await browser.storage.local.set({ [ENDPOINT_REDIRECTS_KEY]: all });
    } catch (e) {
        console.warn("[ThunderAI] The endpoint redirect could not be removed: " + e);
    }
}
