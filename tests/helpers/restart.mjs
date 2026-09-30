/*
 *  "Restart Thunderbird": run a scenario in a fresh extension context.
 *
 *  mztaManaged is read once per context, so checking what a DIFFERENT policy (or no policy)
 *  makes of the storage a scenario left behind needs a second, independent module graph.
 *  A worker thread is exactly that: its own globals, its own module cache, its own
 *  singleton. The storage snapshot is handed over explicitly, the way it survives a restart.
 *
 *  Usage from a test file:
 *      const r = await restart({ policy: null, local: ctl.localData() }, 'readPrefs', ['k']);
 *      r.result, r.local, r.warnings
 */

import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';

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
    return new Promise((resolve, reject) => {
        const w = new Worker(new URL(import.meta.url), {
            workerData: { mockOpts, scenario, args },
        });
        let answered = false;
        const timer = setTimeout(() => {
            reject(new Error('restart worker "' + scenario + '" gave no answer in ' + WORKER_TIMEOUT_MS + ' ms'));
            w.terminate();
        }, WORKER_TIMEOUT_MS);
        w.once('message', m => { answered = true; clearTimeout(timer); resolve(m); });
        w.once('error', e => { clearTimeout(timer); reject(e); });
        // Rejects on ANY exit without an answer, code 0 included: a scenario whose promise never
        // settles lets the worker's event loop drain, and it exits 0 having posted nothing - which
        // otherwise only surfaces as node:test's generic "Promise resolution is still pending".
        // The timer above covers the other case, a worker kept alive by an open handle, which
        // would otherwise wait forever (node:test has no default timeout).
        w.once('exit', code => {
            clearTimeout(timer);
            if (!answered) reject(new Error('restart worker "' + scenario + '" exited ' + code + ' without an answer'));
        });
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
