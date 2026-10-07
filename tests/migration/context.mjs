/*
 *  One Thunderbird start, in a fresh extension context: the migration area's only way to run code.
 *
 *  The modules the sequence touches keep module-level state (the organization prompt cache in
 *  js/mzta-prompts.js, the policy load and hydration promises in js/mzta-managed.js), so a second
 *  start in the same process would not be a real restart. Every start therefore runs in its own
 *  worker thread (../helpers/core/worker.mjs): its own globals, its own module cache. Storage is
 *  handed in and back explicitly, the way it survives a restart. Nothing is ever reset by hand.
 *
 *  This module is both sides: startup() in the test file, and the worker's entry point.
 *
 *      const r = await startup({ sync, local, run: 'sequence' });
 *      r.value   what the run returned (a function's result, or the sequence's declared names)
 *      r.error   the message of an exception that escaped the run, or null
 *      r.local, r.sync   the storage content the run left (before the reads)
 *      r.calls   every storage call of the run, in order: {area, op, keys | items}
 *      r.sent    every runtime.sendMessage of the run
 *      r.read    what the reads asked for in `read` returned, after the run
 *      r.logs    the captured console, [{level, msg}]
 *
 *  Not a test file (no .test.mjs suffix). Imports only the core, never jsdom.
 */

import {
    isMainThread,
    workerData,
    parentPort
} from 'node:worker_threads';
import { runWorker } from '../helpers/core/worker.mjs';

/** The migration functions a start can run alone, and their module. */
export const FUNCTIONS = {
    migratePrefsToLocal: 'js/mzta-prefs-migration.js',
    isSyncDrained: 'js/mzta-prefs-migration.js',
    migrateOllamaThinkLevel: 'js/mzta-prefs-migration.js',
    migrateCustomPromptsStorage: 'js/mzta-utils.js',
    migrateDefaultPromptsPropStorage: 'js/mzta-utils.js',
    migrateCalendarNoSelection: 'js/mzta-prompts.js',
};

const WRITE_OPS = new Set(['set', 'remove', 'clear']);

// A start is one short context; anything near this means it hangs.
const WORKER_TIMEOUT_MS = 60000;

/**
 * Start a fresh context on the given storage and run `run` in it.
 *
 * @param {object} o
 *   sync, local   the storage content at start
 *   run           'sequence' (the cut block of mzta-background.js), a name of FUNCTIONS, or null
 *   faults        [{area, op, nth = 1, count = 1}]: the nth call of storage.<area>.<op> and the
 *                 count-1 matching calls after it reject, with no effect (count: Infinity = all)
 *   crashAtWrite  n: the nth storage write of the run (set / remove on any area) and every later
 *                 one reject with no effect - Thunderbird closing mid-start: nothing after that
 *                 point reaches storage
 *   read          after the run, with every fault off and the policy loaded as the background
 *                 does before its first read: {prefs: [ids]} through mztaPrefs.getPrefs(),
 *                 {specialPrompts: true} through getSpecialPrompts()
 */
export function startup(o) {
    const p = runWorker(new URL(import.meta.url), structuredClone(o), {
        label: 'migration start (' + (o.run || 'no run') + ')',
        timeoutMs: WORKER_TIMEOUT_MS,
        captureOutput: true,
        unwrap: true,
    });
    // Started early and awaited by a test later: never an unhandled rejection in between.
    p.catch(() => {});
    return p;
}

/** Wrap storage.local / storage.sync to inject faults, and record remove() (the mock records get/set). */
function decorate(ctl, { faults = [], crashAtWrite = 0 }, state) {
    const counts = {};
    let writes = 0;
    for (const area of ['local', 'sync']) {
        const target = ctl.browser.storage[area];
        for (const op of ['get', 'set', 'remove', 'clear']) {
            const original = target[op].bind(target);
            target[op] = async (arg) => {
                if (op === 'remove' || op === 'clear') ctl.calls.push({ area, op, keys: structuredClone(arg) });
                if (!state.armed) return original(arg);
                const key = area + '.' + op;
                counts[key] = (counts[key] || 0) + 1;
                if (WRITE_OPS.has(op)) {
                    writes++;
                    if (crashAtWrite && writes >= crashAtWrite) {
                        state.crashed = true;
                        if (op !== 'remove' && op !== 'clear') ctl.calls.push({ area, op, items: structuredClone(arg), crashed: true });
                        throw new Error('injected: Thunderbird closed during storage.' + key);
                    }
                }
                for (const f of faults) {
                    const nth = f.nth ?? 1;
                    const count = f.count ?? 1;
                    if (f.area === area && f.op === op && counts[key] >= nth && counts[key] < nth + count) {
                        if (op !== 'remove' && op !== 'clear') {
                            ctl.calls.push({ area, op, [op === 'get' ? 'keys' : 'items']: structuredClone(arg), failed: true });
                        }
                        throw new Error('injected: storage.' + key + ' failed');
                    }
                }
                return original(arg);
            };
        }
    }
    return { writes: () => writes };
}

const raw = area => Object.fromEntries([...area._data].map(([k, v]) => [k, structuredClone(v)]));

async function main(o) {
    const { installBrowserMock } = await import('../helpers/core/browser-mock.mjs');
    const { captureConsole, loadModules, REPO } = await import('../helpers/core/load.mjs');
    const imp = rel => import(new URL(rel, REPO).href);

    const ctl = installBrowserMock({ policy: null, local: o.local || {}, sync: o.sync || {} });
    const state = { armed: false, crashed: false };
    const counter = decorate(ctl, o, state);
    const con = captureConsole();
    const mods = await loadModules();
    // Only the run is recorded: importing a module is not a migration.
    ctl.calls.length = 0;
    ctl.sent.length = 0;

    let value = null;
    let error = null;
    state.armed = true;
    try {
        if (o.run === 'sequence') {
            const { cutSequence, compileSequence } = await import('./sequence.mjs');
            const seq = cutSequence();
            const deps = {};
            for (const d of seq.deps) {
                deps[d.local] = (await imp(d.module))[d.imported];
                if (deps[d.local] === undefined) throw new Error('startup: ' + d.module + ' exports no ' + d.imported);
            }
            value = await compileSequence(seq)(deps);
        } else if (o.run) {
            if (!Object.hasOwn(FUNCTIONS, o.run)) throw new Error('startup: unknown function ' + o.run);
            value = await (await imp(FUNCTIONS[o.run]))[o.run]();
        }
    } catch (e) {
        error = (e && e.message) || String(e);
    }
    state.armed = false;

    const calls = structuredClone(ctl.calls);
    const sent = structuredClone(ctl.sent);
    // Storage as the run left it, before any read below (getSpecialPrompts() may write back).
    const local = raw(ctl.browser.storage.local);
    const sync = raw(ctl.browser.storage.sync);
    const read = {};
    if (o.read) {
        const { mztaManaged } = await imp('js/mzta-managed.js');
        await mztaManaged.loadManaged();
        if (o.read.prefs) read.prefs = await mods.mztaPrefs.getPrefs(o.read.prefs);
        if (o.read.specialPrompts) read.specialPrompts = await mods.prompts.getSpecialPrompts();
    }
    return {
        value: value === undefined ? null : structuredClone(value),
        error,
        crashed: state.crashed,
        writes: counter.writes(),
        local,
        sync,
        calls,
        sent,
        read,
        logs: con.entries.map(e => ({ level: e.level, msg: e.msg })),
    };
}

if (!isMainThread && workerData && 'run' in workerData) {
    try {
        parentPort.postMessage({ result: await main(workerData) });
    } catch (e) {
        parentPort.postMessage({ error: (e && e.stack) || String(e) });
    }
}
