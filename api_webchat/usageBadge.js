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
// Two levels, never duplicated:
//   per answer  -> a chip in the answer's action bar, with a detail popover
//   per session -> a meter above the input field (see messageInput.js)
//
// The guiding rule is "show only what exists": a null field is omitted entirely,
// never rendered as "0", "-" or "n/a". A reported 0 is printed. The duration is
// the one value that is always there, because the window measures it itself.

import { toUsageNumber } from '../js/api/mzta-api-usage.js';

// Marks every element that is usage chrome rather than answer content. The
// selection helpers in messagesArea.js key off it to scrub the chip and its
// popover out of any range the user drags across the transcript.
export const USAGE_MARKER_ATTR = 'data-mzta-usage';

// At or above this share of the context window the meter turns to the warning
// colour and suggests starting over.
const CONTEXT_WARN_PCT = 80;

// Locale-aware thousands separator, the same way the rest of the UI formats
// dates: the browser locale, not a hardcoded one.
function formatCount(value) {
    return Number(value).toLocaleString();
}

// "4.2 s" -- always one decimal, so the chip does not change width by a digit
// between two answers of similar length.
function formatDuration(durationMs) {
    return (durationMs / 1000).toLocaleString(undefined, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    }) + ' s';
}

function isDuration(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// Generation speed. Ollama reports its own rate, measured on the generation phase
// alone, which is more accurate than anything the window can derive, so it wins.
// Otherwise it is the output count over the wall-clock duration -- which includes
// the network and the prompt processing, so it is a floor, not the model's speed.
function tokensPerSecond(usage, durationMs) {
    const reported = toUsageNumber(usage?.tokens_per_second);
    if (reported !== null) return Math.round(reported);
    const output = toUsageNumber(usage?.output_tokens);
    if (output === null || !isDuration(durationMs) || durationMs === 0) return null;
    return Math.round(output / (durationMs / 1000));
}

// The chip text, first applicable of: total, output only, duration only.
function chipText(usage, durationMs) {
    const total = toUsageNumber(usage?.total_tokens);
    if (total !== null) {
        return browser.i18n.getMessage('apiwebchat_usage_chip_tokens', [formatCount(total)]);
    }
    const output = toUsageNumber(usage?.output_tokens);
    if (output !== null) {
        return browser.i18n.getMessage('apiwebchat_usage_chip_output_tokens', [formatCount(output)]);
    }
    return isDuration(durationMs) ? formatDuration(durationMs) : '';
}

// The popover rows, in display order, each one only if its value exists. The
// "of which" rows are subsets of the row above them: the extractors normalize
// every provider so that cached and cache-write tokens are part of the input and
// reasoning tokens are part of the output (see claude-spec/04-api-integrations.md).
//
// Returns [] when nothing but the duration is known: the chip is then static and
// there is no popover at all.
function popoverRows(usage, durationMs) {
    const rows = [];
    const add = (labelKey, value, kind = '') => {
        const n = toUsageNumber(value);
        if (n !== null) rows.push({ label: browser.i18n.getMessage(labelKey), value: formatCount(n), kind });
    };
    const input = toUsageNumber(usage?.input_tokens);
    const output = toUsageNumber(usage?.output_tokens);

    add('apiwebchat_usage_input', input);
    // A subset row without its parent would be an orphaned "of which".
    if (input !== null) {
        add('apiwebchat_usage_of_which_cached', usage.cached_input_tokens, 'sub');
        add('apiwebchat_usage_of_which_cache_write', usage.cache_creation_tokens, 'sub');
    }
    add('apiwebchat_usage_output', output);
    if (output !== null) {
        add('apiwebchat_usage_of_which_reasoning', usage.reasoning_tokens, 'sub');
    }
    // The total alone would only repeat the chip.
    if (input !== null || output !== null) {
        add('apiwebchat_usage_total', usage.total_tokens, 'total');
    }

    if (rows.length > 0 && isDuration(durationMs)) {
        let value = formatDuration(durationMs);
        const rate = tokensPerSecond(usage, durationMs);
        if (rate !== null) {
            value += ' · ' + browser.i18n.getMessage('apiwebchat_usage_speed', [formatCount(rate)]);
        }
        rows.push({ kind: 'divider' });
        rows.push({ label: browser.i18n.getMessage('apiwebchat_usage_duration'), value, kind: '' });
    }
    return rows;
}

// ---- popover open/close ----
// At most one popover is open at a time, window-wide. The listeners are installed
// once, on the document: a click or a key anywhere in the window has to be able to
// close it, and composedPath() sees through the open shadow roots of the chat.
let openChip = null;
let listenersInstalled = false;

function closeOpenPopover(restoreFocus = false) {
    if (openChip === null) return;
    const { button, popover } = openChip;
    openChip = null;
    popover.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.querySelector('.caret').textContent = '▾';
    if (restoreFocus) button.focus();
}

function installListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    document.addEventListener('pointerdown', (e) => {
        if (openChip !== null && !e.composedPath().includes(openChip.wrap)) closeOpenPopover();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && openChip !== null) {
            e.preventDefault();
            closeOpenPopover(true);
        }
    });
}

let popoverSeq = 0;

/**
 * Build the per-answer usage chip, or null when there is nothing at all to show.
 *
 * The chip is clickable -- and opens the detail popover -- only when there is some
 * detail beyond the duration. Otherwise it is a static label.
 *
 * The caller puts it in the answer's action bar, a sibling of the .message
 * element, never inside it: the chip is not part of the answer.
 *
 * @param {object|null} usage a normalized usage object, or null if none arrived
 * @param {number|null} durationMs send-to-end-of-stream time measured by the window
 * @returns {HTMLElement|null}
 */
export function buildUsageChip(usage, durationMs) {
    const text = chipText(usage, durationMs);
    if (text === '') return null;

    const wrap = document.createElement('span');
    wrap.classList.add('mzta-usage');

    const rows = popoverRows(usage, durationMs);
    if (rows.length === 0) {
        const chip = document.createElement('span');
        chip.classList.add('mzta-usage-chip', 'is-static');
        chip.setAttribute(USAGE_MARKER_ATTR, '1');
        chip.textContent = text;
        wrap.appendChild(chip);
        return wrap;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add('mzta-usage-chip');
    button.setAttribute(USAGE_MARKER_ATTR, '1');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.appendChild(document.createTextNode(text + ' '));
    const caret = document.createElement('span');
    caret.classList.add('caret');
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▾';
    button.appendChild(caret);

    const popover = document.createElement('div');
    popover.classList.add('mzta-usage-popover');
    popover.id = 'mzta-usage-popover-' + (++popoverSeq);
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', browser.i18n.getMessage('apiwebchat_usage_label'));
    popover.setAttribute(USAGE_MARKER_ATTR, '1');
    popover.hidden = true;
    for (const row of rows) {
        const line = document.createElement('div');
        if (row.kind === 'divider') {
            line.classList.add('mzta-usage-divider');
            popover.appendChild(line);
            continue;
        }
        line.classList.add('mzta-usage-row');
        if (row.kind) line.classList.add('is-' + row.kind);
        const label = document.createElement('span');
        label.classList.add('label');
        label.textContent = row.label;
        const value = document.createElement('span');
        value.classList.add('value');
        value.textContent = row.value;
        line.appendChild(label);
        line.appendChild(value);
        popover.appendChild(line);
    }
    button.setAttribute('aria-controls', popover.id);

    button.addEventListener('click', () => {
        installListeners();
        const wasOpen = openChip !== null && openChip.button === button;
        closeOpenPopover();
        if (wasOpen) return;
        popover.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        caret.textContent = '▴';
        openChip = { wrap, button, popover };
    });

    wrap.appendChild(button);
    wrap.appendChild(popover);
    return wrap;
}

// Styles for the chip and its popover, for the messages-area shadow root.
export const USAGE_CHIP_CSS = `
    .mzta-usage {
        position: relative;
        display: inline-flex;
        /* Not answer text: keep it out of any selection dragged across the
           transcript. The selection scrub in messagesArea.js is the backstop. */
        user-select: none;
        -moz-user-select: none;
    }
    .mzta-usage-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 1px solid var(--border-strong);
        border-radius: var(--r-pill);
        padding: 5px 12px;
        background: transparent;
        color: var(--ink);
        font: inherit;
        font-size: .75rem;
        line-height: 1.2;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        cursor: default;
    }
    button.mzta-usage-chip {
        cursor: pointer;
        transition: background .12s ease;
    }
    button.mzta-usage-chip:hover,
    button.mzta-usage-chip[aria-expanded="true"] {
        background: var(--surface);
    }
    button.mzta-usage-chip:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
    }
    .mzta-usage-chip .caret {
        font-size: .625rem;
        color: var(--ink-2);
    }
    .mzta-usage-popover {
        position: absolute;
        left: 0;
        bottom: calc(100% + 8px);
        z-index: 3;
        width: 220px;
        max-width: calc(100vw - 48px);
        box-sizing: border-box;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--r-md);
        box-shadow: 0 6px 20px var(--shadow);
        font-size: .8125rem;
        font-variant-numeric: tabular-nums;
        color: var(--ink);
    }
    .mzta-usage-popover[hidden] {
        display: none;
    }
    .mzta-usage-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
    }
    .mzta-usage-row .label {
        color: var(--ink-2);
    }
    .mzta-usage-row.is-sub .label {
        padding-left: 12px;
    }
    .mzta-usage-row.is-total {
        font-weight: 600;
    }
    .mzta-usage-divider {
        height: 1px;
        background: var(--border);
    }
    /* Earlier answers' compact toolbar is icon-sized: the chip follows it. */
    .turn-tools .mzta-usage-chip {
        padding: 3px 10px;
    }
`;

// ---- session meter ----

/**
 * A fresh session accumulator. One window is one chat, so a window opening is
 * also the reset.
 *   total   -> sum of every answer's total_tokens, null until one reports it
 *   context -> input + output of the latest answer, i.e. what the next request
 *              will resend (the workers resend the whole conversation history)
 * @returns {{total: number|null, context: number|null}}
 */
export function createSessionUsage() {
    return { total: null, context: null };
}

/**
 * Fold one answer's usage into the session. A null field never counts as 0.
 * @param {object} session from createSessionUsage(), mutated
 * @param {object} usage a normalized usage object
 */
export function addUsageToSession(session, usage) {
    const total = toUsageNumber(usage?.total_tokens);
    if (total !== null) session.total = (session.total ?? 0) + total;
    const input = toUsageNumber(usage?.input_tokens);
    const output = toUsageNumber(usage?.output_tokens);
    const context = (input !== null && output !== null) ? input + output : total;
    if (context !== null) session.context = context;
}

/**
 * What the meter above the input should show.
 *   'bar'    -> context window known and some context measured
 *   'text'   -> no known window, but the session has a token total
 *   'hidden' -> no tokens at all in this session
 * @param {object} session from createSessionUsage()
 * @param {number|null} contextWindow tokens, or null when unknown
 * @returns {{mode: string, text: string, pct: number, warn: boolean, used: number|null, max: number|null}}
 */
export function buildUsageMeterState(session, contextWindow) {
    const cw = (typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0) ? contextWindow : null;
    if (cw !== null && session.context !== null) {
        const pct = Math.round(session.context / cw * 100);
        const warn = pct >= CONTEXT_WARN_PCT;
        let text = browser.i18n.getMessage('apiwebchat_usage_context',
            [formatCount(session.context), formatCount(cw), String(pct)]);
        if (warn) text += ' — ' + browser.i18n.getMessage('apiwebchat_usage_context_warn');
        return { mode: 'bar', text, pct, warn, used: session.context, max: cw };
    }
    if (session.total !== null) {
        return {
            mode: 'text',
            text: browser.i18n.getMessage('apiwebchat_usage_session', [formatCount(session.total)]),
            pct: 0, warn: false, used: null, max: null,
        };
    }
    return { mode: 'hidden', text: '', pct: 0, warn: false, used: null, max: null };
}

// Styles for the meter, for the message-input shadow root.
export const USAGE_METER_CSS = `
    #usageMeter {
        flex: 1 0 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: .75rem;
        line-height: 1.2;
        color: var(--ink-2);
        font-variant-numeric: tabular-nums;
        user-select: none;
        -moz-user-select: none;
    }
    #usageMeter[hidden], #usageMeterTrack[hidden] {
        display: none;
    }
    #usageMeterTrack {
        flex: 1;
        height: 4px;
        border-radius: 2px;
        background: var(--border);
        overflow: hidden;
    }
    #usageMeterFill {
        height: 100%;
        background: var(--accent);
        transition: width .2s ease-out;
    }
    #usageMeter.is-warn #usageMeterFill {
        background: var(--warn);
    }
    #usageMeterText {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    /* Text-only mode: no track to push the label right. */
    #usageMeter.is-text #usageMeterText {
        flex: 1;
    }
`;

/**
 * Paint a meter state into the #usageMeter element built by messageInput.js.
 * @param {HTMLElement} meter the #usageMeter element
 * @param {object} state from buildUsageMeterState()
 */
export function renderUsageMeter(meter, state) {
    const track = meter.querySelector('#usageMeterTrack');
    const fill = meter.querySelector('#usageMeterFill');
    const text = meter.querySelector('#usageMeterText');
    meter.hidden = state.mode === 'hidden';
    meter.classList.toggle('is-text', state.mode === 'text');
    meter.classList.toggle('is-warn', state.warn);
    track.hidden = state.mode !== 'bar';
    text.textContent = state.text;
    if (state.mode === 'bar') {
        fill.style.width = Math.min(state.pct, 100) + '%';
        track.setAttribute('aria-valuenow', String(state.used));
        track.setAttribute('aria-valuemax', String(state.max));
        track.setAttribute('aria-valuetext', state.text);
    }
}
