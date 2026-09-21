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

// Display layer for the token usage. The normalization lives in
// js/api/mzta-api-usage.js, which must stay DOM-free; everything that turns a
// usage object into something on screen is here.
//
// The null / 0 distinction from that module is carried all the way through: a
// null field is omitted entirely, a 0 is printed. Nothing here ever coerces one
// into the other, in the compact line or in the tooltip.

import { USAGE_NUMERIC_FIELDS, toUsageNumber } from '../js/api/mzta-api-usage.js';

// Marks every element that is usage chrome rather than answer content. The
// helpers that read an answer out of the DOM use it to exclude the badge -- see
// stripUsageNodes() below and its callers in messagesArea.js.
export const USAGE_MARKER_ATTR = 'data-mzta-usage';

// The class the badge carries, for styling and for the selection scrub.
export const USAGE_BADGE_CLASS = 'mzta-usage-badge';

// Locale-aware thousands separator, the same way the rest of the UI formats
// dates: the browser locale, not a hardcoded one.
function formatCount(value) {
    return Number(value).toLocaleString();
}

// The compact line: "↑ 1,234 · ↓ 567 · Σ 1,801", with the arrows standing in
// for input/output and Σ for the total. Only the three headline metrics appear
// here; everything else lives in the tooltip. A field reported as null is left
// out completely, so a provider that reports only a total shows only "Σ …".
function buildCompactText(usage) {
    const parts = [];
    const input = toUsageNumber(usage.input_tokens);
    const output = toUsageNumber(usage.output_tokens);
    const total = toUsageNumber(usage.total_tokens);
    if (input !== null) parts.push('\u2191 ' + formatCount(input));
    if (output !== null) parts.push('\u2193 ' + formatCount(output));
    if (total !== null) parts.push('\u03A3 ' + formatCount(total));
    return parts.join('  \u00B7  ');
}

// i18n label per normalized field, in the order the tooltip lists them.
const TOOLTIP_FIELDS = [
    ['input_tokens', 'apiwebchat_usage_input'],
    ['output_tokens', 'apiwebchat_usage_output'],
    ['total_tokens', 'apiwebchat_usage_total'],
    ['cached_input_tokens', 'apiwebchat_usage_cached_input'],
    ['cache_creation_tokens', 'apiwebchat_usage_cache_creation'],
    ['reasoning_tokens', 'apiwebchat_usage_reasoning'],
    ['tokens_per_second', 'apiwebchat_usage_tokens_per_second'],
];

// The full detail, one metric per line, for the title attribute. The model heads
// the list when the provider named it; null metrics are skipped, exactly as in
// the compact line.
function buildTooltipText(usage) {
    const lines = [];
    if (typeof usage.model === 'string' && usage.model !== '') {
        lines.push(browser.i18n.getMessage('apiwebchat_usage_model') + ': ' + usage.model);
    }
    for (const [field, labelKey] of TOOLTIP_FIELDS) {
        const value = toUsageNumber(usage[field]);
        if (value === null) continue;
        lines.push(browser.i18n.getMessage(labelKey) + ': ' + formatCount(value));
    }
    return lines.join('\n');
}

/**
 * Build the per-message usage badge, or null when there is nothing to show.
 *
 * The caller appends it AFTER the assistant message body container, never inside
 * it: the badge is not part of the answer and must not be reachable by anything
 * that reads the answer back out of the DOM.
 *
 * @param {object} usage a normalized usage object
 * @returns {HTMLElement|null}
 */
export function buildUsageBadge(usage) {
    const text = buildCompactText(usage);
    if (text === '') return null;

    const badge = document.createElement('div');
    badge.classList.add(USAGE_BADGE_CLASS);
    // Both the attribute and the class are set: the attribute is the contract
    // stripUsageNodes() keys off, the class is what the stylesheet targets.
    badge.setAttribute(USAGE_MARKER_ATTR, '1');
    // Not part of the document's reading order: a screen reader announcing a
    // token count after every answer would be noise, and the same information is
    // on the element's own label for anyone who asks for it.
    badge.setAttribute('aria-label', browser.i18n.getMessage('apiwebchat_usage_label'));
    badge.textContent = text;
    const tooltip = buildTooltipText(usage);
    if (tooltip !== '') badge.title = tooltip;
    return badge;
}

/**
 * The compact line and the tooltip for the session total shown in the header.
 *
 * @param {object} totals a usage-shaped object holding the session sums
 * @returns {{text: string, tooltip: string}}
 */
export function buildSessionTotalText(totals) {
    // tokens_per_second is dropped before the tooltip is built: it is a rate, and
    // the sum of the per-turn rates is a number with no meaning. Every other field
    // is a count and adds up correctly. The compact line never showed it anyway.
    const shown = { ...totals, tokens_per_second: null };
    return {
        text: buildCompactText(shown),
        tooltip: buildTooltipText(shown),
    };
}

/**
 * Add one response's usage into the running session totals.
 *
 * A provider that reports null for a field keeps contributing null to that
 * field's running sum until some response actually reports it: null is "not
 * reported", never 0, so treating it as 0 would silently understate a total that
 * looks authoritative. Once any response reports a number, later nulls are
 * skipped rather than resetting the sum.
 *
 * `totals` is mutated and returned.
 *
 * @param {object} totals a usage-shaped object of running sums
 * @param {object} usage the normalized usage of one response
 * @returns {object} the same `totals`
 */
export function addUsageToTotals(totals, usage) {
    for (const field of USAGE_NUMERIC_FIELDS) {
        const value = toUsageNumber(usage[field]);
        if (value === null) continue;
        const running = toUsageNumber(totals[field]);
        totals[field] = (running === null) ? value : running + value;
    }
    return totals;
}

/**
 * A fresh session-total accumulator: every field null, i.e. "nothing reported
 * yet". Called when a chat window opens, so totals never leak between chats.
 *
 * tokens_per_second is part of the object for shape consistency with a usage
 * object, but buildSessionTotalText() drops it before display: summing a rate
 * across turns is meaningless.
 *
 * @returns {object}
 */
export function createSessionTotals() {
    const totals = {};
    for (const field of USAGE_NUMERIC_FIELDS) {
        totals[field] = null;
    }
    totals.model = null;
    return totals;
}
