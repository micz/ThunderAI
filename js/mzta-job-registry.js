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
// In-flight job registry for the per-message AI features (summary, translation, spam,
// add_tags). One entry per `${kind}:${headerMessageId}` while its job runs.
//
// It is the only authority for "this feature is in progress on this message". The batch
// (processEmails) and the manual paths (panel buttons, context menu, refresh, popup) can
// reach the same message at any moment; whoever arrives second finds the entry and JOINS
// it (awaits its promise) instead of starting a second AI call or giving up.
//
// get() and start() are synchronous, and callers use them back to back with no await in
// between: that is what makes the check-then-register race-free. The storage.session
// "processing" flags this replaces were checked and set across several awaits (two callers
// could both pass) and were cleared only on the save path (a config error left them set
// for the whole session).
//
// The promise of an entry never rejects: it resolves to an outcome
//   { status: 'ok' | 'error' | 'skipped' | 'cancelled', data, errorMessage, rateLimited, retryAfterMs, ... }
// 'cancelled' = the job was invalidated (the user removed the result while it ran).
// A job body that resolves to nothing (a missing return) resolves 'error', logged.
// The entry is removed in a finally, so no path can leave it behind.
//
// The entry object itself is the per-job token: invalidate() flags it, the job reads the
// flag before saving/broadcasting, and finally only deletes the key while the map still
// holds that very entry.
export const taJobRegistry = {

    taLog: console,
    _jobs: new Map(),

    _key(kind, id){
        return kind + ':' + id;
    },

    // The running entry, or null. Synchronous.
    get(kind, id){
        return this._jobs.get(this._key(kind, id)) || null;
    },

    isRunning(kind, id){
        return this._jobs.has(this._key(kind, id));
    },

    // Register and start a job. Synchronous: the entry is in the map before this returns,
    // and fn(entry) starts on the next microtask (so even a job that never awaits cannot
    // run its finally before the entry exists). Returns the entry; await entry.promise.
    //
    // options.groupId: the Smart bar instruction the job belongs to (claude-spec/10-smartbar.md).
    // Every entry carries an AbortController (entry.abort): a job passes entry.abort.signal to
    // its AI call, and abortGroup() stops every job of one instruction at once. A job started
    // by anyone else (the batch, a panel button) has no group, so no instruction can stop it.
    start(kind, id, fn, options = {}){
        const key = this._key(kind, id);
        const entry = { kind: kind, id: id, promise: null, invalidated: false, wantsMove: false,
            groupId: options.groupId || null, abort: new AbortController() };
        this._jobs.set(key, entry);
        this.taLog.log("[taJobs] start " + key);
        entry.promise = Promise.resolve()
            .then(() => fn(entry))
            .then(outcome => {
                if (outcome) return outcome;
                // Every job body returns an outcome on every path: nothing back can only be a
                // missing return. Reported as an error, so the joiners end as on a failure and
                // the log names the job, instead of a silent 'skipped'.
                this.taLog.error("[taJobs] " + key + " returned no outcome");
                return { status: 'error', errorMessage: 'the job returned no outcome', rateLimited: false, retryAfterMs: null };
            })
            .catch(e => {
                // Last resort: the job bodies catch their own errors.
                this.taLog.error("[taJobs] " + key + " threw: " + (e?.message || e));
                return { status: 'error', errorMessage: e?.message || String(e), rateLimited: !!e?.rateLimited, retryAfterMs: e?.retryAfterMs ?? null };
            })
            .then(outcome => {
                if (this._jobs.get(key) === entry) this._jobs.delete(key);
                this.taLog.log("[taJobs] end " + key + " " + outcome.status);
                return outcome;
            });
        return entry;
    },

    // Log a join, for the manual tests ("exactly one start").
    logJoin(entry){
        this.taLog.log("[taJobs] join " + this._key(entry.kind, entry.id));
    },

    // The user removed the result while the job was running: when it lands, it must
    // neither save nor show it. Returns true when there was a job to invalidate.
    invalidate(kind, id){
        const entry = this.get(kind, id);
        if (!entry) return false;
        entry.invalidated = true;
        this.taLog.log("[taJobs] invalidate " + this._key(kind, id));
        return true;
    },

    // The running entries of one Smart bar instruction. Synchronous.
    getGroup(groupId){
        if (!groupId) return [];
        return [...this._jobs.values()].filter(entry => entry.groupId === groupId);
    },

    // Stop every job of one Smart bar instruction: each is invalidated FIRST (so when it lands
    // it neither saves nor shows anything) and then aborted (its AI call stops at once). Only
    // the entries carrying this groupId: a batch job on the same message, which the bar may
    // have joined, has no group and is never touched. Returns the number of jobs stopped.
    abortGroup(groupId){
        const entries = this.getGroup(groupId);
        for (const entry of entries) {
            entry.invalidated = true;
            this.taLog.log("[taJobs] abort " + this._key(entry.kind, entry.id) + " (group " + groupId + ")");
            try { entry.abort.abort(); } catch (e) { /* already aborted */ }
        }
        return entries.length;
    },

    // An explicit manual re-trigger on an invalidated job: joining it and taking its
    // result is cheaper than a second concurrent call.
    revive(entry){
        // An aborted job has stopped its call: there is no result left to take.
        if (!entry || !entry.invalidated || entry.abort?.signal.aborted) return;
        entry.invalidated = false;
        this.taLog.log("[taJobs] revive " + this._key(entry.kind, entry.id));
    },
};
