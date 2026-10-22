/*
 *  The core loader: the modules under test, their console output, fixtures, and the two kinds
 *  of extension context (a background, a page with its background).
 *
 *  Order matters and is always: installBrowserMock() -> captureConsole() -> loadModules().
 *  js/mzta-prefs.js touches `browser` at import time, so a static import at the top of a
 *  test file would run before the mock exists.
 *
 *  The core loads only the modules every branch has. What a test area adds (its modules, its
 *  background state, the background commands it answers) comes from its plugin in
 *  tests/helpers/plugins/ (see ./plugins.mjs); with no plugin the core runs on its own.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installBrowserMock } from './browser-mock.mjs';
import {
    plugins,
    mergeCommands,
} from './plugins.mjs';

export const REPO = new URL('../../../', import.meta.url);
export const repoPath = rel => fileURLToPath(new URL(rel, REPO));

const imp = rel => import(new URL(rel, REPO).href);

/** A JSON fixture from tests/fixtures/ (or tests/fixtures/<dir>/), parsed fresh each time. */
export function loadFixture(name, dir = '') {
    return JSON.parse(readFileSync(repoPath('tests/fixtures/' + (dir ? dir + '/' : '') + name), 'utf8'));
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

/** Import the core modules under test. Only call after installBrowserMock(). */
export async function loadModules() {
    const [prefs, prompts, utils, defaults] = await Promise.all([
        imp('js/mzta-prefs.js'),
        imp('js/mzta-prompts.js'),
        imp('js/mzta-utils.js'),
        imp('options/mzta-options-default.js'),
    ]);
    return {
        mztaPrefs: prefs.mztaPrefs,
        prompts,
        utils,
        prefs_default: defaults.prefs_default,
        defaults,
    };
}

/** The core modules plus every plugin's modules(). */
async function loadAllModules(list) {
    const mods = await loadModules();
    for (const p of list) {
        if (p.modules) Object.assign(mods, await p.modules(imp));
    }
    return mods;
}

/**
 * The background page at startup: mock, console capture, modules, then each plugin's
 * startBackground() - the area's own startup, before the first preference read.
 */
export async function startBackground(mockOpts = {}) {
    const list = await plugins();
    const ctl = installBrowserMock(mockOpts);
    for (const p of list) {
        if (p.extendMock) p.extendMock(ctl.browser, { context: 'background', opts: mockOpts });
    }
    const con = captureConsole();
    const mods = await loadAllModules(list);
    const ctx = { ctl, con, ...mods };
    for (const p of list) {
        if (p.startBackground) Object.assign(ctx, await p.startBackground(ctx));
    }
    return ctx;
}

// The fields the plugins' remote backgrounds added to a startPage() ctx, for the DOM harness.
const REMOTE_FIELDS = new WeakMap();

/** The fields startPage() took from the plugins' remote backgrounds (e.g. for openPage()). */
export function remoteFields(ctx) {
    return REMOTE_FIELDS.get(ctx) || {};
}

/**
 * A NON-background extension page, with its background.
 *
 * The page's modules are the plain ones. Its background is whatever the plugins start in
 * remoteBackground(): separate module instances in the same process, which the page reaches
 * only through runtime.sendMessage, answered in the order documented in ./plugins.mjs.
 *
 * @param {object} o
 *   policy, local, session, accounts - as for installBrowserMock()
 *   sender   - the SENDERS entry the page sends from (its url decides what it receives)
 *   remote   - optional replacement for the background's reply (fail-open tests)
 *   onOtherMessage - optional (message, sender, fields) => reply, for every message no plugin
 *              answers (the DOM tests answer the other background commands with it); `fields`
 *              are the plugins' remote fields. Without it they get undefined.
 *   external - as for installBrowserMock()
 *   decorate - optional (ctl) => void, run right after the mock is installed (and extended by
 *              the plugins) and BEFORE any module is imported (js/mzta-prefs.js keeps a
 *              reference to storage.local from import time), so a caller can extend or wrap
 *              globalThis.browser in time.
 */
export async function startPage(opts = {}) {
    const { policy = null, local, session, accounts, sender, remote, onOtherMessage, external, decorate } = opts;
    const list = await plugins();
    const listeners = [];
    const fields = {};
    let commands = {};
    const dispatch = (message, s) => {
        for (const listener of listeners) {
            const answer = listener(message, s);
            if (answer !== false && answer !== undefined) return answer;
        }
        const command = message && message.command;
        if (typeof command === 'string' && Object.hasOwn(commands, command)) {
            return commands[command](message, s, fields);
        }
        return onOtherMessage ? onOtherMessage(message, s, fields) : undefined;
    };
    const ctl = installBrowserMock({
        policy, local, session, accounts, external,
        senderUrl: sender.url,
        remote: remote ?? dispatch,
    });
    for (const p of list) {
        if (p.extendMock) p.extendMock(ctl.browser, { context: 'page', opts });
    }
    if (decorate) decorate(ctl);
    const con = captureConsole();
    const remotes = [];
    for (const p of list) {
        if (p.remoteBackground) {
            remotes.push({ name: p.name, bg: await p.remoteBackground({ browser: ctl.browser, ctl, imp }) });
        }
    }
    const mods = await loadAllModules(list);
    const commandEntries = [];
    for (const { name, bg } of remotes) {
        const out = (bg && bg.start ? await bg.start(mods) : null) || {};
        Object.assign(fields, out.fields);
        listeners.push(...(out.listeners || []));
        commandEntries.push({ name, commands: out.commands });
    }
    commands = mergeCommands(commandEntries);
    con.clear();
    const ctx = { ctl, con, ...fields, ...mods };
    REMOTE_FIELDS.set(ctx, { ...fields });
    return ctx;
}
