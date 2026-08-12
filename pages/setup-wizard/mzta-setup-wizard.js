/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { prefs_default } from '../../options/mzta-options-default.js';
import { taLogger } from '../../js/mzta-logger.js';
import { setTomSelectBorder, hasNoConnectionSelected } from '../../js/mzta-utils.js';
import {
  injectConnectionUI,
  varConnectionUI,
  showConnectionOptions
} from '../_lib/connection-ui.js';
import {
  isTestableConnection,
  runConnectionTest
} from '../../js/mzta-connection-test.js';

let taLog = console;

// Provider order + card tag i18n keys. Names reuse the existing
// prefs_Connection_type_* messages so they stay consistent with the rest of
// the UI. tag keys are wizard-specific (see _locales/en/messages.json).
const PROVIDERS = [
  { id: 'chatgpt_web',        nameKey: 'prefs_Connection_type_ChatGPT_Web',        tagKey: 'wizard_provider_tag_chatgpt_web' },
  { id: 'chatgpt_api',        nameKey: 'prefs_Connection_type_ChatGPT_API',        tagKey: 'wizard_provider_tag_chatgpt_api' },
  { id: 'google_gemini_api',  nameKey: 'prefs_Connection_type_Google_Gemini_API',  tagKey: 'wizard_provider_tag_google_gemini_api' },
  { id: 'anthropic_api',      nameKey: 'prefs_Connection_type_Anthropic_API',      tagKey: 'wizard_provider_tag_anthropic_api' },
  { id: 'ollama_api',         nameKey: 'prefs_Connection_type_Ollama_API',         tagKey: 'wizard_provider_tag_ollama_api' },
  { id: 'openai_comp_api',    nameKey: 'prefs_Connection_type_OpenAI_Comp_API',    tagKey: 'wizard_provider_tag_openai_comp_api' },
];

// Only the four API-driven features are offered in the wizard (the two Sparks
// features are configured later from the options page).
const WIZARD_FEATURES = ['add_tags', 'spamfilter', 'summarize', 'translate'];

const CONN_TYPES = PROVIDERS.map(p => p.id);

// Wizard state. `step` is the raw step index (0=provider, 1=connect,
// 2=tools, 3=done); navigation walks the provider-specific sequence.
// `provider` stays empty until the user picks a card: the wizard must never
// persist a provider just because it was opened.
let state = {
  step: 0,
  provider: prefs_default.connection_type,
};

function getProviderName(id) {
  const p = PROVIDERS.find(x => x.id === id) || PROVIDERS[0];
  return browser.i18n.getMessage(p.nameKey) || id;
}

// Step sequence is provider-dependent: ChatGPT Web skips the "Pick your tools"
// step because it has no API-driven features. With no provider chosen yet the
// full sequence is assumed (navigation past step 0 is blocked anyway).
function getSequence() {
  return state.provider === 'chatgpt_web' ? [0, 1, 3] : [0, 1, 2, 3];
}

// ---- Persistence (mirrors options/mzta-options.js) -----------------------

function saveOptions(e) {
  let options = {};
  let element = e.target;
  switch (element.type) {
    case 'checkbox':
      options[element.id] = element.checked;
      break;
    case 'number':
      options[element.id] = element.valueAsNumber;
      break;
    case 'text':
    case 'password':
    case 'textarea':
      options[element.id] = element.value.trim();
      break;
    case 'select-one':
      options[element.id] = element.value;
      break;
    default:
      console.error('[ThunderAI] Unhandled input type:', element.type);
      return;
  }
  browser.storage.sync.set(options);
}

async function restoreOptions() {
  function setCurrentChoice(result) {
    document.querySelectorAll('.option-input').forEach(element => {
      if (!element.id) return;
      switch (element.type) {
        case 'checkbox':
          element.checked = result[element.id] || false;
          break;
        case 'number':
          element.value = result[element.id] ?? 0;
          break;
        case 'text':
        case 'password':
          element.value = result[element.id] || '';
          break;
        case 'select-one':
          let default_select_value = '';
          if (element.id === 'connection_type') default_select_value = state.provider;
          element.value = result[element.id] || default_select_value;
          // Nothing chosen yet (fresh install): leave the select unset. It is
          // hidden anyway, and restoring must never persist a provider.
          if (element.value === '') element.selectedIndex = -1;
          if (element.tomselect) {
            element.tomselect.setValue(element.value, true);
            setTomSelectBorder(element.tomselect);
          }
          break;
        case 'textarea':
          element.value = result[element.id] || '';
          break;
        default:
          console.error('[ThunderAI] Unhandled input type:', element.type);
      }
    });
  }
  let getting = await browser.storage.sync.get(prefs_default);
  setCurrentChoice(getting);
}

// ---- Connection test status strip (mirrors options page) -----------------

function refreshConnTestVisibility() {
  let strip = document.getElementById('mzta_conn_test');
  if (!strip) return;
  strip.style.display = isTestableConnection(state.provider) ? 'flex' : 'none';
  setConnTestState('idle');
}

function setConnTestState(stateName, message) {
  let strip = document.getElementById('mzta_conn_test');
  let textEl = document.getElementById('mzta_conn_test_text');
  let linkEl = document.getElementById('mzta_conn_test_link');
  if (!strip || !textEl || !linkEl) return;
  strip.setAttribute('data-state', stateName);
  switch (stateName) {
    case 'loading':
      textEl.textContent = browser.i18n.getMessage('connTest_testing');
      linkEl.style.display = 'none';
      break;
    case 'ok':
      textEl.textContent = browser.i18n.getMessage('connTest_ok', [message || '']);
      linkEl.textContent = browser.i18n.getMessage('connTest_link_retest');
      linkEl.style.display = '';
      break;
    case 'error':
      textEl.textContent = browser.i18n.getMessage('connTest_error', [message || '']);
      linkEl.textContent = browser.i18n.getMessage('connTest_link_retry');
      linkEl.style.display = '';
      break;
    case 'idle':
    default:
      textEl.textContent = browser.i18n.getMessage('connTest_idle');
      linkEl.textContent = browser.i18n.getMessage('connTest_link_test');
      linkEl.style.display = '';
      break;
  }
}

// ---- Per-connection advanced disclosure (mirrors options page) -----------

function resetConnAdv() {
  let btn = document.getElementById('mzta_conn_adv_btn');
  let panel = document.getElementById('connection_ui_adv_table');
  if (!btn || !panel) return;
  btn.setAttribute('aria-expanded', 'false');
  panel.classList.add('hidden');
}

function showAdvConnectionOptions() {
  let advTable = document.getElementById('connection_ui_adv_table');
  if (!advTable) return;
  advTable.querySelectorAll('tr[class*="conntype_"]').forEach(tr => {
    tr.style.display = tr.classList.contains('conntype_' + state.provider) ? '' : 'none';
  });
}

// ---- Provider selection --------------------------------------------------

function selectProvider(id) {
  state.provider = id;

  // Drive the hidden connection-type <select> so the shared connection UI
  // reacts, and persist the choice via the same change→saveOptions path.
  let select = document.getElementById('connection_type');
  if (select) {
    select.value = id;
    if (select.tomselect) select.tomselect.setValue(id, true);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Show only the selected provider's rows in the core + advanced tables.
  if (select) showConnectionOptions(select, '');
  showAdvConnectionOptions();
  resetConnAdv();

  // Re-tint the connection panel, the done badge and update the pill name.
  let panel = document.getElementById('mzta_conn_panel');
  let done = document.getElementById('wiz_step_done');
  for (let t of CONN_TYPES) {
    if (panel) panel.classList.toggle('tint_' + t, t === id);
    if (done) done.classList.toggle('tint_' + t, t === id);
  }
  let pillName = document.getElementById('mzta_conn_pill_name');
  if (pillName) pillName.textContent = getProviderName(id);

  // Update the Connect step heading/sub for the chosen provider.
  let heading = document.getElementById('wiz_connect_heading');
  if (heading) heading.textContent = browser.i18n.getMessage('wizard_connect_heading', [getProviderName(id)]);
  let sub = document.getElementById('wiz_connect_sub');
  if (sub) sub.textContent = browser.i18n.getMessage(id === 'chatgpt_web' ? 'wizard_step_connect_sub_web' : 'wizard_step_connect_sub');

  // Mark the selected provider card.
  document.querySelectorAll('.wiz_provider_card').forEach(card => {
    card.classList.toggle('wiz_selected', card.dataset.provider === id);
  });

  refreshConnTestVisibility();
  refreshNextEnabled();
}

function buildProviderCards() {
  let list = document.getElementById('wiz_provider_list');
  if (!list) return;
  list.textContent = '';
  PROVIDERS.forEach(p => {
    let card = document.createElement('button');
    card.type = 'button';
    card.className = 'wiz_provider_card tint_' + p.id;
    card.dataset.provider = p.id;

    let dot = document.createElement('span');
    dot.className = 'wiz_provider_dot';

    let info = document.createElement('div');
    info.className = 'wiz_provider_info';
    let name = document.createElement('div');
    name.className = 'wiz_provider_name';
    name.textContent = browser.i18n.getMessage(p.nameKey) || p.id;
    let tag = document.createElement('div');
    tag.className = 'wiz_provider_tag';
    tag.textContent = browser.i18n.getMessage(p.tagKey) || '';
    info.appendChild(name);
    info.appendChild(tag);

    let radio = document.createElement('span');
    radio.className = 'wiz_provider_radio';
    let radioDot = document.createElement('span');
    radioDot.className = 'wiz_provider_radio_dot';
    radio.appendChild(radioDot);

    card.appendChild(dot);
    card.appendChild(info);
    card.appendChild(radio);
    card.addEventListener('click', () => selectProvider(p.id));
    list.appendChild(card);
  });
}

// ---- Step rendering ------------------------------------------------------

function renderSteps() {
  let seq = getSequence();
  let pos = seq.indexOf(state.step);
  let container = document.getElementById('wiz_steps');
  if (!container) return;
  container.textContent = '';
  seq.forEach((stepIdx, p) => {
    let isLast = p === seq.length - 1;
    let doneOrActive = p <= pos;
    let dot = document.createElement('span');
    dot.className = 'wiz_dot' + (doneOrActive ? ' wiz_dot_on' : '');
    dot.textContent = isLast ? '✓' : String(p + 1);
    container.appendChild(dot);
    let line = document.createElement('span');
    line.className = 'wiz_line' + (p < pos ? ' wiz_line_on' : '');
    container.appendChild(line);
  });
}

function renderStep() {
  let seq = getSequence();
  // Clamp the step to a valid position in the current sequence (e.g. if the
  // provider changed to one with a shorter sequence).
  if (!seq.includes(state.step)) state.step = seq[0];
  let pos = seq.indexOf(state.step);

  document.getElementById('wiz_step_provider').classList.toggle('hidden', state.step !== 0);
  document.getElementById('wiz_step_connect').classList.toggle('hidden', state.step !== 1);
  document.getElementById('wiz_step_tools').classList.toggle('hidden', state.step !== 2);
  document.getElementById('wiz_step_done').classList.toggle('hidden', state.step !== 3);

  renderSteps();

  // Nav bar: Back visible only when not first and not last; Next hidden on Done.
  let nav = document.getElementById('wiz_nav');
  let back = document.getElementById('wiz_back');
  let next = document.getElementById('wiz_next');
  let backShown = pos > 0 && state.step !== 3;
  back.classList.toggle('hidden', !backShown);
  nav.classList.toggle('wiz_nav_back_hidden', !backShown);
  next.classList.toggle('hidden', state.step === 3);
  // "Finish setup" on the second-to-last step of the sequence, else "Continue".
  next.textContent = browser.i18n.getMessage(pos === seq.length - 2 ? 'wizard_finish' : 'wizard_continue');
  refreshNextEnabled();
}

// Can't go past the provider step until a provider has actually been chosen.
// Called both on step render and right after a provider card is clicked, so the
// button unlocks on the first click without waiting for another render.
function refreshNextEnabled() {
  let next = document.getElementById('wiz_next');
  if (next) next.disabled = (state.step === 0) && hasNoConnectionSelected(state.provider);
}

function goNext() {
  // Nothing to configure until a provider is chosen.
  if (state.step === 0 && hasNoConnectionSelected(state.provider)) return;
  let seq = getSequence();
  let pos = seq.indexOf(state.step);
  state.step = seq[Math.min(seq.length - 1, pos + 1)];
  renderStep();
}

function goBack() {
  let seq = getSequence();
  let pos = seq.indexOf(state.step);
  state.step = seq[Math.max(0, pos - 1)];
  renderStep();
}

// ---- Boot ----------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  let prefs = await browser.storage.sync.get({
    do_debug: prefs_default.do_debug,
    connection_type: prefs_default.connection_type,
  });
  taLog = new taLogger('mzta-setup-wizard', prefs.do_debug);
  // Empty when nothing has been chosen yet: no provider card is preselected.
  state.provider = prefs.connection_type;

  await injectConnectionUI({
    afterTrId: 'connection_ui_anchor',
    selectId: 'connection_type',
    taLog: taLog,
  });

  // Move the advanced connection rows into the dedicated table below the
  // disclosure button (same pattern as the options page).
  let conn_adv_body = document.querySelector('#connection_ui_adv_table tbody');
  if (conn_adv_body) {
    document.querySelectorAll('#connection_ui_table tr.conn_adv').forEach(tr => conn_adv_body.appendChild(tr));
  }

  await restoreOptions();

  varConnectionUI.permission_all_urls = await messenger.permissions.contains({ origins: ['<all_urls>'] });

  i18n.updateDocument();

  buildProviderCards();

  // Persist any field edit (this also persists connection_type when a card is
  // picked, since selectProvider dispatches a change on the select).
  document.querySelectorAll('.option-input').forEach(element => {
    element.addEventListener('change', saveOptions);
  });

  // Per-connection advanced disclosure toggle.
  let conn_adv_btn = document.getElementById('mzta_conn_adv_btn');
  let conn_adv_panel = document.getElementById('connection_ui_adv_table');
  conn_adv_btn.addEventListener('click', () => {
    let expanded = conn_adv_btn.getAttribute('aria-expanded') === 'true';
    conn_adv_btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    conn_adv_panel.classList.toggle('hidden', expanded);
  });

  // Any edit to a connection field invalidates a prior test result.
  let conn_ui_table = document.getElementById('connection_ui_table');
  conn_ui_table.addEventListener('input', () => setConnTestState('idle'));
  conn_ui_table.addEventListener('change', () => setConnTestState('idle'));
  conn_adv_panel.addEventListener('input', () => setConnTestState('idle'));
  conn_adv_panel.addEventListener('change', () => setConnTestState('idle'));

  // Run the (non-persistent) connectivity check when the action link is clicked.
  document.getElementById('mzta_conn_test_link').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!isTestableConnection(state.provider)) return;
    setConnTestState('loading');
    let result = await runConnectionTest(state.provider);
    if (result.status === 'ok') {
      setConnTestState('ok', result.apiName);
    } else {
      setConnTestState('error', result.message);
    }
  });

  // Nav + done actions.
  document.getElementById('wiz_next').addEventListener('click', goNext);
  document.getElementById('wiz_back').addEventListener('click', goBack);
  document.getElementById('wiz_restart').addEventListener('click', () => {
    state.step = 0;
    renderStep();
  });

  // Initial render: apply the saved provider, if any, then show step 0.
  // With no provider saved we must NOT call selectProvider(): it dispatches a
  // 'change' on the hidden select, which would persist a connection_type the
  // user never chose (just opening the wizard would pick one for them). Step 0
  // only shows the provider cards, so no connection UI setup is needed yet —
  // the first card click does it.
  if (!hasNoConnectionSelected(state.provider)) {
    selectProvider(state.provider);
  }
  state.step = 0;
  renderStep();
}, { once: true });
