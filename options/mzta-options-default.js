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

const special_prompts_with_integration = ['add_tags', 'spamfilter'];

export const integration_options_config = {
    chatgpt: {
        api_key: '',
        model: '',
        developer_messages: '',
        temperature: '',
        store: false
    },
    ollama: {
        host: '',
        model: '',
        num_ctx: 0,
        temperature: '',
        think: false
    },
    openai_comp: {
        host: '',
        model: '',
        api_key: '',
        use_v1: true,
        chat_name: 'OpenAI Comp',
        temperature: ''
    },
    google_gemini: {
        api_key: '',
        model: '',
        system_instruction: '',
        thinking_budget: '',
        temperature: ''
    },
    anthropic: {
        api_key: '',
        model: '',
        version: '2023-06-01',
        max_tokens: 4096,
        system_prompt: '',
        temperature: ''
    }
};

const integration_settings_template = {
    use_specific_integration: false,
    connection_type: 'chatgpt_api',
};

const global_integration_settings = { ...integration_settings_template };

for (const [integration, options] of Object.entries(integration_options_config)) {
    for (const [key, value] of Object.entries(options)) {
        global_integration_settings[`${integration}_${key}`] = value;
    }
}

let generated_prefs = {};

special_prompts_with_integration.forEach(prompt_prefix => {
    for (const [key, value] of Object.entries(integration_settings_template)) {
        generated_prefs[`${prompt_prefix}_${key}`] = value;
    }
});

export function getDynamicSettingsDefaults(keysFilter = []) {
    let defaults = {};
    special_prompts_with_integration.forEach(prefix => {
        const keys = keysFilter.length > 0 ? keysFilter : Object.keys(integration_settings_template);
        keys.forEach(key => {
             defaults[`${prefix}_${key}`] = prefs_default[`${prefix}_${key}`];
        });
    });
    return defaults;
}

export function getDynamicSettingValue(prefs, prefix, settingName) {
    return prefs[`${prefix}_${settingName}`];
}

export const prefs_default = {
    ...global_integration_settings,
    do_debug: false,
    chatgpt_win_height: 800,
    chatgpt_win_width: 700,
    default_chatgpt_lang: '',
    default_sign_name: '',
    reply_type: 'reply_all',
    composing_plain_text: false,
    connection_type: 'chatgpt_web',     //Other values: 'chatgpt_api', 'ollama_api', 'openai_comp_api', 'google_gemini_api'
    chatgpt_web_model: '',
    chatgpt_web_tempchat: false,
    chatgpt_web_project: '',
    chatgpt_web_custom_gpt: '',
    dynamic_menu_force_enter: false,
    dynamic_menu_order_alphabet: true,
    placeholders_use_default_value: false,
    max_prompt_length: 30000,   // max string length for prompt
    add_tags: false,
    add_tags_maxnum: 3,
    add_tags_hide_exclusions: false,
    add_tags_exclusions_exact_match: false,
    add_tags_first_uppercase: true,
    add_tags_force_lang: true,
    add_tags_auto: false,
    add_tags_auto_force_existing: false,
    add_tags_auto_only_inbox: true,
    add_tags_auto_uselist: false,
    add_tags_auto_uselist_list: '',
    add_tags_context_menu: true,
    add_tags_enabled_accounts: [],
    get_calendar_event: true,
    get_task: true,
    calendar_enforce_timezone: false,
    calendar_timezone: '',
    spamfilter: false,
    spamfilter_threshold: 70,
    spamfilter_context_menu: true,
    spamfilter_enabled_accounts: [],
    ...generated_prefs
}
