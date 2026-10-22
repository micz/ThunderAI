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

// Sender-based result cache for the batch features.
// The AI verdict/tags of a mail is stored per sender address, so further mails
// from the same sender are processed without another AI call (one prompt per
// sender instead of one per mail). Data is kept in browser.storage.local.

const CACHE_KEY = 'sender_cache';
const MAX_ENTRIES = 500;
export const SENDER_CACHE_TTL_DAYS = 30;

const _latestDecision = (entry) => Math.max(
    entry.spam?.decidedAt || 0,
    entry.tags?.decidedAt || 0,
);

async function _loadCache() {
    const res = await browser.storage.local.get({ [CACHE_KEY]: {} });
    return res[CACHE_KEY] || {};
}

async function _saveCache(cache) {
    // Keep only the most recently updated MAX_ENTRIES senders.
    const entries = Object.entries(cache);
    entries.sort((a, b) => _latestDecision(b[1]) - _latestDecision(a[1]));
    await browser.storage.local.set({ [CACHE_KEY]: Object.fromEntries(entries.slice(0, MAX_ENTRIES)) });
}

/**
 * Returns the cached data for a sender, or null when absent/expired.
 * @param {string} senderEmail - the sender address (case-insensitive)
 * @param {'spam'|'tags'} kind - which kind of cached result to look up
 * @param {object} options
 * @param {number} options.ttl_days - maximum age of the entry in days
 */
export async function getCachedSenderData(senderEmail, kind, { ttl_days = SENDER_CACHE_TTL_DAYS } = {}) {
    if (!senderEmail || !kind) return null;
    const cache = await _loadCache();
    const entry = cache[senderEmail.toLowerCase()];
    if (!entry || !entry[kind]) return null;
    const age = Date.now() - (entry[kind].decidedAt || 0);
    if (age > ttl_days * 24 * 60 * 60 * 1000) return null;
    return entry[kind];
}

/**
 * Stores data for a sender (overwrites any previous entry of the same kind).
 * @param {string} senderEmail - the sender address (case-insensitive)
 * @param {'spam'|'tags'} kind - which kind of result to store
 * @param {object} data - the result data (e.g. { spamValue, explanation } or { tags })
 */
export async function setCachedSenderData(senderEmail, kind, data) {
    if (!senderEmail || !kind || !data) return;
    const cache = await _loadCache();
    const key = senderEmail.toLowerCase();
    const entry = cache[key] || {};
    entry[kind] = { ...data, decidedAt: Date.now() };
    cache[key] = entry;
    await _saveCache(cache);
}

/** Empties the whole sender cache. */
export async function clearSenderCache() {
    await browser.storage.local.set({ [CACHE_KEY]: {} });
}
