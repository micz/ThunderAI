/*
 *  The smartbar area's plugin (tests/smartbar/README.md): the Smart bar settings page
 *  (pages/smartbar/), which the DOM harness does not know otherwise. Nothing else: a plugin is
 *  loaded into every context, and modelling an API here would change what the strict proxy
 *  reports on every other page.
 *
 *  No jsdom here, so level 1 can load it.
 */

export default {
    name: 'smartbar',

    pages: {
        smartbar: 'pages/smartbar/mzta-smartbar.html',
    },
};
