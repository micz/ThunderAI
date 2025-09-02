// connection-ui.js
// Public API:
//   injectConnectionUI({ afterTrId, groupId?, selectId?, defaultType?, idSuffix?, onTypeChange? })
//
// All variable names and comments are in English.
// It generates the connection type UI rows and handles basic show/hide behavior.

export const varConnectionUI = {
  permission_all_urls: false
}

export function injectConnectionUI({
    afterTrId = '',
    selectId = '',
    no_chatgpt_web = false,
    defaultType = '',
    tr_class = '',
  } = {}) {

  const anchorTr = document.getElementById(afterTrId);
  if (!anchorTr) {
    console.error(`[ThuderAI | injectConnectionUI] Can't find tr#${afterTrId}`);
    return null;
  }

  let tpl = `
  <tr ${tr_class}>
    <td>
      <label>
        <span class="opt_title">__MSG_prefs_Connection_type__</span>
      </label>
    </td>
    <td>
      <label>
        <select id="${selectId}" name="${selectId}" class="option-input"></select>
      </label>
    </td>
  </tr>
  <tr class="conntype_chatgpt_web">
    <td><label>
      <span class="opt_title">__MSG_apiwebchat_info__</span>
    </label></td>
    <td>
      <label>
        __MSG_prefs_OptionText_chatgpt_web_br_replace_info__
      </label>
    </td>
  </tr>
  <tr class="conntype_chatgpt_web">
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
  <tr class="conntype_chatgpt_web">
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
  <tr class="conntype_chatgpt_web">
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
  <tr class="conntype_chatgpt_web">
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
  <tr class="conntype_chatgpt_web">
    <td colspan="2" style="padding:0px 2em;text-align:center;"><span>__MSG_OpenChatGPTTab_Info__</span>
        <br><br><button id="btnChatGPTWeb_Tab">__MSG_OpenChatGPTTab__</button>
        <br><br>__MSG_OpenChatGPTTab_Info2__
    </td>
  </tr>
  <tr class="conntype_chatgpt_api">
    <td><label>
      <span class="opt_title">__MSG_prefs_ChatGPT_API_Key__</span>
    </label></td>
    <td>
      <div class="api_key-container">
        <label>
          <input type="password" id="chatgpt_api_key" name="chatgpt_api_key" class="option-input"/>
        </label>
        <span class="toggle-icon" id="toggle_chatgpt_api_key"><img src="/images/pwd-show.png" id="pwd-icon_chatgpt_api_key"></span>
      </div>
    </td>
  </tr>
  <tr class="conntype_chatgpt_api">
    <td>
      <label>
        <span class="opt_title">__MSG_ChatGPT_Models__</span>
      </label>
    </td>
    <td>
      <button id="btnUpdateChatGPTModels">__MSG_ChatGPT_Models_Fetch__</button> <span id="chatgpt_model_fetch_loading">__MSG_Loading__</span><br>
      <label>
        <select id="chatgpt_model" name="chatgpt_model" class="option-input"></select>
      </label>
    </td>
  </tr>
  <tr class="conntype_chatgpt_api">
    <td>
      <label>
        <span class="opt_title">__MSG_ChatGPT_chatgpt_api_store__</span>
      </label>
    </td>
    <td>
      <label>
        <input type="checkbox" id="chatgpt_api_store" name="chatgpt_api_store" class="option-input" />
        &nbsp;<span>__MSG_ChatGPT_chatgpt_api_store_info__</span>
      </label>
    </td>
  </tr>
  <tr class="conntype_chatgpt_api">
    <td>
      <label>
        <span class="opt_title">__MSG_ChatGPT_Developer_Messages__</span>
      </label>
    </td>
    <td>
      <label>
        <textarea id="chatgpt_developer_messages" name="chatgpt_developer_messages" class="option-input option-textarea"></textarea>
        <br>__MSG_ChatGPT_Developer_Messages_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_google_gemini_api">
    <td><label>
      <span class="opt_title">__MSG_prefs_GoogleGemini_API_Key__</span>
    </label></td>
    <td>
      <div class="api_key-container">
        <label>
          <input type="password" id="google_gemini_api_key" name="google_gemini_api_key" class="option-input"/>
        </label>
        <span class="toggle-icon" id="toggle_google_gemini_api_key"><img src="/images/pwd-show.png" id="pwd-icon_google_gemini_api_key"></span>
      </div>
    </td>
  </tr>
  <tr class="conntype_google_gemini_api">
    <td>
      <label>
        <span class="opt_title">__MSG_GoogleGemini_Models__</span>
      </label>
    </td>
    <td>
      <button id="btnUpdateGoogleGeminiModels">__MSG_GoogleGemini_Models_Fetch__</button> <span id="google_gemini_model_fetch_loading">__MSG_Loading__</span><br>
      <label>
        <select id="google_gemini_model" name="google_gemini_model" class="option-input"></select>
      </label>
    </td>
  </tr>
  <tr class="conntype_google_gemini_api">
    <td>
      <label>
        <span class="opt_title">__MSG_GoogleGemini_SystemInstruction__</span>
      </label>
    </td>
    <td>
      <label>
        <textarea id="google_gemini_system_instruction" name="google_gemini_system_instruction" class="option-input option-textarea"></textarea>
        <br>__MSG_GoogleGemini_SystemInstruction_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_ollama_api">
    <td><label>
      <span class="opt_title">__MSG_prefs_API_Host__</span>
      <br><i class="small_info">__MSG_prefs_API_Host_Info__ http://127.0.0.1:11434</i>
    </label></td>
    <td>
      <label>
        <input type="text" id="ollama_host" name="ollama_host" class="option-input"/>
      </label>
    </td>
  </tr>
  <tr class="conntype_ollama_api" id="ollama_api_cors_warning">
    <td colspan="2" style="text-align:center;">
      __MSG_remember_CORS__ [<a href="https://micz.it/thunderbird-addon-thunderai/ollama-cors-information/">__MSG_more_info_string__</a>]
      <br><br><b>__MSG_CORS_alternative_1__</b>
      <br>__MSG_CORS_alternative_2__
        <br><br><button id="btnGiveAllUrlsPermission_ollama_api">__MSG_CORS_give_allurls_perm__</button>
    </td>
  </tr>
  <tr class="conntype_ollama_api">
    <td>
      <label>
        <span class="opt_title">__MSG_Ollama_Models__</span>
      </label>
    </td>
    <td>
      <button id="btnUpdateOllamaModels">__MSG_Ollama_Models_Fetch__</button> <span id="ollama_model_fetch_loading">__MSG_Loading__</span><br>
      <label>
        <select id="ollama_model" name="ollama_model" class="option-input"></select>
      </label>
    </td>
  </tr>
  <tr class="conntype_ollama_api">
    <td><label>
      <span class="opt_title">__MSG_prefs_ollama_think__</span>
    </label></td>
    <td>
      <label>
        <input type="checkbox" id="ollama_think" name="ollama_think" class="option-input"/>
        __MSG_prefs_ollama_think_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_ollama_api">
    <td><label>
      <span class="opt_title">__MSG_prefs_ollama_num_ctx__ <i>[num_ctx]</i></span>
    </label></td>
    <td>
      <label>
        <input type="number" id="ollama_num_ctx" name="ollama_num_ctx" class="option-input"/>
        <br>__MSG_prefs_ollama_num_ctx_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api">
    <td><label>
      <span class="opt_title">__MSG_prefs_OpenAIComp_AvailableServices__</span>
    </label></td>
    <td>
      <label>
        <select id="openai_comp_services_shortcut"></select>
        <br>__MSG_prefs_OpenAIComp_AvailableServices_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api">
    <td><label>
      <span class="opt_title">__MSG_prefs_API_Host__</span>
      <br><i class="small_info">__MSG_prefs_API_Host_Info__ http://localhost:1234</i>
    </label></td>
    <td>
      <label>
        <input type="text" id="openai_comp_host" name="openai_comp_host" class="option-input" />
        <br>__MSG_prefs_OptionText_openai_comp_info_remote__
      </label>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api" id="openai_comp_api_cors_warning">
    <td colspan="2" style="text-align:center;">
      __MSG_maybe_CORS_openai_comp__ [<a href="https://micz.it/thunderbird-addon-thunderai/ollama-cors-information/">__MSG_more_info_string__</a>]
      <br><br><b>__MSG_CORS_alternative_1__</b>
      <br>__MSG_CORS_alternative_2__
        <br><br><button id="btnGiveAllUrlsPermission_openai_comp_api">__MSG_CORS_give_allurls_perm__</button>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api">
    <td><label>
      <span class="opt_title">__MSG_prefs_OptionText_openai_comp_use_v1__</span>
    </label></td>
    <td>
      <label>
        <input type="checkbox" id="openai_comp_use_v1" name="openai_comp_use_v1" class="option-input" />
        &nbsp;<span>__MSG_prefs_OptionText_openai_comp_use_v1_info__</span>
      </label>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api">
    <td><label>
      <span class="opt_title">__MSG_prefs_OpenAIComp_API_Key__</span>
      <br><i class="small_info">__MSG_Optional__</i>
    </label></td>
    <td>
      <div class="api_key-container">
        <label>
          <input type="password" id="openai_comp_api_key" name="openai_comp_api_key" class="option-input"/>
        </label>
        <span class="toggle-icon" id="toggle_openai_comp_api_key"><img src="/images/pwd-show.png" id="pwd-icon_openai_comp_api_key"></span>
      </div>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api">
    <td>
      <label>
        <span class="opt_title">__MSG_OpenAIComp_Models__</span>
        <br><button id="btnOpenAICompForceModel" class="btn_small">__MSG_prefs_OpenAIComp_ForceModel__</button>
      <br><button id="btnOpenAICompClearModelsList" class="btn_small">__MSG_prefs_OpenAIComp_ClearModelsList__</button></td>
      </label>
    </td>
    <td>
      <button id="btnUpdateOpenAICompModels">__MSG_OpenAIComp_Models_Fetch__</button> <span id="openai_comp_model_fetch_loading">__MSG_Loading__</span><br>
      <label>
        <select id="openai_comp_model" name="openai_comp_model" class="option-input"></select>
      </label>
    </td>
  </tr>
  <tr class="conntype_openai_comp_api">
    <td><label>
      <span class="opt_title">__MSG_prefs_OpenAIComp_ChatName__</span>
    </label></td>
    <td>
      <label>
        <input type="text" id="openai_comp_chat_name" name="openai_comp_chat_name" class="option-input" />
        <br>__MSG_prefs_OpenAIComp_ChatName_Info__
      </label>
    </td>
  </tr>
  <tr class="conntype_anthropic_api">
    <td><label>
      <span class="opt_title">__MSG_prefs_Anthropic_API_Key__</span>
    </label></td>
    <td>
      <div class="api_key-container">
        <label>
          <input type="password" id="anthropic_api_key" name="anthropic_api_key" class="option-input"/>
        </label>
        <span class="toggle-icon" id="toggle_anthropic_api_key"><img src="/images/pwd-show.png" id="pwd-icon_anthropic_api_key"></span>
      </div>
    </td>
  </tr>
  <tr class="conntype_anthropic_api">
    <td>
      <label>
        <span class="opt_title">__MSG_Anthropic_Models__</span>
      </label>
    </td>
    <td>
      <button id="btnUpdateAnthropicModels">__MSG_Anthropic_Models_Fetch__</button> <span id="anthropic_model_fetch_loading">__MSG_Loading__</span><br>
      <label>
        <select id="anthropic_model" name="anthropic_model" class="option-input"></select>
      </label>
    </td>
  </tr>
  <tr class="conntype_anthropic_api">
    <td>
      <label>
        <span class="opt_title">__MSG_Anthropic_Version__</span>
      </label>
    </td>
    <td>
      <label>
        <input type="text" id="anthropic_version" name="anthropic_version" class="option-input" />
        <br>__MSG_Anthropic_Version_Info__ <a href="https://docs.anthropic.com/en/api/versioning">https://docs.anthropic.com/en/api/versioning</a>
      </label>
    </td>
  </tr>
  <tr class="conntype_anthropic_api">
    <td><span class="opt_title">__MSG_prefs_OptionText_anthropic_max_tokens__</span></td>
    <td>
      <label>
        <input type="number" id="anthropic_max_tokens" name="anthropic_max_tokens" class="option-input" />
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

  // Bindings
  const bindClick = (id, cb) => { const el = document.getElementById(id); if (el && typeof cb === 'function') el.addEventListener('click', cb); };
  const bindChange = (id, cb) => { const el = document.getElementById(id); if (el && typeof cb === 'function') el.addEventListener('change', cb); };
  const bindInput = (id, cb) => { const el = document.getElementById(id); if (el && typeof cb === 'function') el.addEventListener('input', cb); };

  populateConnectionTypeOptions(selectId, no_chatgpt_web);

  let selectEl = document.getElementById(selectId);

  if (!selectEl) {
    console.error('[ThuderAI | injectConnectionUI] Select not found after insertion.');
  }

  const bindPasswordToggle = (idBase) => {
    const input = document.getElementById(idBase);
    const toggler = document.getElementById(`toggle_\${idBase}`);
    const icon = document.getElementById(`pwd-icon_\${idBase}`);
    if (!input || !toggler) return;
    toggler.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      if (icon) icon.src = input.type === 'password' ? '/images/pwd-show.png' : '/images/pwd-hide.png';
    });
  };

  bindPasswordToggle('chatgpt_api_key');
  bindPasswordToggle('google_gemini_api_key');
  bindPasswordToggle('openai_comp_api_key');
  bindPasswordToggle('anthropic_api_key');

  // Live warnings and enable/disable logic
  const applyLiveWarnings = () => {
    // ChatGPT API
    const chatgptKey = document.getElementById('chatgpt_api_key');
    const btnChatGPT = document.getElementById('btnUpdateChatGPTModels');
    const selChatGPT = document.getElementById('chatgpt_model');
    if (chatgptKey && btnChatGPT && selChatGPT) {
      const empty = !chatgptKey.value;
      chatgptKey.style.border = empty ? '2px solid red' : '';
      btnChatGPT.disabled = !!empty;
      selChatGPT.disabled = !!empty;
      if (!empty) {
        selChatGPT.style.border = (!selChatGPT.value || selChatGPT.selectedIndex === -1) ? '2px solid red' : '';
      } else {
        selChatGPT.style.border = '';
      }
    }

    // Google Gemini API
    const geminiKey = document.getElementById('google_gemini_api_key');
    const btnGemini = document.getElementById('btnUpdateGoogleGeminiModels');
    const selGemini = document.getElementById('google_gemini_model');
    if (geminiKey && btnGemini && selGemini) {
      const empty = !geminiKey.value;
      geminiKey.style.border = empty ? '2px solid red' : '';
      btnGemini.disabled = !!empty;
      selGemini.disabled = !!empty;
      if (!empty) {
        selGemini.style.border = (!selGemini.value || selGemini.selectedIndex === -1) ? '2px solid red' : '';
      } else {
        selGemini.style.border = '';
      }
    }

    // Ollama API
    const ollamaHost = document.getElementById('ollama_host');
    const btnOllama = document.getElementById('btnUpdateOllamaModels');
    const selOllama = document.getElementById('ollama_model');
    if (ollamaHost && btnOllama && selOllama) {
      const empty = !ollamaHost.value;
      ollamaHost.style.border = empty ? '2px solid red' : '';
      btnOllama.disabled = !!empty;
      selOllama.disabled = !!empty;
      if (!empty) {
        selOllama.style.border = (!selOllama.value || selOllama.selectedIndex === -1) ? '2px solid red' : '';
      } else {
        selOllama.style.border = '';
      }
    }

    // OpenAI-Compatible API
    const openaiCompHost = document.getElementById('openai_comp_host');
    const btnOpenAIComp = document.getElementById('btnUpdateOpenAICompModels');
    const selOpenAIComp = document.getElementById('openai_comp_model');
    if (openaiCompHost && btnOpenAIComp && selOpenAIComp) {
      const empty = !openaiCompHost.value;
      openaiCompHost.style.border = empty ? '2px solid red' : '';
      btnOpenAIComp.disabled = !!empty;
      selOpenAIComp.disabled = !!empty;
      if (!empty) {
        selOpenAIComp.style.border = (!selOpenAIComp.value || selOpenAIComp.selectedIndex === -1) ? '2px solid red' : '';
      } else {
        selOpenAIComp.style.border = '';
      }
    }

    // Anthropic API
    const anthropicKey = document.getElementById('anthropic_api_key');
    const btnAnthropic = document.getElementById('btnUpdateAnthropicModels');
    const selAnthropic = document.getElementById('anthropic_model');
    const anthropicVersion = document.getElementById('anthropic_version');
    if (anthropicKey && selAnthropic) {
      const emptyKey = !anthropicKey.value;
      anthropicKey.style.border = emptyKey ? '2px solid red' : '';
      if (btnAnthropic) btnAnthropic.disabled = !!emptyKey;
      if (selAnthropic) selAnthropic.disabled = !!emptyKey;
      if (!emptyKey && selAnthropic) {
        selAnthropic.style.border = (!selAnthropic.value || selAnthropic.selectedIndex === -1) ? '2px solid red' : '';
      } else if (selAnthropic) {
        selAnthropic.style.border = '';
      }
    }
    if (anthropicVersion) {
      const emptyVer = !anthropicVersion.value;
      anthropicVersion.style.border = emptyVer ? '2px solid red' : '';
    }
  };

  // Bind inputs to live warnings
  bindInput('chatgpt_api_key', applyLiveWarnings);
  bindInput('google_gemini_api_key', applyLiveWarnings);
  bindInput('ollama_host', applyLiveWarnings);
  bindInput('openai_comp_host', applyLiveWarnings);
  bindInput('anthropic_api_key', applyLiveWarnings);
  bindInput('anthropic_version', applyLiveWarnings);

  bindChange('chatgpt_model', applyLiveWarnings);
  bindChange('google_gemini_model', applyLiveWarnings);
  bindChange('ollama_model', applyLiveWarnings);
  bindChange('openai_comp_model', applyLiveWarnings);
  bindChange('anthropic_model', applyLiveWarnings);

  // Run once on init
  applyLiveWarnings();


  // Bind button clicks to provided callbacks (page-specific logic stays outside)
  // bindClick('btnChatGPTWeb_Tab', onOpenChatGPTWebTab);
  // bindClick('btnUpdateChatGPTModels', onFetchChatGPTModels);
  // bindClick('btnUpdateGoogleGeminiModels', onFetchGoogleGeminiModels);
  // bindClick('btnUpdateOllamaModels', onFetchOllamaModels);
  // bindClick('btnUpdateOpenAICompModels', onFetchOpenAICompModels);
  // bindClick('btnOpenAICompForceModel', onOpenAICompForceModel);
  // bindClick('btnOpenAICompClearModelsList', onOpenAICompClearModelsList);
  // bindClick('btnUpdateAnthropicModels', onFetchAnthropicModels);
  // bindClick('btnGiveAllUrlsPermission_ollama_api', onGiveAllUrlsPermissionOllama);
  // bindClick('btnGiveAllUrlsPermission_openai_comp_api', onGiveAllUrlsPermissionOpenAIComp);

  selectEl.addEventListener("change", () => showConnectionOptions(selectEl));

  showConnectionOptions(selectEl);
  
  return {
    select: selectEl,
    onTypeChange: (fn) => { onTypeChange = fn; fn(selectEl.value, { select: selectEl }); }
  };
}


function populateConnectionTypeOptions(selectId, no_chatgpt_web = false) {
  const selectEl = document.getElementById(selectId);
  if (!selectEl) return;

  const prevValue = selectEl.value;

  const options = [
    { value: 'chatgpt_web',        msgKey: 'prefs_Connection_type_ChatGPT_Web' },
    { value: 'chatgpt_api',        msgKey: 'prefs_Connection_type_ChatGPT_API' },
    { value: 'google_gemini_api',  msgKey: 'prefs_Connection_type_Google_Gemini_API' },
    { value: 'anthropic_api',      msgKey: 'prefs_Connection_type_Anthropic_API' },
    { value: 'ollama_api',         msgKey: 'prefs_Connection_type_Ollama_API' },
    { value: 'openai_comp_api',    msgKey: 'prefs_Connection_type_OpenAI_Comp_API' }
  ];

  selectEl.innerHTML = '';

  for (const opt of options.filter(o => !(no_chatgpt_web && o.value === 'chatgpt_web'))) {
    const optionEl = document.createElement('option');
    optionEl.value = opt.value;
    optionEl.textContent = browser.i18n.getMessage(opt.msgKey) || opt.msgKey;
    selectEl.appendChild(optionEl);
  }

  if (options.some(o => o.value === prevValue)) {
    selectEl.value = prevValue;
  }
}


export function showConnectionOptions(conntype_select) {
  let chatgpt_web_display = 'table-row';
  let chatgpt_api_display = 'none';
  let ollama_api_display = 'none';
  let openai_comp_api_display = 'none';
  let google_gemini_api_display = 'none';
  let anthropic_api_display = 'none';
  let parent = conntype_select.parentElement.parentElement.parentElement;
  parent.classList.toggle("conntype_chatgpt_web", (conntype_select.value === "chatgpt_web"));
  parent.classList.toggle("conntype_chatgpt_api", (conntype_select.value === "chatgpt_api"));
  parent.classList.toggle("conntype_ollama_api", (conntype_select.value === "ollama_api"));
  parent.classList.toggle("conntype_openai_comp_api", (conntype_select.value === "openai_comp_api"));
  parent.classList.toggle("conntype_google_gemini_api", (conntype_select.value === "google_gemini_api"));
  parent.classList.toggle("conntype_anthropic_api", (conntype_select.value === "anthropic_api"));
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
  document.querySelectorAll(".conntype_chatgpt_web").forEach(element => {
    element.style.display = chatgpt_web_display;
  });
  document.querySelectorAll(".conntype_chatgpt_api").forEach(element => {
    element.style.display = chatgpt_api_display;
  });
  document.querySelectorAll(".conntype_ollama_api").forEach(element => {
    element.style.display = ollama_api_display;
  });
  document.querySelectorAll(".conntype_openai_comp_api").forEach(element => {
    element.style.display = openai_comp_api_display;
  });
  document.querySelectorAll(".conntype_google_gemini_api").forEach(element => {
    element.style.display = google_gemini_api_display;
  });
  document.querySelectorAll(".conntype_anthropic_api").forEach(element => {
    element.style.display = anthropic_api_display;
  });
  if (varConnectionUI.permission_all_urls) {
    document.getElementById('openai_comp_api_cors_warning').style.display = 'none';
    document.getElementById('ollama_api_cors_warning').style.display = 'none';
  }
}