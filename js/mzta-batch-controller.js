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
// Mirrors the taWorkingStatus singleton style. It exposes a single global
// "cancel all" flag plus a progress counter. processEmails() checks isCancelled()
// at its natural yield points (top of the message loop, between chunks, in the
// summarize block) and breaks out cleanly when a cancel has been requested.
//
// Scope note: this tracks its OWN _activeBatches counter, NOT taWorkingStatus.WorkingLevel.
// Standalone operations (e.g. a single inline summary via _generateSummaryForMessage)
// also drive WorkingLevel, but they are not cancellable batches — so isWorking() must
// reflect only batch scope, otherwise the popup would offer a "Stop processing" button
// with no batch to stop.
export const taBatchController = {

    taLog: console,
    _cancelRequested: false,
    // Why the batch was stopped: 'user' (Stop button) or 'rate_limit' (the AI provider
    // refused more requests, see processEmails()). null while no cancel is pending.
    _cancelReason: null,
    // With a 'rate_limit' stop: the wait the provider asked for (ms), when it said so.
    _retryAfterMs: null,
    _activeBatches: 0,
    processed: 0,

    // Mark the start of a cancellable batch. Multiple batches may overlap.
    beginBatch(){
        this._activeBatches++;
        this.taLog.log("[taBatchController] beginBatch, activeBatches: " + this._activeBatches);
    },

    // Mark the end of a batch. The cancel flag and progress counter are reset only
    // when the LAST active batch exits, so a single cancel request is honored by all
    // overlapping batches and never leaks into a future batch.
    //
    // Returns a snapshot taken BEFORE the reset, so the caller can show a "stopped after
    // N messages" notice exactly once (when lastExit && cancelled). `processed` is captured
    // here because it is zeroed on the last-batch reset; `reason` picks the notice.
    endBatch(){
        this._activeBatches--;
        const lastExit = this._activeBatches <= 0;
        const result = { lastExit: lastExit, cancelled: this._cancelRequested, processed: this.processed, reason: this._cancelReason, retryAfterMs: this._retryAfterMs };
        if(lastExit){
            this._activeBatches = 0;
            this._cancelRequested = false;
            this._cancelReason = null;
            this._retryAfterMs = null;
            this.processed = 0;
        }
        this.taLog.log("[taBatchController] endBatch, activeBatches: " + this._activeBatches);
        return result;
    },

    // Ask all active batches to stop at their next cooperative checkpoint.
    // A 'rate_limit' reason wins over 'user': the user must learn the provider refused
    // the work, even if they also pressed Stop.
    // retryAfterMs: with 'rate_limit', the wait the provider asked for; the longest one is kept.
    requestCancel(reason = 'user', retryAfterMs = null){
        this._cancelRequested = true;
        if(this._cancelReason !== 'rate_limit'){
            this._cancelReason = reason;
        }
        if(Number.isFinite(retryAfterMs) && !(this._retryAfterMs >= retryAfterMs)){
            this._retryAfterMs = retryAfterMs;
        }
        this.taLog.log("[taBatchController] cancel requested, reason: " + reason);
    },

    isCancelled(){
        return this._cancelRequested;
    },

    // Count one processed message (used for the "N processed" progress display).
    tick(){
        this.processed++;
    },

    isWorking(){
        return this._activeBatches > 0;
    },

    getStatus(){
        return {
            working: this.isWorking(),
            processed: this.processed,
            cancelRequested: this._cancelRequested,
            cancelReason: this._cancelReason,
        };
    },
};
