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

// Normalized representation of the token usage every API provider reports under a
// different shape. Like api-utils.js, this module must stay free of any
// WebExtension or DOM dependency: it is imported by the API classes and by the
// Web Workers in js/workers/.
//
// The null / 0 distinction is the whole point of this layer and matters all the
// way down to the UI:
//   null -> the provider does not expose this metric at all
//   0    -> the provider reported zero
// A missing value is therefore NEVER coerced to 0.
//
// Display helpers deliberately live elsewhere: this module only normalizes.

// Every numeric field of a usage object, in the order the UI will want them.
// Exported so a consumer can iterate the metrics without hardcoding the list.
export const USAGE_NUMERIC_FIELDS = [
    'input_tokens',
    'output_tokens',
    'total_tokens',
    'cached_input_tokens',
    'cache_creation_tokens',
    'reasoning_tokens',
    'tokens_per_second',
];

/**
 * Coerce a raw provider value to a usage number, or to null.
 *
 * Anything that is not a finite number -- undefined, null, NaN, Infinity, a
 * string, an object -- becomes null, i.e. "not reported". A real 0 survives.
 *
 * @param {*} value the raw value read from a provider payload
 * @returns {number|null}
 */
export function toUsageNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return value;
}

/**
 * Build a normalized usage object.
 *
 * Every field missing from `fields` defaults to null. When total_tokens is not
 * reported but both input_tokens and output_tokens are numbers, the total is
 * computed from them; otherwise it stays null (a partial sum would be a lie).
 *
 * @param {object} fields the known values, using the normalized field names
 * @returns {object} the normalized usage object
 */
export function createUsageData(fields = {}) {
    const src = (fields !== null && typeof fields === 'object') ? fields : {};

    const input_tokens = toUsageNumber(src.input_tokens);
    const output_tokens = toUsageNumber(src.output_tokens);
    let total_tokens = toUsageNumber(src.total_tokens);

    if (total_tokens === null && input_tokens !== null && output_tokens !== null) {
        total_tokens = input_tokens + output_tokens;
    }

    return {
        provider: typeof src.provider === 'string' ? src.provider : '',
        model: typeof src.model === 'string' && src.model !== '' ? src.model : null,
        input_tokens: input_tokens,
        output_tokens: output_tokens,
        total_tokens: total_tokens,
        cached_input_tokens: toUsageNumber(src.cached_input_tokens),
        cache_creation_tokens: toUsageNumber(src.cache_creation_tokens),
        reasoning_tokens: toUsageNumber(src.reasoning_tokens),
        tokens_per_second: toUsageNumber(src.tokens_per_second),
    };
}

/**
 * True when there is nothing worth showing: no object at all, or every numeric
 * field is null. An object carrying only a provider and a model is empty.
 *
 * @param {object|null|undefined} usage a normalized usage object
 * @returns {boolean}
 */
export function isUsageDataEmpty(usage) {
    if (usage === null || usage === undefined || typeof usage !== 'object') return true;
    return USAGE_NUMERIC_FIELDS.every((field) => toUsageNumber(usage[field]) === null);
}

/**
 * Merge two partial usage objects, with the non-null values of `b` winning.
 *
 * Needed by Anthropic above all, where the input tokens arrive in message_start
 * and the output tokens only later, in message_delta.
 *
 * total_tokens is recomputed rather than merged: a total carried over from a
 * partial object would contradict the merged input/output pair. An explicitly
 * reported total still wins, because createUsageData() only computes the sum
 * when no total was given.
 *
 * @param {object|null} a the accumulated usage, possibly null
 * @param {object|null} b the new partial usage, possibly null
 * @returns {object|null} the merged object, or null when both sides are unusable
 */
export function mergeUsageData(a, b) {
    const left = (a !== null && a !== undefined && typeof a === 'object') ? a : null;
    const right = (b !== null && b !== undefined && typeof b === 'object') ? b : null;

    if (left === null && right === null) return null;
    if (left === null) return createUsageData(right);
    if (right === null) return createUsageData(left);

    const merged = {
        provider: (typeof right.provider === 'string' && right.provider !== '') ? right.provider : left.provider,
        model: (typeof right.model === 'string' && right.model !== '') ? right.model : left.model,
    };

    for (const field of USAGE_NUMERIC_FIELDS) {
        const right_value = toUsageNumber(right[field]);
        merged[field] = (right_value !== null) ? right_value : toUsageNumber(left[field]);
    }

    // Dropped on purpose so createUsageData() recomputes it from the merged
    // input/output pair, unless one of the two sides actually reported a total.
    const reported_total = (toUsageNumber(right.total_tokens) !== null) || (toUsageNumber(left.total_tokens) !== null);
    if (!reported_total) {
        merged.total_tokens = null;
    }

    return createUsageData(merged);
}
