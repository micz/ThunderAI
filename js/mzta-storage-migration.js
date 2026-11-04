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
 *  message, with optional spam / summary / translation fields) to IndexedDB [#955].
 *
 *  Run by the background at EVERY start, in its startup migration block, never by a page: a
 *  user who downgrades gets msg: records written again by the old version, and they are moved
 *  at the next start of this one. With no msg: key in storage.local it costs one read and
 *  writes nothing. See claude-spec/01-architecture.md "Per-Message Data Storage".
 */

import {
    taStorage,
    MESSAGE_STORES,
    MIGRATION_FLAG_KEY,
    MIGRATION_FAILED
} from './mzta-storage.js';

const LEGACY_PREFIX = 'msg:';

/** A legacy ts usable as createdAt: a finite, positive number. */
function validTs(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Steps 3 and 4 below: open the database and write the records in one transaction. Resolves once
 * the transaction has committed; rejects with nothing committed.
 */
async function writeRecords(records) {
    const db = await taStorage.openDB();
    const tx = db.transaction(MESSAGE_STORES, 'readwrite');
    // A failing request aborts the transaction and the loop below throws before reaching
    // `await tx.done`: without a handler that rejection would be unhandled. The failure itself
    // still reaches the caller through the loop (or through the awaited tx.done).
    tx.done.catch(() => {});
    let migrated = 0;
    let skipped = 0;
    for (const { type, record } of records) {
        const store = tx.objectStore(type);
        const existing = await store.get(record.messageId);
        if (existing && typeof existing.createdAt === 'number' && existing.createdAt >= record.createdAt) {
            skipped++;
            continue;
        }
        await store.put(record);
        migrated++;
    }
    await tx.done;
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
 * Move the legacy msg: records into IndexedDB:
 *   1. read the legacy keys from storage.local;
 *   2. set the migration flag to true (the management pages show a notice while it is), also
 *      over the 'failed' of a previous attempt;
 *   3. open the database;
 *   4. write the records, in one transaction: each legacy field becomes a record of its store,
 *      createdAt = the field's ts, else the record's ts, else now (ts itself is not copied), its
 *      size computed. A record the database already holds with a createdAt as new or newer is
 *      never overwritten;
 *   5. once that transaction has committed, remove the legacy keys;
 *   6. remove the flag.
 * A field that is not an object cannot be migrated: it is logged and dropped with its key.
 * Rejects on any failure, leaving the legacy keys for the next start. A failure of steps 3-4 sets
 * the flag to 'failed' (MIGRATION_FAILED); a failure of steps 1-2, 5 or 6 leaves it as it is.
 *
 * @returns {Promise<{migrated: number, skipped: number, dropped: number}>}
 */
export async function migrateMessageDataToIndexedDB() {
    const all = await browser.storage.local.get(null);
    const legacyKeys = Object.keys(all).filter(key => key.startsWith(LEGACY_PREFIX));
    if (legacyKeys.length === 0) {
        // A flag left by a start that closed between removing the keys and removing it.
        if (Object.hasOwn(all, MIGRATION_FLAG_KEY)) await browser.storage.local.remove(MIGRATION_FLAG_KEY);
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
        ({ migrated, skipped } = await writeRecords(records));
    } catch (e) {
        // Nothing was committed: the legacy keys stay for the next start, and the flag says the
        // attempt failed, so the pages stop announcing a move nobody is making.
        await markFailed();
        throw e;
    }

    await browser.storage.local.remove(legacyKeys);
    await browser.storage.local.remove(MIGRATION_FLAG_KEY);
    console.log('[ThunderAI] migrateMessageDataToIndexedDB: ' + migrated + ' records moved to IndexedDB, ' +
        skipped + ' kept (newer in IndexedDB), ' + dropped + ' dropped.');
    return { migrated, skipped, dropped };
}
