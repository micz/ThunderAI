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

// The approved unencrypted endpoints [#1000]: the http: origins of non-loopback
// servers the user accepted, kept in browser.storage.local, plus the ones the
// enterprise policy configures (the administrator chose them, so the user is never
// asked about them). The rules themselves are in js/mzta-endpoint-policy.js.
//
// For the extension pages and the background only: a Web Worker gets the list in
// its init message (approved_insecure_origins) and never imports this module.

import { mztaManaged } from './mzta-managed.js';
import {
    ENDPOINT_PROBLEM,
    checkEndpoint,
    endpointOrigin
} from './mzta-endpoint-policy.js';

// Leading underscore: not a preference (spec 05 "Overview").
const STORAGE_KEY = '_approved_insecure_origins';

// The host fields an endpoint can come from: the global preferences, the per-feature
// connections and the prompts' own connection fields all use these names.
const HOST_FIELDS = ['ollama_host', 'openai_comp_host'];

function cleanOrigins(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.filter(o => typeof o === 'string' && o !== '' && endpointOrigin(o) === o))];
}

/** The origins the user approved, in the order they were approved. */
export async function getUserApprovedInsecureOrigins() {
    const stored = await browser.storage.local.get({ _approved_insecure_origins: [] });
    return cleanOrigins(stored[STORAGE_KEY]);
}

/** Remember the user's approval of an origin (a URL.origin). */
export async function approveInsecureOrigin(origin) {
    const list = await getUserApprovedInsecureOrigins();
    if (!list.includes(origin)) list.push(origin);
    await browser.storage.local.set({ [STORAGE_KEY]: cleanOrigins(list) });
}

/** Forget an approval: the next request to that origin is blocked until confirmed again. */
export async function revokeInsecureOrigin(origin) {
    const list = await getUserApprovedInsecureOrigins();
    await browser.storage.local.set({ [STORAGE_KEY]: list.filter(o => o !== origin) });
}

/**
 * The http: origins of every host the enterprise policy sets: the global host
 * preferences, the enforced per-feature connections and the organization prompts.
 */
async function getPolicyOrigins() {
    await mztaManaged.managedReady();
    const hosts = [];
    for (const field of HOST_FIELDS) {
        if (mztaManaged.hasManagedValue(field)) hosts.push(mztaManaged.getManagedValue(field));
    }
    for (const entry of Object.values(mztaManaged.getSpecialPromptsConnection() || {})) {
        for (const field of HOST_FIELDS) {
            const value = entry?.fields?.[field]?.value;
            if (value !== undefined) hosts.push(value);
        }
    }
    for (const prompt of mztaManaged.getOrgPrompts() || []) {
        for (const field of HOST_FIELDS) {
            if (prompt?.[field] !== undefined) hosts.push(prompt[field]);
        }
    }
    return hosts.map(h => endpointOrigin(h)).filter(o => o.startsWith('http:'));
}

/** Every origin a request may go to unencrypted: the user's approvals and the policy's hosts. */
export async function getApprovedInsecureOrigins() {
    return cleanOrigins([...await getUserApprovedInsecureOrigins(), ...await getPolicyOrigins()]);
}

/** The localized message of a problem found by checkEndpoint(). */
export function endpointProblemMessage(problem, origin = '') {
    switch (problem) {
        case ENDPOINT_PROBLEM.SCHEME:
            return browser.i18n.getMessage('endpoint_error_scheme');
        case ENDPOINT_PROBLEM.CREDENTIALS:
            return browser.i18n.getMessage('endpoint_error_credentials');
        case ENDPOINT_PROBLEM.INSECURE:
            return browser.i18n.getMessage('endpoint_insecure_not_confirmed', [origin]);
        default:
            return browser.i18n.getMessage('endpoint_error_invalid');
    }
}

/**
 * Check an endpoint before a request is sent to it.
 *
 * With `ask` (an explicit user action: "Test now" and "Update list" in the settings,
 * opening the API chat window) an unapproved unencrypted origin is asked about with a
 * confirmation dialog, and remembered when accepted. Without it (the background, the
 * notes under the host fields, the probes) the request is simply refused.
 * Nothing about the URL is logged here: it may carry a user name and password.
 *
 * @param {string} host the endpoint as configured
 * @param {{ask?: boolean}} options
 * @returns {Promise<{ok: true, approvedOrigins: string[]} | {ok: false, problem: string, message: string}>}
 *   approvedOrigins is what the API class (or the worker) must be given
 */
export async function resolveEndpointAccess(host, { ask = false } = {}) {
    let approvedOrigins = await getApprovedInsecureOrigins();
    const check = checkEndpoint(host, approvedOrigins);
    if (check.ok) return { ok: true, approvedOrigins };
    if (check.problem === ENDPOINT_PROBLEM.INSECURE && ask
        && window.confirm(browser.i18n.getMessage('endpoint_insecure_confirm', [check.origin]))) {
        await approveInsecureOrigin(check.origin);
        approvedOrigins = await getApprovedInsecureOrigins();
        return { ok: true, approvedOrigins };
    }
    return { ok: false, problem: check.problem, message: endpointProblemMessage(check.problem, check.origin) };
}
