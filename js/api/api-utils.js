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
