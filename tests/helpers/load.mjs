/*
 *  Loading the modules under test, capturing their console output, reading fixtures.
 *
 *  Order matters and is always: installBrowserMock() -> captureConsole() -> loadModules().
 *  js/mzta-prefs.js touches `browser` at import time, so a static import at the top of a
 *  test file would run before the mock exists.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installBrowserMock } from './browser-mock.mjs';

export const REPO = new URL('../../', import.meta.url);
export const repoPath = rel => fileURLToPath(new URL(rel, REPO));

/** A policy fixture from tests/fixtures/, parsed fresh each time. */
export function loadFixture(name) {
    return JSON.parse(readFileSync(repoPath('tests/fixtures/' + name), 'utf8'));
}

/**
 * Record every console call instead of printing it. taLogger writes through console.log
 * (gated on do_debug), console.warn and console.error. Set TEST_VERBOSE=1 to also print.
 */
export function captureConsole() {
    const entries = [];
    const original = {};
    for (const level of ['log', 'info', 'debug', 'warn', 'error']) {
        original[level] = console[level];
        console[level] = (...args) => {
            entries.push({ level, msg: args.map(a => (typeof a === 'string' ? a : String(a))).join(' ') });
            if (process.env.TEST_VERBOSE) original[level](...args);
        };
    }
    return {
        entries,
        warnings: () => entries.filter(e => e.level === 'warn').map(e => e.msg),
        all: () => entries.map(e => e.msg),
        clear() { entries.length = 0; },
        restore() { Object.assign(console, original); },
    };
}

/** Import the modules under test. Only call after installBrowserMock(). */
export async function loadModules() {
    const imp = rel => import(new URL(rel, REPO).href);
    const [managed, prefs, prompts, utils, defaults] = await Promise.all([
        imp('js/mzta-managed.js'),
        imp('js/mzta-prefs.js'),
        imp('js/mzta-prompts.js'),
        imp('js/mzta-utils.js'),
        imp('options/mzta-options-default.js'),
    ]);
    return {
        mztaManaged: managed.mztaManaged,
        MANAGED_SECRET_MARKER: managed.MANAGED_SECRET_MARKER,
        managedModule: managed,
        mztaPrefs: prefs.mztaPrefs,
        prompts,
        utils,
        prefs_default: defaults.prefs_default,
        defaults,
    };
}

/**
 * The background page at startup: mock, console capture, modules, then loadManaged() -
 * the one call mzta-background.js makes before its first preference read.
 */
export async function startBackground(mockOpts = {}) {
    const ctl = installBrowserMock(mockOpts);
    const con = captureConsole();
    const mods = await loadModules();
    await mods.mztaManaged.loadManaged();
    return { ctl, con, ...mods };
}

/**
 * A NON-background extension page whose background runs the given policy.
 *
 * Two independent instances of js/mzta-managed.js live in this process: the page's own
 * (the plain module, which js/mzta-prefs.js imports) and the background's (the same file
 * under a query string, hence a separate singleton). The background instance reads the
 * policy with loadManaged(); the page reaches it only through runtime.sendMessage, answered
 * by the real get_managed_values listener taken from mzta-background.js.
 *
 * @param {object} o
 *   policy, local, accounts - as for installBrowserMock()
 *   sender   - the SENDERS entry the page sends from (its url decides what it receives)
 *   remote   - optional replacement for the background's reply (fail-open tests)
 *   onOtherMessage - optional (message, sender, {bgManaged}) => reply, for every message the
 *              get_managed_values listener does not answer (the DOM tests answer the other
 *              background commands with it). Without it they get undefined, as before.
 *   external - as for installBrowserMock()
 *   decorate - optional (ctl) => void, run right after the mock is installed and BEFORE any
 *              module is imported (js/mzta-prefs.js keeps a reference to storage.local from
 *              import time), so a caller can extend or wrap globalThis.browser in time.
 */
export async function startPage({ policy = null, local, accounts, sender, remote, onOtherMessage, external, decorate } = {}) {
    const { installBrowserMock } = await import('./browser-mock.mjs');
    const { extractManagedValuesListener } = await import('./background-handler.mjs');
    let listener = null;
    let bgManaged = null;
    const ctl = installBrowserMock({
        policy, local, accounts, external,
        senderUrl: sender.url,
        remote: remote ?? ((message, s) => {
            const answer = listener(message, s);
            if (answer !== false) return answer;
            return onOtherMessage ? onOtherMessage(message, s, { bgManaged: bgManaged.mztaManaged }) : undefined;
        }),
    });
    if (decorate) decorate(ctl);
    const con = captureConsole();
    bgManaged = await import(new URL('js/mzta-managed.js?context=background', REPO).href);
    const mods = await loadModules();
    listener = extractManagedValuesListener({
        browser: ctl.browser,
        mztaManaged: bgManaged.mztaManaged,
        MANAGED_SECRET_MARKER: bgManaged.MANAGED_SECRET_MARKER,
        prefs_default: mods.prefs_default,
    });
    await bgManaged.mztaManaged.loadManaged();
    con.clear();
    return { ctl, con, bgManaged: bgManaged.mztaManaged, ...mods };
}
