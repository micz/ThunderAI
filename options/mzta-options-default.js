/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024  Mic (m@micz.it)

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
    connection_type: 'chatgpt_web',     //Other values: 'chatgpt_api', 'ollama_api', 'openai_comp_api'
    chatgpt_web_model: '',
    chatgpt_web_tempchat: false,
    chatgpt_api_key: '',
    chatgpt_model: '',
    ollama_host: '',
    ollama_model: '',
    openai_comp_host: '',   // For OpenAI Compatible API as LM-Studio
    openai_comp_model: '',
    openai_comp_api_key: '',
    openai_comp_use_v1: true,
    openai_comp_chat_name: 'OpenAI Comp',
    dynamic_menu_force_enter: false,
    dynamic_menu_order_alphabet: true,
    placeholders_use_default_value: false,
    max_prompt_length: 30000,   // max string length for prompt
    add_tags: false,
}