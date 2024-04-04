// Modified version derived from https://github.com/ali-raheem/Aify/blob/13ff87583bc520fb80f555ab90a90c5c9df797a7/plugin/html/globals.js

/*  Types (type attribute):
    0: always show (when composing a part of the text must be selected if need_selected = 1)
    1: show when reading an email
    2: show when composing a mail (a part of the text must be selected if need_selected = 1)

    Actions (action attribute):
    0: close button
    1: do reply
    2: substitute text

    Only if text selected (attribute need_selected):
    0: no selection needed (use all the message body)
    1: need a selection
*/

export const defaultPrompts = [
    { id: 'prompt_reply', name: "__MSG_prompt_reply__", text: "Reply to the following email.", type: 1, action: 1, need_selected: 0 },
    { id: 'prompt_rewrite_polite', name: "__MSG_prompt_rewrite_polite__", text: "Rewrite the following text to be more polite. Reply with only the re-written text and with no extra comments or other text.", type: 2, action: 2, need_selected: 1 },
    { id: 'prompt_rewrite_formal', name: "__MSG_prompt_rewrite_formal__", text: "Rewrite the following text to be more formal. Reply with only the re-written text and with no extra comments or other text.", type: 2, action: 2, need_selected: 1 },
    { id: 'prompt_classify', name: "__MSG_prompt_classify__", text: "Classify the following text in terms of Politeness, Warmth, Formality, Assertiveness, Offensiveness giving a percentage for each category. Reply with only the category and score with no extra comments or other text.", type: 0, action: 0, need_selected: 0 },
    { id: 'prompt_summarize_this', name: "__MSG_prompt_summarize_this__", text: "Summerize the following email into a bullet point list.", type: 0, action: 0, need_selected: 0 },
    { id: 'prompt_translate_this', name: "__MSG_prompt_translate_this__", text: "Translate the following email in __MSG_prompt_translate_lang__", type: 0, action: 0, need_selected: 0 },
];
