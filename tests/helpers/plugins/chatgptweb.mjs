/*
 *  The ChatGPT Web plugin (contract: ../core/plugins.mjs).
 *
 *  The area's module is js/mzta-chatgpt.js, which only exports `mzta_script`, the content script
 *  the background injects into the ChatGPT page as a string (pre-script + mzta_script). It is
 *  loaded with the other modules of every context and handed to the ctx as `chatgptWebScript`:
 *  importing it has no side effect, so the other areas' contexts are unchanged.
 *
 *  Nothing else: the content script runs in the ChatGPT page, not in an extension page, so the
 *  area needs no page, no page-side API and no background answer from the core (see
 *  tests/chatgptweb/README.md).
 *
 *  No jsdom here, so level 1 can load it.
 */

export default {
    name: 'chatgptweb',

    async modules(imp) {
        const chatgpt = await imp('js/mzta-chatgpt.js');
        return { chatgptWebScript: chatgpt.mzta_script };
    },
};
