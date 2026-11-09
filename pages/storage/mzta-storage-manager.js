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
 *  The storage management page [#956]: the saved spam reports, summaries and translations
 *  (claude-spec/01-architecture.md "Per-Message Data Storage", claude-spec/05-options.md
 *  "Storage Management Page").
 *
 *  It reads IndexedDB directly through js/mzta-storage.js, like the spam filter page, and never
 *  rebuilds, realigns or migrates it: the realignment is asked of the background
 *  (reconcileMessageStorage). Every bulk removal runs under the cleanup lock, inside taStorage.
 */

import { taLogger } from '../../js/mzta-logger.js';
import { mztaPrefs } from '../../js/mzta-prefs.js';
import { prefs_default } from '../../options/mzta-options-default.js';
import {
    CLEANUP_AUTO_PREF,
    MESSAGE_STORES,
    STORAGE_PREFS,
    STORE_SPAM,
    STORE_SUMMARY,
    STORE_TRANSLATION,
    buildMessageMetadata,
    isMirrorKey,
    taStorage
} from '../../js/mzta-storage.js';
import { taSpamReport } from '../../js/mzta-spamreport.js';
import { formatBytes } from '../../js/mzta-utils.js';
import {
    applyManagedUI,
    isLockedKey,
    setDisabledRespectingManaged,
    showManagedBanner
} from '../_lib/managed-ui.js';
import { initUnsavedGuard } from '../_lib/unsaved-guard.js';
import {
    attachRowResizer,
    headerText,
    renderSpamReportRows
} from '../_lib/spam-log.js';

/** The order the page shows the types in. */
const TYPE_ORDER = [STORE_SUMMARY, STORE_TRANSLATION, STORE_SPAM];
/** The entry list's page size. */
const PAGE_SIZE = 50;
/** Every preference the rules form edits. */
const RULE_KEYS = [...TYPE_ORDER.flatMap(type => Object.values(STORAGE_PREFS[type])), CLEANUP_AUTO_PREF];
/** The delete method of a single entry, per type. */
const DELETE_ENTRY = {
    [STORE_SPAM]: 'deleteSpamField',
    [STORE_SUMMARY]: 'deleteSummaryField',
    [STORE_TRANSLATION]: 'deleteTranslationField',
};

let taLog = null;
let storage = null;
let rulesDirty = false;
let entriesType = STORE_SUMMARY;
let entriesOffset = 0;
let scanRunning = false;
let scanStop = false;
let orphans = [];

const $ = id => document.getElementById(id);
const msg = (key, subs) => browser.i18n.getMessage(key, subs);
const typeName = type => msg('storage_type_' + type);
const dateText = time => (Number.isFinite(time) ? new Date(time).toLocaleString() : '');

/** "Summaries: 3, Translations: 0, Spam reports: 5", for the types present in byType. */
function formatCounts(byType) {
    return TYPE_ORDER.filter(type => byType && Object.hasOwn(byType, type))
        .map(type => msg('storage_count_item', [typeName(type), String(byType[type] ?? 0)]))
        .join(', ');
}

/** Show a result line: an outcome, or an error (styled as one). */
function showResult(element, text, isError = false) {
    element.textContent = text;
    element.classList.toggle('storage_error', isError);
}

/**
 * The text of a failed action. A bulk removal works in lots and is not atomic: when it removed
 * something before failing, its error carries it (error.removed, per type) and the text says so.
 */
function errorText(e) {
    const reason = String(e?.message || e);
    const removed = e?.removed;
    if (removed && Object.values(removed).some(n => n > 0)) {
        return msg('storage_action_error_partial', [formatCounts(removed), reason]);
    }
    return msg('storage_action_error', [reason]);
}

document.addEventListener('DOMContentLoaded', async () => {
    // Warn before leaving the page with unsaved rules (an enabled btn_save_rules).
    initUnsavedGuard();

    const prefs = await mztaPrefs.getPrefs(['do_debug']);
    taLog = new taLogger('mzta-storage-page', prefs.do_debug);
    storage = new taStorage(prefs.do_debug);

    i18n.updateDocument();
    await showManagedBanner('managed_config_banner', prefs.do_debug);

    await loadRules();
    // After the values are in: a locked rule is disabled and marked.
    await applyManagedUI(document, prefs.do_debug);

    // No automatic refresh: the overview, the notices and the list are read again on demand.
    $('btn_refresh').addEventListener('click', async () => {
        await showMigrationState();
        await refreshAll();
    });
    bindRules();
    bindActions();
    bindEntries();
    attachEntriesFullscreen();
    bindOrphans();
    attachRowResizer($('entries_body'));

    // The rules changed elsewhere (another page, a policy reload): shown again, unless the
    // user is editing them. The mirror keys (one per saved record) are never ours.
    browser.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const keys = Object.keys(changes).filter(key => !isMirrorKey(key));
        if (!rulesDirty && keys.some(key => RULE_KEYS.includes(key))) loadRules();
    });

    window.addEventListener('hashchange', () => {
        if (applyHash()) loadEntries().then(scrollToEntries);
    });

    const fromHash = applyHash();
    await showMigrationState();
    await Promise.all([loadOverview(), loadEntries()]);
    if (fromHash) scrollToEntries();
});

// ---- Migration notices -------------------------------------------------------------------

async function showMigrationState() {
    const migration = await taStorage.getMigrationState();
    $('storage_migrating').style.display = migration === 'migrating' ? '' : 'none';
    $('storage_migration_failed').style.display = migration === 'failed' ? '' : 'none';
}

// ---- Overview ----------------------------------------------------------------------------

async function loadOverview() {
    const stats = await taStorage.getStats();
    const body = $('stats_body');
    body.textContent = '';
    let count = 0;
    let errors = 0;
    let size = 0;
    for (const type of TYPE_ORDER) {
        const s = stats[type];
        count += s.count;
        errors += s.errors;
        size += s.size;
        const row = document.createElement('tr');
        row.dataset.type = type;
        const th = document.createElement('th');
        th.textContent = typeName(type);
        row.appendChild(th);
        for (const text of [String(s.count), String(s.errors), formatBytes(s.size), dateText(s.oldest), dateText(s.newest)]) {
            const td = document.createElement('td');
            td.textContent = text;
            row.appendChild(td);
        }
        body.appendChild(row);
    }
    $('stats_total_count').textContent = String(count);
    $('stats_total_errors').textContent = String(errors);
    $('stats_total_size').textContent = formatBytes(size);

    const last = await taStorage.getLastCleanup();
    $('last_cleanup').textContent = last
        ? msg('storage_last_cleanup', [dateText(last.time), formatCounts(Object.fromEntries(TYPE_ORDER.map(t => [t, last.removed[t] ?? 0])))])
        : msg('storage_last_cleanup_never');
}

/** Everything the actions change: the overview and the entry list. */
async function refreshAll() {
    await Promise.all([loadOverview(), loadEntries()]);
}

// ---- Retention rules ---------------------------------------------------------------------

function setRulesDirty(dirty) {
    rulesDirty = dirty;
    setDisabledRespectingManaged($('btn_save_rules'), !dirty);
}

/** Put the stored rules (policy values included) in the form. */
async function loadRules() {
    const values = await mztaPrefs.getPrefs(RULE_KEYS);
    for (const key of RULE_KEYS) setRuleControl(key, values[key]);
    $('rules_invalid').style.display = 'none';
    setRulesDirty(false);
}

function setRuleControl(key, value) {
    const input = $(key);
    if (key === CLEANUP_AUTO_PREF) input.checked = value !== false;
    else input.value = Number.isInteger(value) && value >= 0 ? String(value) : '0';
}

/** The form's values: { values: {key: value}, valid } (a number must be an integer >= 0). */
function readRules() {
    const values = {};
    let valid = true;
    for (const key of RULE_KEYS) {
        const input = $(key);
        if (key === CLEANUP_AUTO_PREF) {
            values[key] = input.checked;
            continue;
        }
        const n = input.valueAsNumber;
        if (!Number.isInteger(n) || n < 0) valid = false;
        values[key] = n;
    }
    $('rules_invalid').style.display = valid ? 'none' : '';
    return { values, valid };
}

/** The limits of the form in the shape taStorage.cleanup() / previewCleanup() take. */
function limitsOf(values) {
    return Object.fromEntries(MESSAGE_STORES.map(type => [type, {
        maxEntries: values[STORAGE_PREFS[type].maxEntries],
        maxAgeDays: values[STORAGE_PREFS[type].maxAgeDays],
        errorMaxAgeDays: values[STORAGE_PREFS[type].errorMaxAgeDays],
    }]));
}

const sumOf = byType => Object.values(byType).reduce((a, b) => a + b, 0);

function bindRules() {
    document.querySelectorAll('.rule_input').forEach(input => {
        input.addEventListener('input', () => setRulesDirty(true));
        input.addEventListener('change', () => setRulesDirty(true));
    });

    // Save: when the automatic cleanup stays on and the new rules would delete saved entries
    // at its next run, the user is told how many first, and may cancel.
    $('btn_save_rules').addEventListener('click', async () => {
        const result = $('rules_result');
        const { values, valid } = readRules();
        if (!valid) return;
        try {
            if (values[CLEANUP_AUTO_PREF]) {
                const preview = await taStorage.previewCleanup(limitsOf(values));
                const total = sumOf(preview);
                if (total > 0 && !confirm(msg('storage_rules_save_confirm', [String(total), formatCounts(preview)]))) return;
            }
            const toWrite = Object.fromEntries(Object.entries(values).filter(([key]) => !isLockedKey(key)));
            await mztaPrefs.setPrefs(toWrite);
            setRulesDirty(false);
            showResult(result, msg('storage_rules_saved'));
        } catch (e) {
            taLog.error('Could not save the storage rules: ' + e);
            showResult(result, errorText(e), true);
        }
    });

    // The defaults in the form (the locked keys keep their policy value); saved by Save.
    $('btn_restore_rules').addEventListener('click', () => {
        for (const key of RULE_KEYS) {
            if (isLockedKey(key)) continue;
            setRuleControl(key, prefs_default[key]);
        }
        $('rules_invalid').style.display = 'none';
        setRulesDirty(true);
    });

    // What the rules in the form would remove now, saved or not: counts only, nothing deleted.
    $('btn_preview').addEventListener('click', async () => {
        const { values, valid } = readRules();
        if (!valid) return;
        const preview = await taStorage.previewCleanup(limitsOf(values));
        showResult($('rules_result'), msg('storage_preview_result', [formatCounts(preview)]));
    });

    // The saved rules, now. Not the scheduled run: its time is not stored, its timer not moved.
    $('btn_apply_now').addEventListener('click', () => runAction($('rules_result'),
        msg('storage_apply_confirm'),
        () => taStorage.cleanup(),
        removed => msg('storage_removed_result', [formatCounts(removed)])));
}

// ---- Manual actions ----------------------------------------------------------------------

/**
 * A destructive action: confirmed first, then run, its outcome (or error) shown in `resultEl`,
 * then the overview and the list read again.
 */
async function runAction(resultEl, confirmText, fn, doneText) {
    if (!confirm(confirmText)) return;
    try {
        const outcome = await fn();
        showResult(resultEl, doneText(outcome));
    } catch (e) {
        taLog.error('Storage action error: ' + e);
        showResult(resultEl, errorText(e), true);
    }
    await refreshAll();
}

function bindActions() {
    const result = $('actions_result');
    for (const type of TYPE_ORDER) {
        $('btn_delete_' + type).addEventListener('click', () => runAction(result,
            msg('storage_delete_' + type + '_confirm'),
            () => taStorage.clear(type),
            n => msg('storage_removed_result', [formatCounts({ [type]: n })])));
    }
    $('btn_delete_errors').addEventListener('click', () => runAction(result,
        msg('storage_delete_errors_confirm'),
        () => taStorage.deleteErrors(),
        removed => msg('storage_removed_result', [formatCounts(removed)])));
    $('btn_delete_all').addEventListener('click', () => runAction(result,
        msg('prefs_storage_clear_confirm'),
        () => taStorage.clearAllRecords(),
        n => msg('prefs_storage_clear_done', [String(n)])));
    $('btn_delete_older').addEventListener('click', () => {
        const days = $('delete_older_days').valueAsNumber;
        if (!Number.isInteger(days) || days < 1) {
            showResult(result, msg('storage_days_invalid'), true);
            return;
        }
        return runAction(result,
            msg('storage_delete_older_confirm', [String(days)]),
            () => taStorage.deleteOlderThan(days),
            removed => msg('storage_removed_result', [formatCounts(removed)]));
    });
    // The realignment with the storage.local mirror runs in the background only.
    $('btn_realign').addEventListener('click', () => runAction(result,
        msg('storage_realign_confirm'),
        async () => {
            const answer = await browser.runtime.sendMessage({ command: 'reconcileMessageStorage' });
            if (!answer?.ok) throw new Error(answer?.error || msg('storage_no_answer'));
            return answer.counts;
        },
        counts => msg('storage_realign_done', [TYPE_ORDER.map(type => msg('storage_realign_item',
            [typeName(type), String(counts?.[type]?.restored ?? 0), String(counts?.[type]?.removed ?? 0)])).join(', ')])));
}

// ---- Entry list --------------------------------------------------------------------------

/** #summary, #translation or #spam selects the list's type. Whether the hash named one. */
function applyHash() {
    const type = decodeURIComponent((window.location.hash || '').slice(1));
    if (!MESSAGE_STORES.includes(type)) return false;
    entriesType = type;
    entriesOffset = 0;
    $('entries_type').value = type;
    return true;
}

function scrollToEntries() {
    // Not implemented everywhere a page can be rendered: optional.
    $('entries_section').scrollIntoView?.({ block: 'start' });
}

function bindEntries() {
    $('entries_type').addEventListener('change', (e) => {
        entriesType = e.target.value;
        entriesOffset = 0;
        showResult($('entries_result'), '');
        loadEntries();
    });
    $('entries_prev_btn').addEventListener('click', () => {
        entriesOffset = Math.max(0, entriesOffset - PAGE_SIZE);
        loadEntries();
    });
    $('entries_next_btn').addEventListener('click', () => {
        entriesOffset += PAGE_SIZE;
        loadEntries();
    });
}

/**
 * The full-tab button of the entry list (#entries_fullscreen_btn), the same as the spam log's on
 * the spam filter page: the section is pinned over the whole tab and the page behind is locked.
 * Icon-only, the state in aria-pressed (which also swaps the icons in CSS). Escape closes it.
 */
function attachEntriesFullscreen() {
    const btn = $('entries_fullscreen_btn');
    const section = $('entries_section');
    if (!btn || !section) return;

    const setState = (on) => {
        section.classList.toggle('entries_fullscreen_on', on);
        document.body.classList.toggle('entries_fullscreen', on);
        btn.setAttribute('aria-pressed', String(on));
        // Leaving full-tab mode restores the page scroll, which may be far from the list.
        if (!on) section.scrollIntoView?.({ block: 'nearest' });
    };

    btn.addEventListener('click', () => {
        setState(btn.getAttribute('aria-pressed') !== 'true');
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && btn.getAttribute('aria-pressed') === 'true') {
            setState(false);
        }
    });
}

function headersOf(type) {
    if (type === STORE_SPAM) {
        return ['Message_ID', msg('Date'), msg('From'), msg('Subject'), msg('Spam_Value'), msg('Moved_to_Spam'),
            msg('Explanation'), msg('Report_Date'), msg('storage_col_status'), msg('storage_col_actions')];
    }
    const cols = [msg('storage_col_saved'), msg('storage_col_status'), msg('Subject'), msg('From'), msg('Date')];
    if (type === STORE_TRANSLATION) cols.push(msg('storage_col_language'));
    cols.push(msg('storage_col_actions'));
    return cols;
}

async function loadEntries() {
    const type = entriesType;
    const total = await taStorage.count(type);
    // A page past the end (entries removed meanwhile): back to the last one.
    if (entriesOffset >= total) entriesOffset = Math.max(0, Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE);
    const records = await taStorage.getPage(type, { offset: entriesOffset, limit: PAGE_SIZE });
    // The type changed while reading: a newer load draws the list.
    if (type !== entriesType) return;

    const headers = headersOf(type);
    const head = $('entries_head');
    head.textContent = '';
    const headRow = document.createElement('tr');
    headers.forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        headRow.appendChild(th);
    });
    head.appendChild(headRow);
    $('entries_table').dataset.type = type;

    const body = $('entries_body');
    if (type === STORE_SPAM) {
        renderSpamReportRows(body, records.map(r => taSpamReport.toReport(r)), {
            emptyText: msg('storage_no_entries'),
            colSpan: headers.length,
            extraCells: report => [statusCell(type, { spamValue: report.spamValue }, report.explanation),
                actionsCell(type, report.headerMessageId)],
        });
    } else {
        renderEntryRows(body, type, records, headers.length);
    }

    const pager = $('entries_pager');
    if (total === 0 || records.length === 0) {
        pager.style.display = 'none';
        return;
    }
    pager.style.display = '';
    $('entries_page_label').textContent = msg('spamfilter_report_page_label',
        [String(entriesOffset + 1), String(entriesOffset + records.length), String(total)]);
    $('entries_prev_btn').disabled = entriesOffset === 0;
    $('entries_next_btn').disabled = entriesOffset + records.length >= total;
}

function textCell(text, title = false) {
    const td = document.createElement('td');
    td.textContent = text;
    if (title) td.title = text;
    return td;
}

/** The summary and translation rows: saved on, status, subject, sender, message date, language. */
function renderEntryRows(body, type, records, colSpan) {
    body.textContent = '';
    if (records.length === 0) {
        const row = document.createElement('tr');
        const td = textCell(msg('storage_no_entries'));
        td.colSpan = colSpan;
        row.appendChild(td);
        body.appendChild(row);
        return;
    }
    for (const record of records) {
        const row = document.createElement('tr');
        row.dataset.messageId = record.messageId;
        row.appendChild(textCell(dateText(record.createdAt)));
        row.appendChild(statusCell(type, record, record.message));
        row.appendChild(textCell(headerText(record.subject), true));
        row.appendChild(textCell(headerText(record.from), true));
        row.appendChild(textCell(record.message_date ? new Date(record.message_date).toLocaleString() : ''));
        if (type === STORE_TRANSLATION) row.appendChild(textCell(record.lang || ''));
        row.appendChild(actionsCell(type, record.messageId));
        body.appendChild(row);
    }
}

/** ok / error; an error carries its message as a tooltip. */
function statusCell(type, record, errorMessage) {
    const failed = taStorage.isFailed(type, record);
    const td = textCell(msg(failed ? 'storage_status_error' : 'storage_status_ok'));
    td.className = failed ? 'status_error' : 'status_ok';
    if (failed && errorMessage) td.title = errorMessage;
    return td;
}

function actionsCell(type, messageId) {
    const td = document.createElement('td');
    td.className = 'actions_cell';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn_small btn_secondary entry_open';
    open.textContent = msg('storage_open_message');
    open.addEventListener('click', () => openMessage(messageId));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn_small btn_secondary entry_delete';
    del.textContent = msg('storage_delete_entry');
    del.addEventListener('click', () => runAction($('entries_result'),
        msg('storage_delete_entry_confirm'),
        () => storage[DELETE_ENTRY[type]](messageId),
        () => msg('storage_entry_deleted')));
    td.append(open, del);
    return td;
}

/** The message of a Message-ID, or null when no folder holds it (messages.query()). */
async function findMessage(messageId) {
    const list = await browser.messages.query({ headerMessageId: messageId });
    return list?.messages?.[0] ?? null;
}

/** Open the original message in a tab, or say that it no longer exists. */
async function openMessage(messageId) {
    const result = $('entries_result');
    try {
        const message = await findMessage(messageId);
        if (!message) {
            showResult(result, msg('storage_message_not_found'), true);
            return;
        }
        await browser.messageDisplay.open({ messageId: message.id, location: 'tab' });
        showResult(result, '');
    } catch (e) {
        taLog.error('Could not open the message ' + messageId + ': ' + e);
        showResult(result, errorText(e), true);
    }
}

// ---- Orphan scan -------------------------------------------------------------------------

function bindOrphans() {
    $('btn_orphans_start').addEventListener('click', startScan);
    $('btn_orphans_stop').addEventListener('click', () => { scanStop = true; });
    $('btn_orphans_delete').addEventListener('click', () => runAction($('orphans_result'),
        msg('storage_orphans_delete_confirm', [String(orphans.length)]),
        () => taStorage.removeEntries(orphans),
        removed => {
            orphans = [];
            $('orphans_results').style.display = 'none';
            return msg('storage_removed_result', [formatCounts(removed)]);
        }));
}

/**
 * Walk every saved Message-ID (once, whatever the number of its entries) and look its message
 * up. Not found: its entries are listed as orphans. Found: its entries with empty metadata get
 * the subject, sender and date of the message (taStorage.fillMetadata(), which skips the others).
 * A lookup that fails is neither: logged and skipped. Stoppable between two lookups.
 */
async function startScan() {
    if (scanRunning) return;
    if (!confirm(msg('storage_orphans_confirm'))) return;
    scanRunning = true;
    scanStop = false;
    orphans = [];
    $('btn_orphans_start').disabled = true;
    $('btn_orphans_stop').disabled = false;
    $('orphans_results').style.display = 'none';
    showResult($('orphans_result'), '');
    const progress = $('orphans_progress');

    let filled = 0;
    let done = 0;
    let stopped = false;
    try {
        const byId = new Map();
        for (const type of TYPE_ORDER) {
            for (const { messageId, createdAt } of await taStorage.getEntryKeys(type)) {
                if (!byId.has(messageId)) byId.set(messageId, []);
                byId.get(messageId).push({ type, messageId, createdAt });
            }
        }
        const total = byId.size;
        progress.textContent = msg('storage_orphans_progress', ['0', String(total)]);
        for (const [messageId, entries] of byId) {
            if (scanStop) {
                stopped = true;
                break;
            }
            let message;
            try {
                message = await findMessage(messageId);
            } catch (e) {
                taLog.error('Orphan scan: could not look up ' + messageId + ': ' + e);
                message = undefined;
            }
            if (message === null) {
                orphans.push(...entries);
            } else if (message) {
                const metadata = buildMessageMetadata(message, null);
                for (const entry of entries) {
                    try {
                        if (await taStorage.fillMetadata(entry.type, messageId, entry.createdAt, metadata)) filled++;
                    } catch (e) {
                        taLog.error('Orphan scan: could not complete ' + entry.type + ' ' + messageId + ': ' + e);
                    }
                }
            }
            done++;
            progress.textContent = msg('storage_orphans_progress', [String(done), String(total)]);
        }
        showOrphans(filled, stopped);
    } catch (e) {
        taLog.error('Orphan scan error: ' + e);
        showResult($('orphans_result'), errorText(e), true);
    } finally {
        scanRunning = false;
        $('btn_orphans_start').disabled = false;
        $('btn_orphans_stop').disabled = true;
    }
    if (filled > 0) await refreshAll();
}

function showOrphans(filled, stopped) {
    const parts = [];
    if (stopped) parts.push(msg('storage_orphans_stopped'));
    parts.push(msg('storage_orphans_found', [String(orphans.length)]));
    if (filled > 0) parts.push(msg('storage_orphans_filled', [String(filled)]));
    $('orphans_summary').textContent = parts.join(' ');

    const body = $('orphans_body');
    body.textContent = '';
    for (const entry of orphans) {
        const row = document.createElement('tr');
        row.appendChild(textCell(typeName(entry.type)));
        row.appendChild(textCell(entry.messageId, true));
        row.appendChild(textCell(dateText(entry.createdAt)));
        body.appendChild(row);
    }
    $('btn_orphans_delete').disabled = orphans.length === 0;
    $('orphans_note').style.display = orphans.length > 0 ? '' : 'none';
    $('orphans_results').style.display = '';
}
