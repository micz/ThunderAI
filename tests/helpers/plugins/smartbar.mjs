/*
 *  The smartbar area's plugin (tests/smartbar/README.md): the SmartBar settings page
 *  (pages/smartbar/), which the DOM harness does not know otherwise, and the default answers to
 *  the command its Activity tab sends at load (an empty list) and to smartbar_open_page (the
 *  options page's Manage settings: opened). Nothing else: a plugin is
 *  loaded into every context, and modelling an API here would change what the strict proxy
 *  reports on every other page. The Activity tests model the background's answers themselves
 *  (opts.commands); what the background does is tested on its real code
 *  (tests/background/46-smartbar-activity).
 *
 *  No jsdom here, so level 1 can load it.
 */

export default {
    name: 'smartbar',

    pages: {
        smartbar: 'pages/smartbar/mzta-smartbar.html',
    },

    pageCommands() {
        return {
            smartbar_activity_list: () => ({ ok: true, records: [], more: false, counts: { running: 0, errors: 0 } }),
            smartbar_open_page: () => ({ ok: true }),
        };
    },
};
