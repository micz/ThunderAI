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
 *  Who opens the database: the background (every read and write of the message flow, the
 *  migration from storage.local, the scheduled cleanup) and the management pages (the options
 *  page, the spam filter page). The message display and compose scripts never do: they go
 *  through the background.
 *
 *  Two rules hold everywhere below:
 *   - nothing but IndexedDB requests is awaited inside a transaction: a transaction commits as
 *     soon as the event loop is idle, so a preference read in the middle would end it;
 *   - a write never swallows its error: it is logged, then the promise rejects, so the caller
 *     can tell the user.
 */

import { openDB } from './lib/idb.js';
import { taLogger } from './mzta-logger.js';
import { mztaPrefs } from './mzta-prefs.js';

/** The database, its schema version, its object stores and their indexes. */
export const MESSAGE_DB_NAME = 'thunderai-message-data';
export const MESSAGE_DB_VERSION = 1;
export const STORE_SPAM = 'spam';
export const STORE_SUMMARY = 'summary';
export const STORE_TRANSLATION = 'translation';
export const MESSAGE_STORES = Object.freeze([STORE_SPAM, STORE_SUMMARY, STORE_TRANSLATION]);
export const INDEX_CREATED_AT = 'createdAt';
export const INDEX_SIZE = 'size';

/** The Web Lock every cleanup and every bulk removal runs under, in every context. */
export const CLEANUP_LOCK_NAME = 'thunderai-storage-cleanup';

/**
 * storage.local key set while the background moves the legacy msg: records into the database
 * (js/mzta-storage-migration.js). The management pages show a notice instead of an empty table
 * while it is present. There is no "done" flag: with nothing to migrate, nothing is set.
 */
export const MIGRATION_FLAG_KEY = '_message_data_migrating';

/** storage.local key holding the time (ms) of the last completed scheduled cleanup. */
export const LAST_CLEANUP_KEY = '_message_data_last_cleanup';

/** The preferences of each type: saving enabled, maximum entries, maximum age in days. */
export const STORAGE_PREFS = Object.freeze({
    [STORE_SPAM]: Object.freeze({
        enabled: 'spamfilter_storage_enabled',
        maxEntries: 'spamfilter_storage_max_entries',
        maxAgeDays: 'spamfilter_storage_max_age_days',
    }),
    [STORE_SUMMARY]: Object.freeze({
        enabled: 'summarize_storage_enabled',
        maxEntries: 'summarize_storage_max_entries',
        maxAgeDays: 'summarize_storage_max_age_days',
    }),
    [STORE_TRANSLATION]: Object.freeze({
        enabled: 'translate_storage_enabled',
        maxEntries: 'translate_storage_max_entries',
        maxAgeDays: 'translate_storage_max_age_days',
    }),
});

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

/** The value as an ISO string when it is a Date, else unchanged. */
function toIsoDate(value) {
    return value instanceof Date ? value.toISOString() : value;
}

/** A limit as stored: a positive integer, or 0 (no limit) for anything else. */
function toLimit(value) {
    return Number.isInteger(value) && value > 0 ? value : 0;
}

/** Run fn() under the cleanup lock. Without the Web Locks API, fn() runs directly. */
function withCleanupLock(fn) {
    const locks = globalThis.navigator?.locks;
    if (!locks || typeof locks.request !== 'function') {
        _log.warn('navigator.locks is not available: running without the storage cleanup lock.');
        return fn();
    }
    return locks.request(CLEANUP_LOCK_NAME, fn);
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
     * The connection of this context, opened once. Future schema versions go in upgrade().
     * @returns {Promise<IDBPDatabase>}
     */
    static openDB() {
        if (_dbPromise) return _dbPromise;
        const opening = openDB(MESSAGE_DB_NAME, MESSAGE_DB_VERSION, {
            upgrade(db, oldVersion) {
                if (oldVersion < 1) {
                    for (const name of MESSAGE_STORES) {
                        const store = db.createObjectStore(name, { keyPath: 'messageId' });
                        store.createIndex(INDEX_CREATED_AT, 'createdAt');
                        store.createIndex(INDEX_SIZE, 'size');
                    }
                }
            },
            blocked(currentVersion, blockedVersion) {
                _log.warn('The message database (version ' + currentVersion + ') is open in another context: waiting to open version ' + blockedVersion + '.');
            },
            blocking(currentVersion, blockedVersion) {
                // Another context needs to upgrade: let it. The next call opens a new connection.
                _log.log('Closing the message database (version ' + currentVersion + ') for an upgrade to version ' + blockedVersion + '.');
                if (_dbPromise === opening) _dbPromise = null;
                opening.then(db => db.close()).catch(() => {});
            },
            terminated() {
                _log.warn('The message database connection was closed by the browser.');
                if (_dbPromise === opening) _dbPromise = null;
            },
        });
        _dbPromise = opening;
        // A failed open is not kept: the next call tries again.
        opening.catch(() => { if (_dbPromise === opening) _dbPromise = null; });
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
            // The shape _buildReportMetadata() gives (mzta-background.js): subject and from are
            // arrays (MIME headers), message_date an ISO string. Empty when not known.
            subject: data.subject ?? [],
            from: data.from ?? [],
            message_date: toIsoDate(data.message_date) ?? '',
            ...typeFields(type, data),
        };
        for (const key of Object.keys(record)) {
            if (record[key] === undefined) delete record[key];
        }
        record.size = new TextEncoder().encode(JSON.stringify(record)).byteLength;
        return record;
    }

    /** Whether saving is enabled for the type (preference {feature}_storage_enabled). */
    static async isSavingEnabled(type) {
        const key = STORAGE_PREFS[type]?.enabled;
        if (!key) throw new Error('Unknown message data type: ' + type);
        return (await mztaPrefs.getPref(key)) !== false;
    }

    /** Whether the background is moving legacy records into the database (see MIGRATION_FLAG_KEY). */
    static async isMigrating() {
        try {
            const result = await browser.storage.local.get(MIGRATION_FLAG_KEY);
            return result[MIGRATION_FLAG_KEY] === true;
        } catch (e) {
            _log.error('Could not read the migration flag: ' + e);
            return false;
        }
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
            const db = await taStorage.openDB();
            const tx = db.transaction(MESSAGE_STORES, 'readonly');
            const found = await Promise.all(MESSAGE_STORES.map(name => tx.objectStore(name).get(messageId)));
            await tx.done;
            const out = {};
            MESSAGE_STORES.forEach((name, i) => { if (found[i]) out[name] = found[i]; });
            const record = Object.keys(out).length > 0 ? out : null;
            this.taLog.log('[getRecord] record found: ' + (record !== null));
            return record;
        } catch (e) {
            this.taLog.error('getRecord error: ' + e);
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
     * @returns {Promise<object[]>}
     */
    static async getPage(type, { offset = 0, limit = 50 } = {}) {
        const db = await taStorage.openDB();
        const tx = db.transaction(type, 'readonly');
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
    }

    /** The number of records of a type. */
    static async count(type) {
        const db = await taStorage.openDB();
        return await db.count(type);
    }

    /**
     * The bytes taken by the records of the three stores: the sum of their size, read from the
     * size index with a key cursor (the key is the size: no record is loaded).
     */
    static async getTotalSize() {
        const db = await taStorage.openDB();
        const tx = db.transaction(MESSAGE_STORES, 'readonly');
        let total = 0;
        for (const name of MESSAGE_STORES) {
            let cursor = await tx.objectStore(name).index(INDEX_SIZE).openKeyCursor();
            while (cursor) {
                if (typeof cursor.key === 'number') total += cursor.key;
                cursor = await cursor.continue();
            }
        }
        await tx.done;
        return total;
    }

    // ---- Writes ---------------------------------------------------------------------------------

    /**
     * Store the record of a type. Skipped (resolves null) when the Message-ID is empty or saving
     * is disabled for the type; with force false, also when a record already exists.
     * @returns {Promise<object|null>} the stored record
     */
    async _write(type, messageId, data, force = true) {
        this.taLog.log('[write ' + type + '] messageId: ' + messageId + ', force: ' + force);
        if (!messageId) {
            this.taLog.error('[write ' + type + '] empty Message-ID (' + JSON.stringify(messageId) + '): nothing saved.');
            return null;
        }
        if (!(await taStorage.isSavingEnabled(type))) {
            this.taLog.log('[write ' + type + '] saving is disabled for this type, nothing saved.');
            return null;
        }
        const record = taStorage.buildRecord(type, messageId, data || {}, Date.now());
        try {
            const db = await taStorage.openDB();
            const tx = db.transaction(type, 'readwrite');
            if (!force && (await tx.store.get(messageId))) {
                this.taLog.log('[write ' + type + '] a record already exists, skipping (force=false)');
                await tx.done;
                return null;
            }
            await tx.store.put(record);
            await tx.done;
            return record;
        } catch (e) {
            this.taLog.error('write ' + type + ' error: ' + e);
            throw e;
        }
    }

    /** Delete the record of one type. */
    async _deleteField(type, messageId) {
        this.taLog.log('[delete ' + type + '] messageId: ' + messageId);
        if (!messageId) return;
        try {
            const db = await taStorage.openDB();
            await db.delete(type, messageId);
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

    /** Delete the records of a message from the three stores, in one readwrite transaction. */
    async deleteRecord(messageId) {
        this.taLog.log('[deleteRecord] messageId: ' + messageId);
        if (!messageId) return;
        try {
            const db = await taStorage.openDB();
            const tx = db.transaction(MESSAGE_STORES, 'readwrite');
            await Promise.all(MESSAGE_STORES.map(name => tx.objectStore(name).delete(messageId)));
            await tx.done;
        } catch (e) {
            this.taLog.error('deleteRecord error: ' + e);
            throw e;
        }
    }

    /**
     * Empty the store of one type, under the cleanup lock.
     * @returns {Promise<number>} the number of records removed
     */
    static clear(type) {
        if (!MESSAGE_STORES.includes(type)) return Promise.reject(new Error('Unknown message data type: ' + type));
        return withCleanupLock(async () => {
            try {
                const db = await taStorage.openDB();
                const tx = db.transaction(type, 'readwrite');
                const n = await tx.store.count();
                await tx.store.clear();
                await tx.done;
                return n;
            } catch (e) {
                _log.error('clear ' + type + ' error: ' + e);
                throw e;
            }
        });
    }

    /**
     * Empty the three stores, in one transaction, under the cleanup lock.
     * @returns {Promise<number>} the number of records removed
     */
    static clearAllRecords() {
        return withCleanupLock(async () => {
            try {
                const db = await taStorage.openDB();
                const tx = db.transaction(MESSAGE_STORES, 'readwrite');
                let n = 0;
                for (const name of MESSAGE_STORES) {
                    const store = tx.objectStore(name);
                    n += await store.count();
                    await store.clear();
                }
                await tx.done;
                return n;
            } catch (e) {
                _log.error('clearAllRecords error: ' + e);
                throw e;
            }
        });
    }

    // ---- Cleanup --------------------------------------------------------------------------------

    /** The limits of every type, from the preferences: { [type]: { maxEntries, maxAgeDays } }. */
    static async readLimits() {
        const keys = MESSAGE_STORES.flatMap(type => [STORAGE_PREFS[type].maxEntries, STORAGE_PREFS[type].maxAgeDays]);
        const prefs = await mztaPrefs.getPrefs(keys);
        const out = {};
        for (const type of MESSAGE_STORES) {
            out[type] = {
                maxEntries: toLimit(prefs[STORAGE_PREFS[type].maxEntries]),
                maxAgeDays: toLimit(prefs[STORAGE_PREFS[type].maxAgeDays]),
            };
        }
        return out;
    }

    /**
     * The one cleanup routine, under the cleanup lock. For each type: the records older than its
     * maximum age, then the oldest records beyond its maximum count. A limit of 0 is no limit.
     *
     * @param {object} [limits] { [type]: { maxEntries, maxAgeDays } }; read from the preferences
     *   (before the lock is taken) when omitted
     * @param {number} [now]
     * @returns {Promise<object>} the number of records removed, per type
     */
    static async cleanup(limits = null, now = Date.now()) {
        const resolved = limits || await taStorage.readLimits();
        return withCleanupLock(async () => {
            const db = await taStorage.openDB();
            const removed = {};
            for (const type of MESSAGE_STORES) {
                const { maxEntries = 0, maxAgeDays = 0 } = resolved[type] || {};
                removed[type] = 0;
                const ageLimit = toLimit(maxAgeDays);
                if (ageLimit > 0) {
                    const tx = db.transaction(type, 'readwrite');
                    const range = IDBKeyRange.upperBound(now - ageLimit * DAY_MS, true);
                    let cursor = await tx.store.index(INDEX_CREATED_AT).openCursor(range);
                    while (cursor) {
                        await cursor.delete();
                        removed[type]++;
                        cursor = await cursor.continue();
                    }
                    await tx.done;
                }
                const countLimit = toLimit(maxEntries);
                if (countLimit > 0) {
                    const tx = db.transaction(type, 'readwrite');
                    let excess = (await tx.store.count()) - countLimit;
                    if (excess > 0) {
                        let cursor = await tx.store.index(INDEX_CREATED_AT).openCursor();
                        while (cursor && excess > 0) {
                            await cursor.delete();
                            removed[type]++;
                            excess--;
                            cursor = await cursor.continue();
                        }
                    }
                    await tx.done;
                }
            }
            _log.log('Storage cleanup: removed ' + JSON.stringify(removed));
            return removed;
        });
    }

    /**
     * Start the scheduled cleanup (background only, without the alarms permission): one timer at
     * a time, no periodic checks. At start, if the last completed cleanup is older than 24 hours
     * (or there is none) it runs at once, else 2 hours later; after each run its time is saved
     * in storage.local and the next run is set 24 hours later. A failed run is logged and still
     * sets the next one. Calling it again replaces the pending timer.
     */
    static async startCleanupSchedule() {
        taStorage.stopCleanupSchedule();
        let last = 0;
        try {
            const stored = await browser.storage.local.get(LAST_CLEANUP_KEY);
            last = Number(stored[LAST_CLEANUP_KEY]) || 0;
        } catch (e) {
            _log.error('Could not read the time of the last storage cleanup: ' + e);
        }
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
    }

    static _scheduleCleanup(delay) {
        if (_cleanupTimer !== null) clearTimeout(_cleanupTimer);
        _cleanupTimer = setTimeout(() => {
            _cleanupTimer = null;
            taStorage._runScheduledCleanup();
        }, delay);
    }

    static async _runScheduledCleanup() {
        try {
            await taStorage.cleanup();
            await browser.storage.local.set({ [LAST_CLEANUP_KEY]: Date.now() });
        } catch (e) {
            _log.error('Storage cleanup error: ' + e);
        }
        taStorage._scheduleCleanup(CLEANUP_INTERVAL_MS);
    }
}
