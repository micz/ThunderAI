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
// Cooperative cancellation controller for batch email processing (processEmails).
//
// Mirrors the taWorkingStatus singleton style. Each processEmails() call gets its own
// batch token from beginBatch(); a cancel request (Stop button, rate limit) flags every
// batch active at that moment, and processEmails() checks isCancelled(batch) at its
// natural yield points (top of the message loop, between chunks, between the features of
// a message, in the summarize block) and breaks out cleanly.
//
// Per batch, not global: with a single global flag reset only when the LAST batch exits, a
// manual action (context-menu Summarize/Translate) started while an automatic batch was
// still winding down after a Stop or a rate limit was silently skipped. A batch that
// begins after the cancel request is not affected by it.
//
// The progress counter and the "why it stopped" aggregation stay global: the popup shows
// one "N processed" figure, and the stopped notice is shown once, on the last exit.
//
// Scope note: this tracks its OWN active batches, NOT taWorkingStatus.WorkingLevel.
// Standalone operations (e.g. a single inline summary via _generateSummaryForMessage)
// also drive WorkingLevel, but they are not cancellable batches — so isWorking() must
// reflect only batch scope, otherwise the popup would offer a "Stop processing" button
// with no batch to stop.
export const taBatchController = {

    taLog: console,
    // Set while at least one cancel was requested during the current span of overlapping
    // batches; read by endBatch() for the notice. Reset on the last exit.
    _cancelRequested: false,
    // Why the batch was stopped: 'user' (Stop button) or 'rate_limit' (the AI provider
    // refused more requests, see processEmails()). null while no cancel is pending.
    _cancelReason: null,
    // With a 'rate_limit' stop: the wait the provider asked for (ms), when it said so.
    _retryAfterMs: null,
    // The active batch tokens: { cancelled }.
    _batches: new Set(),
    processed: 0,

    // Mark the start of a cancellable batch. Multiple batches may overlap. Returns the
    // batch token to pass to isCancelled() / endBatch().
    beginBatch(){
        const batch = { cancelled: false };
        this._batches.add(batch);
        this.taLog.log("[taBatchController] beginBatch, activeBatches: " + this._batches.size);
        return batch;
    },

    // Mark the end of a batch. The notice state and progress counter are reset only
    // when the LAST active batch exits, so one "stopped" notice covers all overlapping
    // batches and never leaks into a future batch.
    //
    // Returns a snapshot taken BEFORE the reset, so the caller can show a "stopped after
    // N messages" notice exactly once (when lastExit && cancelled). `processed` is captured
    // here because it is zeroed on the last-batch reset; `reason` picks the notice.
    endBatch(batch){
        this._batches.delete(batch);
        const lastExit = this._batches.size === 0;
        const result = { lastExit: lastExit, cancelled: this._cancelRequested, processed: this.processed, reason: this._cancelReason, retryAfterMs: this._retryAfterMs };
        if(lastExit){
            this._cancelRequested = false;
            this._cancelReason = null;
            this._retryAfterMs = null;
            this.processed = 0;
        }
        this.taLog.log("[taBatchController] endBatch, activeBatches: " + this._batches.size);
        return result;
    },

    // Ask every batch active right now to stop at its next cooperative checkpoint.
    // Batches begun later are not affected.
    // A 'rate_limit' reason wins over 'user': the user must learn the provider refused
    // the work, even if they also pressed Stop.
    // retryAfterMs: with 'rate_limit', the wait the provider asked for; the longest one is kept.
    requestCancel(reason = 'user', retryAfterMs = null){
        for (const batch of this._batches) {
            batch.cancelled = true;
        }
        this._cancelRequested = true;
        if(this._cancelReason !== 'rate_limit'){
            this._cancelReason = reason;
        }
        if(Number.isFinite(retryAfterMs) && !(this._retryAfterMs >= retryAfterMs)){
            this._retryAfterMs = retryAfterMs;
        }
        this.taLog.log("[taBatchController] cancel requested, reason: " + reason + ", batches: " + this._batches.size);
    },

    isCancelled(batch){
        return !!batch?.cancelled;
    },

    // Count one processed message (used for the "N processed" progress display).
    tick(){
        this.processed++;
    },

    isWorking(){
        return this._batches.size > 0;
    },

    getStatus(){
        let allCancelled = this._batches.size > 0;
        for (const batch of this._batches) {
            if (!batch.cancelled) allCancelled = false;
        }
        return {
            working: this.isWorking(),
            processed: this.processed,
            // True only when every running batch is stopping: a batch started after the
            // cancel is still a batch the user can stop.
            cancelRequested: allCancelled,
            cancelReason: this._cancelReason,
        };
    },
};
