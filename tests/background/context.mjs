/*
 *  One background context: the core mock, this area's API models, the fake Worker, and the
 *  background's own code cut out of mzta-background.js (./scope.mjs), started the way the
 *  background starts.
 *
 *  A test file is ONE context (one process, fresh module singletons): call bgContext() once, at
 *  the top level, and never reset taJobRegistry, taBatchController, taWorkingStatus or the
 *  stores by hand.
 *
 *  The order is the background page's:
 *    1. installBrowserMock() (core), then the `decorate` step: installApis() adds the modelled
 *       namespaces (./apis.mjs) before any module is imported (js/mzta-prefs.js keeps a reference
 *       to storage.local from import time);
 *    2. the two classic scripts mzta-background.html loads before the module: markdown-it
 *       (window.markdownit) and js/lib/mzta-html-lines.js (the line projection js/mzta-utils.js
 *       reads through globalThis), run as classic scripts, in that order;
 *    3. the fake Worker (./fake-worker.mjs), console capture, the core modules;
 *    4. the scope: the declarations the roots reach, plus the STARTUP statements below, verbatim
 *       and in file order - loadManaged(), the flag repair, the snapshot, the storage listener,
 *       the main runtime.onMessage listener, the menus and their click listener, the
 *       onNewMailReceived registration.
 *
 *  What the scope takes from somewhere else than the real modules (STAND_INS) is listed, with the
 *  reason, below: each is a part of ThunderAI another area owns that needs a DOM, which level 1
 *  does not have.
 *
 *  Not a test file (no .test.mjs suffix). Imports only the core, never jsdom.
 */

import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { installBrowserMock } from '../helpers/core/browser-mock.mjs';
import {
    captureConsole,
    loadModules,
    repoPath
} from '../helpers/core/load.mjs';
import {
    mailModel,
    installApis
} from './apis.mjs';
import { installFakeWorker } from './fake-worker.mjs';
import {
    cutScope,
    runScope
} from './scope.mjs';

/** The background functions and constants a context exposes to the tests. */
export const ROOTS = [
    'processEmails',
    'newEmailListener',
    'reload_pref_init',
    'setupStorageChangeListener',
    '_computeActiveSpecialIds',
    '_reload_menus',
    'preparePopupMenu',
    '_generateSummaryForMessage',
    '_generateTranslationForMessage',
    '_generateSpamReportForMessage',
    'runWithConcurrency',
    'PREFS_INIT_KEYS',
    'MENU_RELEVANT_KEYS',
];

/**
 * The top-level statements of the startup a context runs, by the text they start with, in the
 * order they have in the file (which is the order they run in). What the startup does besides
 * these is left out: the migrations (migration area), the policy warnings (managed area), the
 * content script registrations and injections, the permission and onInstalled listeners.
 */
export const STARTUP = [
    'await mztaManaged.loadManaged();',
    'await _reconcileFeatureFlags(await _readFeatureConnPrefs());',
    'await reload_pref_init();',
    'taWorkingStatus.taLog = taLog;',
    'taBatchController.taLog = taLog;',
    'taJobRegistry.taLog = taLog;',
    'messenger.runtime.onMessage.addListener(',
    'browser.runtime.onMessageExternal.addListener(',
    'setupStorageChangeListener();',
    'await menus.loadMenus(await _computeActiveSpecialIds());',
    'browser.menus.onClicked.addListener(',
    'browser.messages.onNewMailReceived.addListener(newEmailListener, true);',
];

/**
 * The names the scope gets from the test instead of the real module, and why. Each records what
 * it was given in ctx.standIns.<name>.
 *
 *   window               the background page's window: `window.markdownit` (the summary job
 *                        renders the answer with it: the real markdown-it) and `window.screen`
 *                        (openChatGPT() sizes the chat window from it: a 1920 x 1080 screen)
 *   sanitizeBlockHtml    js/mzta-richtext.js, the ONE sanitizer: DOMParser. The compose area tests
 *                        it; here only "the payload crossed it" is asserted. Stand-in: tags the
 *                        HTML ('<!--sanitized-->' + html) and records it
 *   htmlBodyToPlainText  js/mzta-utils.js, the body reading of the spam filter and add_tags:
 *                        DOMParser (compose area). The model's messages have a text/plain part
 *                        only, whose HTML twin is the text with <br> for \n: the stand-in turns it
 *                        back, and records it
 *   taPromptUtils        js/mzta-utils-prompt.js, as is, but for buildSummaryPrompt(), which reads
 *                        the body through htmlBodyToPlainText() inside the module (DOMParser). The
 *                        stand-in records the {message, fullMessage} entries - which message is
 *                        summarized, the one fact the background decides - and returns a prompt
 *                        naming them, with the real prompt_summarize as promptInfo
 */
async function standIns(rec) {
    const { taPromptUtils } = await import('../../js/mzta-utils-prompt.js');
    const { getSummarizePrompt } = await import('../../js/mzta-prompts.js');
    const promptUtils = Object.create(taPromptUtils);
    promptUtils.buildSummaryPrompt = async (entries) => {
        rec.buildSummaryPrompt.push(entries.map(e => ({ message: structuredClone(e.message), subject: e.fullMessage?.headers?.subject })));
        return {
            promptText: 'SUMMARIZE ' + entries.map(e => e.message.headerMessageId).join(' + '),
            promptInfo: await getSummarizePrompt(),
        };
    };
    return {
        window: { markdownit: globalThis.markdownit, screen: { width: 1920, height: 1080 } },
        sanitizeBlockHtml: (html) => { rec.sanitizeBlockHtml.push(html); return '<!--sanitized-->' + html; },
        htmlBodyToPlainText: (html) => { rec.htmlBodyToPlainText.push(html); return String(html ?? '').replace(/<br>/g, '\n'); },
        taPromptUtils: promptUtils,
    };
}

let classicLoaded = false;
function loadClassicScripts() {
    if (classicLoaded) return;
    classicLoaded = true;
    for (const rel of ['api_webchat/markdown-it.min.js', 'js/lib/mzta-html-lines.js']) {
        runInThisContext(readFileSync(repoPath(rel), 'utf8'), { filename: repoPath(rel) });
    }
    if (typeof globalThis.markdownit !== 'function') throw new Error('bgContext: markdown-it did not define markdownit');
    if (typeof globalThis.mztaLinesToHtml !== 'function') throw new Error('bgContext: mzta-html-lines.js did not load');
}

/** The answer of the Sparks presence check: not installed. */
export const SPARKS_ABSENT = () => null;

/**
 * Start one background context.
 *
 * @param {object} o
 *   local      storage.local at start (the preferences, the prompts, stored records)
 *   mail       the options of mailModel() (accounts, folders, tags, permissions, contacts)
 *   setup(m)   called with the model before the startup runs (add messages, tabs)
 *   external   the other add-on's answers (default: Sparks absent)
 *   roots, statements, overrides   for a test of the cut itself; overrides are added to the
 *              stand-ins (and replace one of the same name)
 *   startup    false: cut and run nothing but the declarations (no STARTUP statement)
 * @returns ctx {ctl, con, m, workers, bg, cut, standIns, unhandled, mztaPrefs, prompts, utils, prefs_default}
 *   bg         the ROOTS, by name, plus $eval(source)
 *   unhandled  every promise rejection nobody handled, from the start: a fire-and-forget task
 *              of the background that rejects lands here (each test file ends asserting it empty)
 */
export async function bgContext(o = {}) {
    const unhandled = [];
    process.on('unhandledRejection', e => { unhandled.push(e); });
    const m = mailModel(o.mail || {});
    const ctl = installBrowserMock({
        policy: null,
        local: o.local || {},
        accounts: m.accounts,
        tags: m.tags,
        external: o.external ?? SPARKS_ABSENT,
    });
    installApis(ctl.browser, m);
    loadClassicScripts();
    const workers = installFakeWorker();
    const con = captureConsole();
    const mods = await loadModules();
    if (o.setup) await o.setup(m);
    const rec = { sanitizeBlockHtml: [], htmlBodyToPlainText: [], buildSummaryPrompt: [] };
    const given = { ...(await standIns(rec)), ...(o.overrides || {}) };
    const cut = cutScope({
        roots: o.roots || ROOTS,
        statements: o.startup === false ? [] : (o.statements || STARTUP),
        overrides: Object.keys(given),
    });
    const used = Object.fromEntries(Object.entries(given).filter(([n]) => cut.injected.includes(n)));
    const bg = await runScope(cut, used, (o.roots || ROOTS));
    return { ctl, con, m, workers, bg, cut, standIns: rec, unhandled, ...mods };
}

/**
 * A context for the modules alone (taStorage, the stores, the job registry...): the core mock,
 * the API models, console capture, the core modules and the policy load the background makes
 * before its first read (no policy). No background code runs.
 */
export async function moduleContext(o = {}) {
    const m = mailModel(o.mail || {});
    const ctl = installBrowserMock({ policy: null, local: o.local || {}, session: o.session || {}, accounts: m.accounts, tags: m.tags });
    installApis(ctl.browser, m);
    const workers = installFakeWorker();
    const con = captureConsole();
    const mods = await loadModules();
    const { mztaManaged } = await import('../../js/mzta-managed.js');
    await mztaManaged.loadManaged();
    return { ctl, con, m, workers, ...mods };
}

/** Let every pending promise chain (and setImmediate) run: n turns of the event loop. */
export async function flush(n = 20) {
    for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r));
}
