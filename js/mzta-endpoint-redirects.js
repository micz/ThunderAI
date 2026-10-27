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
//   { to: '<destination>' | '', failed: boolean, at: <timestamp> }
// `to` is empty when the destination cannot be known (a redirect found by the probe of
// js/api/api-retry.js). The outcome comes from the API classes' redirect_info.
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
 * The destination stored for a redirect: the origin of the final address, or the
 * whole final address when the redirect stayed on the configured origin (a redirect
 * of the path only). '' when the final address is unknown or not an http(s) URL.
 * Never a user name or a password.
 *
 * @param {string} host the configured host
 * @param {string} finalUrl response.url
 */
export function redirectTarget(host, finalUrl) {
    let url;
    try {
        url = new URL(String(finalUrl ?? ''));
    } catch (e) {
        return '';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.username = '';
    url.password = '';
    const configured = parseEndpoint(normalizeEndpointHost(host));
    return configured.ok && configured.url.origin === url.origin ? url.href : url.origin;
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
    return { to: typeof entry.to === 'string' ? entry.to : '', failed: entry.failed === true, at: entry.at };
}

/**
 * Save the redirect outcome of a request (an API class's redirect_info):
 * - {redirected: true, url, failed} stores the entry of the host;
 * - {redirected: false}, a success with no redirect, removes it: the server no longer
 *   redirects, so the warning must not stay;
 * - null or anything else changes nothing.
 * The storage is written only when the entry really changes: every chat message
 * reports an outcome. A host that is not a usable address (credentials in it, an
 * invalid URL) is never stored. Never throws: a storage failure only loses the warning.
 *
 * @param {string} host the configured host
 * @param {{redirected: boolean, url?: string, failed?: boolean}|null} info
 */
export async function saveEndpointRedirect(host, info) {
    if (info === null || typeof info !== 'object' || typeof info.redirected !== 'boolean') return;
    const key = normalizeEndpointHost(host);
    if (!parseEndpoint(key).ok) return;
    try {
        const all = await readAll();
        const current = all[key];
        if (info.redirected) {
            const to = redirectTarget(key, info.url);
            const failed = info.failed === true;
            if (current && current.to === to && current.failed === failed) return;
            all[key] = { to, failed, at: Date.now() };
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
