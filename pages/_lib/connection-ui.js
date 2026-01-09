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

import {
  prefs_default,
  integration_options_config
} from '../../options/mzta-options-default.js';
import { OpenAI } from '../../js/api/openai_responses.js';
import { Ollama } from '../../js/api/ollama.js';
import { OpenAIComp } from '../../js/api/openai_comp.js'
import { GoogleGemini } from '../../js/api/google_gemini.js';
import { Anthropic } from '../../js/api/anthropic.js';
import {
  validateCustomData_ChatGPTWeb,
  sanitizeChatGPTModelData,
  sanitizeChatGPTWebCustomData
} from '../../js/mzta-utils.js';
import { openAICompConfigs } from '../../js/api/openai_comp_configs.js';
import { loadPrompt, savePrompt, clearPromptAPI } from '../../js/mzta-prompts.js';

export const varConnectionUI = {
  permission_all_urls: false
}

export async function injectConnectionUI({
    afterTrId = '',
    selectId = '',
    modelId_prefix = '',
    no_chatgpt_web = false,
    defaultType = '',
    tr_class = '',
    taLog = console,
    customButtonLabel = '',
    customButtonCallback = null
  } = {}) {

  const anchorTr = document.getElementById(afterTrId);
  if (!anchorTr) {
    console.error(`[ThuderAI | injectConnectionUI] Can't find tr#${afterTrId}`);
    return null;
  }

  // Inject CSS if not present
  if (!document.getElementById('mzta-connection-ui-style')) {
    const style = document.createElement('style');
    style.id = 'mzta-connection-ui-style';
    style.textContent = `
      .api_key-container { position: relative; display: flex; align-items: center; }
      .toggle-icon { cursor: pointer; margin-left: 5px; }
      .toggle-icon img { width: 16px; height: 16px; vertical-align: middle; }
      .option-input { flex-grow: 1; }
    `;
    document.head.appendChild(style);
  }

  let tpl = `
  <tr id="${selectId}_tr"${tr_class ? ` class="${tr_class}"` : ''}>
    <td>
      <label>
        <span class="opt_title">__MSG_prefs_Connection_type__</span>
      </label>
    </td>
    <td>
      <label style="display: flex; align-items: center;">
        <select id="${selectId}" name="${selectId}" class="option-input"></select>
        ${customButtonLabel ? `<button id="${modelId_prefix}customButton" style="margin-left: 10px;">${customButtonLabel}</button>` : ''}
      </label>
    </td>
  </tr>
  <tr class="conntype_chatgpt_web${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_apiwebchat_info__</span>
    </label></td>
    <td>
      <label>
        __MSG_prefs_OptionText_chatgpt_web_br_replace_info__
      </label>
    </td>
  </tr>
  <tr class="conntype_chatgpt_web${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_OptionText_chatgpt_web_model__</span>
      <br><table title="__MSG_prefs_OptionText_chatgpt_web_model_tooltip__"><tr id="chatgpt_web_models_list"></tr></table>
    </label></td>
    <td>
      <label>
        <input type="text" id="chatgpt_web_model" name="chatgpt_web_model" class="option-input" />
        <br>__MSG_prefs_OptionText_chatgpt_web_model_info__
      </label>
    </td>
  </tr>
  <tr class="conntype_chatgpt_web${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_OptionText_chatgpt_web_project__</span>
      <br><i class="small_info" id="chatgpt_web_project_info">__MSG_prefs_OptionText_chatgpt_web_custom_data_info__ <b class="lightbold">/g/PROJECT-ID-PROJECT-NAME/project</b>
        <br>__MSG_prefs_OptionText_chatgpt_web_custom_data_info2__</i>
    </label></td>
    <td>
      <label>
        <input type="text" id="chatgpt_web_project" name="chatgpt_web_project" class="option-input" />
        <br>__MSG_prefs_OptionText_chatgpt_web_project_info__
      </label>
    </td>
  </tr>
  <tr class="conntype_chatgpt_web${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_OptionText_chatgpt_web_custom_gpt__</span>
      <br><i class="small_info" id="chatgpt_web_custom_gpt_info">__MSG_prefs_OptionText_chatgpt_web_custom_data_info__ <b class="lightbold">/g/CUSTOM-GPT-ID</b>
        <br>__MSG_prefs_OptionText_chatgpt_web_custom_data_info2__</i>
    </label></td>
    <td>
      <label>
        <input type="text" id="chatgpt_web_custom_gpt" name="chatgpt_web_custom_gpt" class="option-input" />
        <br>__MSG_prefs_OptionText_chatgpt_web_custom_gpt_info__
        <br>__MSG_prefs_OptionText_CustomGPT_Warn__
      </label>
    </td>
  </tr>
  <tr class="conntype_chatgpt_web${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_OptionText_chatgpt_web_tempchat__</span>
    </label></td>
    <td>
      <label>
        <input type="checkbox" id="chatgpt_web_tempchat" name="chatgpt_web_tempchat" class="option-input" />
        &nbsp;<span>__MSG_prefs_OptionText_chatgpt_web_tempchat_info__
          <br>__MSG_prefs_OptionText_Project_No_temporary_chat_warn__
        </span>
      </label>
    </td>
  </tr>
  <tr class="conntype_chatgpt_web${tr_class ? ` ${tr_class}` : ''}">
    <td colspan="2" style="padding:0px 2em;text-align:center;"><span>__MSG_OpenChatGPTTab_Info__</span>
        <br><br><button id="btnChatGPTWeb_Tab">__MSG_OpenChatGPTTab__</button>
        <br><br>__MSG_OpenChatGPTTab_Info2__
    </td>
  </tr>
  <tr class="conntype_chatgpt_api${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_ChatGPT_API_Key__</span>
    </label></td>
    <td>
      <div class="api_key-container">
        <label>
          <input type="password" id="${modelId_prefix ? `${modelId_prefix}` : ''}chatgpt_api_key" name="${modelId_prefix ? `${modelId_prefix}` : ''}chatgpt_api_key" class="option-input"/>
        </label>
        <span class="toggle-icon" id="${modelId_prefix ? `${modelId_prefix}` : ''}toggle_chatgpt_api_key"><img src="/images/pwd-show.png" id="${modelId_prefix ? `${modelId_prefix}` : ''}pwd-icon_chatgpt_api_key"></span>
      </div>
    </td>
  </tr>
  <tr class="conntype_chatgpt_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_ChatGPT_Models__</span>
      </label>
    </td>
    <td>
      <button id="${modelId_prefix ? `${modelId_prefix}` : ''}btnUpdateChatGPTModels">__MSG_ChatGPT_Models_Fetch__</button> <span id="${modelId_prefix ? `${modelId_prefix}` : ''}chatgpt_model_fetch_loading" style="display:none">__MSG_Loading__</span><br>
      <label>
        <select id="${modelId_prefix ? `${modelId_prefix}` : ''}chatgpt_model" name="${modelId_prefix ? `${modelId_prefix}` : ''}chatgpt_model" class="option-input"></select>
      </label>
    </td>
  </tr>
  <tr class="conntype_chatgpt_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_prefs_api_temperature__</span>
      </label>
    </td>
    <td>
      <label>
        <input type="text" id="${modelId_prefix ? `${modelId_prefix}` : ''}chatgpt_temperature" name="${modelId_prefix ? `${modelId_prefix}` : ''}chatgpt_temperature" class="option-input check-number" />
        <br>__MSG_prefs_chatgpt_api_temperature_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_chatgpt_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_ChatGPT_chatgpt_api_store__</span>
      </label>
    </td>
    <td>
      <label>
        <input type="checkbox" id="${modelId_prefix ? `${modelId_prefix}` : ''}chatgpt_store" name="${modelId_prefix ? `${modelId_prefix}` : ''}chatgpt_store" class="option-input" />
        &nbsp;<span>__MSG_ChatGPT_chatgpt_api_store_info__</span>
      </label>
    </td>
  </tr>
  <tr class="conntype_chatgpt_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_ChatGPT_Developer_Messages__</span>
      </label>
    </td>
    <td>
      <label>
        <textarea id="${modelId_prefix ? `${modelId_prefix}` : ''}chatgpt_developer_messages" name="${modelId_prefix ? `${modelId_prefix}` : ''}chatgpt_developer_messages" class="option-input option-textarea"></textarea>
        <br>__MSG_ChatGPT_Developer_Messages_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_google_gemini_api${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_GoogleGemini_API_Key__</span>
    </label></td>
    <td>
      <div class="api_key-container">
        <label>
          <input type="password" id="${modelId_prefix ? `${modelId_prefix}` : ''}google_gemini_api_key" name="${modelId_prefix ? `${modelId_prefix}` : ''}google_gemini_api_key" class="option-input"/>
        </label>
        <span class="toggle-icon" id="${modelId_prefix ? `${modelId_prefix}` : ''}toggle_google_gemini_api_key"><img src="/images/pwd-show.png" id="${modelId_prefix ? `${modelId_prefix}` : ''}pwd-icon_google_gemini_api_key"></span>
      </div>
    </td>
  </tr>
  <tr class="conntype_google_gemini_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_GoogleGemini_Models__</span>
      </label>
    </td>
    <td>
      <button id="${modelId_prefix ? `${modelId_prefix}` : ''}btnUpdateGoogleGeminiModels">__MSG_GoogleGemini_Models_Fetch__</button> <span id="${modelId_prefix ? `${modelId_prefix}` : ''}google_gemini_model_fetch_loading" style="display:none">__MSG_Loading__</span><br>
      <label>
        <select id="${modelId_prefix ? `${modelId_prefix}` : ''}google_gemini_model" name="${modelId_prefix ? `${modelId_prefix}` : ''}google_gemini_model" class="option-input"></select>
      </label>
    </td>
  </tr>
  <tr class="conntype_google_gemini_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_prefs_api_temperature__</span>
      </label>
    </td>
    <td>
      <label>
        <input type="text" id="${modelId_prefix ? `${modelId_prefix}` : ''}google_gemini_temperature" name="${modelId_prefix ? `${modelId_prefix}` : ''}google_gemini_temperature" class="option-input check-number"/>
        <br>__MSG_prefs_google_gemini_temperature_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_google_gemini_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_prefs_google_gemini_thinking_budget__</span>
      </label>
    </td>
    <td>
      <label>
        <input type="text" id="${modelId_prefix ? `${modelId_prefix}` : ''}google_gemini_thinking_budget" name="${modelId_prefix ? `${modelId_prefix}` : ''}google_gemini_thinking_budget" class="option-input"/>
        <br>__MSG_prefs_google_gemini_thinking_budget_Info__
        <br><a href="https://ai.google.dev/gemini-api/docs/thinking#set-budget">__MSG_more_info_string__</a>
      </label>
    </td>
  </tr>
  <tr class="conntype_google_gemini_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_GoogleGemini_SystemInstruction__</span>
      </label>
    </td>
    <td>
      <label>
        <textarea id="${modelId_prefix ? `${modelId_prefix}` : ''}google_gemini_system_instruction" name="${modelId_prefix ? `${modelId_prefix}` : ''}google_gemini_system_instruction" class="option-input option-textarea"></textarea>
        <br>__MSG_GoogleGemini_SystemInstruction_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_ollama_api${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_API_Host__</span>
      <br><i class="small_info">__MSG_prefs_API_Host_Info__ http://127.0.0.1:11434</i>
    </label></td>
    <td>
      <label>
        <input type="text" id="${modelId_prefix ? `${modelId_prefix}` : ''}ollama_host" name="${modelId_prefix ? `${modelId_prefix}` : ''}ollama_host" class="option-input"/>
      </label>
    </td>
  </tr>
  <tr class="conntype_ollama_api${tr_class ? ` ${tr_class}` : ''}" id="${modelId_prefix ? `${modelId_prefix}` : ''}ollama_api_cors_warning">
    <td colspan="2" style="text-align:center;">
      __MSG_remember_CORS__ [<a href="https://micz.it/thunderbird-addon-thunderai/ollama-cors-information/">__MSG_more_info_string__</a>]
      <br><br><b>__MSG_CORS_alternative_1__</b>
      <br>__MSG_CORS_alternative_2__
        <br><br><button id="${modelId_prefix ? `${modelId_prefix}` : ''}btnGiveAllUrlsPermission_ollama_api">__MSG_CORS_give_allurls_perm__</button>
    </td>
  </tr>
  <tr class="conntype_ollama_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_Ollama_Models__</span>
      </label>
    </td>
    <td>
      <button id="${modelId_prefix ? `${modelId_prefix}` : ''}btnUpdateOllamaModels">__MSG_Ollama_Models_Fetch__</button> <span id="${modelId_prefix ? `${modelId_prefix}` : ''}ollama_model_fetch_loading" style="display:none">__MSG_Loading__</span><br>
      <label>
        <select id="${modelId_prefix ? `${modelId_prefix}` : ''}ollama_model" name="${modelId_prefix ? `${modelId_prefix}` : ''}ollama_model" class="option-input"></select>
      </label>
    </td>
  </tr>
   <tr class="conntype_ollama_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_prefs_api_temperature__</span>
      </label>
    </td>
    <td>
      <label>
        <input type="text" id="${modelId_prefix ? `${modelId_prefix}` : ''}ollama_temperature" name="${modelId_prefix ? `${modelId_prefix}` : ''}ollama_temperature" class="option-input check-number" />
        <br>__MSG_prefs_ollama_temperature_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_ollama_api${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_ollama_think__</span>
    </label></td>
    <td>
      <label>
        <input type="checkbox" id="${modelId_prefix ? `${modelId_prefix}` : ''}ollama_think" name="${modelId_prefix ? `${modelId_prefix}` : ''}ollama_think" class="option-input"/>
        __MSG_prefs_ollama_think_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_ollama_api${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_ollama_num_ctx__ <i>[num_ctx]</i></span>
    </label></td>
    <td>
      <label>
        <input type="number" id="${modelId_prefix ? `${modelId_prefix}` : ''}ollama_num_ctx" name="${modelId_prefix ? `${modelId_prefix}` : ''}ollama_num_ctx" class="option-input"/>
        <br>__MSG_prefs_ollama_num_ctx_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_OpenAIComp_AvailableServices__</span>
    </label></td>
    <td>
      <label>
        <select id="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_services_shortcut"></select>
        <br>__MSG_prefs_OpenAIComp_AvailableServices_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_API_Host__</span>
      <br><i class="small_info">__MSG_prefs_API_Host_Info__ http://localhost:1234</i>
    </label></td>
    <td>
      <label>
        <input type="text" id="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_host" name="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_host" class="option-input" />
        <br>__MSG_prefs_OptionText_openai_comp_info_remote__
      </label>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api${tr_class ? ` ${tr_class}` : ''}" id="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_api_cors_warning">
    <td colspan="2" style="text-align:center;">
      __MSG_maybe_CORS_openai_comp__ [<a href="https://micz.it/thunderbird-addon-thunderai/ollama-cors-information/">__MSG_more_info_string__</a>]
      <br><br><b>__MSG_CORS_alternative_1__</b>
      <br>__MSG_CORS_alternative_2__
        <br><br><button id="${modelId_prefix ? `${modelId_prefix}` : ''}btnGiveAllUrlsPermission_openai_comp_api">__MSG_CORS_give_allurls_perm__</button>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_OptionText_openai_comp_use_v1__</span>
    </label></td>
    <td>
      <label>
        <input type="checkbox" id="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_use_v1" name="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_use_v1" class="option-input" />
        &nbsp;<span>__MSG_prefs_OptionText_openai_comp_use_v1_info__</span>
      </label>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_OpenAIComp_API_Key__</span>
      <br><i class="small_info">__MSG_Optional__</i>
    </label></td>
    <td>
      <div class="api_key-container">
        <label>
          <input type="password" id="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_api_key" name="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_api_key" class="option-input"/>
        </label>
        <span class="toggle-icon" id="${modelId_prefix ? `${modelId_prefix}` : ''}toggle_openai_comp_api_key"><img src="/images/pwd-show.png" id="${modelId_prefix ? `${modelId_prefix}` : ''}pwd-icon_openai_comp_api_key"></span>
      </div>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_OpenAIComp_Models__</span>
        <br><button id="${modelId_prefix ? `${modelId_prefix}` : ''}btnOpenAICompForceModel" class="btn_small">__MSG_prefs_OpenAIComp_ForceModel__</button>
      <br><button id="${modelId_prefix ? `${modelId_prefix}` : ''}btnOpenAICompClearModelsList" class="btn_small">__MSG_prefs_OpenAIComp_ClearModelsList__</button></td>
      </label>
    </td>
    <td>
      <button id="${modelId_prefix ? `${modelId_prefix}` : ''}btnUpdateOpenAICompModels">__MSG_OpenAIComp_Models_Fetch__</button> <span id="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_model_fetch_loading" style="display:none">__MSG_Loading__</span><br>
      <label>
        <select id="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_model" name="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_model" class="option-input"></select>
      </label>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_OpenAIComp_ChatName__</span>
    </label></td>
    <td>
      <label>
        <input type="text" id="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_chat_name" name="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_chat_name" class="option-input" />
        <br>__MSG_prefs_OpenAIComp_ChatName_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_prefs_api_temperature__</span>
      </label>
    </td>
    <td>
      <label>
        <input type="text" id="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_temperature" name="${modelId_prefix ? `${modelId_prefix}` : ''}openai_comp_temperature" class="option-input check-number" />
        <br>__MSG_prefs_openai_comp_temperature_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_anthropic_api${tr_class ? ` ${tr_class}` : ''}">
    <td><label>
      <span class="opt_title">__MSG_prefs_Anthropic_API_Key__</span>
    </label></td>
    <td>
      <div class="api_key-container">
        <label>
          <input type="password" id="${modelId_prefix ? `${modelId_prefix}` : ''}anthropic_api_key" name="${modelId_prefix ? `${modelId_prefix}` : ''}anthropic_api_key" class="option-input"/>
        </label>
        <span class="toggle-icon" id="${modelId_prefix ? `${modelId_prefix}` : ''}toggle_anthropic_api_key"><img src="/images/pwd-show.png" id="${modelId_prefix ? `${modelId_prefix}` : ''}pwd-icon_anthropic_api_key"></span>
      </div>
    </td>
  </tr>
  <tr class="conntype_anthropic_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_Anthropic_Models__</span>
      </label>
    </td>
    <td>
      <button id="${modelId_prefix ? `${modelId_prefix}` : ''}btnUpdateAnthropicModels">__MSG_Anthropic_Models_Fetch__</button> <span id="${modelId_prefix ? `${modelId_prefix}` : ''}anthropic_model_fetch_loading" style="display:none">__MSG_Loading__</span><br>
      <label>
        <select id="${modelId_prefix ? `${modelId_prefix}` : ''}anthropic_model" name="${modelId_prefix ? `${modelId_prefix}` : ''}anthropic_model" class="option-input"></select>
      </label>
    </td>
  </tr>
  <tr class="conntype_anthropic_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_prefs_api_temperature__</span>
      </label>
    </td>
    <td>
      <label>
        <input type="text" id="${modelId_prefix ? `${modelId_prefix}` : ''}anthropic_temperature" name="${modelId_prefix ? `${modelId_prefix}` : ''}anthropic_temperature" class="option-input check-number" />
        <br>__MSG_prefs_anthropic_temperature_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_anthropic_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_Anthropic_System_Prompt__</span>
      </label>
    </td>
    <td>
      <label>
        <textarea id="${modelId_prefix ? `${modelId_prefix}` : ''}anthropic_system_prompt" name="${modelId_prefix ? `${modelId_prefix}` : ''}anthropic_system_prompt" class="option-input option-textarea"></textarea>
        <br>__MSG_Anthropic_System_Prompt_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_anthropic_api${tr_class ? ` ${tr_class}` : ''}">
    <td>
      <label>
        <span class="opt_title">__MSG_Anthropic_Version__</span>
      </label>
    </td>
    <td>
      <label>
        <input type="text" id="${modelId_prefix ? `${modelId_prefix}` : ''}anthropic_version" name="${modelId_prefix ? `${modelId_prefix}` : ''}anthropic_version" class="option-input" />
        <br>__MSG_Anthropic_Version_Info__ <a href="https://docs.anthropic.com/en/api/versioning">https://docs.anthropic.com/en/api/versioning</a>
      </label>
    </td>
  </tr>
  <tr class="conntype_anthropic_api${tr_class ? ` ${tr_class}` : ''}">
    <td><span class="opt_title">__MSG_prefs_OptionText_anthropic_max_tokens__</span></td>
    <td>
      <label>
        <input type="number" id="${modelId_prefix ? `${modelId_prefix}` : ''}anthropic_max_tokens" name="${modelId_prefix ? `${modelId_prefix}` : ''}anthropic_max_tokens" class="option-input" />
        <br>__MSG_prefs_OptionText_anthropic_max_tokens_Info__
      </label>
    </td>
  </tr>
  `;

  const template = document.createElement('template');
  template.innerHTML = tpl.trim();
  const frag = template.content;

  const parent = anchorTr.parentElement;
  const nodes = Array.from(frag.childNodes);
  let last = anchorTr;
  nodes.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      parent.insertBefore(node, last.nextSibling);
      last = node;
    }
  });

  const getPrefixedId = (id) => `${modelId_prefix ? `${modelId_prefix}` : ''}${id}`;

  // Bindings
  // const bindClick = (id, cb) => { const el = document.getElementById(id); if (el && typeof cb === 'function') el.addEventListener('click', cb); };
  // const bindChange = (id, cb) => { const el = document.getElementById(id); if (el && typeof cb === 'function') el.addEventListener('change', cb); };
  // const bindInput = (id, cb) => { const el = document.getElementById(id); if (el && typeof cb === 'function') el.addEventListener('input', cb); };

  populateConnectionTypeOptions(selectId, no_chatgpt_web);

  let conntype_select = document.getElementById(selectId);

  if (!conntype_select) {
    console.error('[ThuderAI | injectConnectionUI] Select not found after insertion.');
  }

  conntype_select.addEventListener("change", () => showConnectionOptions(conntype_select));
  conntype_select.addEventListener("change", (ev) => warn_ChatGPT_APIKeyEmpty(modelId_prefix));
  conntype_select.addEventListener("change", (ev) => warn_Ollama_HostEmpty(modelId_prefix));
  conntype_select.addEventListener("change", (ev) => warn_OpenAIComp_HostEmpty(modelId_prefix));
  conntype_select.addEventListener("change", (ev) => warn_GoogleGemini_APIKeyEmpty(modelId_prefix));
  conntype_select.addEventListener("change", (ev) => warn_Anthropic_APIKeyEmpty(modelId_prefix));
  conntype_select.addEventListener("change", (ev) => warn_Anthropic_VersionEmpty(modelId_prefix));
  document.getElementById("chatgpt_web_project").addEventListener("input", validateCustomData_ChatGPTWeb);
  document.getElementById("chatgpt_web_custom_gpt").addEventListener("input", validateCustomData_ChatGPTWeb);
  document.getElementById(getPrefixedId("chatgpt_api_key")).addEventListener("change", (ev) => warn_ChatGPT_APIKeyEmpty(modelId_prefix));
  document.getElementById(getPrefixedId("ollama_host")).addEventListener("change", (ev) => warn_Ollama_HostEmpty(modelId_prefix));
  document.getElementById(getPrefixedId("openai_comp_host")).addEventListener("change", (ev) => warn_OpenAIComp_HostEmpty(modelId_prefix));
  document.getElementById(getPrefixedId("google_gemini_api_key")).addEventListener("change", (ev) => warn_GoogleGemini_APIKeyEmpty(modelId_prefix));
  document.getElementById(getPrefixedId("anthropic_api_key")).addEventListener("change", (ev) => warn_Anthropic_APIKeyEmpty(modelId_prefix));
  document.getElementById(getPrefixedId("anthropic_version")).addEventListener("change", (ev) => warn_Anthropic_VersionEmpty(modelId_prefix));
  document.getElementById(getPrefixedId("openai_comp_host")).addEventListener("input", () => resetOpenAICompConfigs(modelId_prefix));
  document.getElementById(getPrefixedId("openai_comp_chat_name")).addEventListener("input", () => resetOpenAICompConfigs(modelId_prefix));
  document.getElementById(getPrefixedId("openai_comp_use_v1")).addEventListener("input", () => resetOpenAICompConfigs(modelId_prefix));

  showConnectionOptions(conntype_select);
  loadOpenAICompConfigs(modelId_prefix);
  warn_ChatGPT_APIKeyEmpty(modelId_prefix);
  warn_Ollama_HostEmpty(modelId_prefix);
  warn_OpenAIComp_HostEmpty(modelId_prefix);
  warn_GoogleGemini_APIKeyEmpty(modelId_prefix);
  warn_Anthropic_APIKeyEmpty(modelId_prefix);
  warn_Anthropic_VersionEmpty(modelId_prefix);

  const passwordField_chatgpt_api_key = document.getElementById(getPrefixedId('chatgpt_api_key'));
  const toggleIcon_chatgpt_api_key = document.getElementById(getPrefixedId('toggle_chatgpt_api_key'));
  const icon_img_chatgpt_api_key = document.getElementById(getPrefixedId('pwd-icon_chatgpt_api_key'));

  toggleIcon_chatgpt_api_key.addEventListener('click', () => {
      const type = passwordField_chatgpt_api_key.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordField_chatgpt_api_key.setAttribute('type', type);

      icon_img_chatgpt_api_key.src = type === 'password' ? "/images/pwd-show.png" : "/images/pwd-hide.png";
  });

  const passwordField_google_gemini_api_key = document.getElementById(getPrefixedId('google_gemini_api_key'));
  const toggleIcon_google_gemini_api_key = document.getElementById(getPrefixedId('toggle_google_gemini_api_key'));
  const icon_img_google_gemini_api_key = document.getElementById(getPrefixedId('pwd-icon_google_gemini_api_key'));

  toggleIcon_google_gemini_api_key.addEventListener('click', () => {
      const type = passwordField_google_gemini_api_key.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordField_google_gemini_api_key.setAttribute('type', type);

      icon_img_google_gemini_api_key.src = type === 'password' ? "/images/pwd-show.png" : "/images/pwd-hide.png";
  });

  const passwordField_openai_comp_api_key = document.getElementById(getPrefixedId('openai_comp_api_key'));
  const toggleIcon_openai_comp_api_key = document.getElementById(getPrefixedId('toggle_openai_comp_api_key'));
  const icon_img_openai_comp_api_key = document.getElementById(getPrefixedId('pwd-icon_openai_comp_api_key'));

  toggleIcon_openai_comp_api_key.addEventListener('click', () => {
      const type = passwordField_openai_comp_api_key.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordField_openai_comp_api_key.setAttribute('type', type);

      icon_img_openai_comp_api_key.src = type === 'password' ? "/images/pwd-show.png" : "/images/pwd-hide.png";
  });

  const passwordField_anthropic_api_key = document.getElementById(getPrefixedId('anthropic_api_key'));
  const toggleIcon_anthropic_api_key = document.getElementById(getPrefixedId('toggle_anthropic_api_key'));
  const icon_img_anthropic_api_key = document.getElementById(getPrefixedId('pwd-icon_anthropic_api_key'));

  toggleIcon_anthropic_api_key.addEventListener('click', () => {
      const type = passwordField_anthropic_api_key.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordField_anthropic_api_key.setAttribute('type', type);

      icon_img_anthropic_api_key.src = type === 'password' ? "/images/pwd-show.png" : "/images/pwd-hide.png";
  });

  const btnChatGPTWeb_Tab = document.getElementById('btnChatGPTWeb_Tab');
  btnChatGPTWeb_Tab.addEventListener('click', async () => {
    let prefs_mod = await browser.storage.sync.get({
      chatgpt_web_model: prefs_default.chatgpt_web_model,
      chatgpt_web_project: prefs_default.chatgpt_web_project,
      chatgpt_web_custom_gpt: prefs_default.chatgpt_web_custom_gpt
    });
    
    let base_url = 'https://chatgpt.com';
    let model_opt = '';
    let webproject_set = false;
    
    if((prefs_mod.chatgpt_web_model != '') && (prefs_mod.chatgpt_web_model != undefined)){
      model_opt = '?model=' + sanitizeChatGPTModelData(prefs_mod.chatgpt_web_model);
    }
    if((prefs_mod.chatgpt_web_project != '') && (prefs_mod.chatgpt_web_project != undefined)){
      base_url += sanitizeChatGPTWebCustomData(prefs_mod.chatgpt_web_project);
      webproject_set = true;
    }
    if(!webproject_set && (prefs_mod.chatgpt_web_custom_gpt != '') && (prefs_mod.chatgpt_web_custom_gpt != undefined)){
      base_url += sanitizeChatGPTWebCustomData(prefs_mod.chatgpt_web_custom_gpt);
    }
    browser.tabs.create({ url: base_url + model_opt });
  });

  let select_openai_comp_services_shortcut = document.getElementById(getPrefixedId('openai_comp_services_shortcut'));
  select_openai_comp_services_shortcut.addEventListener("change", () => {
    let selectedOption = select_openai_comp_services_shortcut.options[select_openai_comp_services_shortcut.selectedIndex];
    const config = openAICompConfigs.find(cfg => cfg.id === selectedOption.value);
    if (config) {
      if (!confirm(browser.i18n.getMessage('OpenAIComp_Configs_ConfirmApply', config.name))) {
        return;
      }
      document.getElementById(getPrefixedId('openai_comp_host')).value = config.host || '';
      // Clear all options from the select except the first (placeholder) one
      const openaiCompModelSelect = getModelEl('openai_comp_model', modelId_prefix);
      openaiCompModelSelect.value = '';
      while (openaiCompModelSelect.options.length > 0) {
        openaiCompModelSelect.remove(0);
      }
      document.getElementById(getPrefixedId('openai_comp_use_v1')).checked = !!config.use_v1;
      document.getElementById(getPrefixedId('openai_comp_chat_name')).value = config.chat_name || '';
      // Trigger change events if needed
      document.getElementById(getPrefixedId('openai_comp_host')).dispatchEvent(new Event('change', { bubbles: true }));
      getModelEl('openai_comp_model', modelId_prefix).dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById(getPrefixedId('openai_comp_use_v1')).dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById(getPrefixedId('openai_comp_chat_name')).dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  let prefs = await browser.storage.sync.get({chatgpt_web_model: '', chatgpt_model: '', ollama_model: '', openai_comp_model: '', google_gemini_model: '', anthropic_model: '', anthropic_version: '', chatgpt_win_height: 0, chatgpt_win_width: 0 });
  
  // OpenAI API ChatGPT model fetching
  let select_chatgpt_model = getModelEl('chatgpt_model', modelId_prefix);
  const chatgpt_option = document.createElement('option');
  chatgpt_option.value = prefs.chatgpt_model;
  chatgpt_option.text = prefs.chatgpt_model;
  select_chatgpt_model.appendChild(chatgpt_option);
  select_chatgpt_model.addEventListener("change", () => warn_ChatGPT_APIKeyEmpty(modelId_prefix));

  document.getElementById(getPrefixedId('btnUpdateChatGPTModels')).addEventListener('click', async () => {
    document.getElementById(getPrefixedId('chatgpt_model_fetch_loading')).style.display = 'inline';
    let openai = new OpenAI({
      apiKey: document.getElementById(getPrefixedId("chatgpt_api_key")).value,
    });
    let granted = await messenger.permissions.request({ origins: ["https://*.openai.com/*"] });
    if(!granted){
        document.getElementById(getPrefixedId('chatgpt_model_fetch_loading')).style.display = 'none';
        taLog.log("OpenAI API permission denied");
        alert(browser.i18n.getMessage("Optional_Permission_Denied_Model_Fetching"));
        return;
    }
    openai.fetchModels().then((data) => {
      if(!data.ok){
        let errorDetail;
        try {
          errorDetail = JSON.parse(data.error);
          errorDetail = errorDetail.error.message;
        } catch (e) {
          errorDetail = data.error;
        }
        document.getElementById(getPrefixedId('chatgpt_model_fetch_loading')).style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("ChatGPT_Models_Error_fetching"));
        alert(browser.i18n.getMessage("ChatGPT_Models_Error_fetching")+": " + errorDetail);
        return;
      }
      taLog.log("ChatGPT models: " + JSON.stringify(data));
      data.response.forEach(model => {
        if (!Array.from(select_chatgpt_model.options).some(option => option.value === model.id)) {
          const option = document.createElement('option');
          option.value = model.id;
          option.text = model.id;
          select_chatgpt_model.appendChild(option);
        }
      });
      document.getElementById(getPrefixedId('chatgpt_model_fetch_loading')).style.display = 'none';
    });
    
    warn_ChatGPT_APIKeyEmpty(modelId_prefix);
  });

  // Google Gemini API model fetching
  let select_google_gemini_model = getModelEl('google_gemini_model', modelId_prefix);
  const google_gemini_option = document.createElement('option');
  google_gemini_option.value = prefs.google_gemini_model;
  google_gemini_option.text = prefs.google_gemini_model;
  select_google_gemini_model.appendChild(google_gemini_option);
  select_google_gemini_model.addEventListener("change", () => warn_GoogleGemini_APIKeyEmpty(modelId_prefix));

  document.getElementById(getPrefixedId('btnUpdateGoogleGeminiModels')).addEventListener('click', async () => {
    document.getElementById(getPrefixedId('google_gemini_model_fetch_loading')).style.display = 'inline';
    let google_gemini = new GoogleGemini({
      apiKey: document.getElementById(getPrefixedId("google_gemini_api_key")).value,
    });
    google_gemini.fetchModels().then((data) => {
      if(!data.ok){
        let errorDetail;
        try {
          errorDetail = JSON.parse(data.error);
          errorDetail = errorDetail.error.message;
        } catch (e) {
          errorDetail = data.error;
        }
        document.getElementById(getPrefixedId('google_gemini_model_fetch_loading')).style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("GoogleGemini_Models_Error_fetching"));
        alert(browser.i18n.getMessage("GoogleGemini_Models_Error_fetching")+": " + errorDetail);
        return;
      }
      taLog.log("GoogleGemini models: " + JSON.stringify(data));
      data.response.forEach(model => {
        if (!Array.from(select_google_gemini_model.options).some(option => option.value === model.name.substring(model.name.lastIndexOf("/") + 1))) {
          const option = document.createElement('option');
          option.value = model.name.substring(model.name.lastIndexOf("/") + 1);
          option.text = model.displayName;
          select_google_gemini_model.appendChild(option);
        }
      });
      document.getElementById(getPrefixedId('google_gemini_model_fetch_loading')).style.display = 'none';
    });
    
    warn_GoogleGemini_APIKeyEmpty(modelId_prefix);
  });

  // Ollama API Model fetching
  let select_ollama_model = getModelEl('ollama_model', modelId_prefix);
  const ollama_option = document.createElement('option');
  ollama_option.value = prefs.ollama_model;
  ollama_option.text = prefs.ollama_model;
  select_ollama_model.appendChild(ollama_option);
  select_ollama_model.addEventListener("change", () => warn_Ollama_HostEmpty(modelId_prefix));

  document.getElementById(getPrefixedId('btnUpdateOllamaModels')).addEventListener('click', async () => {
    document.getElementById(getPrefixedId('ollama_model_fetch_loading')).style.display = 'inline';
    let ollama = new Ollama({
      host: document.getElementById(getPrefixedId("ollama_host")).value,
    });
    try {
      let data = await ollama.fetchModels();
      if(!data){
        document.getElementById(getPrefixedId('ollama_model_fetch_loading')).style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("Ollama_Models_Error_fetching"));
        alert(browser.i18n.getMessage("Ollama_Models_Error_fetching"));
        return;
      }
      if(!data.ok){
        let errorDetail;
        try {
          errorDetail = JSON.parse(data.error);
          errorDetail = errorDetail.error.message;
        } catch (e) {
          errorDetail = data.error;
        }
        document.getElementById(getPrefixedId('ollama_model_fetch_loading')).style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("Ollama_Models_Error_fetching"));
        alert(browser.i18n.getMessage("Ollama_Models_Error_fetching")+": " + errorDetail);
        return;
      }
      if(data.response.models.length == 0){
        document.getElementById(getPrefixedId('ollama_model_fetch_loading')).style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("Ollama_Models_Error_fetching"));
        alert(browser.i18n.getMessage("Ollama_Models_Error_fetching")+": " + browser.i18n.getMessage("API_Models_Error_NoModels"));
        return;
      }
      taLog.log("Ollama models: " + JSON.stringify(data));
      data.response.models.forEach(model => {
        if (!Array.from(select_ollama_model.options).some(option => option.value === model.model)) {
          const option = document.createElement('option');
          option.value = model.model;
          option.text = model.name + " (" + model.model + ")";
          select_ollama_model.appendChild(option);
        }
      });
      document.getElementById(getPrefixedId('ollama_model_fetch_loading')).style.display = 'none';
    } catch (error) {
      document.getElementById(getPrefixedId('ollama_model_fetch_loading')).style.display = 'none';
      taLog.error(browser.i18n.getMessage("Ollama_Models_Error_fetching"));
      alert(browser.i18n.getMessage("Ollama_Models_Error_fetching")+": " + error.message);
    }
    
    warn_Ollama_HostEmpty(modelId_prefix);
  });

  // OpenAI Comp API Model fetching
  let select_openai_comp_model = getModelEl('openai_comp_model', modelId_prefix);
  const openai_comp_option = document.createElement('option');
  openai_comp_option.value = prefs.openai_comp_model;
  openai_comp_option.text = prefs.openai_comp_model;
  select_openai_comp_model.appendChild(openai_comp_option);
  select_openai_comp_model.addEventListener("change", () => warn_OpenAIComp_HostEmpty(modelId_prefix));

  document.getElementById(getPrefixedId('btnUpdateOpenAICompModels')).addEventListener('click', async () => {
    document.getElementById(getPrefixedId('openai_comp_model_fetch_loading')).style.display = 'inline';
    let openai_comp = new OpenAIComp({
      host: document.getElementById(getPrefixedId("openai_comp_host")).value,
      apiKey: document.getElementById(getPrefixedId("openai_comp_api_key")).value,
      use_v1: document.getElementById(getPrefixedId("openai_comp_use_v1")).checked,
    });
    openai_comp.fetchModels().then((data) => {
      if(!data.ok){
        let errorDetail;
        try {
          errorDetail = JSON.parse(data.error);
          errorDetail = errorDetail.error.message;
        } catch (e) {
          errorDetail = data.error;
        }
        document.getElementById(getPrefixedId('openai_comp_model_fetch_loading')).style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("OpenAIComp_Models_Error_fetching"));
        alert(browser.i18n.getMessage("OpenAIComp_Models_Error_fetching")+": " + errorDetail);
        return;
      }
      taLog.log("OpenAIComp models: " + JSON.stringify(data));
      data.response.forEach(model => {
        if (!Array.from(select_openai_comp_model.options).some(option => option.value === model.id)) {
          const option = document.createElement('option');
          option.value = model.id;
          option.text = model.id;
          select_openai_comp_model.appendChild(option);
        }
      });
      document.getElementById(getPrefixedId('openai_comp_model_fetch_loading')).style.display = 'none';
    });
    
    warn_OpenAIComp_HostEmpty(modelId_prefix);
  });

   // Anthropic API model fetching
  let select_anthropic_model = getModelEl('anthropic_model', modelId_prefix);
  const anthropic_option = document.createElement('option');
  anthropic_option.value = prefs.anthropic_model;
  anthropic_option.text = prefs.anthropic_model;
  select_anthropic_model.appendChild(anthropic_option);
  select_anthropic_model.addEventListener("change", () => warn_Anthropic_APIKeyEmpty(modelId_prefix));
  select_anthropic_model.addEventListener("change", () => warn_Anthropic_VersionEmpty(modelId_prefix));

  document.getElementById(getPrefixedId('btnUpdateAnthropicModels')).addEventListener('click', async () => {
    document.getElementById(getPrefixedId('anthropic_model_fetch_loading')).style.display = 'inline';
    let anthropic = new Anthropic({
      apiKey: document.getElementById(getPrefixedId("anthropic_api_key")).value,
      version: document.getElementById(getPrefixedId("anthropic_version")).value,
    });
    let granted = await messenger.permissions.request({ origins: ["https://*.anthropic.com/*"] });
    if(!granted){
        document.getElementById(getPrefixedId('anthropic_model_fetch_loading')).style.display = 'none';
        taLog.warn("Claude API web permission denied");
        alert(browser.i18n.getMessage("Optional_Permission_Denied_Model_Fetching"));
        return;
    }
    anthropic.fetchModels().then((data) => {
      if(!data.ok){
        let errorDetail;
        try {
          errorDetail = JSON.parse(data.error);
          errorDetail = errorDetail.error.message;
        } catch (e) {
          errorDetail = data.error;
        }
        document.getElementById(getPrefixedId('anthropic_model_fetch_loading')).style.display = 'none';
        console.error("[ThunderAI] " + browser.i18n.getMessage("Anthropic_Models_Error_fetching"));
        alert(browser.i18n.getMessage("Anthropic_Models_Error_fetching")+": " + errorDetail);
        return;
      }
      taLog.log("Anthropic models: " + JSON.stringify(data));
      data.response.forEach(model => {
        const existingOption = Array.from(select_anthropic_model.options).find(option => option.value === model.id);
        if (existingOption) {
          existingOption.text = model.display_name + " (" + model.id + ")";
        } else {
          const option = document.createElement('option');
          option.value = model.id;
          option.text = model.display_name + " (" + model.id + ")";
          select_anthropic_model.appendChild(option);
        }
      });
      document.getElementById(getPrefixedId('anthropic_model_fetch_loading')).style.display = 'none';
    });
    
    warn_Anthropic_APIKeyEmpty(modelId_prefix);
  });

    document.getElementById(getPrefixedId('btnOpenAICompForceModel')).addEventListener('click', () => {
      let modelName = prompt(browser.i18n.getMessage('OpenAIComp_force_model_ask')).trim();
      if ((modelName !== null) && (modelName !== undefined) && (modelName !== '')) {
        let select_openai_comp_model = getModelEl('openai_comp_model', modelId_prefix);
        let option = document.createElement('option');
        option.value = modelName;
        option.text = modelName;
        select_openai_comp_model.appendChild(option);
        select_openai_comp_model.value = modelName;
        select_openai_comp_model.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  
    document.getElementById(getPrefixedId('btnOpenAICompClearModelsList')).addEventListener('click', () => {
      if (!confirm(browser.i18n.getMessage('OpenAIComp_ClearModelsList_Confirm'))) {
        return;
      }
      let select_openai_comp_model = getModelEl('openai_comp_model', modelId_prefix);
      while (select_openai_comp_model.options.length > 0) {
        select_openai_comp_model.remove(0);
      }
      select_openai_comp_model.value = '';
      select_openai_comp_model.dispatchEvent(new Event('change', { bubbles: true }));
    });
  
    document.getElementById(getPrefixedId('btnGiveAllUrlsPermission_ollama_api')).addEventListener('click', async () => {
      varConnectionUI.permission_all_urls = await messenger.permissions.request({ origins: ["<all_urls>"] });
    });
  
    document.getElementById(getPrefixedId('btnGiveAllUrlsPermission_openai_comp_api')).addEventListener('click', async () => {
      varConnectionUI.permission_all_urls = await messenger.permissions.request({ origins: ["<all_urls>"] });
    });

   document.querySelectorAll('.check-number').forEach(input => {
    input.addEventListener('input', warn_InvalidNumber);
   });
  
  warn_ChatGPT_APIKeyEmpty(modelId_prefix);
  warn_Ollama_HostEmpty(modelId_prefix);
  warn_OpenAIComp_HostEmpty(modelId_prefix);
  warn_GoogleGemini_APIKeyEmpty(modelId_prefix);
  warn_Anthropic_APIKeyEmpty(modelId_prefix);
  warn_Anthropic_VersionEmpty(modelId_prefix);

  if (customButtonLabel && customButtonCallback) {
    const btn = document.getElementById(`${modelId_prefix}customButton`);
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        customButtonCallback(e);
      });
    }
  }

  return {
    select: conntype_select,
    onTypeChange: (fn) => { onTypeChange = fn; fn(conntype_select.value, { select: conntype_select }); }
  };
}

export async function initializeSpecificIntegrationUI({
  prefix,
  promptId,
  taLog,
  restoreOptionsCallback
}) {
  const conntype_select_id = `${prefix}_connection_type`;
  const model_prefix = `${prefix}_`;
  const use_specific_integration_id = `${prefix}_use_specific_integration`;

  // 1. Inject UI
  try {
      await injectConnectionUI({
          afterTrId: 'connection_ui_anchor',
          tr_class: 'specific_integration_sub',
          selectId: conntype_select_id,
          modelId_prefix: model_prefix,
          no_chatgpt_web: true,
          taLog: taLog
      });
  } catch (e) {
      console.error(`Failed to inject connection UI (${prefix})`, e);
  }

  // 2. Restore Options
  if (restoreOptionsCallback) {
      await restoreOptionsCallback();
  }

  // 3. Setup Logic
  const use_specific_integration_el = document.getElementById(use_specific_integration_id);
  const conntype_el = document.getElementById(conntype_select_id);
  const conntype_row = document.getElementById(conntype_select_id + '_tr');
  const conntype_end_el = document.getElementById('connection_ui_end');

  // Helper to update prompt
  const _updatePrompt = async () => {
      let conntype = conntype_el.value;
      
      let prompt = await loadPrompt(promptId);
      if(!prompt) return;

      prompt.api_type = conntype;

      for (const [integration, options] of Object.entries(integration_options_config)) {
          for (const key of Object.keys(options)) {
              let propName = `${integration}_${key}`;
              let elementId = `${model_prefix}${propName}`;
              let element = document.getElementById(elementId);
              if (element) {
                  prompt[propName] = (element.type === 'checkbox') ? element.checked : element.value;
              }
          }
      }
      
      await savePrompt(prompt);
  };

  // Helper for visibility
  const _updateVisibility = (checked) => {
      document.querySelectorAll(".specific_integration_sub").forEach(tr => {
          tr.style.display = checked && tr.classList.contains('conntype_' + conntype_el.value) ? 'table-row' : 'none';
      });
      if (conntype_row) conntype_row.style.display = checked ? 'table-row' : 'none';
      if (conntype_end_el) conntype_end_el.style.display = checked ? 'table-row' : 'none';
      if (conntype_row) changeConnTypeRowColor(conntype_row, conntype_el);
  };

  // Check global connection type
  let globalPrefs = await browser.storage.sync.get({ connection_type: 'chatgpt_web' });
  if (globalPrefs.connection_type === 'chatgpt_web') {
      use_specific_integration_el.checked = true;
      use_specific_integration_el.disabled = true;
  }

  // Event Listener for Checkbox
  use_specific_integration_el.addEventListener('change', async (event) => {
      _updateVisibility(event.target.checked);
      if (!event.target.checked) {
          await clearPromptAPI(promptId);
      } else {
          await _updatePrompt();
      }
  });

  // Event Listeners for Inputs
  conntype_el.addEventListener('change', async () => {
      _updateVisibility(use_specific_integration_el.checked);
      if (use_specific_integration_el.checked) await _updatePrompt();
  });

  document.querySelectorAll(".specific_integration_sub .option-input").forEach(element => {
      element.addEventListener("change", async () => {
          if (use_specific_integration_el.checked) await _updatePrompt();
      });
  });

  // Initial State Apply
  _updateVisibility(use_specific_integration_el.checked);
  if (use_specific_integration_el.checked) {
      await _updatePrompt();
  }
  
  updateWarnings(model_prefix);
}

// From here there are exported functions

export function updateWarnings(modelId_prefix = '') {
  warn_ChatGPT_APIKeyEmpty(modelId_prefix);
  warn_Ollama_HostEmpty(modelId_prefix);
  warn_OpenAIComp_HostEmpty(modelId_prefix);
  warn_GoogleGemini_APIKeyEmpty(modelId_prefix);
  warn_Anthropic_APIKeyEmpty(modelId_prefix);
  warn_Anthropic_VersionEmpty(modelId_prefix);
}

export function changeConnTypeRowColor(conntype_row, conntype_select) {
  conntype_row.classList.toggle("conntype_chatgpt_web", (conntype_select.value === "chatgpt_web"));
  conntype_row.classList.toggle("conntype_chatgpt_api", (conntype_select.value === "chatgpt_api"));
  conntype_row.classList.toggle("conntype_ollama_api", (conntype_select.value === "ollama_api"));
  conntype_row.classList.toggle("conntype_openai_comp_api", (conntype_select.value === "openai_comp_api"));
  conntype_row.classList.toggle("conntype_google_gemini_api", (conntype_select.value === "google_gemini_api"));
  conntype_row.classList.toggle("conntype_anthropic_api", (conntype_select.value === "anthropic_api"));  
}

export function showConnectionOptions(conntype_select, modelId_prefix = '') {
  let chatgpt_web_display = 'table-row';
  let chatgpt_api_display = 'none';
  let ollama_api_display = 'none';
  let openai_comp_api_display = 'none';
  let google_gemini_api_display = 'none';
  let anthropic_api_display = 'none';
  let parent = conntype_select.parentElement.parentElement.parentElement;
  changeConnTypeRowColor(parent, conntype_select);
  if (conntype_select.value === "chatgpt_web") {
    chatgpt_web_display = 'table-row';
  }else{
    chatgpt_web_display = 'none';
  }
  if (conntype_select.value === "chatgpt_api") {
    chatgpt_api_display = 'table-row';
  }else{
    chatgpt_api_display = 'none';
  }
  if (conntype_select.value === "ollama_api") {
    ollama_api_display = 'table-row';
  }else{
    ollama_api_display = 'none';
  }
  if (conntype_select.value === "openai_comp_api") {
    openai_comp_api_display = 'table-row';
  }else{
    openai_comp_api_display = 'none';
  }
  if (conntype_select.value === "google_gemini_api") {
    google_gemini_api_display = 'table-row';
  }else{
    google_gemini_api_display = 'none';
  }
  if (conntype_select.value === "anthropic_api") {
    anthropic_api_display = 'table-row';
  }else{
    anthropic_api_display = 'none';
  }
  parent.parentElement.querySelectorAll(".conntype_chatgpt_web").forEach(element => {
    element.style.display = chatgpt_web_display;
  });
  parent.parentElement.querySelectorAll(".conntype_chatgpt_api").forEach(element => {
    element.style.display = chatgpt_api_display;
  });
  parent.parentElement.querySelectorAll(".conntype_ollama_api").forEach(element => {
    element.style.display = ollama_api_display;
  });
  parent.parentElement.querySelectorAll(".conntype_openai_comp_api").forEach(element => {
    element.style.display = openai_comp_api_display;
  });
  parent.parentElement.querySelectorAll(".conntype_google_gemini_api").forEach(element => {
    element.style.display = google_gemini_api_display;
  });
  parent.parentElement.querySelectorAll(".conntype_anthropic_api").forEach(element => {
    element.style.display = anthropic_api_display;
  });
  if (varConnectionUI.permission_all_urls) {
    const openaiCompWarning = document.getElementById((modelId_prefix ? modelId_prefix : '') + 'openai_comp_api_cors_warning');
    if (openaiCompWarning) openaiCompWarning.style.display = 'none';
    const ollamaWarning = document.getElementById((modelId_prefix ? modelId_prefix : '') + 'ollama_api_cors_warning');
    if (ollamaWarning) ollamaWarning.style.display = 'none';
  }
}


// From here there are internal functions

function getModelEl(model, modelId_prefix) {
  return document.getElementById((modelId_prefix ? modelId_prefix : '') + model);
}

function populateConnectionTypeOptions(selectId, no_chatgpt_web = false) {
  const conntype_select = document.getElementById(selectId);
  if (!conntype_select) return;

  const prevValue = conntype_select.value;

  const options = [
    { value: 'chatgpt_web',        msgKey: 'prefs_Connection_type_ChatGPT_Web' },
    { value: 'chatgpt_api',        msgKey: 'prefs_Connection_type_ChatGPT_API' },
    { value: 'google_gemini_api',  msgKey: 'prefs_Connection_type_Google_Gemini_API' },
    { value: 'anthropic_api',      msgKey: 'prefs_Connection_type_Anthropic_API' },
    { value: 'ollama_api',         msgKey: 'prefs_Connection_type_Ollama_API' },
    { value: 'openai_comp_api',    msgKey: 'prefs_Connection_type_OpenAI_Comp_API' }
  ];

  conntype_select.innerHTML = '';

  for (const opt of options.filter(o => !(no_chatgpt_web && o.value === 'chatgpt_web'))) {
    const optionEl = document.createElement('option');
    optionEl.value = opt.value;
    optionEl.textContent = browser.i18n.getMessage(opt.msgKey) || opt.msgKey;
    conntype_select.appendChild(optionEl);
  }

  if (options.some(o => o.value === prevValue)) {
    conntype_select.value = prevValue;
  }
}

function warn_InvalidNumber(event){
  const elementValue = event.target.value;
  // console.log(">>>>>>>>>>> warn_InvalidNumber: " + event.target.id + ": " + elementValue)
  if (elementValue != '' && isNaN(parseFloat(elementValue))) {
    // Handle invalid number case, e.g., set border to red
    event.target.style.border = '2px solid red';
  } else {
    event.target.style.border = '';
  }
}

function warn_ChatGPT_APIKeyEmpty(modelId_prefix) {
  const getPrefixedId = (id) => `${modelId_prefix ? `${modelId_prefix}` : ''}${id}`;
  let apiKeyInput = document.getElementById(getPrefixedId('chatgpt_api_key'));
  let btnFetchChatGPTModels = document.getElementById(getPrefixedId('btnUpdateChatGPTModels'));
  let modelChatGPT = getModelEl('chatgpt_model', modelId_prefix);
  if(apiKeyInput.value === ''){
    apiKeyInput.style.border = '2px solid red';
    btnFetchChatGPTModels.disabled = true;
    modelChatGPT.disabled = true;
    modelChatGPT.selectedIndex = -1;
    modelChatGPT.style.border = '';
  }else{
    apiKeyInput.style.border = '';
    btnFetchChatGPTModels.disabled = false;
    modelChatGPT.disabled = false;
    if((modelChatGPT.selectedIndex === -1)||(modelChatGPT.value === '')){
      modelChatGPT.style.border = '2px solid red';
    }else{
      modelChatGPT.style.border = '';
    }
  }
}

function warn_GoogleGemini_APIKeyEmpty(modelId_prefix) {
  const getPrefixedId = (id) => `${modelId_prefix ? `${modelId_prefix}` : ''}${id}`;
  let apiKeyInput = document.getElementById(getPrefixedId('google_gemini_api_key'));
  let btnFetchGoogleGeminiModels = document.getElementById(getPrefixedId('btnUpdateGoogleGeminiModels'));
  let modelGoogleGemini = getModelEl('google_gemini_model', modelId_prefix);
  if(apiKeyInput.value === ''){
    apiKeyInput.style.border = '2px solid red';
    btnFetchGoogleGeminiModels.disabled = true;
    modelGoogleGemini.disabled = true;
    modelGoogleGemini.selectedIndex = -1;
    modelGoogleGemini.style.border = '';
  }else{
    apiKeyInput.style.border = '';
    btnFetchGoogleGeminiModels.disabled = false;
    modelGoogleGemini.disabled = false;
    if((modelGoogleGemini.selectedIndex === -1)||(modelGoogleGemini.value === '')){
      modelGoogleGemini.style.border = '2px solid red';
    }else{
      modelGoogleGemini.style.border = '';
    }
  }
}

function warn_Ollama_HostEmpty(modelId_prefix) {
  const getPrefixedId = (id) => `${modelId_prefix ? `${modelId_prefix}` : ''}${id}`;
  let hostInput = document.getElementById(getPrefixedId('ollama_host'));
  let btnFetchOllamaModels = document.getElementById(getPrefixedId('btnUpdateOllamaModels'));
  let modelOllama = getModelEl('ollama_model', modelId_prefix);
  if(hostInput.value === ''){
    hostInput.style.border = '2px solid red';
    btnFetchOllamaModels.disabled = true;
    modelOllama.disabled = true;
    modelOllama.selectedIndex = -1;
    modelOllama.style.border = '';
  }else{
    hostInput.style.border = '';
    btnFetchOllamaModels.disabled = false;
    modelOllama.disabled = false;
    if((modelOllama.selectedIndex === -1)||(modelOllama.value === '')){
      modelOllama.style.border = '2px solid red';
    }else{
      modelOllama.style.border = '';
    }
  }
}

function warn_OpenAIComp_HostEmpty(modelId_prefix) {
  const getPrefixedId = (id) => `${modelId_prefix ? `${modelId_prefix}` : ''}${id}`;
  let hostInput = document.getElementById(getPrefixedId('openai_comp_host'));
  let btnUpdateOpenAICompModels = document.getElementById(getPrefixedId('btnUpdateOpenAICompModels'));
  let modelOpenAIComp = getModelEl('openai_comp_model', modelId_prefix);
  if(hostInput.value === ''){
    hostInput.style.border = '2px solid red';
    btnUpdateOpenAICompModels.disabled = true;
    modelOpenAIComp.disabled = true;
    modelOpenAIComp.selectedIndex = -1;
    modelOpenAIComp.style.border = '';
  }else{
    hostInput.style.border = '';
    btnUpdateOpenAICompModels.disabled = false;
    modelOpenAIComp.disabled = false;
    if((modelOpenAIComp.selectedIndex === -1)||(modelOpenAIComp.value === '')){
      modelOpenAIComp.style.border = '2px solid red';
    }else{
      modelOpenAIComp.style.border = '';
    }
  }
}

function warn_Anthropic_APIKeyEmpty(modelId_prefix) {
  const getPrefixedId = (id) => `${modelId_prefix ? `${modelId_prefix}` : ''}${id}`;
  let apiKeyInput = document.getElementById(getPrefixedId('anthropic_api_key'));
  let btnFetchAnthropicModels = document.getElementById(getPrefixedId('btnUpdateAnthropicModels'));
  let modelAnthropic = getModelEl('anthropic_model', modelId_prefix);
  if(apiKeyInput.value === ''){
    apiKeyInput.style.border = '2px solid red';
    btnFetchAnthropicModels.disabled = true;
    modelAnthropic.disabled = true;
    modelAnthropic.selectedIndex = -1;
    modelAnthropic.style.border = '';
  }else{
    apiKeyInput.style.border = '';
    btnFetchAnthropicModels.disabled = false;
    modelAnthropic.disabled = false;
    if((modelAnthropic.selectedIndex === -1)||(modelAnthropic.value === '')){
      modelAnthropic.style.border = '2px solid red';
    }else{
      modelAnthropic.style.border = '';
    }
  }
}

function warn_Anthropic_VersionEmpty(modelId_prefix) {
  const getPrefixedId = (id) => `${modelId_prefix ? `${modelId_prefix}` : ''}${id}`;
  let versionInput = document.getElementById(getPrefixedId('anthropic_version'));
  let btnFetchAnthropicModels = document.getElementById(getPrefixedId('btnUpdateAnthropicModels'));
  let modelAnthropic = getModelEl('anthropic_model', modelId_prefix);
  if(versionInput.value === ''){
    versionInput.style.border = '2px solid red';
    btnFetchAnthropicModels.disabled = true;
    modelAnthropic.disabled = true;
    modelAnthropic.selectedIndex = -1;
    modelAnthropic.style.border = '';
  }else{
    versionInput.style.border = '';
    btnFetchAnthropicModels.disabled = false;
    modelAnthropic.disabled = false;
    if((modelAnthropic.selectedIndex === -1)||(modelAnthropic.value === '')){
      modelAnthropic.style.border = '2px solid red';
    }else{
      modelAnthropic.style.border = '';
    }
  }
}

function resetOpenAICompConfigs(modelId_prefix = ''){
  let select_openai_comp_model = document.getElementById((modelId_prefix ? modelId_prefix : '') + 'openai_comp_services_shortcut');
  select_openai_comp_model.value = 'custom';
}

function loadOpenAICompConfigs(modelId_prefix = ''){
  let select_openai_comp_model = document.getElementById((modelId_prefix ? modelId_prefix : '') + 'openai_comp_services_shortcut');
  openAICompConfigs.forEach(config => {
    const option = document.createElement('option');
    option.value = config.id;
    option.text = config.name;
    select_openai_comp_model.appendChild(option);
  });
}
