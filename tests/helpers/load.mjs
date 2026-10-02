/*
 *  The managed layer of the loader: the core loader (./core/load.mjs), with the managed
 *  configuration in every context.
 *
 *  Order matters and is always: installBrowserMock() -> captureConsole() -> loadModules().
 *  js/mzta-prefs.js touches `browser` at import time, so a static import at the top of a
 *  test file would run before the mock exists.
 *
 *  startBackground() and startPage() are the core ones: with the managed plugin
 *  (./plugins/managed.mjs) present they also load js/mzta-managed.js, run loadManaged() and, for
 *  a page, start the background instance that answers get_managed_values (ctx.bgManaged).
 *  loadModules() adds the managed module to the core ones here, as it always has.
 */

import {
    REPO,
    loadModules as loadCoreModules,
} from './core/load.mjs';
import { managedModules } from './plugins/managed.mjs';

export {
    REPO,
    repoPath,
    loadFixture,
    captureConsole,
    startBackground,
    startPage,
} from './core/load.mjs';

/**
 * Import the modules under test, js/mzta-managed.js included (mztaManaged,
 * MANAGED_SECRET_MARKER, managedModule). Only call after installBrowserMock().
 */
export async function loadModules() {
    const mods = await loadCoreModules();
    return { ...mods, ...await managedModules(rel => import(new URL(rel, REPO).href)) };
}
