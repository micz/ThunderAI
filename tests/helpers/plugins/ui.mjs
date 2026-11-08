/*
 *  The ui area's plugin (tests/ui/README.md): what the storage management page
 *  (pages/storage/) needs from the DOM harness and the core does not give.
 *
 *    pages      the page itself, `storage`;
 *    pageApis   messages.query({ headerMessageId }) and messageDisplay.open(), ONLY when the test
 *               passes opts.messageStore: on every other page (of every area) the strict proxy
 *               keeps reporting them as unmodelled, exactly as before this plugin existed.
 *
 *  opts.messageStore:
 *    messages   [{ id, headerMessageId, subject, author, date }]: what messages.query() finds
 *    fails      [headerMessageId]: the lookups that reject (a folder that cannot be read)
 *    opened     filled with the messageDisplay.open() arguments, in order
 *    queried    filled with the headerMessageId of every messages.query(), in order
 *
 *  No jsdom here, so level 1 can load it.
 */

export default {
    name: 'ui',

    pages: {
        storage: 'pages/storage/mzta-storage-manager.html',
    },

    pageApis(browser, opts) {
        const store = opts.messageStore;
        if (!store) return;
        store.opened = store.opened || [];
        store.queried = store.queried || [];
        browser.messages = {
            ...browser.messages,
            async query(info) {
                const id = info?.headerMessageId;
                store.queried.push(id);
                if ((store.fails || []).includes(id)) throw new Error('folder not readable');
                const found = (store.messages || []).filter(m => m.headerMessageId === id);
                return { id: null, messages: found.map(m => ({ ...m })) };
            },
        };
        browser.messageDisplay = {
            async open(props) {
                store.opened.push({ ...props });
                return { id: props.messageId };
            },
        };
    },
};
