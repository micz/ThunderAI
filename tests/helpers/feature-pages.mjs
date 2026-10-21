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
 *    textarea   the id of the textarea that edits that text (saved with #btn_save_prompt)
 *    text       a stored text for that prompt that satisfies its response contract
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
};

/** The feature prefix a FEATURE_PAGES page belongs to. */
export function prefixOfPage(page) {
    const found = Object.entries(FEATURE_PAGES).find(([, f]) => f.page === page);
    if (!found) throw new Error('feature-pages: "' + page + '" is not a feature page');
    return found[0];
}
