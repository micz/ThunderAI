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
 *  The move of the per-message data from storage.local (one msg:<headerMessageId> record per
 *  message, with optional spam / summary / translation fields) to the mirror keys of storage.local
 *  and to IndexedDB [#955].
 *
 *  Run by the background at startup, in its startup migration block, never by a page. It scans
 *  storage.local (one get(null), which also loads every mirror record) only when the add-on version
 *  it last completed for (MIGRATION_VERSION_KEY) is not the running one, or a migration flag was
 *  left behind: at the first start of every update. A user who downgrades gets msg: records written
 *  again by the old version, and they are moved at the first start of the next update. Any other
 *  start costs one targeted read and writes nothing. See claude-spec/01-architecture.md
 *  "Per-Message Data Storage".
 */

import {
    taStorage,
    putNewerRecords,
    mirrorKey,
    MESSAGE_STORES,
    MIGRATION_FLAG_KEY,
    MIGRATION_FAILED,
    MIGRATION_VERSION_KEY
} from './mzta-storage.js';

const LEGACY_PREFIX = 'msg:';

/** A legacy ts usable as createdAt: a finite, positive number. */
function validTs(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** The createdAt of a stored copy, or -Infinity when it is not a record of that message. */
function createdAtOf(value, messageId) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.messageId !== messageId) return -Infinity;
    return typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : -Infinity;
}

/**
 * Steps 3 and 4 below. Keeps for each record the newer of the legacy copy and the mirror one (on a
 * tie, the mirror one: the mirror is the source of truth), writes the mirror keys of the legacy
 * records that win (one storage.local.set(), with no transaction open), then puts the records into
 * the database in one transaction (putNewerRecords(), the write loop shared with
 * taStorage.reconcileWithMirror(): a record the database holds as new or newer is kept). Resolves
 * once that transaction has committed; rejects with nothing committed to the database.
 *
 * @param {{type: string, record: object}[]} records  the legacy records
 * @param {object} all  the storage.local content the scan read (the mirror keys among it)
 */
async function writeRecords(records, all) {
    let migrated = 0;
    let skipped = 0;
    const mirrorItems = {};
    const toPut = [];
    for (const { type, record } of records) {
        const key = mirrorKey(type, record.messageId);
        const inMirror = all[key];
        if (createdAtOf(inMirror, record.messageId) >= record.createdAt) {
            skipped++;
            toPut.push({ type, record: inMirror });
        } else {
            migrated++;
            mirrorItems[key] = record;
            toPut.push({ type, record });
        }
    }
    if (Object.keys(mirrorItems).length > 0) await browser.storage.local.set(mirrorItems);
    await putNewerRecords(toPut);
    return { migrated, skipped };
}

/** Set the flag to MIGRATION_FAILED. Never throws: the caller is already reporting a failure. */
async function markFailed() {
    try {
        await browser.storage.local.set({ [MIGRATION_FLAG_KEY]: MIGRATION_FAILED });
    } catch (e) {
        console.error('[ThunderAI] migrateMessageDataToIndexedDB: could not mark the migration as failed: ' + e);
    }
}

/**
 * Move the legacy msg: records into the mirror and IndexedDB:
 *   0. read MIGRATION_VERSION_KEY and the flag; when the version is the running one and no flag
 *      is left, stop: nothing else is read or written;
 *   1. read storage.local (get(null)) for the legacy keys; with none, remove a flag left behind
 *      and store the version;
 *   2. set the migration flag to true (the management pages show a notice while it is), also
 *      over the 'failed' of a previous attempt;
 *   3. write the mirror keys: each legacy field becomes a record (createdAt = the field's ts,
 *      else the record's ts, else now; ts itself is not copied; its size computed), unless the
 *      mirror holds a copy as new or newer, which is kept;
 *   4. open the database and put the records (the winners of step 3) in one transaction; a record
 *      the database holds as new or newer is kept;
 *   5. once that transaction has committed, remove the legacy keys;
 *   6. remove the flag, store the version.
 * A field that is not an object cannot be migrated: it is logged and dropped with its key.
 * Rejects on any failure, leaving the legacy keys and the old version for the next start. A
 * failure of steps 3-4 sets the flag to 'failed' (MIGRATION_FAILED); a failure of steps 0-2, 5
 * or 6 leaves it as it is.
 *
 * @returns {Promise<{migrated: number, skipped: number, dropped: number}>}
 */
export async function migrateMessageDataToIndexedDB() {
    const version = browser.runtime.getManifest().version;
    const state = await browser.storage.local.get([MIGRATION_VERSION_KEY, MIGRATION_FLAG_KEY]);
    if (state[MIGRATION_VERSION_KEY] === version && !Object.hasOwn(state, MIGRATION_FLAG_KEY)) {
        return { migrated: 0, skipped: 0, dropped: 0 };
    }

    const all = await browser.storage.local.get(null);
    const legacyKeys = Object.keys(all).filter(key => key.startsWith(LEGACY_PREFIX));
    if (legacyKeys.length === 0) {
        // A flag left by a start that closed between removing the keys and removing it.
        if (Object.hasOwn(all, MIGRATION_FLAG_KEY)) await browser.storage.local.remove(MIGRATION_FLAG_KEY);
        await browser.storage.local.set({ [MIGRATION_VERSION_KEY]: version });
        return { migrated: 0, skipped: 0, dropped: 0 };
    }
    if (all[MIGRATION_FLAG_KEY] !== true) await browser.storage.local.set({ [MIGRATION_FLAG_KEY]: true });

    const now = Date.now();
    const records = [];
    let dropped = 0;
    for (const key of legacyKeys) {
        const messageId = key.slice(LEGACY_PREFIX.length);
        const legacy = all[key];
        if (!messageId || !legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
            console.warn('[ThunderAI] migrateMessageDataToIndexedDB: the legacy record ' + JSON.stringify(key) + ' cannot be migrated, dropped.');
            dropped++;
            continue;
        }
        for (const type of MESSAGE_STORES) {
            if (!Object.hasOwn(legacy, type)) continue;
            const field = legacy[type];
            if (!field || typeof field !== 'object' || Array.isArray(field)) {
                console.warn('[ThunderAI] migrateMessageDataToIndexedDB: the ' + type + ' field of ' + JSON.stringify(key) + ' is not an object, dropped.');
                dropped++;
                continue;
            }
            const createdAt = validTs(field.ts) ?? validTs(legacy.ts) ?? now;
            const { ts, ...data } = field;
            records.push({ type, record: taStorage.buildRecord(type, messageId, data, createdAt) });
        }
    }

    let migrated = 0;
    let skipped = 0;
    try {
        ({ migrated, skipped } = await writeRecords(records, all));
    } catch (e) {
        // Nothing was committed to the database: the legacy keys stay for the next start, and the
        // flag says the attempt failed, so the pages stop announcing a move nobody is making.
        await markFailed();
        throw e;
    }

    await browser.storage.local.remove(legacyKeys);
    await browser.storage.local.remove(MIGRATION_FLAG_KEY);
    await browser.storage.local.set({ [MIGRATION_VERSION_KEY]: version });
    console.log('[ThunderAI] migrateMessageDataToIndexedDB: ' + migrated + ' records moved to the mirror and IndexedDB, ' +
        skipped + ' kept (a newer copy already stored), ' + dropped + ' dropped.');
    return { migrated, skipped, dropped };
}
