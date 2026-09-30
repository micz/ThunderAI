/*
 *  Test-area plugins: how an area (a part of ThunderAI with its own tests) hooks into the core
 *  loader and the DOM harness without the core naming it.
 *
 *  A plugin is a file tests/helpers/plugins/<area>.mjs whose default export is an object with
 *  any of the hooks below. The core imports every such file, in alphabetical order of file
 *  name, the first time it starts a context. A missing or empty directory means no plugins:
 *  the core then runs the shipped modules alone, which is what lets it run on a branch where
 *  an area (and its plugin) does not exist.
 *
 *  Hooks, all optional, called in plugin order:
 *
 *    name                          the plugin's name in error messages (default: the file name)
 *
 *    extendMock(browser, {context, opts})
 *                                  right after installBrowserMock() and BEFORE any module is
 *                                  imported (js/mzta-prefs.js reads storage.local at import
 *                                  time): add the browser.* APIs the area needs. `context` is
 *                                  'background' or 'page'; `opts` are the start options.
 *                                  Runs before the caller's own `decorate`.
 *
 *    modules(imp) -> object        after the core modules: import the area's own modules
 *                                  (imp(rel) imports a repository path) and return the fields
 *                                  to add to `mods` (and so to the ctx).
 *
 *    startBackground(ctx) -> object | void
 *                                  a background context (startBackground()), once the modules
 *                                  are loaded: start the area's background state. Returned
 *                                  fields are added to the ctx.
 *
 *    remoteBackground({browser, ctl, imp}) -> { start(mods) }
 *                                  a page context (startPage()): the page's background, run in
 *                                  the same process as separate module instances. Called
 *                                  BEFORE the page's modules are imported; start(mods) is
 *                                  called after them and resolves to
 *                                      { fields, listeners, commands }   (each optional)
 *                                  fields     added to the ctx (and passed to onOtherMessage)
 *                                  listeners  [(message, sender) => answer], WebExtension style
 *                                  commands   {command: (message, sender, fields) => answer}
 *
 *    pageApis(browser, opts)       DOM harness: page-side APIs, added after the core ones and
 *                                  before the strict proxy wraps the mock.
 *
 *    pageCommands(mods) -> {command: (message, sender) => answer}
 *                                  DOM harness: default answers to background commands, merged
 *                                  after the core ones.
 *
 *  A page's runtime.sendMessage is answered, unless startPage({remote}) replaces it all, by:
 *    1. the plugins' listeners, in plugin order: the first that returns neither false nor
 *       undefined answers (WebExtension semantics);
 *    2. the plugins' commands maps, in plugin order. Two plugins answering the same command is
 *       an error at start, never a silent shadowing;
 *    3. the caller's onOtherMessage(message, sender, fields), else undefined. In the DOM
 *       harness that is {core defaultCommands, then each plugin's pageCommands, then
 *       opts.commands}, later entries overriding earlier ones; anything else is a violation.
 *
 *  No jsdom here, so level 1 can import it.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIR = new URL('../plugins/', import.meta.url);

let loading = null;

/** Every plugin, in alphabetical order of file name. Read once per process. */
export function plugins() {
    if (!loading) loading = discover();
    return loading;
}

async function discover() {
    let files;
    try {
        files = readdirSync(fileURLToPath(PLUGIN_DIR)).filter(f => f.endsWith('.mjs')).sort();
    } catch (e) {
        if (e && e.code === 'ENOENT') return [];
        throw e;
    }
    const out = [];
    for (const file of files) {
        const mod = await import(new URL(file, PLUGIN_DIR).href);
        const plugin = mod.default;
        if (!plugin || typeof plugin !== 'object') {
            throw new Error('plugins: ' + file + ' has no default export object');
        }
        out.push({ name: file.replace(/\.mjs$/, ''), ...plugin });
    }
    return out;
}

/** Merge the plugins' command maps; the same command from two plugins is an error. */
export function mergeCommands(entries) {
    const merged = {};
    const owner = {};
    for (const { name, commands } of entries) {
        for (const [command, fn] of Object.entries(commands || {})) {
            if (Object.hasOwn(merged, command)) {
                throw new Error('plugins: command "' + command + '" answered by both '
                    + owner[command] + ' and ' + name);
            }
            merged[command] = fn;
            owner[command] = name;
        }
    }
    return merged;
}
