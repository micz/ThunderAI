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

// Lightweight, non-persistent connectivity check for the Connection Settings panel.
// It reuses each provider class' existing fetchModels() method (the same call the
// per-provider "Fetch models" buttons use) so URL/header/auth logic is never duplicated.
// It reads the CURRENT form field values (saved or not) and does not save anything.

import { OpenAI } from './api/openai_responses.js';
import { GoogleGemini } from './api/google_gemini.js';
import { Anthropic } from './api/anthropic.js';
import { Ollama } from './api/ollama.js';
import { OpenAIComp } from './api/openai_comp.js';
import { prepareOriginURL } from './mzta-utils.js';

const CONN_TEST_TIMEOUT_MS = 10000;

function _val(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

// Provider registry: for each testable connection_type, how to build the client from the
// current form fields, its display-name i18n key, and how to obtain the needed host
// permission. chatgpt_web is intentionally absent (no testable endpoint).
const TESTABLE = {
  chatgpt_api: {
    nameKey: 'prefs_Connection_type_ChatGPT_API',
    makeClient: () => new OpenAI({ apiKey: _val('chatgpt_api_key') }),
    requestPermission: async () =>
      messenger.permissions.request({ origins: ['https://*.openai.com/*'] }),
  },
  google_gemini_api: {
    nameKey: 'prefs_Connection_type_Google_Gemini_API',
    makeClient: () => new GoogleGemini({ apiKey: _val('google_gemini_api_key') }),
    requestPermission: async () =>
      messenger.permissions.request({ origins: ['https://generativelanguage.googleapis.com/*'] }),
  },
  anthropic_api: {
    nameKey: 'prefs_Connection_type_Anthropic_API',
    makeClient: () => new Anthropic({
      apiKey: _val('anthropic_api_key'),
      version: _val('anthropic_version'),
    }),
    requestPermission: async () =>
      messenger.permissions.request({ origins: ['https://*.anthropic.com/*'] }),
  },
  ollama_api: {
    nameKey: 'prefs_Connection_type_Ollama_API',
    makeClient: () => new Ollama({ host: _val('ollama_host') }),
    requestPermission: async () => _requestHostPermission(_val('ollama_host')),
  },
  openai_comp_api: {
    nameKey: 'prefs_Connection_type_OpenAI_Comp_API',
    makeClient: () => {
      const use_v1_el = document.getElementById('openai_comp_use_v1');
      return new OpenAIComp({
        host: _val('openai_comp_host'),
        apiKey: _val('openai_comp_api_key'),
        use_v1: use_v1_el ? use_v1_el.checked : true,
      });
    },
    requestPermission: async () => _requestHostPermission(_val('openai_comp_host')),
  },
};

// Mirrors the CORS "give permission" buttons: localhost hosts need <all_urls>,
// remote hosts need the specific origin.
async function _requestHostPermission(host) {
  const h = (host || '').trim();
  if (h === '') return false;
  if (h.includes('localhost') || h.includes('127.0.0.1')) {
    return messenger.permissions.request({ origins: ['<all_urls>'] });
  }
  return messenger.permissions.request({ origins: [prepareOriginURL(h)] });
}

// Returns the registry entry for a connection type, or null if it has no testable endpoint.
export function getTestableConnection(connType) {
  return TESTABLE[connType] || null;
}

// True if the given connection type exposes a testable endpoint (everything but chatgpt_web).
export function isTestableConnection(connType) {
  return !!TESTABLE[connType];
}

// Interpret a fetchModels() result / thrown error into a user-facing message key.
function _mapError(data) {
  // Network / CORS / thrown exception (no HTTP response reached us).
  if (data && data.is_exception) {
    return browser.i18n.getMessage('connTest_error_network');
  }
  // HTTP error: data.error holds the raw response body (often JSON with .error.message).
  let detail = '';
  try {
    const parsed = JSON.parse(data.error);
    detail = (parsed && parsed.error && parsed.error.message) ? parsed.error.message : '';
  } catch (e) {
    detail = typeof data.error === 'string' ? data.error : '';
  }
  const lower = (detail || '').toLowerCase();
  if (lower.includes('api key') || lower.includes('api-key') ||
      lower.includes('unauthorized') || lower.includes('authentication') ||
      lower.includes('invalid x-api-key') || lower.includes('permission')) {
    return browser.i18n.getMessage('connTest_error_auth');
  }
  if (detail) return detail;
  return browser.i18n.getMessage('connTest_error_network');
}

// Runs the connectivity check for the current form values of `connType`.
// Returns { status: 'ok', apiName } or { status: 'error', message }.
// Non-destructive: reads form fields only, saves nothing.
export async function runConnectionTest(connType) {
  const entry = getTestableConnection(connType);
  if (!entry) {
    return { status: 'error', message: browser.i18n.getMessage('connTest_error_network') };
  }

  const apiName = browser.i18n.getMessage(entry.nameKey) || connType;

  // Ensure we have the host permission the request needs (mirrors the fetch-models buttons).
  const granted = await entry.requestPermission();
  if (!granted) {
    return { status: 'error', message: browser.i18n.getMessage('Optional_Permission_Denied_Model_Fetching') };
  }

  const client = entry.makeClient();

  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve({ __timeout: true }), CONN_TEST_TIMEOUT_MS));

  let data;
  try {
    // fetchModels() resolves with {ok, error, is_exception}; OpenAIComp may throw on network error.
    data = await Promise.race([client.fetchModels(), timeout]);
  } catch (error) {
    return { status: 'error', message: browser.i18n.getMessage('connTest_error_network') };
  }

  if (data && data.__timeout) {
    return { status: 'error', message: browser.i18n.getMessage('connTest_error_timeout') };
  }

  if (data && data.ok) {
    return { status: 'ok', apiName };
  }

  return { status: 'error', message: _mapError(data || {}) };
}
