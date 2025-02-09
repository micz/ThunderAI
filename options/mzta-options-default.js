/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2025  Mic (m@micz.it)

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

export const prefs_default = {
    do_debug: false,
    chatgpt_win_height: 800,
    chatgpt_win_width: 700,
    default_chatgpt_lang: '',
    default_sign_name: '',
    connection_type: 'chatgpt_web',     //Other values: 'chatgpt_api', 'ollama_api', 'openai_comp_api', 'google_gemini_api'
    chatgpt_web_model: '',
    chatgpt_web_tempchat: false,
    chatgpt_api_key: '',
    chatgpt_model: '',
    chatgpt_developer_messages: '',
    ollama_host: '',
    ollama_model: '',
    openai_comp_host: '',   // For OpenAI Compatible API as LM-Studio
    openai_comp_model: '',
    openai_comp_api_key: '',
    openai_comp_use_v1: true,
    openai_comp_chat_name: 'OpenAI Comp',
    google_gemini_api_key: '',
    google_gemini_model: '',
    google_gemini_system_instruction: '',
    dynamic_menu_force_enter: false,
    dynamic_menu_order_alphabet: true,
    placeholders_use_default_value: false,
    max_prompt_length: 30000,   // max string length for prompt
    add_tags: true,
    add_tags_maxnum: 3,
    add_tags_hide_exclusions: false,
    add_tags_first_uppercase: true,
    add_tags_force_lang: true,
    add_tags_auto: false,
    add_tags_auto_force_existing: false,
    add_tags_auto_only_inbox: true,
    get_calendar_event: true,
}