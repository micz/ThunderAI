/*
 *  The feature settings pages that host a specific-integration panel, keyed by the feature
 *  prefix of special_prompts_with_integration (options/mzta-options-default.js).
 *
 *  The DOM scenarios for _special_prompts_connection are generated from this map, and
 *  tests/managed/10h checks that it covers special_prompts_with_integration exactly: a feature
 *  added to that list fails the suite until it is added here, with its page, which is what makes
 *  the new feature's panel covered. Kept free of jsdom, so level 1 can import it.
 *
 *    page       the dom-page.mjs PAGES key
 *    promptId   the special prompt the page's connection panel edits (the promptId it passes to
 *               initializeSpecificIntegrationUI())
 *    textarea   the id of the textarea that edits that text
 *    save       the id of its Save button, when it is not #btn_save_prompt (a page with several
 *               editors: the SmartBar page)
 *    text       a stored text for that prompt that satisfies its response contract
 *    root       the id of the element holding the feature's panel, when the page hosts several
 *               (the SmartBar page: one section per special prompt); absent: the whole page
 */

export const FEATURE_PAGES = {
    add_tags: {
        page: 'addtags', promptId: 'prompt_add_tags', textarea: 'addtags_prompt_text',
        text: 'Return {"tags": [...]} for {%mail_text_body%}',
    },
    spamfilter: {
        page: 'spamfilter', promptId: 'prompt_spamfilter', textarea: 'spamfilter_prompt_text',
        text: 'Return {"explanation": "", "spamValue": 0} for {%mail_html_body%}',
    },
    summarize: {
        page: 'summarize', promptId: 'prompt_summarize', textarea: 'summarize_prompt_text',
        text: 'Summarize the message.',
    },
    get_calendar_event: {
        page: 'get-calendar-event', promptId: 'prompt_get_calendar_event', textarea: 'get_calendar_event_prompt_text',
        text: 'Return {"startDate", "endDate", "summary"} for {%mail_text_body_or_selected%}',
    },
    get_task: {
        page: 'get-task', promptId: 'prompt_get_task', textarea: 'get_task_prompt_text',
        text: 'Return {"summary"} for {%mail_text_body_or_selected%}',
    },
    translate: {
        page: 'translate', promptId: 'prompt_translate_this', textarea: 'translate_prompt_text',
        text: 'Translate {%mail_html_body%} to {%thunderai_translate_lang%}, return {"subject", "body", "status"}',
    },
    smartbar_router: {
        page: 'smartbar', promptId: 'prompt_smartbar_router', root: 'smartbar_conn_router_section',
        textarea: 'smartbar_prompt_router_text', save: 'btn_save_smartbar_router',
        text: 'Route the instruction. {OPERATIONS} {PLACEHOLDERS} {LANGUAGE_RULE}',
    },
    smartbar_execute: {
        page: 'smartbar', promptId: 'prompt_smartbar_execute', root: 'smartbar_conn_execute_section',
        textarea: 'smartbar_prompt_execute_text', save: 'btn_save_smartbar_execute',
        text: 'Execute.',
    },
    smartbar_chat: {
        page: 'smartbar', promptId: 'prompt_smartbar_chat', root: 'smartbar_conn_chat_section',
        textarea: 'smartbar_prompt_chat_text', save: 'btn_save_smartbar_chat',
        text: 'Chat.',
    },
};

/** The feature prefixes a FEATURE_PAGES page hosts, in map order. */
export function prefixesOfPage(page) {
    return Object.entries(FEATURE_PAGES).filter(([, f]) => f.page === page).map(([prefix]) => prefix);
}

/**
 * The feature prefix a FEATURE_PAGES page belongs to. A page hosting several features (the
 * SmartBar page) has no single one: its scenario files name the prefix themselves.
 */
export function prefixOfPage(page) {
    const found = prefixesOfPage(page);
    if (found.length === 0) throw new Error('feature-pages: "' + page + '" is not a feature page');
    if (found.length > 1) throw new Error('feature-pages: "' + page + '" hosts several features (' + found.join(', ') + '): name one');
    return found[0];
}

/**
 * The scenario file of a feature: tests/dom/<page>/<NN-name>.dom.mjs, with the prefix appended
 * when the page hosts several features (13-connection-enforced-smartbar_router.dom.mjs).
 */
export function scenarioFile(prefix, name) {
    const page = FEATURE_PAGES[prefix].page;
    return page + '/' + name + (prefixesOfPage(page).length > 1 ? '-' + prefix : '') + '.dom.mjs';
}
