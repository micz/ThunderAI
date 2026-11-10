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

/*
 *  The per-message data storage: spam reports, summaries and translations, in IndexedDB [#955].
 *
 *  One database, one object store per type, one record per message and type, keyed by the
 *  header Message-ID alone (a new translation replaces the previous one, whatever its language).
 *  Every record has the same common fields - messageId, createdAt, size, subject, from,
 *  message_date - plus the fields of its type. See claude-spec/01-architecture.md
 *  "Per-Message Data Storage".
 *
 *  A fourth store, smartbar, holds the SmartBar's records (claude-spec/10-smartbar.md "Storage"):
 *  one per instruction, keyed by an auto-increment id, NOT mirrored (STORE_MIRRORED): nothing of
 *  what is said below about the mirror applies to it. ALL_STORES is the four, MESSAGE_STORES the
 *  three mirrored ones keyed on the Message-ID. A smartbar record still running is never removed
 *  by a bulk removal (isKeptRecord()).
 *
 *  Who opens the database: the background (every read and write of the message flow, the
 *  migration from storage.local, the scheduled cleanup) and the management pages (the options
 *  page, the spam filter page, the storage management page pages/storage/). The message display
 *  and compose scripts never do: they go through the background.
 *
 *  Every record also has failed (1 when it holds an error, else 0), the first key of the
 *  failed_createdAt index the error rules and counts use.
 *
 *  The durable copy is the MIRROR in storage.local: one key per record, `<prefix><messageId>`
 *  (MIRROR_PREFIXES: spam:, summary:, translation:), whose value is the very record of the store.
 *  storage.local is never evicted; the database is (Thunderbird may evict it without notice, and
 *  it grants an add-on neither persistent storage nor, as an optional permission,
 *  unlimitedStorage). So the database is the working copy every read uses (pages, counts, size,
 *  the cleanup cursors), and the mirror is the source of truth it is rebuilt from:
 *   - every write goes to the mirror first, then to the database; every delete removes both;
 *   - a database that turns out to be new (created by this open, or deleted and created again
 *     because its object stores were missing) is rebuilt from the mirror by the background
 *     (reconcileIfNew(), reconcileWithMirror()); the pages never rebuild it;
 *   - a read that cannot reach the database (it cannot be opened, a store is missing) logs and
 *     answers as empty: no record, an empty page, 0;
 *   - a delete on a database that cannot be opened still removes the mirror keys;
 *   - every transaction's done promise has a handler, so an aborted transaction never surfaces
 *     as an unhandled rejection.
 *  Only clear(), clearAllRecords() and reconcileWithMirror() enumerate storage.local
 *  (get(null)): rare, user-initiated or rebuild operations. No routine path ever does.
 *
 *  Every change to the data (each write and single delete, each lot of a bulk removal, the
 *  realignment's steps, each metadata fill) runs under one Web Lock, CLEANUP_LOCK_NAME; the bulk
 *  removals work in lots of message_storage_batch_size records and release it between two lots,
 *  so a write waits for one lot at most (claude-spec/01-architecture.md, "The cleanup lock and the
 *  lots").
 *
 *  Two rules hold everywhere below:
 *   - nothing but IndexedDB requests is awaited inside a transaction: a transaction commits as
 *     soon as the event loop is idle, so a preference read or a storage.local call in the middle
 *     would end it (the mirror is written before a transaction is opened, or after it is done);
 *   - a write never swallows its error: it is logged, then the promise rejects, so the caller
 *     can tell the user (the background still shows the result it could not save).
 */

import {
    deleteDB,
    openDB
} from './lib/idb.js';
import { taLogger } from './mzta-logger.js';
import { mztaPrefs } from './mzta-prefs.js';

/** The database, its schema version, its object stores and their indexes. */
export const MESSAGE_DB_NAME = 'thunderai-message-data';
export const MESSAGE_DB_VERSION = 1;
export const STORE_SPAM = 'spam';
export const STORE_SUMMARY = 'summary';
export const STORE_TRANSLATION = 'translation';
/** The per-message stores: keyed by the Message-ID, one record per message, mirrored. */
export const MESSAGE_STORES = Object.freeze([STORE_SPAM, STORE_SUMMARY, STORE_TRANSLATION]);
/**
 * The SmartBar's store (claude-spec/10-smartbar.md): one record per instruction the user typed,
 * keyed by an auto-increment id, NOT mirrored in storage.local. It can be lost if Thunderbird
 * evicts the database: nothing rebuilds it.
 */
export const STORE_SMARTBAR = 'smartbar';
/** Every object store of the database. */
export const ALL_STORES = Object.freeze([...MESSAGE_STORES, STORE_SMARTBAR]);
/**
 * Per store: whether it has a durable copy in storage.local (the mirror). A store that is not
 * mirrored never writes to storage.local, is not rebuilt by reconcileWithMirror() (a database
 * found new leaves it empty), and its deletes touch only the database.
 */
export const STORE_MIRRORED = Object.freeze({
    [STORE_SPAM]: true,
    [STORE_SUMMARY]: true,
    [STORE_TRANSLATION]: true,
    [STORE_SMARTBAR]: false,
});
/** The smartbar store's own indexes, besides createdAt, size and failed_createdAt. */
export const INDEX_MESSAGE_ID = 'messageId';
export const INDEX_SESSION_ID = 'sessionId';
export const INDEX_STATE = 'state';
/**
 * [state, failed, createdAt]: the running records older than a cutoff, with or without an error,
 * counted without loading them (previewCleanup()).
 */
export const INDEX_STATE_FAILED_CREATED_AT = 'state_failed_createdAt';
/** The smartbar state the cleanup never removes: an instruction still being processed. */
export const SMARTBAR_STATE_RUNNING = 'running';
export const INDEX_CREATED_AT = 'createdAt';
export const INDEX_SIZE = 'size';
/**
 * The error index of every store, keyPath [failed, createdAt]: failed is 1 for a record that holds
 * an error, else 0 (a boolean cannot be an IndexedDB key). The error queries are ranges on it,
 * e.g. IDBKeyRange.bound([1, -Infinity], [1, Infinity]), never a full scan.
 */
export const INDEX_FAILED_CREATED_AT = 'failed_createdAt';

/** The spamValue of a spam report that holds an error (taSpamReport.buildError()). */
export const SPAM_ERROR_VALUE = -999;

/**
 * The storage.local key prefix of the mirror records of each type: the record of a message is
 * kept under `<prefix><messageId>` (the Message-ID as headerMessageId gives it, without angle
 * brackets), its value the very record of the store. One key per record: storage.local.set()
 * rewrites a key's whole value, so every save stays a single put that reads nothing else.
 */
export const MIRROR_PREFIXES = Object.freeze({
    [STORE_SPAM]: STORE_SPAM + ':',
    [STORE_SUMMARY]: STORE_SUMMARY + ':',
    [STORE_TRANSLATION]: STORE_TRANSLATION + ':',
});

/** The storage.local key of the mirror record of a type and a message. */
export function mirrorKey(type, messageId) {
    const prefix = MIRROR_PREFIXES[type];
    if (!prefix) throw new Error('Unknown message data type: ' + type);
    return prefix + messageId;
}

/** The type of a mirror key (one of MESSAGE_STORES), or null for any other storage.local key. */
export function mirrorKeyType(key) {
    if (typeof key !== 'string') return null;
    for (const type of MESSAGE_STORES) {
        if (key.startsWith(MIRROR_PREFIXES[type])) return type;
    }
    return null;
}

/** Whether a storage.local key is a mirror record (the storage.onChanged listeners skip them). */
export function isMirrorKey(key) {
    return mirrorKeyType(key) !== null;
}

/** The Web Lock every cleanup and every bulk removal runs under, in every context. */
export const CLEANUP_LOCK_NAME = 'thunderai-storage-cleanup';

/**
 * storage.local key of the move of the legacy msg: records into the database
 * (js/mzta-storage-migration.js). Three states:
 *   true      the background is moving them: the management pages show a notice instead of an
 *             empty table;
 *   'failed'  the last attempt failed (the database could not be opened or written): the legacy
 *             records are kept and the next start tries again; the pages say so, and show what
 *             the database holds;
 *   absent    done, or nothing to move. There is no "done" value.
 */
export const MIGRATION_FLAG_KEY = '_message_data_migrating';
/** The MIGRATION_FLAG_KEY value of a failed migration. */
export const MIGRATION_FAILED = 'failed';

/**
 * storage.local key holding the add-on version (manifest.json) the move of the legacy records
 * last completed for. The move scans storage.local only when the running version differs (an
 * update, also after a downgrade), never at every start: a scan reads every mirror record too.
 */
export const MIGRATION_VERSION_KEY = '_message_data_migration_version';

/**
 * storage.local key of the last completed scheduled cleanup: { time, removed }, time in ms,
 * removed the records it removed per type (what cleanup() returns). Written by the scheduled
 * cleanup only, on success; read by startCleanupSchedule() and by the storage management page
 * (getLastCleanup()).
 */
export const LAST_CLEANUP_KEY = '_message_data_last_cleanup';

/**
 * The preferences of each type: maximum entries, maximum age in days, maximum age in days of the
 * records that hold an error. 0 = no limit.
 */
export const STORAGE_PREFS = Object.freeze({
    [STORE_SPAM]: Object.freeze({
        maxEntries: 'spamfilter_storage_max_entries',
        maxAgeDays: 'spamfilter_storage_max_age_days',
        errorMaxAgeDays: 'spamfilter_storage_error_max_age_days',
    }),
    [STORE_SUMMARY]: Object.freeze({
        maxEntries: 'summarize_storage_max_entries',
        maxAgeDays: 'summarize_storage_max_age_days',
        errorMaxAgeDays: 'summarize_storage_error_max_age_days',
    }),
    [STORE_TRANSLATION]: Object.freeze({
        maxEntries: 'translate_storage_max_entries',
        maxAgeDays: 'translate_storage_max_age_days',
        errorMaxAgeDays: 'translate_storage_error_max_age_days',
    }),
    [STORE_SMARTBAR]: Object.freeze({
        maxEntries: 'smartbar_retention_max_records',
        maxAgeDays: 'smartbar_retention_days',
        errorMaxAgeDays: 'smartbar_retention_error_days',
    }),
});

/** The preference that turns the scheduled cleanup on and off (default true). */
export const CLEANUP_AUTO_PREF = 'message_storage_cleanup_auto';

/**
 * The preference of the size of a lot of a bulk removal (policy-only, no control in any page),
 * its default and its maximum (its policy range in js/mzta-managed.js, PREF_NUMBER_RANGES).
 */
export const BATCH_SIZE_PREF = 'message_storage_batch_size';
export const DEFAULT_BATCH_SIZE = 100;
export const BATCH_SIZE_MAX = 10000;

const DAY_MS = 24 * 60 * 60 * 1000;
/** The scheduled cleanup runs every 24 hours, and 2 hours after a start that does not need it at once. */
export const CLEANUP_INTERVAL_MS = DAY_MS;
export const CLEANUP_STARTUP_DELAY_MS = 2 * 60 * 60 * 1000;

const _log = new taLogger('mzta-storage', false);

// The open connection of this context, shared by every instance. Reset when the connection is
// closed for another context's upgrade (blocking) or by the browser (terminated): the next call
// opens a new one.
let _dbPromise = null;
// The one pending timer of the scheduled cleanup (background only).
let _cleanupTimer = null;
// Bumped by every stopCleanupSchedule() (so by every startCleanupSchedule() too): a start whose
// reads were overtaken by a later one gives up, and a run in progress when the schedule was
// stopped or restarted does not set its next run.
let _scheduleGeneration = 0;
// True once an open of this context found the database new (it created the object stores):
// what reconcileIfNew() reads, and clears when it has rebuilt the database from the mirror.
let _dbIsNew = false;
// Background only (startRebuildWatch()): a lost connection is opened again at once, and a
// database found new is rebuilt from the mirror.
let _rebuildWatch = false;
// The rebuild the watch started after a lost connection, until it ends (background only): the
// reads wait for it, so a record the mirror holds is never answered as missing in the meantime
// (a summary asked for then would be generated again by the AI).
let _rebuilding = null;

/** Wait for the rebuild in progress, if any (never rejects). */
function rebuildDone() {
    return _rebuilding || Promise.resolve();
}

/** The value as an ISO string when it is a Date, else unchanged. */
function toIsoDate(value) {
    return value instanceof Date ? value.toISOString() : value;
}

/** A limit as stored: a positive integer, or 0 (no limit) for anything else. */
function toLimit(value) {
    return Number.isInteger(value) && value > 0 ? value : 0;
}

/** The limits of one type, each through toLimit() (a missing one is 0). */
function normalizeLimits(limits) {
    return {
        maxEntries: toLimit(limits?.maxEntries),
        maxAgeDays: toLimit(limits?.maxAgeDays),
        errorMaxAgeDays: toLimit(limits?.errorMaxAgeDays),
    };
}

/**
 * Open the database once, without checking its contents. `onLost` is called when the connection
 * stops being usable: closed for another context's upgrade or deletion (blocking), or by the
 * browser (terminated).
 */
function openMessageDB(onLost) {
    const opening = openDB(MESSAGE_DB_NAME, MESSAGE_DB_VERSION, {
        upgrade(db, oldVersion) {
            // oldVersion 0: the database did not exist (first start, evicted, or deleted by
            // openCheckedMessageDB() below): whatever it held is only in the mirror now.
            if (oldVersion === 0) _dbIsNew = true;
            if (oldVersion < 1) {
                for (const name of MESSAGE_STORES) {
                    const store = db.createObjectStore(name, { keyPath: 'messageId' });
                    store.createIndex(INDEX_CREATED_AT, 'createdAt');
                    store.createIndex(INDEX_SIZE, 'size');
                    store.createIndex(INDEX_FAILED_CREATED_AT, ['failed', 'createdAt']);
                }
                // Version 1 too: nothing of this storage has been released yet. A development
                // database without it opens without its object store, and is created again
                // (openCheckedMessageDB()), then rebuilt from the mirror.
                const smartbar = db.createObjectStore(STORE_SMARTBAR, { keyPath: 'id', autoIncrement: true });
                smartbar.createIndex(INDEX_MESSAGE_ID, 'messageId');
                smartbar.createIndex(INDEX_SESSION_ID, 'sessionId');
                smartbar.createIndex(INDEX_CREATED_AT, 'createdAt');
                smartbar.createIndex(INDEX_SIZE, 'size');
                smartbar.createIndex(INDEX_FAILED_CREATED_AT, ['failed', 'createdAt']);
                smartbar.createIndex(INDEX_STATE, 'state');
                smartbar.createIndex(INDEX_STATE_FAILED_CREATED_AT, ['state', 'failed', 'createdAt']);
            }
        },
        blocked(currentVersion, blockedVersion) {
            _log.warn('The message database (version ' + currentVersion + ') is open in another context: waiting to open version ' + blockedVersion + '.');
        },
        blocking(currentVersion, blockedVersion) {
            // Another context needs to upgrade or delete the database: let it. The next call
            // opens a new connection.
            _log.log('Closing the message database (version ' + currentVersion + ') for ' +
                (blockedVersion ? 'an upgrade to version ' + blockedVersion : 'its deletion') + '.');
            onLost();
            opening.then(db => db.close()).catch(() => {});
        },
        terminated() {
            _log.warn('The message database connection was closed by the browser.');
            onLost();
        },
    });
    return opening;
}

/**
 * Open the database and check that it has its three object stores. A database at the current
 * version without them (damaged, or partly evicted) is never upgraded, so it would stay broken:
 * it is deleted and created again, empty. Its new open runs upgrade() from version 0, which
 * marks it new, so the background rebuilds it from the mirror.
 */
async function openCheckedMessageDB(onLost) {
    const db = await openMessageDB(onLost);
    const missing = ALL_STORES.filter(name => !db.objectStoreNames.contains(name));
    if (missing.length === 0) return db;
    _log.warn('The message database has no ' + missing.join(', ') + ' object store: creating it again, empty.');
    db.close();
    await deleteDB(MESSAGE_DB_NAME, {
        blocked() {
            _log.warn('The message database is open in another context: waiting to delete it.');
        },
    });
    return await openMessageDB(onLost);
}

/**
 * A transaction on the database of this context. When the cached connection was closed under it
 * (InvalidStateError), a new one is opened, once. The transaction's done promise gets a handler
 * at once: a failing request aborts the transaction, and its done would otherwise become an
 * unhandled rejection whenever the caller stops before awaiting it. Awaiting tx.done still rejects.
 * Exported for the migration (js/mzta-storage-migration.js), the one transaction opened outside this file.
 */
export async function openTransaction(stores, mode) {
    let opening = taStorage.openDB();
    let db = await opening;
    let tx;
    try {
        tx = db.transaction(stores, mode);
    } catch (e) {
        if (e?.name !== 'InvalidStateError') throw e;
        _log.warn('The message database connection was closed: opening it again.');
        if (_dbPromise === opening) _dbPromise = null;
        opening = taStorage.openDB();
        db = await opening;
        tx = db.transaction(stores, mode);
    }
    tx.done.catch(() => {});
    return tx;
}

/** a is newer than b: a greater createdAt (a record without a number counts as 0). */
function isNewer(a, b) {
    const t = r => (typeof r?.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0);
    return t(a) > t(b);
}

/** A mirror value that can be put into its store: an object whose messageId is the one of its key. */
function isStorableRecord(value, messageId) {
    return !!value && typeof value === 'object' && !Array.isArray(value) && value.messageId === messageId;
}

/**
 * The mirror records of the given types, read with ONE storage.local.get(null) filtered on the
 * prefixes: { [type]: Map(messageId -> value) }. Only for the rare operations (clear, the
 * reconcile), never on the message flow.
 */
async function readMirror(types = MESSAGE_STORES) {
    const all = await browser.storage.local.get(null);
    const out = Object.fromEntries(types.map(type => [type, new Map()]));
    for (const [key, value] of Object.entries(all)) {
        const type = mirrorKeyType(key);
        if (type && out[type]) out[type].set(key.slice(MIRROR_PREFIXES[type].length), value);
    }
    return out;
}

/**
 * Put records into their stores and remove others, in one readwrite transaction. A record is put
 * only when the store does not already hold one of that Message-ID with a createdAt as new or
 * newer; a removal ({type, messageId, createdAt}) deletes the stored record only when it still has
 * the createdAt seen when it was chosen (a write since then has replaced it: it is kept). The write
 * loop of the move of the legacy records (js/mzta-storage-migration.js) and of
 * reconcileWithMirror(). Resolves once the transaction has committed; rejects with nothing
 * committed.
 *
 * @param {{type: string, record: object}[]} records
 * @param {{type: string, messageId: string, createdAt: *}[]} [removals]
 * @returns {Promise<{written: number, skipped: number, byType: object, removedByType: object}>}
 *   byType: written per type; removedByType: removed per type
 */
export async function putNewerRecords(records, removals = []) {
    const byType = Object.fromEntries(MESSAGE_STORES.map(type => [type, 0]));
    const removedByType = Object.fromEntries(MESSAGE_STORES.map(type => [type, 0]));
    if (records.length === 0 && removals.length === 0) return { written: 0, skipped: 0, byType, removedByType };
    const tx = await openTransaction(MESSAGE_STORES, 'readwrite');
    let written = 0;
    let skipped = 0;
    try {
        for (const { type, record } of records) {
            const store = tx.objectStore(type);
            const existing = await store.get(record.messageId);
            if (existing && typeof existing.createdAt === 'number' && existing.createdAt >= record.createdAt) {
                skipped++;
                continue;
            }
            await store.put(record);
            written++;
            byType[type]++;
        }
        for (const { type, messageId, createdAt } of removals) {
            const store = tx.objectStore(type);
            const existing = await store.get(messageId);
            if (!existing || existing.createdAt !== createdAt) continue;
            await store.delete(messageId);
            removedByType[type]++;
        }
    } catch (e) {
        // A request that throws (rather than failing) does not abort the transaction: left alone,
        // it would commit what was done before it. All or nothing.
        try { tx.abort(); } catch { /* already finished */ }
        throw e;
    }
    await tx.done;
    return { written, skipped, byType, removedByType };
}

/** The range of the failed_createdAt index holding the errors created before `upper` (all by default). */
function errorRange(upper = Infinity, upperOpen = false) {
    return IDBKeyRange.bound([1, -Infinity], [1, upper], false, upperOpen);
}

/** A count of 0 for every type (every store, the smartbar one included). */
function zeroByType() {
    return Object.fromEntries(ALL_STORES.map(type => [type, 0]));
}

/** A day count as a cutoff time: the records created before it are older. */
function cutoff(now, days) {
    return now - days * DAY_MS;
}

/**
 * Remove the mirror keys of records just removed from the database, but only those whose mirror
 * value still has the createdAt the removal saw. One targeted storage.local.get(keys) and one
 * remove() per type, never get(null). Called once the transaction of the removal has committed
 * (nothing but IndexedDB requests is awaited inside one), in the same hold of the cleanup lock:
 * the writes take it too, so none lands between the cursor, the get and the remove. The createdAt
 * check stays as a defence (a context without the Web Locks API).
 *
 * @param {object} byType { [type]: [{ messageId, createdAt }] }
 */
async function removeMirrorKeysIfUnchanged(byType) {
    for (const [type, entries] of Object.entries(byType)) {
        // A store with no mirror has no key to remove.
        if (!entries || entries.length === 0 || !STORE_MIRRORED[type]) continue;
        const seen = new Map(entries.map(e => [mirrorKey(type, e.messageId), e.createdAt]));
        const current = await browser.storage.local.get([...seen.keys()]);
        const keys = [...seen.keys()].filter(key =>
            Object.hasOwn(current, key) && current[key]?.createdAt === seen.get(key));
        if (keys.length > 0) await browser.storage.local.remove(keys);
    }
}

/**
 * Delete, in one readwrite transaction on a type, the records a cursor on one of its indexes
 * reaches over a range (all of them, or the first `limit`), and return their
 * { messageId, createdAt }. Resolves once the transaction has committed.
 */
async function deleteByCursor(type, indexName, range, limit = Infinity) {
    const removed = [];
    if (limit <= 0) return removed;
    const tx = await openTransaction(type, 'readwrite');
    let cursor = await tx.store.index(indexName).openCursor(range);
    while (cursor && removed.length < limit) {
        // A SmartBar instruction still being processed is never removed (it becomes
        // 'interrupted' at the next start, then expires like the others).
        if (isKeptRecord(type, cursor.value)) {
            cursor = await cursor.continue();
            continue;
        }
        removed.push({ messageId: cursor.primaryKey, createdAt: cursor.value.createdAt });
        await cursor.delete();
        cursor = await cursor.continue();
    }
    await tx.done;
    return removed;
}

/** A record no bulk removal may delete: a SmartBar instruction still running. */
function isKeptRecord(type, record) {
    return type === STORE_SMARTBAR && record?.state === SMARTBAR_STATE_RUNNING;
}

/** Whether a record holds no message metadata: subject, from and message_date all empty. */
function hasEmptyMetadata(record) {
    const empty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    return empty(record?.subject) && empty(record?.from) && empty(record?.message_date);
}

/**
 * The metadata of a message as the per-message records store it: { subject, from, message_date }.
 * Prefers the full MIME headers (fullMessage.headers, arrays), but falls back to the MessageHeader
 * fields (message.subject / message.author / message.date), which remain readable even when the
 * message storage is no longer available. This keeps the saved entries populated when a user
 * filter removes a message while it is being analyzed, or when getFull() returns partial headers.
 * A field that cannot be known is undefined (buildRecord() then stores it empty).
 * Shared by the background (every save) and the storage management page (the orphan scan, which
 * has the MessageHeader only).
 * Thanks to https://github.com/racerm3 for the idea, from https://github.com/racerm3/ThunderAI/commit/5ae5e206a733b44d57ef57dcc46968ea7e686e72#diff-ee0e0f04f23f4913865479164d992ff20124eba596df1453f1cde635359fb634
 *
 * @param {object|null} message      a MessageHeader
 * @param {object|null} fullMessage  a MessagePart (messages.getFull()), or null
 */
export function buildMessageMetadata(message, fullMessage) {
    const headers = (fullMessage && fullMessage.headers) || {};
    const isEmpty = (v) => v === undefined || v === null || (Array.isArray(v) && v.length === 0);
    return {
        subject: isEmpty(headers.subject) ? (message?.subject ? [message.subject] : undefined) : headers.subject,
        from: isEmpty(headers.from) ? (message?.author ? [message.author] : undefined) : headers.from,
        message_date: message?.date ? new Date(message.date) : undefined
    };
}

// Whether the missing Web Locks API was already logged (once per context, not once per lot).
let _noLocksWarned = false;

/**
 * Run fn() under the cleanup lock: every write and delete, every lot of a bulk removal, the
 * realignment's steps and the metadata fill. Web Locks are not reentrant: fn() never calls it
 * again. Without the Web Locks API, fn() runs directly.
 */
function withCleanupLock(fn) {
    const locks = globalThis.navigator?.locks;
    if (!locks || typeof locks.request !== 'function') {
        if (!_noLocksWarned) _log.warn('navigator.locks is not available: running without the storage cleanup lock.');
        _noLocksWarned = true;
        return fn();
    }
    return locks.request(CLEANUP_LOCK_NAME, fn);
}

/**
 * The size of a lot of a bulk removal: message_storage_batch_size (policy-only, no control), an
 * integer from 1 to BATCH_SIZE_MAX; DEFAULT_BATCH_SIZE for anything else or when it cannot be read.
 */
async function readBatchSize() {
    try {
        const value = await mztaPrefs.getPref(BATCH_SIZE_PREF);
        return Number.isInteger(value) && value >= 1 && value <= BATCH_SIZE_MAX ? value : DEFAULT_BATCH_SIZE;
    } catch (e) {
        _log.error('Could not read ' + BATCH_SIZE_PREF + ': ' + e);
        return DEFAULT_BATCH_SIZE;
    }
}

/**
 * Delete, in lots of `batch`, the records of a type a cursor on one of its indexes reaches over a
 * range: each lot under the cleanup lock, its records deleted in one transaction
 * (deleteByCursor(), which starts again from the start of the range: the records of the lots
 * before are gone) and their mirror keys removed (removeMirrorKeysIfUnchanged()), then the lock
 * released. Adds the count to removed[type] as it goes, so a caller that catches a failure knows
 * what was removed before it.
 */
async function deleteRangeInLots(type, indexName, range, batch, removed) {
    for (;;) {
        const n = await withCleanupLock(async () => {
            const gone = await deleteByCursor(type, indexName, range, batch);
            await removeMirrorKeysIfUnchanged({ [type]: gone });
            return gone.length;
        });
        removed[type] = (removed[type] || 0) + n;
        if (n < batch) return;
    }
}

/**
 * The count rule, in lots of `batch`: under the lock, the excess (count - maxEntries) is
 * computed again, and the oldest records of it, up to `batch`, are deleted with their mirror
 * keys; until there is no excess. Adds to removed[type] as it goes.
 */
async function deleteExcessInLots(type, maxEntries, batch, removed) {
    for (;;) {
        const { n, more } = await withCleanupLock(async () => {
            const tx = await openTransaction(type, 'readwrite');
            const excess = (await tx.store.count()) - maxEntries;
            const take = Math.min(batch, excess);
            const gone = [];
            let cursor = take > 0 ? await tx.store.index(INDEX_CREATED_AT).openCursor() : null;
            while (cursor && gone.length < take) {
                if (!isKeptRecord(type, cursor.value)) {
                    gone.push({ messageId: cursor.primaryKey, createdAt: cursor.value.createdAt });
                    await cursor.delete();
                }
                cursor = await cursor.continue();
            }
            await tx.done;
            await removeMirrorKeysIfUnchanged({ [type]: gone });
            // No cursor left: only kept records remain beyond the limit.
            return { n: gone.length, more: excess > gone.length && cursor !== null };
        });
        removed[type] = (removed[type] || 0) + n;
        if (!more || n === 0) return;
    }
}

/**
 * The upper bound of createdAt an emptying (clear(), clearAllRecords()) removes: now, or the
 * newest createdAt the stores hold if later (a clock moved back), read when it starts. A record
 * written after that has a later createdAt (the writes take it under the lock) and is kept.
 */
async function clearBound(types) {
    let bound = Date.now();
    try {
        const tx = await openTransaction(types, 'readonly');
        for (const type of types) {
            const last = await tx.objectStore(type).index(INDEX_CREATED_AT).openKeyCursor(null, 'prev');
            if (last && typeof last.key === 'number' && last.key > bound) bound = last.key;
        }
        await tx.done;
    } catch (e) {
        // A database that cannot be read has nothing to empty: its lots will find nothing either.
        _log.error('Could not read the newest record: ' + e);
    }
    return bound;
}

/**
 * The last step of an emptying, under the lock: the mirror keys of the types the lots did not
 * reach (a record only the mirror holds, a value that is not a record), found with one
 * storage.local get(null), removed unless their value is a record newer than `bound`.
 */
async function removeMirrorKeysUpTo(types, bound) {
    const mirror = await readMirror(types);
    const keys = [];
    for (const type of types) {
        for (const [id, value] of mirror[type]) {
            const newer = value && typeof value.createdAt === 'number' && value.createdAt > bound;
            if (!newer) keys.push(mirrorKey(type, id));
        }
    }
    if (keys.length > 0) await browser.storage.local.remove(keys);
}

/** The error of a bulk removal, with what it removed before failing: error.removed, per type. */
function withRemoved(error, removed) {
    const e = error instanceof Error ? error : new Error(String(error));
    e.removed = { ...removed };
    return e;
}

/** The fields each type stores besides the common ones, with their defaults. */
function typeFields(type, data) {
    switch (type) {
        case STORE_SPAM:
            return {
                spamValue: data.spamValue,
                explanation: data.explanation ?? '',
                moved: data.moved ?? false,
                SpamThreshold: data.SpamThreshold,
            };
        case STORE_SUMMARY:
            return {
                summary: data.summary ?? '',
                summary_html: data.summary_html || '',
                error: data.error || false,
                message: data.message || '',
                summary_date: toIsoDate(data.summary_date),
            };
        case STORE_TRANSLATION:
            return {
                translated_text: data.translated_text ?? '',
                translated_subject: data.translated_subject ?? '',
                translation_status: data.translation_status ?? '',
                lang: data.lang ?? '',
                error: data.error ?? false,
                message: data.message ?? '',
            };
        default:
            throw new Error('Unknown message data type: ' + type);
    }
}

/** The size of a record, as every store computes it: the JSON byte length of the record without size. */
function recordSize(record) {
    const { size: _size, ...rest } = record;
    return new TextEncoder().encode(JSON.stringify(rest)).byteLength;
}

export class taStorage {

    static FIELD_SPAM = STORE_SPAM;
    static FIELD_SUMMARY = STORE_SUMMARY;
    static FIELD_TRANSLATION = STORE_TRANSLATION;

    taLog = null;

    /**
     * @param {boolean} [do_debug=false] - Enable debug logging.
     */
    constructor(do_debug = false) {
        this.taLog = new taLogger("mzta-storage", do_debug);
    }

    // ---- The database -------------------------------------------------------------------------

    /**
     * The connection of this context, opened once, with its three object stores (see
     * openCheckedMessageDB()). Future schema versions go in upgrade() (openMessageDB()). Rejects
     * when the database cannot be opened; the next call tries again.
     * @returns {Promise<IDBPDatabase>}
     */
    static openDB() {
        if (_dbPromise) return _dbPromise;
        const opening = openCheckedMessageDB(() => {
            if (_dbPromise === opening) _dbPromise = null;
            // The background opens it again at once, so it is the first to find it new after an
            // eviction (a page opening it first would create it, and the background would then
            // find it at version 1 and never rebuild it). After the close in progress: a timer.
            // The reads wait for it from now on, not only once it has started.
            if (_rebuildWatch) {
                const rebuild = new Promise(resolve => setTimeout(resolve, 0))
                    .then(() => taStorage.reconcileIfNew())
                    .catch(e => _log.error('Could not rebuild the message database from the mirror: ' + e))
                    .then(() => { if (_rebuilding === rebuild) _rebuilding = null; });
                _rebuilding = rebuild;
            }
        });
        _dbPromise = opening;
        // A failed open is not kept: the next call tries again.
        opening.catch((e) => {
            _log.error('Could not open the message database: ' + e);
            if (_dbPromise === opening) _dbPromise = null;
        });
        return opening;
    }

    /**
     * A record ready to be stored: the common fields, the type's own fields, and size, the
     * byte length of the JSON of the record without size (computed first, then added).
     * Fields whose value is undefined are left out.
     *
     * @param {string} type      one of MESSAGE_STORES
     * @param {string} messageId the header Message-ID
     * @param {object} data      the type's fields, plus subject / from / message_date when known
     * @param {number} createdAt ms timestamp
     */
    static buildRecord(type, messageId, data = {}, createdAt = Date.now()) {
        const record = {
            messageId: messageId,
            createdAt: createdAt,
            // The shape buildMessageMetadata() gives: subject and from are arrays (MIME
            // headers), message_date an ISO string. Empty when not known.
            subject: data.subject ?? [],
            from: data.from ?? [],
            message_date: toIsoDate(data.message_date) ?? '',
            ...typeFields(type, data),
        };
        // 1 / 0, not a boolean: it is the first key of the failed_createdAt index.
        record.failed = taStorage.isFailed(type, record) ? 1 : 0;
        for (const key of Object.keys(record)) {
            if (record[key] === undefined) delete record[key];
        }
        record.size = new TextEncoder().encode(JSON.stringify(record)).byteLength;
        return record;
    }

    /**
     * Whether a record of the type holds an error, what buildRecord() stores as failed (1 / 0): a
     * summary or a translation with error set (a translation_status of "-1", skipped, is a valid
     * result), a spam report whose spamValue is SPAM_ERROR_VALUE.
     */
    static isFailed(type, record) {
        switch (type) {
            case STORE_SPAM:
                return Number(record?.spamValue) === SPAM_ERROR_VALUE;
            case STORE_SUMMARY:
            case STORE_TRANSLATION:
                return !!record?.error;
            case STORE_SMARTBAR:
                // An instruction-level error (the router failed), or an operation that failed.
                return record?.state === 'error' || !!record?.errorType ||
                    (Array.isArray(record?.operations) && record.operations.some(op => op?.state === 'error'));
            default:
                throw new Error('Unknown message data type: ' + type);
        }
    }

    /**
     * The state of the move of the legacy records (see MIGRATION_FLAG_KEY): 'migrating', 'failed',
     * or null (done, nothing to move, any other value, or the flag cannot be read).
     */
    static async getMigrationState() {
        try {
            const value = (await browser.storage.local.get(MIGRATION_FLAG_KEY))[MIGRATION_FLAG_KEY];
            if (value === true) return 'migrating';
            if (value === MIGRATION_FAILED) return 'failed';
            return null;
        } catch (e) {
            _log.error('Could not read the migration flag: ' + e);
            return null;
        }
    }

    /** Whether the background is moving legacy records into the database (see MIGRATION_FLAG_KEY). */
    static async isMigrating() {
        return (await taStorage.getMigrationState()) === 'migrating';
    }

    // ---- Reads ----------------------------------------------------------------------------------

    /**
     * The records of a message, read from the three stores in one readonly transaction.
     * @param {string} messageId - The Message-ID header string.
     * @returns {Promise<object|null>} { spam, summary, translation }, each key present only when
     *   that store has a record (the stored record: createdAt, no ts); null when none has.
     */
    async getRecord(messageId) {
        this.taLog.log('[getRecord] messageId: ' + messageId);
        if (!messageId) return null;
        try {
            await rebuildDone();
            const tx = await openTransaction(MESSAGE_STORES, 'readonly');
            const found = await Promise.all(MESSAGE_STORES.map(name => tx.objectStore(name).get(messageId)));
            await tx.done;
            const out = {};
            MESSAGE_STORES.forEach((name, i) => { if (found[i]) out[name] = found[i]; });
            const record = Object.keys(out).length > 0 ? out : null;
            this.taLog.log('[getRecord] record found: ' + (record !== null));
            return record;
        } catch (e) {
            // An unreachable cache is an empty one: the caller generates the data again.
            this.taLog.error('getRecord error (answered as no record): ' + e);
            return null;
        }
    }

    /**
     * Check if a record contains the specified field.
     * @param {object|null} record - The record object (from getRecord).
     * @param {string} field - The field name to check ("spam", "summary", or "translation").
     * @returns {boolean} True if the record exists and the field is present.
     */
    hasField(record, field) {
        return record !== null && record !== undefined && typeof record === 'object' && field in record;
    }

    /**
     * The records of a type, newest first: a cursor on the createdAt index, in prev direction.
     * @param {string} type - one of MESSAGE_STORES
     * @param {{offset?: number, limit?: number}} [page]
     * @returns {Promise<object[]>} [] when the database cannot be read
     */
    static async getPage(type, { offset = 0, limit = 50 } = {}) {
        try {
            await rebuildDone();
            const tx = await openTransaction(type, 'readonly');
            const out = [];
            let cursor = await tx.store.index(INDEX_CREATED_AT).openCursor(null, 'prev');
            // advance(0) throws.
            if (cursor && offset > 0) cursor = await cursor.advance(offset);
            while (cursor && out.length < limit) {
                out.push(cursor.value);
                cursor = await cursor.continue();
            }
            await tx.done;
            return out;
        } catch (e) {
            _log.error('getPage ' + type + ' error (answered as no record): ' + e);
            return [];
        }
    }

    /** The number of records of a type; 0 when the database cannot be read. */
    static async count(type) {
        try {
            await rebuildDone();
            const tx = await openTransaction(type, 'readonly');
            const n = await tx.store.count();
            await tx.done;
            return n;
        } catch (e) {
            _log.error('count ' + type + ' error (answered as 0): ' + e);
            return 0;
        }
    }

    /**
     * The bytes taken by the records of the three stores: the sum of their size, read from the
     * size index with a key cursor (the key is the size: no record is loaded). 0 when the
     * database cannot be read.
     */
    static async getTotalSize() {
        try {
            await rebuildDone();
            const tx = await openTransaction(ALL_STORES, 'readonly');
            let total = 0;
            for (const name of ALL_STORES) {
                let cursor = await tx.objectStore(name).index(INDEX_SIZE).openKeyCursor();
                while (cursor) {
                    if (typeof cursor.key === 'number') total += cursor.key;
                    cursor = await cursor.continue();
                }
            }
            await tx.done;
            return total;
        } catch (e) {
            _log.error('getTotalSize error (answered as 0): ' + e);
            return 0;
        }
    }

    /**
     * The overview of every type, for the storage management page, in one readonly transaction
     * and without loading a record: count, errors (a count on the failed_createdAt index), size
     * (the sum of the size index, as getTotalSize()), oldest and newest createdAt (the first key of
     * the createdAt index in each direction, null when the store is empty). When the database
     * cannot be read, every type is answered as empty.
     * @returns {Promise<object>} { [type]: { count, errors, size, oldest, newest } }
     */
    static async getStats() {
        const empty = () => Object.fromEntries(ALL_STORES.map(type =>
            [type, { count: 0, errors: 0, size: 0, oldest: null, newest: null }]));
        try {
            await rebuildDone();
            const tx = await openTransaction(ALL_STORES, 'readonly');
            const out = empty();
            for (const type of ALL_STORES) {
                const store = tx.objectStore(type);
                const stats = out[type];
                stats.count = await store.count();
                stats.errors = await store.index(INDEX_FAILED_CREATED_AT).count(errorRange());
                let cursor = await store.index(INDEX_SIZE).openKeyCursor();
                while (cursor) {
                    if (typeof cursor.key === 'number') stats.size += cursor.key;
                    cursor = await cursor.continue();
                }
                const first = await store.index(INDEX_CREATED_AT).openKeyCursor();
                stats.oldest = first ? first.key : null;
                const last = await store.index(INDEX_CREATED_AT).openKeyCursor(null, 'prev');
                stats.newest = last ? last.key : null;
            }
            await tx.done;
            return out;
        } catch (e) {
            _log.error('getStats error (answered as empty): ' + e);
            return empty();
        }
    }

    /**
     * Every record of a type as { messageId, createdAt }, oldest first, read with a key cursor on
     * the createdAt index (its key is createdAt, its primary key the Message-ID): no record is
     * loaded. The list the orphan scan walks; the createdAt is what removeEntries() checks.
     * [] when the database cannot be read.
     */
    static async getEntryKeys(type) {
        try {
            await rebuildDone();
            const tx = await openTransaction(type, 'readonly');
            const out = [];
            let cursor = await tx.store.index(INDEX_CREATED_AT).openKeyCursor();
            while (cursor) {
                out.push({ messageId: cursor.primaryKey, createdAt: cursor.key });
                cursor = await cursor.continue();
            }
            await tx.done;
            return out;
        } catch (e) {
            _log.error('getEntryKeys ' + type + ' error (answered as no record): ' + e);
            return [];
        }
    }

    /**
     * The last completed scheduled cleanup (LAST_CLEANUP_KEY): { time, removed }, or null when
     * there is none, its value is not of that shape, or it cannot be read.
     */
    static async getLastCleanup() {
        try {
            const value = (await browser.storage.local.get(LAST_CLEANUP_KEY))[LAST_CLEANUP_KEY];
            if (!value || typeof value !== 'object' || !Number.isFinite(value.time)) return null;
            return { time: value.time, removed: value.removed && typeof value.removed === 'object' ? value.removed : {} };
        } catch (e) {
            _log.error('Could not read the last storage cleanup: ' + e);
            return null;
        }
    }

    // ---- Writes ---------------------------------------------------------------------------------

    /**
     * Store the record of a type: in the mirror (storage.local) first, then in the database, under
     * the cleanup lock, so it never lands in the middle of a lot of a bulk removal (whose mirror
     * keys would otherwise lose it) or of a metadata fill (which would otherwise overwrite it).
     * A bulk removal releases the lock between two lots, so a write waits for one lot at most.
     * createdAt is taken once the lock is held. Skipped (resolves null), in both, when the
     * Message-ID is empty; with force false, also when a record already exists in either. A failed
     * mirror write rejects before the database is touched; a failed database write after it
     * rejects too and leaves the mirror key: the durable copy wins, and the next rebuild puts it
     * in the database.
     * @returns {Promise<object|null>} the stored record
     */
    async _write(type, messageId, data, force = true) {
        this.taLog.log('[write ' + type + '] messageId: ' + messageId + ', force: ' + force);
        if (!messageId) {
            this.taLog.error('[write ' + type + '] empty Message-ID (' + JSON.stringify(messageId) + '): nothing saved.');
            return null;
        }
        const key = mirrorKey(type, messageId);
        return withCleanupLock(async () => {
            const record = taStorage.buildRecord(type, messageId, data || {}, Date.now());
            try {
                if (!force && (await this._exists(type, messageId, key))) {
                    this.taLog.log('[write ' + type + '] a record already exists, skipping (force=false)');
                    return null;
                }
                // Before the transaction is opened: nothing but IndexedDB requests is awaited in it.
                await browser.storage.local.set({ [key]: record });
                const tx = await openTransaction(type, 'readwrite');
                await tx.store.put(record);
                await tx.done;
                return record;
            } catch (e) {
                this.taLog.error('write ' + type + ' error: ' + e);
                throw e;
            }
        });
    }

    /** Whether the mirror or the database holds a record of the type (the force = false check). */
    async _exists(type, messageId, key) {
        if (Object.hasOwn(await browser.storage.local.get(key), key)) return true;
        const tx = await openTransaction(type, 'readonly');
        const found = await tx.store.get(messageId);
        await tx.done;
        return found !== undefined;
    }

    /**
     * Delete the record of one type: its mirror key first, then the database record. A failed
     * mirror removal rejects before the database is touched. A database that cannot be opened has
     * nothing more to delete (its reads answer as empty): logged, resolves. A delete failing on an
     * open database rejects. Under the cleanup lock, like the writes: a realignment in lots never
     * puts back, between two lots, a record deleted after it read the mirror.
     */
    _deleteField(type, messageId) {
        this.taLog.log('[delete ' + type + '] messageId: ' + messageId);
        if (!messageId) return Promise.resolve();
        return withCleanupLock(() => this._deleteFieldLocked(type, messageId));
    }

    async _deleteFieldLocked(type, messageId) {
        try {
            await browser.storage.local.remove(mirrorKey(type, messageId));
        } catch (e) {
            this.taLog.error('delete ' + type + ' error (mirror): ' + e);
            throw e;
        }
        let tx;
        try {
            tx = await openTransaction(type, 'readwrite');
        } catch (e) {
            this.taLog.error('delete ' + type + ': the message database cannot be read, nothing to delete: ' + e);
            return;
        }
        try {
            await tx.store.delete(messageId);
            await tx.done;
        } catch (e) {
            this.taLog.error('delete ' + type + ' error: ' + e);
            throw e;
        }
    }

    /**
     * Write the spam report of a message.
     * @param {object} report_data - spamValue, explanation, subject, from, message_date, moved, SpamThreshold.
     */
    writeSpam(messageId, report_data, force = true) {
        return this._write(STORE_SPAM, messageId, report_data, force);
    }

    /** Delete the spam report of a message. */
    deleteSpamField(messageId) {
        return this._deleteField(STORE_SPAM, messageId);
    }

    /**
     * Write the summary of a message.
     * @param {object} summary_data - summary, summary_html, error, message, summary_date, plus the metadata.
     */
    writeSummary(messageId, summary_data, force = true) {
        return this._write(STORE_SUMMARY, messageId, summary_data, force);
    }

    /** Delete the summary of a message. */
    deleteSummaryField(messageId) {
        return this._deleteField(STORE_SUMMARY, messageId);
    }

    /**
     * Write the translation of a message.
     * @param {object} data - translated_text, translated_subject, translation_status ("1" ok,
     *   "-1" skipped), lang, error, message, plus the metadata.
     */
    writeTranslation(messageId, data, force = true) {
        return this._write(STORE_TRANSLATION, messageId, data, force);
    }

    /** Delete the translation of a message. */
    deleteTranslationField(messageId) {
        return this._deleteField(STORE_TRANSLATION, messageId);
    }

    /**
     * Delete the records of a message: its three mirror keys, then the three stores, in one
     * readwrite transaction, under the cleanup lock like every write and delete. Like
     * _deleteField(), the database part is a no-op when it cannot be opened.
     */
    deleteRecord(messageId) {
        this.taLog.log('[deleteRecord] messageId: ' + messageId);
        if (!messageId) return Promise.resolve();
        return withCleanupLock(async () => {
            try {
                await browser.storage.local.remove(MESSAGE_STORES.map(type => mirrorKey(type, messageId)));
            } catch (e) {
                this.taLog.error('deleteRecord error (mirror): ' + e);
                throw e;
            }
            let tx;
            try {
                tx = await openTransaction(MESSAGE_STORES, 'readwrite');
            } catch (e) {
                this.taLog.error('deleteRecord: the message database cannot be read, nothing to delete: ' + e);
                return;
            }
            try {
                await Promise.all(MESSAGE_STORES.map(name => tx.objectStore(name).delete(messageId)));
                await tx.done;
            } catch (e) {
                this.taLog.error('deleteRecord error: ' + e);
                throw e;
            }
        });
    }

    // ---- The smartbar store ---------------------------------------------------------------------
    //
    // One record per instruction typed in the SmartBar (claude-spec/10-smartbar.md), keyed by an
    // auto-increment id. Not mirrored: nothing is written to storage.local, and a database found
    // new is not rebuilt for it. Every write is under the cleanup lock, like the other stores. The
    // record itself (its fields and their states) is built by js/mzta-smartbar-store.js; here
    // only failed and size are computed, as buildRecord() does for the other stores.

    /** A smartbar record ready to be stored: failed (1 / 0) and size set, undefined fields dropped. */
    static finishSmartbarRecord(record) {
        const out = { ...record };
        out.failed = taStorage.isFailed(STORE_SMARTBAR, out) ? 1 : 0;
        for (const key of Object.keys(out)) {
            if (out[key] === undefined) delete out[key];
        }
        out.size = recordSize(out);
        return out;
    }

    /**
     * Store a new smartbar record (no id: the store gives one). Rejects when the write fails.
     * @returns {Promise<object>} the stored record, with its id
     */
    static smartbarAdd(record) {
        return withCleanupLock(async () => {
            const stored = taStorage.finishSmartbarRecord(record);
            delete stored.id;
            const tx = await openTransaction(STORE_SMARTBAR, 'readwrite');
            const id = await tx.store.add(stored);
            await tx.done;
            stored.id = id;
            return stored;
        });
    }

    /**
     * Rewrite a smartbar record (it has its id). createdAt is kept as given. Rejects when the
     * write fails; a record removed meanwhile (by the cleanup or a deletion) is not put back.
     * @returns {Promise<object|null>} the stored record, or null when it no longer exists
     */
    static smartbarPut(record) {
        return withCleanupLock(async () => {
            const stored = taStorage.finishSmartbarRecord(record);
            const tx = await openTransaction(STORE_SMARTBAR, 'readwrite');
            const existing = await tx.store.get(stored.id);
            if (!existing) {
                await tx.done;
                return null;
            }
            await tx.store.put(stored);
            await tx.done;
            return stored;
        });
    }

    /** A smartbar record by id; null when there is none or the database cannot be read. */
    static async smartbarGet(id) {
        try {
            await rebuildDone();
            const tx = await openTransaction(STORE_SMARTBAR, 'readonly');
            const record = await tx.store.get(id);
            await tx.done;
            return record || null;
        } catch (e) {
            _log.error('smartbarGet error (answered as no record): ' + e);
            return null;
        }
    }

    /**
     * The newest smartbar record of a message (the highest id on the messageId index); null when
     * there is none or the database cannot be read.
     */
    static async smartbarLatestForMessage(messageId) {
        if (!messageId) return null;
        try {
            await rebuildDone();
            const tx = await openTransaction(STORE_SMARTBAR, 'readonly');
            const cursor = await tx.store.index(INDEX_MESSAGE_ID).openCursor(IDBKeyRange.only(messageId), 'prev');
            const record = cursor ? cursor.value : null;
            await tx.done;
            return record;
        } catch (e) {
            _log.error('smartbarLatestForMessage error (answered as no record): ' + e);
            return null;
        }
    }

    /**
     * The smartbar records of a session (the sessionId index), oldest first by createdAt (then
     * id): the last `limit` of them, and how many the session holds. The chat of the SmartBar
     * loads a session through it. { records: [], total: 0 } when there is none or the database
     * cannot be read.
     * @returns {Promise<{ records: object[], total: number }>}
     */
    static async smartbarSessionRecords(sessionId, limit = 50) {
        if (!sessionId) return { records: [], total: 0 };
        try {
            await rebuildDone();
            const tx = await openTransaction(STORE_SMARTBAR, 'readonly');
            const all = await tx.store.index(INDEX_SESSION_ID).getAll(IDBKeyRange.only(sessionId));
            await tx.done;
            all.sort((a, b) => (a.createdAt - b.createdAt) || (a.id - b.id));
            const max = Number.isInteger(limit) && limit > 0 ? limit : all.length;
            return { records: all.slice(Math.max(0, all.length - max)), total: all.length };
        } catch (e) {
            _log.error('smartbarSessionRecords error (answered as none): ' + e);
            return { records: [], total: 0 };
        }
    }

    /**
     * The distinct instructions of the smartbar store, most recent first, at most `limit` of
     * them (the history suggestions of the bar). Reads at most `limit * 20` records. [] when
     * `limit` is 0 or the database cannot be read.
     */
    static async smartbarRecentInstructions(limit) {
        if (!Number.isInteger(limit) || limit <= 0) return [];
        try {
            await rebuildDone();
            const tx = await openTransaction(STORE_SMARTBAR, 'readonly');
            const seen = new Set();
            const out = [];
            let read = 0;
            let cursor = await tx.store.index(INDEX_CREATED_AT).openCursor(null, 'prev');
            while (cursor && out.length < limit && read < limit * 20) {
                read++;
                const text = cursor.value.instruction;
                if (typeof text === 'string' && text.trim() !== '' && !seen.has(text)) {
                    seen.add(text);
                    out.push(text);
                }
                cursor = await cursor.continue();
            }
            await tx.done;
            return out;
        } catch (e) {
            _log.error('smartbarRecentInstructions error (answered as none): ' + e);
            return [];
        }
    }

    /**
     * The smartbar records of the Activity tab of the SmartBar page, newest first (the highest
     * id first): those whose state is one of `states` (every record when `states` is null), at
     * most `limit` of them, older than the record `beforeId` when given (the next page).
     * { records: [], more: false } when the database cannot be read.
     * @returns {Promise<{ records: object[], more: boolean }>}
     */
    static async smartbarList({ states = null, limit = 200, beforeId = null } = {}) {
        try {
            await rebuildDone();
            const max = Number.isInteger(limit) && limit > 0 ? limit : 200;
            const wanted = Array.isArray(states) ? new Set(states) : null;
            const range = Number.isInteger(beforeId) ? IDBKeyRange.upperBound(beforeId, true) : null;
            const tx = await openTransaction(STORE_SMARTBAR, 'readonly');
            const records = [];
            let more = false;
            let cursor = await tx.store.openCursor(range, 'prev');
            while (cursor) {
                if (!wanted || wanted.has(cursor.value.state)) {
                    if (records.length === max) {
                        more = true;
                        break;
                    }
                    records.push(cursor.value);
                }
                cursor = await cursor.continue();
            }
            await tx.done;
            return { records, more };
        } catch (e) {
            _log.error('smartbarList error (answered as none): ' + e);
            return { records: [], more: false };
        }
    }

    /**
     * The smartbar records in one state (the state index), in no particular order. [] when the
     * database cannot be read.
     */
    static async smartbarByState(state) {
        try {
            await rebuildDone();
            const tx = await openTransaction(STORE_SMARTBAR, 'readonly');
            const records = await tx.store.index(INDEX_STATE).getAll(IDBKeyRange.only(state));
            await tx.done;
            return records;
        } catch (e) {
            _log.error('smartbarByState error (answered as none): ' + e);
            return [];
        }
    }

    /**
     * Remove one smartbar record (the Activity tab's Remove). A record still running is kept,
     * like by every bulk removal. Resolves the removed record, or null when there was none to
     * remove (absent or running).
     */
    static smartbarDelete(id) {
        return withCleanupLock(async () => {
            const tx = await openTransaction(STORE_SMARTBAR, 'readwrite');
            const existing = await tx.store.get(id);
            if (!existing || isKeptRecord(STORE_SMARTBAR, existing)) {
                await tx.done;
                return null;
            }
            await tx.store.delete(id);
            await tx.done;
            return existing;
        });
    }

    /**
     * Remove every smartbar record in state 'error' (the Activity tab's Remove all errors), in
     * one transaction, but the ids of `exceptIds` (the records the background is retrying: still
     * stored in error, running in memory). Resolves the removed records' { id, messageId }.
     */
    static smartbarDeleteErrors(exceptIds = []) {
        const kept = new Set(exceptIds);
        return withCleanupLock(async () => {
            const tx = await openTransaction(STORE_SMARTBAR, 'readwrite');
            const removed = [];
            let cursor = await tx.store.index(INDEX_STATE).openCursor(IDBKeyRange.only('error'));
            while (cursor) {
                if (kept.has(cursor.primaryKey)) {
                    cursor = await cursor.continue();
                    continue;
                }
                removed.push({ id: cursor.primaryKey, messageId: cursor.value.messageId });
                await cursor.delete();
                cursor = await cursor.continue();
            }
            await tx.done;
            return removed;
        });
    }

    /**
     * At startup: every smartbar record still 'running' was cut short by the end of the previous
     * session. It becomes 'interrupted', and its running operations 'cancelled'; it then expires
     * like any other. Resolves the number of records changed.
     */
    static smartbarMarkInterrupted(now = Date.now()) {
        return withCleanupLock(async () => {
            const tx = await openTransaction(STORE_SMARTBAR, 'readwrite');
            let changed = 0;
            let cursor = await tx.store.index(INDEX_STATE).openCursor(IDBKeyRange.only(SMARTBAR_STATE_RUNNING));
            while (cursor) {
                const record = { ...cursor.value, state: 'interrupted' };
                if (Array.isArray(record.operations)) {
                    record.operations = record.operations.map(op => (op?.state === 'running' || op?.state === 'pending_confirmation')
                        ? { ...op, state: 'cancelled', finishedAt: now }
                        : op);
                }
                await cursor.update(taStorage.finishSmartbarRecord(record));
                changed++;
                cursor = await cursor.continue();
            }
            await tx.done;
            return changed;
        });
    }

    // ---- Bulk removals, in lots -----------------------------------------------------------------
    //
    // Every bulk removal works in lots of message_storage_batch_size records (readBatchSize()):
    // each lot takes the cleanup lock, deletes its records in one transaction, removes their
    // mirror keys (removeMirrorKeysIfUnchanged()) and releases the lock. Web Locks grant the
    // requests in order, so a write of the background queued during a lot runs before the next
    // one: it waits for one lot, never for the whole operation, and never lands inside a lot. An
    // operation touches only what existed when it started (its ranges end at a time fixed then).
    // It is no longer atomic: on a failure the lots already done stay done, and the error carries
    // what was removed before it (error.removed, per type).

    /**
     * Empty one type, in lots: every record created up to the start (clearBound()), then, in one
     * last step under the lock, the mirror keys of that type the lots did not reach (found with
     * one storage.local get(null): a rare, user-initiated action) that are not newer than the
     * start either. A record written meanwhile is kept, in both places.
     * @returns {Promise<number>} the number of records removed from the store
     */
    static async clear(type) {
        if (!ALL_STORES.includes(type)) throw new Error('Unknown message data type: ' + type);
        const removed = { [type]: 0 };
        try {
            const batch = await readBatchSize();
            const bound = await clearBound([type]);
            await deleteRangeInLots(type, INDEX_CREATED_AT, IDBKeyRange.upperBound(bound), batch, removed);
            if (STORE_MIRRORED[type]) await withCleanupLock(() => removeMirrorKeysUpTo([type], bound));
            return removed[type];
        } catch (e) {
            _log.error('clear ' + type + ' error: ' + e);
            throw withRemoved(e, removed);
        }
    }

    /**
     * Empty the three types, as clear() does for each, with one last step for the mirror keys of
     * the three.
     * @returns {Promise<number>} the number of records removed from the stores
     */
    static async clearAllRecords() {
        const removed = zeroByType();
        try {
            const batch = await readBatchSize();
            const bound = await clearBound(ALL_STORES);
            for (const type of ALL_STORES) {
                await deleteRangeInLots(type, INDEX_CREATED_AT, IDBKeyRange.upperBound(bound), batch, removed);
            }
            await withCleanupLock(() => removeMirrorKeysUpTo(MESSAGE_STORES, bound));
            return Object.values(removed).reduce((a, b) => a + b, 0);
        } catch (e) {
            _log.error('clearAllRecords error: ' + e);
            throw withRemoved(e, removed);
        }
    }

    /**
     * Delete every record that holds an error (failed 1) and was created up to now, of every
     * type, in lots: a cursor on the failed_createdAt index.
     * @returns {Promise<object>} the number of records removed, per type
     */
    static async deleteErrors(now = Date.now()) {
        const removed = zeroByType();
        try {
            const batch = await readBatchSize();
            for (const type of ALL_STORES) {
                await deleteRangeInLots(type, INDEX_FAILED_CREATED_AT, errorRange(now), batch, removed);
            }
            return removed;
        } catch (e) {
            _log.error('deleteErrors error: ' + e);
            throw withRemoved(e, removed);
        }
    }

    /**
     * Delete every record older than `days` days (by createdAt), of every type, in lots.
     * @param {number} days a positive integer
     * @returns {Promise<object>} the number of records removed, per type
     */
    static async deleteOlderThan(days, now = Date.now()) {
        if (!Number.isInteger(days) || days <= 0) throw new Error('Invalid number of days: ' + days);
        const removed = zeroByType();
        try {
            const batch = await readBatchSize();
            const range = IDBKeyRange.upperBound(cutoff(now, days), true);
            for (const type of ALL_STORES) {
                await deleteRangeInLots(type, INDEX_CREATED_AT, range, batch, removed);
            }
            return removed;
        } catch (e) {
            _log.error('deleteOlderThan error: ' + e);
            throw withRemoved(e, removed);
        }
    }

    /**
     * Delete the given records, in lots: each only if the database still holds it with the
     * createdAt given (a record written since then is kept; putNewerRecords()), then the mirror
     * keys that still hold that createdAt (removeMirrorKeysIfUnchanged()). The orphans of the
     * storage management page.
     * @param {{type: string, messageId: string, createdAt: number}[]} entries
     * @returns {Promise<object>} the number of records removed, per type
     */
    static async removeEntries(entries) {
        // The per-message types only: their entries are what the orphan scan lists.
        const removed = Object.fromEntries(MESSAGE_STORES.map(type => [type, 0]));
        try {
            const batch = await readBatchSize();
            const valid = entries.filter(e => MESSAGE_STORES.includes(e?.type) && e.messageId);
            for (let i = 0; i < valid.length; i += batch) {
                const lot = valid.slice(i, i + batch);
                await withCleanupLock(async () => {
                    const { removedByType } = await putNewerRecords([], lot);
                    await removeMirrorKeysIfUnchanged(Object.fromEntries(MESSAGE_STORES.map(type =>
                        [type, lot.filter(e => e.type === type)])));
                    for (const type of MESSAGE_STORES) removed[type] += removedByType[type];
                });
            }
            return removed;
        } catch (e) {
            _log.error('removeEntries error: ' + e);
            throw withRemoved(e, removed);
        }
    }

    /**
     * Fill the empty message metadata of one record, under the cleanup lock (so no cleanup removes
     * it halfway and no write of the background lands between its reads and its writes):
     * rewritten through buildRecord() with the same createdAt (size recomputed), only if both the
     * mirror value and the database record still have the createdAt given and empty metadata.
     * Mirror first, then the database, as every write; the database put re-checks the record in
     * its own transaction.
     *
     * @param {string} type
     * @param {string} messageId
     * @param {number} createdAt the createdAt seen when the entry was listed
     * @param {object} metadata  { subject, from, message_date } (buildMessageMetadata())
     * @returns {Promise<boolean>} whether the record was rewritten
     */
    static fillMetadata(type, messageId, createdAt, metadata) {
        if (!MESSAGE_STORES.includes(type)) return Promise.reject(new Error('Unknown message data type: ' + type));
        return withCleanupLock(async () => {
            try {
                const key = mirrorKey(type, messageId);
                const inMirror = (await browser.storage.local.get(key))[key];
                if (!isStorableRecord(inMirror, messageId) || inMirror.createdAt !== createdAt || !hasEmptyMetadata(inMirror)) return false;
                const check = await openTransaction(type, 'readonly');
                const inDb = await check.store.get(messageId);
                await check.done;
                if (!inDb || inDb.createdAt !== createdAt || !hasEmptyMetadata(inDb)) return false;

                const { messageId: _id, createdAt: _at, size: _size, failed: _failed, ...fields } = inDb;
                const record = taStorage.buildRecord(type, messageId, {
                    ...fields,
                    subject: metadata?.subject,
                    from: metadata?.from,
                    message_date: metadata?.message_date,
                }, createdAt);
                if (hasEmptyMetadata(record)) return false;

                await browser.storage.local.set({ [key]: record });
                const tx = await openTransaction(type, 'readwrite');
                const current = await tx.store.get(messageId);
                let written = false;
                if (current && current.createdAt === createdAt && hasEmptyMetadata(current)) {
                    await tx.store.put(record);
                    written = true;
                }
                await tx.done;
                return written;
            } catch (e) {
                _log.error('fillMetadata ' + type + ' error: ' + e);
                throw e;
            }
        });
    }

    // ---- The mirror: rebuild and realignment --------------------------------------------------

    /**
     * Align the database with the mirror, ONE WAY (the mirror is the source of truth): the rebuild
     * after an eviction (reconcileIfNew()) and the manual realignment of the storage management
     * page (the background's reconcileMessageStorage command). Background only: a page asks the
     * background. It never writes to storage.local.
     *
     * In one step under the cleanup lock it reads the mirror (one storage.local get(null),
     * filtered on the prefixes) and the three stores, then for each type and Message-ID:
     *   - a mirror record missing from the database, or newer than its record there (createdAt),
     *     is put into its store ("restored");
     *   - a database record with no mirror key is removed from its store ("removed"): it was
     *     deleted from the durable copy (a delete whose database part did not complete).
     * A mirror value that is not a record of its key (not an object, another messageId) is logged
     * and left alone, and so is the database record of that Message-ID. The puts and removals then
     * run in lots (message_storage_batch_size), each its own transaction under the lock
     * (putNewerRecords()); a write or a delete made between two lots goes through the lock too,
     * and wins: a record the store holds as new or newer is kept, a record whose createdAt changed
     * is not removed. On a failure the lots done stay done (running it again finishes the job);
     * it rejects.
     *
     * @param {object} [options]
     * @param {number} [options.batchSize] the lot size; read from message_storage_batch_size when
     *   omitted. The rebuild (reconcileIfNew()) passes DEFAULT_BATCH_SIZE: at startup it runs
     *   before the background has loaded the policy, when a preference read would make the
     *   background ask itself for the policy values.
     * @returns {Promise<object>} { [type]: { restored, removed } }
     */
    static async reconcileWithMirror({ batchSize = null } = {}) {
        try {
            const batch = batchSize ?? await readBatchSize();
            const { toPut, toRemove } = await withCleanupLock(async () => {
                const mirror = await readMirror();
                const tx = await openTransaction(MESSAGE_STORES, 'readonly');
                const stored = await Promise.all(MESSAGE_STORES.map(name => tx.objectStore(name).getAll()));
                await tx.done;

                const puts = [];
                const removals = [];
                MESSAGE_STORES.forEach((type, i) => {
                    const inDb = new Map(stored[i].map(record => [record.messageId, record]));
                    for (const [id, value] of mirror[type]) {
                        if (!isStorableRecord(value, id)) {
                            _log.warn('reconcile: the mirror key ' + JSON.stringify(mirrorKey(type, id)) + ' holds no record of its message, left alone.');
                            continue;
                        }
                        const current = inDb.get(id);
                        if (!current || isNewer(value, current)) puts.push({ type, record: value });
                    }
                    for (const [id, record] of inDb) {
                        if (!mirror[type].has(id)) removals.push({ type, messageId: id, createdAt: record.createdAt });
                    }
                });
                return { toPut: puts, toRemove: removals };
            });

            const result = Object.fromEntries(MESSAGE_STORES.map(type => [type, { restored: 0, removed: 0 }]));
            const lots = Math.max(Math.ceil(toPut.length / batch), Math.ceil(toRemove.length / batch));
            for (let i = 0; i < lots; i++) {
                const puts = toPut.slice(i * batch, (i + 1) * batch);
                const removals = toRemove.slice(i * batch, (i + 1) * batch);
                const { byType, removedByType } = await withCleanupLock(() => putNewerRecords(puts, removals));
                for (const type of MESSAGE_STORES) {
                    result[type].restored += byType[type];
                    result[type].removed += removedByType[type];
                }
            }
            _log.log('Message storage reconciled with the mirror: ' + JSON.stringify(result));
            return result;
        } catch (e) {
            _log.error('reconcileWithMirror error: ' + e);
            throw e;
        }
    }

    /**
     * Rebuild the database from the mirror when an open of this context found it new (created by
     * that open: first start, evicted, or deleted and created again by openCheckedMessageDB()).
     * Opens the database first. Resolves the counts of reconcileWithMirror(), or null when the
     * database was not new. A failed rebuild keeps the mark, so the next call tries again.
     * Background only: at startup, after the move of the legacy records, and after every reopen
     * once startRebuildWatch() has been called.
     */
    static async reconcileIfNew() {
        await taStorage.openDB();
        if (!_dbIsNew) return null;
        _dbIsNew = false;
        _log.log('The message database is new: rebuilding it from the storage.local mirror.');
        try {
            // The default lot size: no preference read before the policy is loaded (see above).
            return await taStorage.reconcileWithMirror({ batchSize: DEFAULT_BATCH_SIZE });
        } catch (e) {
            _dbIsNew = true;
            throw e;
        }
    }

    /**
     * Background only, after the startup reconcileIfNew(): from now on a connection lost
     * (blocking, terminated) is opened again at once, and a database found new is rebuilt from
     * the mirror; until that rebuild ends, the reads of this context (getRecord(), getPage(),
     * count(), getTotalSize()) wait for it. The writes do not: they go to the mirror first, and
     * the rebuild keeps a record the store holds as new or newer. The pages never call it: they
     * show what the database holds.
     */
    static startRebuildWatch() {
        _rebuildWatch = true;
    }

    // ---- Cleanup --------------------------------------------------------------------------------

    /**
     * The limits of every type, from the preferences:
     * { [type]: { maxEntries, maxAgeDays, errorMaxAgeDays } }, each a positive integer or 0 (no limit).
     */
    static async readLimits() {
        const keys = ALL_STORES.flatMap(type => Object.values(STORAGE_PREFS[type]));
        const prefs = await mztaPrefs.getPrefs(keys);
        const out = {};
        for (const type of ALL_STORES) {
            out[type] = {
                maxEntries: toLimit(prefs[STORAGE_PREFS[type].maxEntries]),
                maxAgeDays: toLimit(prefs[STORAGE_PREFS[type].maxAgeDays]),
                errorMaxAgeDays: toLimit(prefs[STORAGE_PREFS[type].errorMaxAgeDays]),
            };
        }
        return out;
    }

    /**
     * The one cleanup routine. For each type, in this order:
     *   1. the records that hold an error (failed 1) older than its maximum error age (a cursor on
     *      the failed_createdAt index);
     *   2. the records older than its maximum age (a cursor on createdAt);
     *   3. the oldest records beyond its maximum count (the excess computed again at each lot).
     * A limit of 0 disables its rule. Every rule runs in lots of message_storage_batch_size
     * (deleteRangeInLots(), deleteExcessInLots()): each lot under the cleanup lock, its mirror
     * keys removed in the same hold, the lock released between two lots so the writes of the
     * background go through. The manual "Apply rules now" of the storage management page calls it
     * too: only the scheduled run stores LAST_CLEANUP_KEY. On a failure the lots done stay done,
     * and the error carries what was removed before it (error.removed).
     *
     * @param {object} [limits] { [type]: { maxEntries, maxAgeDays, errorMaxAgeDays } }; read from
     *   the preferences when omitted
     * @param {number} [now]
     * @returns {Promise<object>} the number of records removed, per type
     */
    static async cleanup(limits = null, now = Date.now()) {
        const removed = zeroByType();
        try {
            const resolved = limits || await taStorage.readLimits();
            const batch = await readBatchSize();
            for (const type of ALL_STORES) {
                const { maxEntries, maxAgeDays, errorMaxAgeDays } = normalizeLimits(resolved[type]);
                if (errorMaxAgeDays > 0) {
                    await deleteRangeInLots(type, INDEX_FAILED_CREATED_AT,
                        errorRange(cutoff(now, errorMaxAgeDays), true), batch, removed);
                }
                if (maxAgeDays > 0) {
                    await deleteRangeInLots(type, INDEX_CREATED_AT,
                        IDBKeyRange.upperBound(cutoff(now, maxAgeDays), true), batch, removed);
                }
                if (maxEntries > 0) await deleteExcessInLots(type, maxEntries, batch, removed);
            }
        } catch (e) {
            _log.error('Storage cleanup error: ' + e);
            throw withRemoved(e, removed);
        }
        _log.log('Storage cleanup: removed ' + JSON.stringify(removed));
        return removed;
    }

    /**
     * What cleanup(limits, now) would remove, per type, from counts only: no record is loaded,
     * nothing is deleted, no lock is taken (one readonly transaction). For each type:
     *   - the records older than the age cutoff;
     *   - plus the errors the error rule removes that the age rule does not reach: those between
     *     the age cutoff and the error cutoff (all the errors older than the error cutoff when
     *     there is no age rule; none when the error cutoff is not newer than the age cutoff);
     *   - plus max(0, total - the two above - maxEntries) for the count rule.
     * The storage management page passes the values of its form, saved or not. When the database
     * cannot be read, every type is answered 0.
     *
     * @param {object} limits { [type]: { maxEntries, maxAgeDays, errorMaxAgeDays } }
     * @param {number} [now]
     * @returns {Promise<object>} the number of records cleanup() would remove, per type
     */
    static async previewCleanup(limits, now = Date.now()) {
        try {
            await rebuildDone();
            const tx = await openTransaction(ALL_STORES, 'readonly');
            const out = zeroByType();
            for (const type of ALL_STORES) {
                const { maxEntries, maxAgeDays, errorMaxAgeDays } = normalizeLimits(limits?.[type]);
                const store = tx.objectStore(type);
                const total = await store.count();
                const ageCut = maxAgeDays > 0 ? cutoff(now, maxAgeDays) : -Infinity;
                const errorCut = errorMaxAgeDays > 0 ? cutoff(now, errorMaxAgeDays) : -Infinity;
                // The records no rule removes (a running SmartBar instruction), counted on the
                // state_failed_createdAt index: `kept` of them, `keptOld` older than the age
                // cutoff, `keptError` holding an error between the age and the error cutoffs.
                let kept = 0;
                let keptOld = 0;
                let keptError = 0;
                if (type === STORE_SMARTBAR) {
                    const index = store.index(INDEX_STATE_FAILED_CREATED_AT);
                    const running = (failed, from, to) => index.count(IDBKeyRange.bound(
                        [SMARTBAR_STATE_RUNNING, failed, from], [SMARTBAR_STATE_RUNNING, failed, to], false, true));
                    kept = await running(0, -Infinity, Infinity) + await running(1, -Infinity, Infinity);
                    if (maxAgeDays > 0) keptOld = await running(0, -Infinity, ageCut) + await running(1, -Infinity, ageCut);
                    if (errorCut > ageCut) keptError = await running(1, ageCut, errorCut);
                }
                const byAge = maxAgeDays > 0
                    ? await store.index(INDEX_CREATED_AT).count(IDBKeyRange.upperBound(ageCut, true)) - keptOld
                    : 0;
                let byError = 0;
                if (errorCut > ageCut) {
                    byError = await store.index(INDEX_FAILED_CREATED_AT)
                        .count(IDBKeyRange.bound([1, ageCut], [1, errorCut], false, true)) - keptError;
                }
                // The count rule cannot take a kept record either: of what the first two rules
                // leave, it removes the excess, at most the records that are not kept.
                const byCount = maxEntries > 0
                    ? Math.min(Math.max(0, total - byAge - byError - maxEntries), total - byAge - byError - kept)
                    : 0;
                out[type] = byAge + byError + byCount;
            }
            await tx.done;
            return out;
        } catch (e) {
            _log.error('previewCleanup error (answered as 0): ' + e);
            return zeroByType();
        }
    }

    /**
     * Start the scheduled cleanup (background only, without the alarms permission): one timer at
     * a time, no periodic checks. With message_storage_cleanup_auto false (read through
     * mztaPrefs, so a policy value counts) it only stops the pending timer. Otherwise, if the last
     * completed cleanup is older than 24 hours (or there is none) it runs at once, else 2 hours
     * later; after each successful run { time, removed } is saved in storage.local and the next
     * run is set 24 hours later. A failed run is logged and still sets the next one. Calling it
     * again replaces the pending timer (the background calls it on every change of the switch).
     */
    static async startCleanupSchedule() {
        taStorage.stopCleanupSchedule();
        const generation = _scheduleGeneration;
        let auto = true;
        try {
            auto = (await mztaPrefs.getPref(CLEANUP_AUTO_PREF)) !== false;
        } catch (e) {
            _log.error('Could not read ' + CLEANUP_AUTO_PREF + ': ' + e);
        }
        // A later call (the switch changed again) has taken over meanwhile.
        if (generation !== _scheduleGeneration) return;
        if (!auto) {
            _log.log('The scheduled storage cleanup is off.');
            return;
        }
        const last = (await taStorage.getLastCleanup())?.time || 0;
        if (generation !== _scheduleGeneration) return;
        if (Date.now() - last >= CLEANUP_INTERVAL_MS) {
            await taStorage._runScheduledCleanup();
        } else {
            taStorage._scheduleCleanup(CLEANUP_STARTUP_DELAY_MS);
        }
    }

    /** Clear the pending timer of the scheduled cleanup. */
    static stopCleanupSchedule() {
        if (_cleanupTimer !== null) clearTimeout(_cleanupTimer);
        _cleanupTimer = null;
        // A run in progress does not set its next one.
        _scheduleGeneration++;
    }

    static _scheduleCleanup(delay) {
        if (_cleanupTimer !== null) clearTimeout(_cleanupTimer);
        _cleanupTimer = setTimeout(() => {
            _cleanupTimer = null;
            taStorage._runScheduledCleanup();
        }, delay);
    }

    static async _runScheduledCleanup() {
        const generation = _scheduleGeneration;
        try {
            const removed = await taStorage.cleanup();
            await browser.storage.local.set({ [LAST_CLEANUP_KEY]: { time: Date.now(), removed } });
        } catch (e) {
            _log.error('Storage cleanup error: ' + e);
        }
        // Not when the schedule was stopped or restarted while this run was going on.
        if (generation === _scheduleGeneration) taStorage._scheduleCleanup(CLEANUP_INTERVAL_MS);
    }
}
