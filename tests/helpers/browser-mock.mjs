/*
 *  The in-memory WebExtension mock. It lives in the core (./core/browser-mock.mjs); this path is
 *  kept so the managed tests import it where they always have.
 */

export {
    EXT_ORIGIN,
    BACKGROUND_URL,
    SENDERS,
    installBrowserMock,
} from './core/browser-mock.mjs';
