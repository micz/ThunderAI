/*
 *  The webchat plugin (contract: ../core/plugins.mjs).
 *
 *  One page-side API the core does not model: browser.windows.openDefaultBrowser(), which the
 *  API chat window calls to open a link of the transcript in the system's browser (spec 01
 *  "Links in the transcript"). The call is recorded by the strict proxy like any other
 *  (ctx.apiCalls('browser.windows.openDefaultBrowser')); `opts.openDefaultBrowser(url)`, when given,
 *  decides its outcome (throw to make it reject). Adding it changes nothing for the other
 *  areas' pages, which never call it.
 *
 *  No jsdom here, so level 1 can load it.
 */

export default {
    name: 'webchat',

    pageApis(browser, opts) {
        browser.windows.openDefaultBrowser = async (url) => {
            if (opts.openDefaultBrowser) { return opts.openDefaultBrowser(url); }
        };
    },
};
