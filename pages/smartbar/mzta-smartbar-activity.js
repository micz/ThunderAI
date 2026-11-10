/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/*
 *  The Activity tab of the SmartBar page (claude-spec/10-smartbar.md "Activity"): the records
 *  of the smartbar store and the instructions in progress, as the background gives them
 *  (smartbar_activity_list). The page holds no state of its own: every action is a command to
 *  the background, which acts through the same functions as the bar and then tells every view
 *  (smartbar_activity_changed), this page included, which reads its list again.
 */

const msg = (key, subs) => browser.i18n.getMessage(key, subs) || key;
const lines = () => globalThis.mztaSmartbarLines;

// The longest instruction shown in full; the whole text is in the cell's tooltip.
const INSTRUCTION_MAX = 80;
const TICK_MS = 1000;

const view = {
    filter: null,           // 'running' | 'errors' | 'all', chosen at the first load
    records: [],
    more: false,
    counts: { running: 0, errors: 0 },
    loading: null,
    again: false,
    tick: null,
    isShown: () => true,
};

function send(command, extra = {}) {
    return browser.runtime.sendMessage({ command: command, ...extra }).catch(() => ({ ok: false }));
}

/** The filter shown first: Running if anything runs, else Errors if any, else All. */
export function defaultFilter(counts) {
    if ((counts?.running || 0) > 0) return 'running';
    if ((counts?.errors || 0) > 0) return 'errors';
    return 'all';
}

function joinHeader(value) {
    if (Array.isArray(value)) return value.join(', ');
    return value == null ? '' : String(value);
}

function truncate(text, max) {
    const s = String(text ?? '');
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? m + ':' + String(s).padStart(2, '0') : s + ' s';
}

function button(label, action, extra = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn_secondary btn_small';
    b.textContent = msg(label);
    b.dataset.action = action;
    for (const [k, v] of Object.entries(extra)) b.dataset[k] = String(v);
    return b;
}

/** Whether a record or one of its operations failed with an unreadable answer (Open in chat). */
function jsonErrorIndex(record) {
    if (record.errorType === 'json') return null;
    const op = (record.operations || []).find(o => o.state === 'error' && o.errorType === 'json');
    return op ? op.index : undefined;
}

/** The latest retryAt of a record in error, when a rate limit asked to wait. */
function retryAtOf(record) {
    const all = [record.retryAt, ...(record.operations || []).filter(o => o.state === 'error').map(o => o.retryAt)];
    return all.reduce((max, v) => Math.max(max, Number(v) || 0), 0) || null;
}

function renderRow(record) {
    const tr = document.createElement('tr');
    tr.dataset.recordId = String(record.id);
    tr.dataset.state = record.state;
    tr.className = 'smartbar_row smartbar_row_' + record.state;

    // The message: subject, sender, and where the instruction came from.
    const tdMsg = document.createElement('td');
    const subject = document.createElement('div');
    subject.className = 'smartbar_subject';
    subject.textContent = joinHeader(record.subject);
    const from = document.createElement('div');
    from.className = 'smartbar_from mzta_help';
    from.textContent = joinHeader(record.from);
    const source = document.createElement('span');
    source.className = 'smartbar_source';
    source.textContent = msg(record.source === 'chat' ? 'smartbar_activity_source_chat' : 'smartbar_activity_source_bar');
    from.append(' ', source);
    tdMsg.append(subject, from);

    const tdInstr = document.createElement('td');
    tdInstr.className = 'smartbar_instruction';
    tdInstr.textContent = truncate(record.instruction, INSTRUCTION_MAX);
    tdInstr.title = String(record.instruction ?? '');

    // The operations with their states; an instruction-level error is a line of its own.
    const tdOps = document.createElement('td');
    tdOps.className = 'smartbar_ops';
    const L = lines();
    if (record.errorType) {
        const div = document.createElement('div');
        div.className = 'smartbar_op smartbar_op_error';
        div.textContent = (L?.STATE_ICON.error || '') + ' ' + msg('smartbar_line_router_error', [String(record.error || '')]);
        tdOps.appendChild(div);
    } else if (record.state === 'running' && (record.operations || []).length === 0) {
        const div = document.createElement('div');
        div.className = 'smartbar_op smartbar_op_running';
        div.textContent = (L?.STATE_ICON.running || '') + ' ' + msg('smartbar_routing');
        tdOps.appendChild(div);
    }
    for (const op of record.operations || []) {
        const div = document.createElement('div');
        div.className = 'smartbar_op smartbar_op_' + op.state;
        div.dataset.index = String(op.index);
        div.textContent = (L?.STATE_ICON[op.state] || '') + ' ' + (L ? L.opText(op) : op.id);
        if (record.live && op.state === 'running') {
            div.append(' ', button('smartbar_stop', 'stop', { index: op.index }));
        }
        tdOps.appendChild(div);
    }

    const tdTime = document.createElement('td');
    tdTime.className = 'smartbar_time';
    if (record.live) {
        tdTime.dataset.since = String(record.createdAt || Date.now());
    } else {
        const at = record.finishedAt || record.createdAt;
        tdTime.textContent = at ? new Date(at).toLocaleString() : '';
    }

    const tdActions = document.createElement('td');
    tdActions.className = 'smartbar_actions';
    if (record.live) {
        tdActions.append(button('smartbar_activity_open', 'open'), button('smartbar_stop', 'stop'));
    } else if (record.state === 'error') {
        const retryAt = retryAtOf(record);
        if (retryAt && retryAt > Date.now()) {
            const wait = document.createElement('span');
            wait.className = 'smartbar_countdown mzta_help';
            wait.dataset.until = String(retryAt);
            tdActions.appendChild(wait);
        }
        // Retry: the instruction-level error, or each failed operation (the first one here:
        // the bar retries a line at a time too).
        const failed = (record.operations || []).find(o => o.state === 'error');
        tdActions.append(record.errorType || !failed
            ? button('smartbar_retry', 'retry')
            : button('smartbar_retry', 'retry', { index: failed.index }));
        tdActions.append(button('smartbar_remove', 'remove'));
        const jsonIndex = jsonErrorIndex(record);
        if (jsonIndex !== undefined) {
            tdActions.append(jsonIndex === null
                ? button('smartbar_open_in_chat', 'open_chat')
                : button('smartbar_open_in_chat', 'open_chat', { index: jsonIndex }));
        }
        tdActions.append(button('smartbar_activity_open', 'open'));
    } else {
        tdActions.append(button('smartbar_activity_open', 'open'), button('smartbar_remove', 'remove'));
    }

    tr.append(tdMsg, tdInstr, tdOps, tdTime, tdActions);
    return tr;
}

function paintFilters() {
    document.querySelectorAll('#smartbar_activity .smartbar_filter').forEach(b => {
        b.setAttribute('aria-checked', b.dataset.filter === view.filter ? 'true' : 'false');
    });
    document.querySelectorAll('#smartbar_activity .smartbar_count').forEach(span => {
        const n = view.counts[span.dataset.count] || 0;
        span.textContent = n > 0 ? '(' + n + ')' : '';
    });
    document.getElementById('smartbar_stop_all').disabled = view.counts.running === 0;
    document.getElementById('smartbar_remove_errors').disabled = view.counts.errors === 0;
}

function paintRows() {
    const body = document.getElementById('smartbar_activity_rows');
    body.replaceChildren(...view.records.map(renderRow));
    document.getElementById('smartbar_activity_empty').hidden = view.records.length > 0;
    document.getElementById('smartbar_activity_table').hidden = view.records.length === 0;
    document.getElementById('smartbar_activity_more').hidden = !view.more;
    paintTimes();
}

/** The elapsed times of the running rows and the rate-limit countdowns, every second. */
function paintTimes() {
    const now = Date.now();
    let live = false;
    document.querySelectorAll('#smartbar_activity_rows [data-since]').forEach(td => {
        td.textContent = msg('smartbar_activity_elapsed', [formatElapsed(now - Number(td.dataset.since))]);
        live = true;
    });
    document.querySelectorAll('#smartbar_activity_rows [data-until]').forEach(span => {
        const left = Math.ceil((Number(span.dataset.until) - now) / 1000);
        span.textContent = left > 0 ? msg('smartbar_retry_in', [String(left)]) : '';
        if (left > 0) live = true;
    });
    clearTimeout(view.tick);
    view.tick = null;
    if (live && view.isShown()) view.tick = setTimeout(paintTimes, TICK_MS);
}

/**
 * Read the list again from the background (the current filter, or the default one at the
 * first load). `more`: the next page, appended. Calls made during a load are coalesced into one
 * more load after it.
 */
export async function refresh({ more = false } = {}) {
    if (view.loading && !more) {
        view.again = true;
        return view.loading;
    }
    view.loading = (async () => {
        do {
            view.again = false;
            const beforeId = more && view.records.length > 0 ? view.records[view.records.length - 1].id : null;
            const answer = await send('smartbar_activity_list', { filter: view.filter || 'all', beforeId: beforeId });
            if (!answer || answer.ok === false) break;
            view.counts = answer.counts || { running: 0, errors: 0 };
            if (view.filter === null) {
                view.filter = defaultFilter(view.counts);
                if (view.filter !== 'all') {
                    view.again = true;
                    continue;
                }
            }
            view.records = more ? [...view.records, ...answer.records] : answer.records;
            view.more = answer.more === true;
            more = false;
            paintFilters();
            paintRows();
        } while (view.again);
    })().finally(() => { view.loading = null; });
    return view.loading;
}

async function onRowAction(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const row = btn.closest('tr[data-record-id]');
    if (!row) return;
    const record = view.records.find(r => String(r.id) === row.dataset.recordId);
    if (!record) return;
    const extra = { recordId: record.id };
    if (btn.dataset.index !== undefined) extra.index = Number(btn.dataset.index);
    btn.disabled = true;
    const command = {
        open: 'smartbar_activity_open',
        stop: 'smartbar_activity_stop',
        retry: 'smartbar_activity_retry',
        remove: 'smartbar_activity_remove',
        open_chat: 'smartbar_activity_open_chat',
    }[btn.dataset.action];
    if (command) await send(command, extra);
    // The background tells every view of the change; a refused action changes nothing, so the
    // list is read again here too.
    await refresh();
}

/**
 * Wire the tab. `isShown()` tells whether the tab is the one shown (the clock runs only then);
 * `openStorage()` opens the storage management page.
 */
export async function initActivityTab({ isShown = () => true, openStorage = () => {} } = {}) {
    view.isShown = isShown;
    document.querySelectorAll('#smartbar_activity .smartbar_filter').forEach(b => {
        b.addEventListener('click', () => {
            view.filter = b.dataset.filter;
            view.records = [];
            refresh();
        });
    });
    document.getElementById('smartbar_activity_rows').addEventListener('click', onRowAction);
    document.getElementById('smartbar_stop_all').addEventListener('click', async () => {
        await send('smartbar_activity_stop_all');
        await refresh();
    });
    document.getElementById('smartbar_remove_errors').addEventListener('click', async () => {
        await send('smartbar_activity_remove_errors');
        await refresh();
    });
    document.getElementById('smartbar_activity_more').addEventListener('click', () => refresh({ more: true }));
    document.getElementById('smartbar_open_storage').addEventListener('click', (e) => {
        e.preventDefault();
        openStorage();
    });
    browser.runtime.onMessage.addListener((message) => {
        if (message?.command === 'smartbar_activity_changed') refresh();
        return false;
    });
    await refresh();
}

/** The tab became visible (or hidden): the clock follows. */
export function activityShown() {
    paintTimes();
}
