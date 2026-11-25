/*
 *  The ui area's plugin (tests/ui/README.md): what the storage management page
 *  (pages/storage/) needs from the DOM harness and the core does not give.
 *
 *    pages      the page itself, `storage`;
 *    pageApis   messages.query({ headerMessageId }) and messageDisplay.open(), ONLY when the test
 *               passes opts.messageStore: on every other page (of every area) the strict proxy
 *               keeps reporting them as unmodelled, exactly as before this plugin existed. And
 *               the answers of other add-ons to runtime.sendMessage(extensionId, message), ONLY
 *               when the test passes opts.otherAddons (the core answers null to every one).
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
        // opts.otherAddons: (extensionId, message) => reply, ANOTHER add-on (QNote for the options
        // page's QNote row), for the two-argument runtime.sendMessage(extensionId, message). Only
        // when the test passes it; it then answers every other add-on too (Sparks: return null).
        // A reply may be a promise the test holds. The one-argument form is untouched.
        const otherAddons = opts.otherAddons;
        if (otherAddons) {
            const original = browser.runtime.sendMessage;
            browser.runtime.sendMessage = async (message, ...rest) => {
                if (typeof message === 'string' && rest.length > 0 && typeof rest[0] === 'object') {
                    const reply = await otherAddons(message, structuredClone(rest[0]));
                    return reply === undefined ? undefined : structuredClone(reply);
                }
                return original(message, ...rest);
            };
        }
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
