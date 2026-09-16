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
 *  One-time migration of the preferences from storage.sync to storage.local.
 *
 *  storage.sync has a narrow quota; the large prompt payloads were moved to storage.local
 *  for issue #129 and the preferences now follow them, so the add-on uses a single area.
 *  See js/mzta-prefs.js (PREFS_AREA) for the read/write side.
 *
 *  It lives in its own module, rather than inside mztaPrefs, so the accessor stays a pure
 *  accessor and this can simply be deleted in a future release.
 */

/*
 *  Keys that are NOT preferences and that this migration must not touch, because
 *  js/mzta-utils.js owns their own sync -> local migration (issue #129) and runs right
 *  after this one in mzta-background.js.
 *
 *  Copying them here would break those migrations rather than help them: each one bails out
 *  when it finds its key already present in storage.local, so it would take the early return
 *  and never reach its `storage.sync.remove()`. The payload would then stay in storage.sync
 *  forever — exactly the quota problem #129 exists to solve — and a later reset of the local
 *  copy would silently resurrect the stale pre-#129 data.
 *
 *  `_special_prompts` and `_custom_placeholder` were only ever written to storage.local, so
 *  they cannot appear in a sync read; they are listed for completeness and to document that
 *  omitting them is not an oversight.
 */
const NOT_PREFERENCES = [
    '_custom_prompt',
    '_default_prompts_properties',
    '_special_prompts',
    '_custom_placeholder',
];

// Completion marker, written to storage.local once storage.sync has nothing left that any
// migration needs. Without it every startup would read the WHOLE of both storage areas,
// forever, only to conclude there is nothing to do; with it the steady-state cost is a
// single-key read and the caller can skip the #129 migrations too (see allMigrationsDone()).
//
// It means "storage.sync is fully drained", not merely "the preferences were copied". It is
// therefore withheld while any NOT_PREFERENCES key is still in sync — those belong to the
// #129 migrations in js/mzta-utils.js, which run right after this one and remove them. The
// flag is then set on the following startup.
//
// It is not a preference: no UI, no prefs_default entry, leading underscore like the other
// internal keys. It is therefore never returned by getAllPrefs() and never reaches
// restoreOptions().
const MIGRATION_FLAG = '_prefs_migrated_from_sync';

/**
 * Copy every key stored in storage.sync into storage.local, without overwriting anything
 * already there. Safe to run at every startup.
 *
 * Two properties are deliberate:
 *
 * - **The sync copy is NOT removed.** A user who downgrades to an older version finds their
 *   settings intact. The cost is a few unused KB in sync; the cost of the alternative is a
 *   profile that looks factory-reset (no connection, setup wizard again). This mirrors what
 *   migrateCustomPromptsStorage() already does on its "local copy already present" path.
 * - **Local wins on conflict.** A key already present in local is left untouched, so even if
 *   the flag below were lost the migration could re-run without reverting a value the user
 *   changed after migrating.
 *
 * Returns true when the preferences are known to be in storage.local (either already
 * migrated, or migrated successfully by this call), false when the copy failed. The caller
 * uses that to decide whether the flag-guarded migrations may run — see mzta-background.js.
 */
export async function migratePrefsToLocal() {
    let ok = true;
    try {
        // Fast path: once the copy has been done there is nothing to compare ever again,
        // so this is the only read the vast majority of startups perform.
        const flag = await browser.storage.local.get({ [MIGRATION_FLAG]: false });
        if (flag[MIGRATION_FLAG] === true) {
            return true;
        }

        // get(null) reads what is ACTUALLY stored, with no defaults substituted. Passing
        // prefs_default instead would write an explicit copy of every unset preference into
        // local, freezing today's defaults for that user: a later change to a default in
        // options/mzta-options-default.js would never reach them again.
        //
        // It also picks up the keys that are not in prefs_default, which is required rather
        // than incidental: the one-shot flags dynamic_menu_order_alphabet and
        // _migrated_enabled_to_showin (js/mzta-prompts.js) both default to "not yet run", so
        // a migration that left them behind in sync would make migrateMenuOrderAlphabetic()
        // run a second time and overwrite the user's custom menu ordering.
        const sync_prefs = await browser.storage.sync.get(null);
        if (Object.keys(sync_prefs).length === 0) {
            // Fresh install, or a profile already drained: nothing to copy, but the state is
            // final, so mark it and never look again.
            await browser.storage.local.set({ [MIGRATION_FLAG]: true });
            return true;
        }

        const local_prefs = await browser.storage.local.get(null);

        const to_copy = {};
        for (const [key, value] of Object.entries(sync_prefs)) {
            // Left to the #129 migrations that run right after this one — see NOT_PREFERENCES.
            if (NOT_PREFERENCES.includes(key)) continue;
            // `key in local_prefs`, not a truthiness test: a stored false / 0 / '' / null is
            // a real value the user configured and must count as "already present".
            if (key in local_prefs) continue;
            to_copy[key] = value;
        }

        // Withhold the marker while the #129 payloads are still in sync: the migrations that
        // drain them run right after this one, so the flag is set on the next startup.
        const sync_drained = !NOT_PREFERENCES.some(key => key in sync_prefs);

        if (Object.keys(to_copy).length === 0) {
            // Every preference is already in local.
            if (sync_drained) await browser.storage.local.set({ [MIGRATION_FLAG]: true });
            return true;
        }

        // One single set() for every key, INCLUDING the completion flag, so the copy either
        // lands whole or not at all. That atomicity is what protects the two one-shot
        // migration flags: were they written separately and the write failed in between, the
        // next startup would find dynamic_menu_order_alphabet at its "not yet run" default
        // and migrateMenuOrderAlphabetic() would overwrite the user's custom menu ordering.
        // For the same reason the flag must never be written by a second, later set().
        const copied = Object.keys(to_copy).length;
        if (sync_drained) to_copy[MIGRATION_FLAG] = true;
        await browser.storage.local.set(to_copy);
        console.info("[ThunderAI] Migrated " + copied +
            " preference(s) from storage.sync to storage.local.");
    } catch (e) {
        // A failed migration must not stop the add-on from starting: nothing has been
        // removed from storage.sync, so the next startup simply retries.
        ok = false;
        console.error("[ThunderAI] migratePrefsToLocal error: " + e);
    }
    return ok;
}

/**
 * True when storage.sync has been fully drained and no migration has anything left to do.
 *
 * Every migration is already guarded by its own flag, so this is purely an optimisation: it
 * lets the caller skip the two #129 migrations, which would otherwise each pay a
 * `storage.sync.get()` at every startup for the rest of the profile's life just to discover
 * there is nothing there.
 *
 * Deliberately NOT used to skip anything else. It says "sync is empty of things we migrate",
 * which is not the same as "every migration has run": migrateEnabledToShowIn() and
 * migrateMenuOrderAlphabetic() operate on storage.local data and own their own flags, so
 * they must still be called and allowed to decide for themselves.
 */
export async function isSyncDrained() {
    try {
        const flag = await browser.storage.local.get({ [MIGRATION_FLAG]: false });
        return flag[MIGRATION_FLAG] === true;
    } catch (e) {
        console.error("[ThunderAI] isSyncDrained error: " + e);
        return false;   // on doubt, let the migrations run their own checks
    }
}
