/*
 *  "Restart Thunderbird": run a scenario in a fresh extension context.
 *
 *  mztaManaged is read once per context, so checking what a DIFFERENT policy (or no policy)
 *  makes of the storage a scenario left behind needs a second, independent module graph.
 *  A worker thread is exactly that (./core/worker.mjs): its own globals, its own module cache,
 *  its own singleton. The storage snapshot is handed over explicitly, the way it survives a
 *  restart. The scenarios below are the managed ones; the worker starts the context with the
 *  managed layer's startBackground().
 *
 *  Usage from a test file:
 *      const r = await restart({ policy: null, local: ctl.localData() }, 'readPrefs', ['k']);
 *      r.result, r.local, r.warnings
 */

import {
    isMainThread,
    workerData,
    parentPort,
} from 'node:worker_threads';
import { runWorker } from './core/worker.mjs';

/** Scenarios run inside the fresh context: (mods, ctl, args) => JSON-serialisable result. */
const SCENARIOS = {
    async readPrefs({ mztaPrefs }, ctl, keys) {
        return mztaPrefs.getPrefs(keys);
    },
    /** What the loader made of the policy: {key: {managed, value, locked}}. */
    async managedKeys({ mztaManaged }, ctl, keys) {
        await mztaManaged.managedReady();
        return Object.fromEntries(keys.map(k => [k, {
            managed: mztaManaged.hasManagedValue(k),
            value: mztaManaged.getManagedValue(k),
            locked: mztaManaged.isManagedLocked(k),
        }]));
    },
    /** The invocation view (menus, popup, loadPrompt()). */
    async invocablePrompts({ prompts }) {
        return prompts.getPrompts();
    },
    async specialPrompts({ prompts }) {
        return prompts.getSpecialPrompts();
    },
    /** A feature page opening and saving the whole special prompt array unchanged. */
    async saveSpecialPromptsAsIs({ prompts }) {
        await prompts.setSpecialPrompts(await prompts.getSpecialPrompts());
        return null;
    },
    async resolveAccounts({ utils }, ctl, [feature, stored]) {
        return utils.resolveEnabledAccounts(feature, stored);
    },
    /** For tests/managed/99-harness-workers only: a scenario whose promise never settles. */
    neverSettles() {
        return new Promise(() => {});
    },
};

// A scenario is one short context start; anything near this means it hangs.
const WORKER_TIMEOUT_MS = 60000;

export function restart(mockOpts, scenario, args) {
    return runWorker(new URL(import.meta.url), { mockOpts, scenario, args }, {
        label: 'restart worker "' + scenario + '"',
        timeoutMs: WORKER_TIMEOUT_MS,
    });
}

if (!isMainThread && workerData && workerData.scenario) {
    const { startBackground } = await import('./load.mjs');
    const { mockOpts, scenario, args } = workerData;
    const ctx = await startBackground(mockOpts);
    const result = await SCENARIOS[scenario](ctx, ctx.ctl, args);
    parentPort.postMessage({
        result: result === undefined ? null : structuredClone(result),
        local: ctx.ctl.localData(),
        warnings: ctx.con.warnings(),
    });
}
