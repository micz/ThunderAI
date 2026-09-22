/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// Modified prompts text derived from https://github.com/ali-raheem/Aify/blob/13ff87583bc520fb80f555ab90a90c5c9df797a7/plugin/html/globals.js

/*  ================= PROMPTS PROPERTIES ========================================

    ================ BASE PROPERTIES

    Types (type attribute):
    0: always show (when composing a part of the text must be selected if need_selected = 1)
    1: show when reading an email
    2: show when composing a mail (a part of the text must be selected if need_selected = 1)

    Actions (action attribute):
    0: close button
    1: do reply
    2: substitute text

    Only if text selected (need_selected attribute):
    0: no selection needed (use all the message body)
    1: need a selection

    Signature (need_signature attribute):
    0: No signature needed
    1: Signature needed

    Custom Text (need_custom_text attribute):
    0: No custom text needed
    1: Custom text needed

    Define response language (define_response_lang attribute):
    0: Do not include a statement about the response language in the prompt
    1: Include a statement about the response language in the prompt

    Use the diff viewer (use_diff_viewer attribute):
    0: Do not use the diff viewer
    1: Use the diff viewer

    ================ DYNAMIC PROPERTIES (set at runtime via prompt_info)

    headerMessageId (set by _openSummaryWebchat in mzta-background.js):
    When present, the webchat UI shows a "Save as Summary" button to capture
    the AI response and save it as an inline summary for the message identified
    by this headerMessageId.

    summaryTabId (set by _openSummaryWebchat in mzta-background.js):
    The tab ID of the message display tab to update with the saved summary.

    Show in menu (show_in attribute):
    "popup": Show only in the popup menu
    "context": Show only in the context menu
    "both": Show in both popup and context menus
    "none": Do not show in any menu

    ================ USER PROPERTIES
    Enabled (enabled attribute):
    0: Disabled
    1: Enabled

    Position Display Message (position_display attribute):
    <num>: position number

    Position Compose Message (position_compose attribute):
    <num>: position number

    ChatGPT Web Model (chatgpt_web_model attribute):
    <model>: model name (e.g. gpt-4, gpt-3.5-turbo, etc.)

    ChatGPT Web Project (chatgpt_web_project attribute):
    <project>: project id url

    ChatGPT Web Custom GPT (chatgpt_web_custom_gpt attribute):
    <custom_gpt>: custom gpt id url

    API Connection Type
    <api_type>: api type

    << All the API settings defined in the default options, with the same IDs. >>
*/

import { integration_options_config } from "../options/mzta-options-default.js";

// The five boolean-ish prompt flags documented above. Canonical representation
// is the string "0"/"1" -- that is what the definitions below declare, and what
// normalizePromptFlags() collapses every stored value back to.
export const promptBooleanFlags = [
    'need_selected',
    'need_signature',
    'need_custom_text',
    'define_response_lang',
    'use_diff_viewer',
];

const defaultPrompts = [
    {
        id: 'prompt_reply',
        name: "__MSG_prompt_reply__",
        text: "prompt_reply_full_text",
        type: "1",
        action: "1",
        need_selected: "0",
        need_signature: "1",
        need_custom_text: "0",
        define_response_lang: "1",
        use_diff_viewer: "0",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_reply_advanced',
        name: "__MSG_prompt_reply_advanced__",
        text: "prompt_reply_advanced_full_text",
        type: "1",
        action: "1",
        need_selected: "1",
        need_signature: "1",
        need_custom_text: "0",
        define_response_lang: "1",
        use_diff_viewer: "0",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_reply_custom_command',
        name: "__MSG_prompt_reply_custom_command__",
        text: "prompt_reply_custom_command_full_text",
        type: "1",
        action: "1",
        need_selected: "0",
        need_signature: "1",
        need_custom_text: "1",
        define_response_lang: "1",
        use_diff_viewer: "0",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_rewrite_polite',
        name: "__MSG_prompt_rewrite_polite__",
        text: "prompt_rewrite_full_text",
        type: "2",
        action: "2",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "1",
        use_diff_viewer: "1",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_rewrite_formal',
        name: "__MSG_prompt_rewrite_formal__",
        text: "prompt_rewrite_formal_full_text",
        type: "2",
        action: "2",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "1",
        use_diff_viewer: "1",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_classify',
        name: "__MSG_prompt_classify__",
        text: "prompt_classify_full_text",
        type: "0",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "1",
        use_diff_viewer: "0",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_proofread_this',
        name: "__MSG_prompt_proofread_this__",
        text: "prompt_proofread_this_full_text",
        type: "2",
        action: "2",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "1",
        use_diff_viewer: "1",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
    {
        id: 'prompt_this',
        name: "__MSG_prompt_this__",
        text: "prompt_this_full_text",
        type: "2",
        action: "2",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        chatgpt_web_model: '',
        chatgpt_web_project: '',
        chatgpt_web_custom_gpt: '',
        api_type: '',
        is_default: "1",
        is_special: "0",
        show_in: "popup",
    },
];

const specialPrompts = [
    {
        id: 'prompt_add_tags',
        name: "__MSG_prompt_add_tags__",
        text: "prompt_add_tags_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        is_default: "1",
        is_special: "1",
        show_in: "both",
    },
    {
        id: 'prompt_get_calendar_event',
        name: "__MSG_prompt_get_calendar_event__",
        text: "prompt_get_calendar_event_full_text",
        type: "1",
        action: "0",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        is_default: "1",
        is_special: "1",
        show_in: "popup",
    },
    {
        id: 'prompt_get_calendar_event_from_clipboard',
        name: "__MSG_prompt_get_calendar_event_from_clipboard__",
        text: "prompt_get_calendar_event_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        is_default: "1",
        is_special: "1",
        show_in: "popup",
    },
    {
        id: 'prompt_get_task',
        name: "__MSG_prompt_get_task__",
        text: "prompt_get_task_full_text",
        type: "1",
        action: "0",
        need_selected: "1",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        is_default: "1",
        is_special: "1",
        show_in: "popup",
    },
    {
        id: 'prompt_spamfilter',
        name: "__MSG_prompt_spamfilter__",
        text: "prompt_spamfilter_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        is_default: "1",
        is_special: "1",
        show_in: "context",
    },
    {
        id: 'prompt_summarize',
        name: "__MSG_prompt_summarize__",
        text: "prompt_summarize_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        api_model: '',
        is_default: "1",
        is_special: "1",
        show_in: "context",
    },
    {
        id: 'prompt_summarize_email_template',
        name: "__MSG_prompt_summarize_email_template__",
        text: "prompt_summarize_email_template_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        api_model: '',
        is_default: "1",
        is_special: "1",
        show_in: "none",
    },
    {
        id: 'prompt_summarize_email_separator',
        name: "__MSG_prompt_summarize_email_separator__",
        text: "prompt_summarize_email_separator_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        api_model: '',
        is_default: "1",
        is_special: "1",
        show_in: "none",
    },
    {
        id: 'prompt_translate_this',
        name: "__MSG_prompt_translate_this__",
        text: "prompt_translate_this_full_text",
        type: "1",
        action: "0",
        need_selected: "0",
        need_signature: "0",
        need_custom_text: "0",
        define_response_lang: "0",
        use_diff_viewer: "0",
        api_type: '',
        api_model: '',
        is_default: "1",
        is_special: "1",
        show_in: "context",
    }
];


// The organization prompts supplied by an enterprise policy: the fourth prompt set,
// alongside defaultPrompts, _custom_prompt and _special_prompts.
//
// They are never stored. The policy is the only source of truth, read once at startup in
// the background page, so a prompt added, changed or removed in the policy is reflected at
// the next Thunderbird start and nothing of the user's is ever touched.
//
// This module runs in BOTH the background page and the settings pages, and only the
// background may read browser.storage.managed. So: in the background the managed module is
// imported directly, and everywhere else the prompts are fetched over runtime.sendMessage.
// The result is cached because getPrompts() is called repeatedly while building menus.
let _orgPromptsCache = null;

async function getOrgPrompts() {
    if (_orgPromptsCache !== null) return _orgPromptsCache;
    let prompts = [];
    try {
        // Importing mzta-managed.js is harmless in any context - it only READS the policy
        // when loadManaged() is called, which happens in the background page alone. So the
        // question is not "where am I" but "has the policy been loaded here", which
        // hasLoaded() answers without any fragile context sniffing.
        const { mztaManaged } = await import('./mzta-managed.js');
        if (mztaManaged.hasLoaded()) {
            prompts = mztaManaged.getOrgPrompts();
        } else {
            prompts = await browser.runtime.sendMessage({ command: 'get_org_prompts' }) || [];
        }
    } catch (e) {
        // A settings page opened while the background is still starting, or any other
        // transient failure: behave as if there were no policy rather than break the page.
        prompts = [];
    }
    // Deep-cloned and normalised on the way out, so a caller that mutates a prompt (as the
    // menu code does when it localises names) cannot corrupt the policy-supplied originals.
    _orgPromptsCache = JSON.parse(JSON.stringify(prompts))
        .map(prompt => normalizePromptFields(prompt));
    return _orgPromptsCache;
}

/** The set of organization prompt ids, lowercased. Used to detect shadowed custom prompts. */
export async function getOrgPromptIds() {
    return new Set((await getOrgPrompts()).map(p => String(p.id).toLowerCase()));
}

// Whether the policy forbids prompt management. Same dual-context shape as getOrgPrompts()
// above - in the background the managed module is read directly, everywhere else the state
// comes over runtime.sendMessage - and cached for the same reason: getPrompts() is called
// repeatedly while building menus.
//
// It fails OPEN (false) on any error, matching pages/_lib/managed-ui.js. A restriction
// misread as ON would make the user's own prompts vanish from every menu and turn
// read-only in the management page, which is far worse than a restriction briefly not
// applied: the policy is re-read at the next start anyway.
let _promptMgmtDisabledCache = null;

async function isPromptManagementDisabled() {
    if (_promptMgmtDisabledCache !== null) return _promptMgmtDisabledCache;
    let disabled = false;
    try {
        const { mztaManaged } = await import('./mzta-managed.js');
        if (mztaManaged.hasLoaded()) {
            disabled = mztaManaged.isPromptManagementDisabled();
        } else {
            const state = await browser.runtime.sendMessage({ command: 'get_managed_state' });
            disabled = (state && state.disablePromptManagement === true);
        }
    } catch (e) {
        disabled = false;
    }
    _promptMgmtDisabledCache = disabled;
    return _promptMgmtDisabledCache;
}

/**
 * A prompt the user owns: not built-in, not special, not supplied by the policy.
 * These are the ones _disable_prompt_management makes inert.
 */
function isUserOwnedPrompt(prompt) {
    return String(prompt.is_default) !== '1'
        && String(prompt.is_special) !== '1'
        && String(prompt.is_org) !== '1';
}

// Whether the policy takes the built-in prompts out of the menus. Same dual-context shape
// and the same cache as isPromptManagementDisabled() above, and it fails OPEN for the same
// reason: a restriction misread as ON would empty the menus of an unmanaged installation.
let _defaultPromptsDisabledCache = null;

async function areDefaultPromptsDisabled() {
    if (_defaultPromptsDisabledCache !== null) return _defaultPromptsDisabledCache;
    let disabled = false;
    try {
        const { mztaManaged } = await import('./mzta-managed.js');
        if (mztaManaged.hasLoaded()) {
            disabled = mztaManaged.areDefaultPromptsDisabled();
        } else {
            const state = await browser.runtime.sendMessage({ command: 'get_managed_state' });
            disabled = (state && state.disableDefaultPrompts === true);
        }
    } catch (e) {
        disabled = false;
    }
    _defaultPromptsDisabledCache = disabled;
    return _defaultPromptsDisabledCache;
}

/**
 * A built-in prompt: one of the eight defined in this file, and NOT a special one.
 *
 * The is_special test is what makes this different from a plain is_default check: the
 * special prompts carry is_default "1" as well, because their display properties are stored
 * the same way, but they back features of their own and _disable_default_prompts leaves
 * them alone.
 */
function isBuiltInDefaultPrompt(prompt) {
    return String(prompt.is_default) === '1' && String(prompt.is_special) !== '1';
}

/**
 * The merge behind all three views below: the four prompt sets in one array, with the
 * three reasons a prompt can be inactive MARKED on it rather than filtered out.
 *
 *   _shadowed_by_org  - an organization prompt has taken this custom prompt's id
 *   _inert_by_policy  - _disable_prompt_management is on and this is the user's own prompt
 *   _default_inert_by_policy - _disable_default_prompts is on and this is a built-in prompt
 *
 * Marking instead of dropping is deliberate, and it is a data-safety rule, not a style
 * choice: the pages that administer prompts rewrite the whole _custom_prompt store from
 * the list they were given (pages/menu_order/ saveAll(), pages/customprompts/ saveAll()),
 * so a prompt missing from their list is a prompt DELETED on the next Save. Only the
 * invocation view (getPrompts) drops anything.
 */
async function buildPromptSet({ includeSpecial = false } = {}) {
    const _defaultPrompts = await getDefaultPrompts_withProps();
    const customPrompts = await getCustomPrompts();
    const orgPrompts = await getOrgPrompts();
    const orgPromptIds = new Set(orgPrompts.map(p => String(p.id).toLowerCase()));
    const mgmtDisabled = await isPromptManagementDisabled();
    const defaultsDisabled = await areDefaultPromptsDisabled();

    const specials = includeSpecial ? await getSpecialPrompts() : [];
    const output = specials.concat(_defaultPrompts).concat(orgPrompts).concat(customPrompts);

    output.forEach(p => {
        p._shadowed_by_org = isShadowedByOrgPrompt(p, orgPromptIds);
        p._inert_by_policy = mgmtDisabled && isUserOwnedPrompt(p);
        p._default_inert_by_policy = defaultsDisabled && isBuiltInDefaultPrompt(p);
    });
    return output;
}

export async function getPrompts(onlyReachable = false, includeSpecial = [], allSpecial = false){ // includeSpecial is an array of active special prompts ids
    // The invocation view: everywhere a prompt can actually be run - the compose, display
    // and context menus, the popup, and loadPrompt() by id.
    //
    // A custom prompt whose id an organization prompt has taken is dropped here, not
    // deleted: the org prompt wins wherever a prompt can be invoked, while the user's own
    // prompt stays in storage and reappears if the policy stops supplying that id. A
    // prompt made inert by _disable_prompt_management is dropped for the same reason and
    // in the same way, as is a built-in one made inert by _disable_default_prompts. The
    // administration pages call getPromptsForManagement() or getPromptsForMenuOrder()
    // instead, which keep all of them visible.
    let output = (await buildPromptSet({ includeSpecial: true }))
        .filter(p => !p._shadowed_by_org && !p._inert_by_policy && !p._default_inert_by_policy);
    if((includeSpecial.length == 0) && !allSpecial){
        output = output.filter(obj => obj.is_special != 1); // we do not want special prompts
    }else{
        // console.log(">>>>>>>>>> getPrompts includeSpecial: " + JSON.stringify(includeSpecial));
        output = output.filter(obj => includeSpecial.includes(obj.id) || obj.is_special != 1 || allSpecial);
        // output = output.filter(obj => {
        //     const isIncluded = includeSpecial.includes(obj.id);
        //     const isNotSpecial = obj.is_special != 1;

        //     console.log(`>>>>>>>>>> Checking obj:`, obj);
        //     console.log(`>>>>>>>>>> isIncluded: ${isIncluded}`);
        //     console.log(`>>>>>>>>>> isNotSpecial: ${isNotSpecial}`);

        //     return isIncluded || isNotSpecial;
        //   });
    }
    if(onlyReachable){
        // Reachability is fully determined by show_in: a prompt with show_in === 'none'
        // is in no menu and cannot be invoked by anything (the shortcut just opens the popup).
        output = output.filter(obj => String(obj.show_in) !== 'none');
    }else{  // order only if we are not filtering, the filtering is for the menus and we are ordering there after i18n
        output.sort((a, b) => a.id.localeCompare(b.id));
    }
    for(let i=1; i<=output.length; i++){
        output[i-1].idnum = i;
    }
    // console.log('>>>>>>>>>>>> getPrompts output: ' + JSON.stringify(output));
    return output;
}

/**
 * getPrompts() for the custom prompts management page.
 *
 * Identical to getPrompts(), except that an inactive prompt is KEPT and flagged, rather
 * than dropped: _shadowed_by_org for a custom prompt whose id an organization prompt has
 * taken, _inert_by_policy for one made read-only by _disable_prompt_management. That page
 * is where the user administers their own prompts, so a prompt of theirs must never just
 * disappear from it: it is shown disabled, with an explanation, and - this is the part
 * that matters - it is still saved. The page rewrites the whole _custom_prompt store from
 * what it lists, so dropping the row here would delete the user's prompt for real on the
 * next Save All.
 *
 * Special prompts are not listed on that page, so they are left out entirely. The menu
 * order page needs them and uses getPromptsForMenuOrder() below.
 */
export async function getPromptsForManagement(){
    let output = await buildPromptSet({ includeSpecial: false });
    output.sort((a, b) => a.id.localeCompare(b.id));
    for(let i=1; i<=output.length; i++){
        output[i-1].idnum = i;
    }
    return output;
}

/**
 * getPrompts() for the menu order page.
 *
 * Like getPromptsForManagement() it keeps the inactive prompts and flags them, for exactly
 * the same reason - that page also rewrites _custom_prompt wholesale from the list it was
 * given - but it INCLUDES special prompts, which it both lists and writes back to
 * _special_prompts. Handing it getPromptsForManagement() would wipe that store on Save.
 */
export async function getPromptsForMenuOrder(){
    let output = await buildPromptSet({ includeSpecial: true });
    output.sort((a, b) => a.id.localeCompare(b.id));
    for(let i=1; i<=output.length; i++){
        output[i-1].idnum = i;
    }
    return output;
}

export function preparePromptsForExport(prompts, include_api_settings = false){
    let output = JSON.parse(JSON.stringify(prompts));
    output.forEach(prompt => {

        if(!include_api_settings){
            delete prompt.api_type;
            for (const [integration, options] of Object.entries(integration_options_config)) {
                for (const key of Object.keys(options)) {
                    delete prompt[`${integration}_${key}`];
                }
            }
        } else {
            if(prompt.api_type && prompt.api_type !== ''){
                const activeIntegration = prompt.api_type.replace('_api', '');
                for (const [integration, options] of Object.entries(integration_options_config)) {
                    if(integration !== activeIntegration){
                        for (const key of Object.keys(options)) {
                            delete prompt[`${integration}_${key}`];
                        }
                    }
                }
            } else {
                for (const [integration, options] of Object.entries(integration_options_config)) {
                    for (const key of Object.keys(options)) {
                        delete prompt[`${integration}_${key}`];
                    }
                }
            }
        }

        if(prompt.is_default == 1){
            let allowedKeys = ['id', 'position_compose', 'position_display', 'position_context', 'need_custom_text', 'show_in', 'custom_icon'];
            if(include_api_settings){
                allowedKeys.push('api_type');
                for (const [integration, options] of Object.entries(integration_options_config)) {
                    for (const key of Object.keys(options)) {
                        allowedKeys.push(`${integration}_${key}`);
                    }
                }
            }
            Object.keys(prompt).forEach(key => {
                if(!allowedKeys.includes(key)){
                    delete prompt[key];
                }
            })
        }else{
            delete prompt['idnum'];
        }

        // Never export the transient policy/shadowing flags: a backup is restored on
        // another profile, or on this one after the policy is gone, and a stored
        // flag such as _inert_by_policy would disable a prompt for a policy that no
        // longer applies.
        // (is_default rows are already covered by the allowedKeys filter above.)
        TRANSIENT_PROMPT_FLAGS.forEach(flag => delete prompt[flag]);
    });
    return output;
}

export async function preparePromptsForImport(prompts){
    // console.log(">>>>>>>>>>> preparePromptsForImport prompts: " + JSON.stringify(prompts));
    // The merged result is written back over the user's prompts by the import, so it must
    // start from the complete set: a prompt missing here is a prompt dropped on import.
    const output = await getPromptsForManagement();
    // console.log(">>>>>>>>>>> preparePromptsForImport output: " + JSON.stringify(output));
    prompts.forEach(prompt => {
        if(output.some(p => p.id == prompt.id)){
            Object.keys(prompt).forEach(key => {
               output.find(p => p.id == prompt.id)[key] = prompt[key];
            })
        }else{
            output.push(prompt);
        }
    });
    // Backward-compat: old backups may still carry the removed `enabled` flag.
    // Map enabled == 0 to show_in === 'none' and drop the field.
    output.forEach(normalizeEnabledToShowIn);
    // A backup file carries whatever representation the version that wrote it
    // used (numbers, strings, or a missing key), and the merge above copies it
    // verbatim -- so collapse the flags to the canonical "0"/"1" here too.
    output.forEach((prompt) => normalizePromptFlags(prompt));
    output.sort((a, b) => a.id.localeCompare(b.id));
    // console.log(">>>>>>>>>>> preparePromptsForImport final output: " + JSON.stringify(output));
    return output;
}

// Backward-compat helper: the prompt `enabled` flag has been removed in favour of
// show_in being the single source of truth. Map a legacy enabled == 0 to
// show_in = 'none' (the "off" state), then drop the field entirely.
export function normalizeEnabledToShowIn(prompt) {
    if (prompt.enabled === 0 || prompt.enabled === "0") {
        prompt.show_in = 'none';
    }
    delete prompt.enabled;
}

// True only for the values that legitimately mean "on". Everything else --
// including the out-of-domain "" that setDefaultPromptsProperties used to write
// -- means "off". Kept deliberately strict: a corrupted value must never turn a
// behaviour on.
export function isPromptFlagOn(value) {
    return value === 1 || value === "1" || value === true;
}

// Normalizing helper, same shape as normalizeEnabledToShowIn above: mutating,
// idempotent, one prompt at a time. The customprompts UI writes these flags as
// numbers while the built-ins are strings, and a missing value used to degrade
// to "" -- three representations for one field. This collapses them to "0"/"1"
// and guarantees every key is present, so consumers can compare against "1"
// without caring where the prompt came from.
//
// `fallbacks` supplies the value to use when the stored one is out of domain
// (neither 0/1 nor "0"/"1"). Default prompts pass their built-in value here so a
// corrupted override falls back to what the prompt ships with, rather than to a
// blanket "0" which would silently disable prompts built with the flag on.
export function normalizePromptFlags(prompt, fallbacks = {}) {
    promptBooleanFlags.forEach((flag) => {
        const value = prompt[flag];
        if (value === 0 || value === "0") {
            prompt[flag] = "0";
        } else if (isPromptFlagOn(value)) {
            prompt[flag] = "1";
        } else {
            // Out of domain ("", undefined, "undefined", null, ...).
            prompt[flag] = isPromptFlagOn(fallbacks[flag]) ? "1" : "0";
        }
    });
}

async function getDefaultPrompts_withProps() {
    let prefs = await browser.storage.local.get({_default_prompts_properties: null});
    // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps prefs: ' + JSON.stringify(prefs));
    //let defaultPrompts_prop = [...defaultPrompts];
    let defaultPrompts_prop = JSON.parse(JSON.stringify(defaultPrompts));
    // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps defaultPrompts: ' + JSON.stringify(defaultPrompts));
    // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps defaultPrompts_prop: ' + JSON.stringify(defaultPrompts_prop));
    if(prefs._default_prompts_properties === null){     // no default prompts properties saved
        let pos = 1;
        defaultPrompts_prop.forEach((prompt) => {
            prompt.text = browser.i18n.getMessage(prompt.text);
            prompt.position_display = pos;
            prompt.position_compose = pos;
            prompt.position_context = pos;
            normalizePromptFlags(prompt);
            pos++;
        })
        // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps [no prop saved] defaultPrompts_prop: ' + JSON.stringify(defaultPrompts_prop));
    } else {    // we have saved default prompts properties
        let pos = 1000;
        defaultPrompts_prop.forEach((prompt) => {
            prompt.text = browser.i18n.getMessage(prompt.text);
            // Captured before the stored properties overwrite them: they are the
            // fallback for an override that is out of domain (see below).
            const builtInFlags = { ...prompt };
            if(prefs._default_prompts_properties?.[prompt.id]){
                prompt.position_compose = prefs._default_prompts_properties[prompt.id].position_compose;
                prompt.position_display = prefs._default_prompts_properties[prompt.id].position_display;
                prompt.position_context = prefs._default_prompts_properties[prompt.id]?.position_context || prompt.position_display;
                // need_custom_text is the only one of the five flags persisted for
                // default prompts, so it is the only one that can come back out of
                // domain (older versions wrote "" for a missing value). Assign it
                // raw here; normalizePromptFlags() below turns a bad value back
                // into the built-in rather than silently forcing it off.
                prompt.need_custom_text = prefs._default_prompts_properties[prompt.id].need_custom_text;
                prompt.chatgpt_web_model = prefs._default_prompts_properties[prompt.id].chatgpt_web_model;
                prompt.chatgpt_web_project = prefs._default_prompts_properties[prompt.id].chatgpt_web_project;
                prompt.chatgpt_web_custom_gpt = (prefs._default_prompts_properties[prompt.id]?.chatgpt_web_custom_gpt || '').trim();
                prompt.api_type = (prefs._default_prompts_properties[prompt.id]?.api_type || '').trim();
                prompt.show_in = prefs._default_prompts_properties[prompt.id]?.show_in || prompt.show_in;
                prompt.custom_icon = prefs._default_prompts_properties[prompt.id]?.custom_icon || "";
            }else{
                prompt.position_display = pos;
                prompt.position_compose = pos;
                prompt.position_context = pos;
                pos++;
            }
            normalizePromptFlags(prompt, builtInFlags);
        })
        // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps [prop saved] defaultPrompts_prop: ' + JSON.stringify(defaultPrompts_prop));
    }
    // console.log('>>>>>>>>>>>> getDefaultPrompts_withProps [final] defaultPrompts_prop: ' + JSON.stringify(defaultPrompts_prop));
    return defaultPrompts_prop;
}


/**
 * Give a prompt its canonical field shape, in place, and return it.
 *
 * Used for every prompt that does not come from the shipped defaults: the user's custom
 * prompts, and the organization prompts supplied by an enterprise policy. Both arrive
 * with fields that may be missing entirely (an older stored prompt, or a policy that
 * omits everything optional), so the two must normalise identically or the same prompt
 * would behave differently depending on where it came from.
 *
 * The boolean flags are collapsed to the canonical "0"/"1" by normalizePromptFlags():
 * the customprompts UI writes them as numbers, and a missing value used to leave
 * use_diff_viewer undefined. These prompts have no built-in to fall back to, so an
 * out-of-domain value means off.
 */
export function normalizePromptFields(prompt) {
    normalizePromptFlags(prompt);
    if(prompt.chatgpt_web_model === undefined){
        prompt.chatgpt_web_model = "";
    }
    if(prompt.chatgpt_web_project === undefined){
        prompt.chatgpt_web_project = "";
    }
    if(prompt.chatgpt_web_custom_gpt === undefined){
        prompt.chatgpt_web_custom_gpt = "";
    }
    if(prompt.api_type === undefined){
        prompt.api_type = "";
    }
    if(prompt.show_in === undefined){
        prompt.show_in = "popup";
    }
    if(prompt.custom_icon === undefined){
        prompt.custom_icon = "";
    }
    return prompt;
}

/**
 * True when a custom prompt is shadowed by an organization prompt with the same id.
 *
 * The user cannot be allowed to disable an organization prompt by creating one with its
 * id: the org prompt would silently vanish, and neither the user nor the administrator
 * would see why. So the organization prompt wins everywhere a prompt can be invoked.
 *
 * The user's prompt is NOT deleted. It stays in _custom_prompt untouched, it is still
 * saved by the custom prompts page, and it comes back by itself the moment the policy
 * stops supplying that id. Only pages/customprompts/ shows it while it is shadowed, so
 * the user can see it exists and why it is inactive; every other surface hides it.
 */
export function isShadowedByOrgPrompt(prompt, orgPromptIds) {
    if (!orgPromptIds || orgPromptIds.size === 0) return false;
    if (String(prompt.is_org) === '1') return false;
    if (String(prompt.is_default) === '1' || String(prompt.is_special) === '1') return false;
    return orgPromptIds.has(String(prompt.id).toLowerCase());
}

async function getCustomPrompts() {
    let prefs = await browser.storage.local.get({_custom_prompt: null});
    if(prefs._custom_prompt === null){
        return [];
    } else {
        prefs._custom_prompt.forEach(prompt => normalizePromptFields(prompt));
        return prefs._custom_prompt;
    }
}

export async function setDefaultPromptsProperties(prompts) {
    let default_prompts_properties = {};
    prompts.forEach((prompt) => {
        default_prompts_properties[prompt.id] = {
            position_compose: (prompt.position_compose === undefined || prompt.position_compose === "undefined") ? "" : prompt.position_compose,
            position_display: (prompt.position_display === undefined || prompt.position_display === "undefined") ? "" : prompt.position_display,
            position_context: (prompt.position_context === undefined || prompt.position_context === "undefined") ? "" : prompt.position_context,
            // Never persist an out-of-domain value: "" used to be written for a
            // missing flag, and it reads as "on" in the editor but "off"
            // everywhere else. Store the canonical "0"/"1" instead.
            need_custom_text: isPromptFlagOn(prompt.need_custom_text) ? "1" : "0",
            chatgpt_web_model: (prompt.chatgpt_web_model === undefined || prompt.chatgpt_web_model === "undefined") ? "" : prompt.chatgpt_web_model,
            chatgpt_web_project: (prompt.chatgpt_web_project === undefined || prompt.chatgpt_web_project === "undefined") ? "" : prompt.chatgpt_web_project,
            chatgpt_web_custom_gpt: (prompt.chatgpt_web_custom_gpt === undefined || prompt.chatgpt_web_custom_gpt === "undefined") ? "" : prompt.chatgpt_web_custom_gpt,
            api_type: (prompt.api_type === undefined || prompt.api_type === "undefined") ? "" : prompt.api_type,
            show_in: (prompt.show_in === undefined || prompt.show_in === "undefined") ? "popup" : prompt.show_in,
            custom_icon: (prompt.custom_icon === undefined || prompt.custom_icon === "undefined") ? "" : prompt.custom_icon,
        };
    });
    //console.log('>>>>>>>>>>>>>> default_prompts_properties: ' + JSON.stringify(default_prompts_properties));
    await browser.storage.local.set({_default_prompts_properties: default_prompts_properties});
}

/**
 * The transient flags buildPromptSet() attaches. They describe the CURRENT policy state,
 * never the prompt itself, so they must not reach storage: a stored _inert_by_policy would
 * outlive the policy that set it and keep a prompt disabled after it was lifted.
 *
 * Stripped here, at the two gates into storage, rather than in each caller - the pages
 * that save hand their whole in-memory prompt objects straight through.
 */
const TRANSIENT_PROMPT_FLAGS = ['_shadowed_by_org', '_inert_by_policy',
                                '_default_inert_by_policy'];

function stripTransientFlags(prompts) {
    return prompts.map(prompt => {
        const copy = Object.assign({}, prompt);
        TRANSIENT_PROMPT_FLAGS.forEach(flag => delete copy[flag]);
        return copy;
    });
}

export async function setCustomPrompts(prompts) {
    // console.log(">>>>>>>>>>>> setCustomPrompts prompts: " + JSON.stringify(prompts));
    await browser.storage.local.set({_custom_prompt: stripTransientFlags(prompts)});
}

export async function getSpecialPrompts(){
    let prefs = await browser.storage.local.get({_special_prompts: null});
    if(prefs._special_prompts === null){
        let def_specPrompts = structuredClone(specialPrompts);
        def_specPrompts.forEach((prompt) => {
            // console.log(">>>>>>>>>>>>> getSpecialPrompts prompt: " + JSON.stringify(prompt));
            prompt.text = browser.i18n.getMessage(prompt.text);
            // Icons are selectable for special prompts too; empty means "use the
            // hard-coded built-in icon" (see getBuiltInPromptIcon()).
            prompt.custom_icon = "";
            normalizePromptFlags(prompt);
        })
        return def_specPrompts;
    } else {
        let updatedPrompts = structuredClone(prefs._special_prompts);

        specialPrompts.forEach((defaultPrompt) => {
            if (!updatedPrompts.some((prompt) => prompt.id === defaultPrompt.id)) {
                let newPrompt = structuredClone(defaultPrompt);
                newPrompt.text = browser.i18n.getMessage(newPrompt.text);
                updatedPrompts.push(newPrompt);
            }
        });
        // Migrate: add show_in if missing from saved special prompts
        updatedPrompts.forEach((prompt) => {
            if (prompt.show_in === undefined) {
                prompt.show_in = "both";
            }
            // Migrate: special prompts saved before icons were selectable have no
            // custom_icon; empty means "use the hard-coded built-in icon".
            if (prompt.custom_icon === undefined || prompt.custom_icon === "undefined") {
                prompt.custom_icon = "";
            }
            // This getter is exported and called directly by buildSummaryPrompt()/
            // buildTranslationPrompt() and by the feature pages, bypassing
            // getPrompts() -- so it has to normalize the flags itself. Fall back to
            // the shipped definition when a saved value is out of domain.
            const builtIn = specialPrompts.find((sp) => sp.id === prompt.id);
            normalizePromptFlags(prompt, builtIn || {});
        });

        // console.log(">>>>>>>>>>>>> getSpecialPrompts updatedPrompts: " + JSON.stringify(updatedPrompts));
        if (updatedPrompts.length !== prefs._special_prompts.length) {
            await browser.storage.local.set({ _special_prompts: updatedPrompts });
        }

        return updatedPrompts;
    }
}

export async function setSpecialPrompts(prompts) {
    // console.log(">>>>>>>>>>>> setSpecialPrompts prompts: " + JSON.stringify(prompts));
    await browser.storage.local.set({_special_prompts: stripTransientFlags(prompts)});
}

export function getHiddenSpecialPromptIds() {
    return specialPrompts.filter(p => p.show_in === "none").map(p => p.id);
}

// Factory show_in for a prompt id: the value declared in the built-in
// defaultPrompts/specialPrompts arrays. Custom prompts have no declaration,
// so they fall back to the same default used by getCustomPrompts() ("popup").
// Used by the menu order page to reset visibility to its out-of-the-box state.
export function getFactoryShowIn(promptId) {
    const prompt = specialPrompts.find(sp => sp.id === promptId)
                || defaultPrompts.find(dp => dp.id === promptId);
    return prompt?.show_in || "popup";
}

// Factory need_custom_text for a built-in prompt: the value declared in defaultPrompts.
// It is the only one of the five flags a user can override on a built-in (see
// setDefaultPromptsProperties), so it is all "Restore default" on the Custom Prompts
// page has to put back. "0" for an id that is not a built-in.
export function getFactoryNeedCustomText(promptId) {
    const prompt = defaultPrompts.find(dp => dp.id === promptId);
    return prompt ? String(prompt.need_custom_text) : "0";
}

// Migration: if dynamic_menu_order_alphabet was true (or unset), assign initial positions
// so that prompts appear alphabetically with special prompts first, then disable the flag
// to switch to position-based ordering permanently.
export async function migrateMenuOrderAlphabetic() {
    // Deliberately NOT routed through js/mzta-prefs.js (issue #163): this is a one-shot
    // migration flag, not a preference. It has no UI and no prefs_default entry on purpose
    // (see claude-spec/05-options.md) — declaring it would make it surface in getAllPrefs()
    // and in every page's restoreOptions().
    //
    // The area must match PREFS_AREA in js/mzta-prefs.js. The flag defaults to "not yet
    // run", so reading it from an area the migration did not populate would re-run this
    // migration and OVERWRITE the user's custom menu ordering (see the position_* writes
    // below). migratePrefsToLocal() carries the flag across for exactly this reason.
    const prefs = await browser.storage.local.get({ dynamic_menu_order_alphabet: true });
    if (!prefs.dynamic_menu_order_alphabet) {
        return;
    }

    // getPromptsForMenuOrder(), not getPrompts(): this migration rewrites _custom_prompt
    // wholesale below, so it must see every prompt the user owns - including the ones an
    // org prompt shadows or a policy has made inert. With the filtering view they would be
    // missing from `ordered` and setCustomPrompts() would delete them for real.
    const allPrompts = await getPromptsForMenuOrder();
    const hiddenSpecialIds = getHiddenSpecialPromptIds();
    const visiblePrompts = allPrompts.filter(p => !hiddenSpecialIds.includes(p.id));

    const resolveName = (p) => {
        const n = p.name || '';
        if (n.startsWith('__MSG_') && n.endsWith('__')) {
            return browser.i18n.getMessage(n.substring(6, n.length - 2));
        }
        return n;
    };

    const specials = visiblePrompts.filter(p => String(p.is_special) === '1')
        .sort((a, b) => resolveName(a).localeCompare(resolveName(b)));
    const others = visiblePrompts.filter(p => String(p.is_special) !== '1')
        .sort((a, b) => resolveName(a).localeCompare(resolveName(b)));
    const ordered = specials.concat(others);

    ordered.forEach((prompt, idx) => {
        const pos = idx + 1;
        prompt.position_display = pos;
        prompt.position_compose = pos;
        prompt.position_context = pos;
    });

    const defaultPromptsToSave = ordered.filter(p => String(p.is_default) === '1' && String(p.is_special) !== '1');
    const customPromptsToSave = ordered.filter(p => String(p.is_default) === '0' && String(p.is_special) !== '1');
    const visibleSpecialsToSave = ordered.filter(p => String(p.is_special) === '1');
    const hiddenSpecialsToPreserve = allPrompts.filter(p => hiddenSpecialIds.includes(p.id));

    await setDefaultPromptsProperties(defaultPromptsToSave);
    await setCustomPrompts(customPromptsToSave);
    await setSpecialPrompts(visibleSpecialsToSave.concat(hiddenSpecialsToPreserve));

    await browser.storage.local.set({ dynamic_menu_order_alphabet: false });
}

// One-time migration: the prompt `enabled` flag has been removed. show_in is now
// the single source of truth for reachability. For every stored prompt across the
// three stores: if it was disabled (enabled == 0) collapse it to show_in = 'none'
// (its previous show_in is intentionally discarded — "off" becomes "none"), then
// drop the enabled property. Guarded by a one-shot sync flag so it runs once;
// also idempotent by construction (after it runs no `enabled` keys remain).
export async function migrateEnabledToShowIn() {
    // Deliberately NOT routed through js/mzta-prefs.js (issue #163): one-shot migration
    // flag, not a preference — same reasoning as dynamic_menu_order_alphabet above, and
    // the same requirement to sit in the same area as PREFS_AREA in js/mzta-prefs.js.
    const flag = await browser.storage.local.get({ _migrated_enabled_to_showin: false });
    if (flag._migrated_enabled_to_showin) {
        return;
    }

    // Default prompt properties: object keyed by prompt id.
    const dpp = await browser.storage.local.get({ _default_prompts_properties: null });
    if (dpp._default_prompts_properties !== null) {
        const props = dpp._default_prompts_properties;
        Object.keys(props).forEach((id) => {
            normalizeEnabledToShowIn(props[id]);
        });
        await browser.storage.local.set({ _default_prompts_properties: props });
    }

    // Custom prompts: array of full prompt objects.
    const cp = await browser.storage.local.get({ _custom_prompt: null });
    if (cp._custom_prompt !== null) {
        cp._custom_prompt.forEach(normalizeEnabledToShowIn);
        await setCustomPrompts(cp._custom_prompt);
    }

    // Special prompts: array of full prompt objects. Only strips enabled; the
    // special "feature active" mechanism is untouched.
    const sp = await browser.storage.local.get({ _special_prompts: null });
    if (sp._special_prompts !== null) {
        sp._special_prompts.forEach(normalizeEnabledToShowIn);
        await setSpecialPrompts(sp._special_prompts);
    }

    await browser.storage.local.set({ _migrated_enabled_to_showin: true });
}

export async function getSpamFilterPrompt(){
    return (await getSpecialPrompts()).find(prompt => prompt.id == 'prompt_spamfilter');
}

export async function getAddTagsPrompt(){
    return (await getSpecialPrompts()).find(prompt => prompt.id == 'prompt_add_tags');
}

export async function getSummarizePrompt(){
    return (await getSpecialPrompts()).find(prompt => prompt.id == 'prompt_summarize');
}

export async function getTranslatePrompt(){
    return (await getSpecialPrompts()).find(prompt => prompt.id == 'prompt_translate_this');
}

export async function loadPrompt(id) {
    let allPrompts = await getPrompts(false,[],true);
    // console.log(">>>>>>>>>>>> loadPrompt id: " + id + " - allPrompts: " + JSON.stringify(allPrompts));
    return allPrompts.find(prompt => prompt.id === id);
}

export async function savePrompt(prompt) {
    // console.log(">>>>>>>>>>>>> savePrompt prompt: " + JSON.stringify(prompt));
    if (prompt.id === undefined) {
        throw new Error("Invalid prompt: " + JSON.stringify(prompt));
    }
    // Special Prompt
    if ((prompt.is_special === "1")||(prompt.is_special === 1)) {
        let specialPrompts = await getSpecialPrompts();
        let index = specialPrompts.findIndex(p => p.id === prompt.id);
        if (index === -1) {
            specialPrompts.push(prompt);
        } else {
            specialPrompts[index] = prompt;
        }
        await setSpecialPrompts(specialPrompts);
        return;
    }
    // Custom Prompt
    if ((prompt.is_default === "0")||(prompt.is_default === 0)) {
        let customPrompts = await getCustomPrompts();
        let index = customPrompts.findIndex(p => p.id === prompt.id);
        if (index === -1) {
            customPrompts.push(prompt);
        } else {
            customPrompts[index] = prompt;
        }
        // console.log(">>>>>>>>>>>> savePrompt customPrompts: " + JSON.stringify(customPrompts));
        await setCustomPrompts(customPrompts);
    } else {       // Default Prompt
        let defaultPrompts = await getDefaultPrompts_withProps();
        let index = defaultPrompts.findIndex(p => p.id === prompt.id);
        if (index === -1) {
            defaultPrompts.push(prompt);
        } else {
            defaultPrompts[index] = prompt;
        }
        await setDefaultPromptsProperties(defaultPrompts);
    }
}

export async function clearPromptAPI(id){
    let _prompt = await loadPrompt(id);
    // console.log(">>>>>>>>>>>>> clearPromptAPI _prompt BEFORE: " + JSON.stringify(_prompt));
    _prompt.api_type = "";
    // Reset all integration-specific settings to their default values
    for (const [integration, options] of Object.entries(integration_options_config)) {
        for (const key of Object.keys(options)) {
            const propName = `${integration}_${key}`;
            if (_prompt.hasOwnProperty(propName)) {
                _prompt[propName] = '';
            }
        }
    }
    // console.log(">>>>>>>>>>>>> clearPromptAPI _prompt AFTER: " + JSON.stringify(_prompt));
    await savePrompt(_prompt);
}
