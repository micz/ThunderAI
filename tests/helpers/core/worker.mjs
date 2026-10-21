/*
 *  A fresh extension context in a worker thread: its own globals, its own module cache, so its
 *  own module singletons. This is how a test reaches a second context (a restart, the bare
 *  baseline of a page) without resetting anything in its own process.
 *
 *  runWorker() is the parent side only: the caller's module is the worker's entry point too
 *  (new URL(import.meta.url)), and decides what it runs and posts back. What it guarantees is
 *  that nothing waits forever: node:test has no default timeout, so the promise rejects when the
 *  worker exits without posting (code 0 included: a promise that never settles lets the
 *  worker's event loop drain, and it exits 0 having posted nothing), and when it gives no answer
 *  within `timeoutMs` (a worker kept alive by an open handle).
 *
 *  No jsdom here, so level 1 can import it.
 */

import { Worker } from 'node:worker_threads';

/**
 * Start `url` as a worker with `workerData` and resolve to the first message it posts.
 *
 * @param {object} o
 *   label          names the worker in the error messages
 *   timeoutMs      how long to wait for the answer
 *   captureOutput  collect the worker's stdout/stderr instead of printing it; stderr is then
 *                  appended to every error message
 *   unwrap         the worker posts {result} or {error}: resolve to result, reject with error
 */
export function runWorker(url, workerData, { label, timeoutMs, captureOutput = false, unwrap = false }) {
    return new Promise((resolve, reject) => {
        const w = new Worker(url, captureOutput
            ? { workerData, stdout: true, stderr: true }
            : { workerData });
        let err = '';
        let answered = false;
        const tail = () => (captureOutput ? '\n' + err : '');
        if (captureOutput) {
            w.stderr.on('data', c => { err += c; });
            w.stdout.on('data', () => {});
        }
        const timer = setTimeout(() => {
            reject(new Error(label + ' gave no answer in ' + timeoutMs + ' ms' + tail()));
            w.terminate();
        }, timeoutMs);
        w.once('message', m => {
            answered = true;
            clearTimeout(timer);
            if (!unwrap) resolve(m);
            else if (m.error) reject(new Error(m.error + tail()));
            else resolve(m.result);
        });
        w.once('error', e => { clearTimeout(timer); reject(e); });
        w.once('exit', code => {
            clearTimeout(timer);
            if (!answered) reject(new Error(label + ' exited ' + code + ' without an answer' + tail()));
        });
    });
}
