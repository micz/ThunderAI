/*
 *  The pre-script the background injects in front of mzta_script, cut out of mzta-background.js.
 *
 *  handleChatGptWeb() (inside openChatGPT()) builds `pre_script`, the `let mzta…` declarations
 *  that carry the preferences and the prompt's data into the ChatGPT page, then runs
 *  `pre_script + mzta_script` in the tab. The tests never keep a copy of that template: the
 *  expression assigned to `pre_script` is located with the core tokenizer (a `;` inside one of its
 *  strings or template literals does not end it) and evaluated with the names it uses as
 *  parameters. A name it reads that is not given here fails loudly (ReferenceError), so a new
 *  injected value cannot be missed by the tests.
 *
 *  `_gpt_model` is computed as the background computes it, with the real
 *  sanitizeChatGPTModelData() and getGPTWebModelString() of js/mzta-utils.js.
 *
 *  No jsdom here, so level 1 can import it.
 */

import {
    segments,
    backgroundSource
} from '../helpers/core/background-source.mjs';

const ANCHOR = 'let pre_script = ';

let cached = null;

/** The source text of the expression assigned to `pre_script` in mzta-background.js. */
export function preScriptSource(src = backgroundSource()) {
    if (cached && cached.src === src) return cached.text;
    const at = src.indexOf(ANCHOR);
    if (at === -1) throw new Error('chatgptweb: "' + ANCHOR + '" not found in mzta-background.js');
    if (src.indexOf(ANCHOR, at + 1) !== -1) throw new Error('chatgptweb: "' + ANCHOR + '" found twice in mzta-background.js');
    const start = at + ANCHOR.length;
    for (const s of segments(src)) {
        if (s.type !== 'code' || s.end <= start) continue;
        const semi = src.indexOf(';', Math.max(s.start, start));
        if (semi !== -1 && semi < s.end) {
            cached = { src, text: src.slice(start, semi) };
            return cached.text;
        }
    }
    throw new Error('chatgptweb: the end of the pre_script expression was not found');
}

/**
 * The pre-script, as the background builds it for one prompt.
 *
 * @param {object} o
 *   browser             the mock (its i18n is read)
 *   utils               js/mzta-utils.js (i18nConditionalGet, sanitizeChatGPTModelData, getGPTWebModelString)
 *   prefs               the preferences (prefs_default merged with what the test sets)
 *   model               the model the prompt asks for (the prompt's own, else chatgpt_web_model), as typed
 *   customGpt           a Custom GPT is opened: the model is not checked
 *   doCustomText        '1' to ask for the custom text first
 *   promptName, originalText, replyType, useDiffViewer, readyReason, readyStateAtSend, waitTime, windowId
 */
export function buildPreScript({
    browser,
    utils,
    prefs,
    model = prefs.chatgpt_web_model,
    customGpt = false,
    doCustomText = '0',
    promptName = 'Model check',
    originalText = '',
    replyType = 'reply_sender',
    useDiffViewer = '0',
    readyReason = 'composer',
    readyStateAtSend = 'complete',
    waitTime = 1000,
    windowId = 7,
}) {
    const deps = {
        createdTab: { id: 70, windowId },
        browser,
        do_custom_text: doCustomText,
        i18nConditionalGet: utils.i18nConditionalGet,
        prompt_name: promptName,
        prefs,
        _custom_gpt_set: customGpt,
        _gpt_model: utils.getGPTWebModelString(utils.sanitizeChatGPTModelData(model)),
        prompt_info: { use_diff_viewer: useDiffViewer },
        originalText,
        reply_type_pref: { reply_type: replyType },
        message: { readyReason, readyStateAtSend },
        _wait_time: waitTime,
    };
    const names = Object.keys(deps);
    // eslint-disable-next-line no-new-func
    const build = new Function(...names, '"use strict"; return (' + preScriptSource() + ');');
    return build(...names.map(n => deps[n]));
}
