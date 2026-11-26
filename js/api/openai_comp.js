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

// Some original methods derived from https://github.com/ali-raheem/Aify/blob/4ece286095ea7a6cf89d696902e6b81b5d1c3a4b/plugin/html/API.js

import {
    mergeHeaders,
    parseExtraBody,
    parseExtraHeaders
} from './api-utils.js';
import {
    fetchWithRetry,
    isRedirectFailed
} from './api-retry.js';
import { createUsageData } from './mzta-api-usage.js';
import {
    checkEndpoint,
    endpointProblemText
} from '../mzta-endpoint-policy.js';

// Local servers (LM Studio, vLLM, llama.cpp...) may load the model before they
// send the response headers, so a chat request gets a longer per-attempt timeout.
const OPENAI_COMP_CHAT_TIMEOUT_MS = 300000;

// Best effort: the OpenAI-compatible servers that implement the usage object do
// so under the chat/completions names, but plenty of them never send one. See
// extractUsage() and the stream_options note in fetchResponse().
export const supportsUsageData = true;

/**
 * Normalize the usage an OpenAI-compatible server reports.
 *
 * The `usage` object sits at the top level of a full response or of the final
 * streamed chunk -- and in a stream it is only emitted at all when the request
 * asked for it through stream_options.include_usage (see fetchResponse()). A
 * server that ignores that parameter simply never sends usage, and this returns
 * null, which is the expected outcome rather than an error.
 *
 * Never throws: every access is guarded, because a partial or unexpected payload
 * must not break the stream it is being read from.
 *
 * @param {object} raw a streamed chunk or a full response body
 * @returns {object|null} the normalized usage, or null when there is none
 */
export function extractUsage(raw) {
  try{
    if(raw === null || typeof raw !== 'object') return null;

    const usage = raw.usage;
    if(usage === null || typeof usage !== 'object') return null;

    const prompt_details = (usage.prompt_tokens_details !== null && typeof usage.prompt_tokens_details === 'object')
      ? usage.prompt_tokens_details : {};
    const completion_details = (usage.completion_tokens_details !== null && typeof usage.completion_tokens_details === 'object')
      ? usage.completion_tokens_details : {};

    return createUsageData({
      provider: 'openai_comp',
      model: raw.model,
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      cached_input_tokens: prompt_details.cached_tokens,
      reasoning_tokens: completion_details.reasoning_tokens,
    });
  }catch(error){
    console.warn("[ThunderAI] OpenAI Comp usage data could not be read, ignoring it: " + error);
    return null;
  }
}

/**
 * Normalize the `content` of a chat completion message (or of a streamed delta)
 * into the answer text and the reasoning text [#1044].
 *
 * The OpenAI shape is a string, but some servers send an array of typed chunks:
 * Mistral's reasoning models (with reasoning_effort set, and always for some models)
 * answer with
 *   [{type: "thinking", thinking: [{type: "text", text: "..."}]}, {type: "text", text: "..."}]
 * and, while streaming, change shape in the same response (an array while thinking,
 * an array with both chunks at the transition, a plain string while answering).
 * Treating the array as a string printed "[object Object]" in the answer.
 *
 * Never throws. A chunk of an unknown type is ignored, logged when `logger` (a
 * taLogger) has debug on.
 *
 * @param {*} content the content value, whatever its shape
 * @param {object} [logger] a taLogger, for the debug line about an unknown chunk
 * @returns {{text: string, thinking: string}}
 */
export function normalizeChatContent(content, logger = null) {
  if (typeof content === 'string') return { text: content, thinking: '' };
  let text = '';
  let thinking = '';
  if (!Array.isArray(content)) return { text, thinking };
  for (const chunk of content) {
    if (typeof chunk === 'string') {
      text += chunk;
    } else if (chunk && chunk.type === 'text') {
      if (typeof chunk.text === 'string') text += chunk.text;
    } else if (chunk && chunk.type === 'thinking') {
      thinking += thinkingChunkText(chunk.thinking);
    } else if (logger && logger.do_debug) {
      logger.log("Ignored a content chunk of an unknown type: " + JSON.stringify(chunk?.type));
    }
  }
  return { text, thinking };
}

// The text of a "thinking" chunk: an array of {type: "text", text} items, or a plain
// string tolerated as such.
function thinkingChunkText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  let out = '';
  for (const item of value) {
    if (typeof item === 'string') out += item;
    else if (item && item.type === 'text' && typeof item.text === 'string') out += item.text;
  }
  return out;
}

/**
 * The message an OpenAI-compatible server puts in an error body, or '' when it
 * has none in a known place [#1044]. Checked in order:
 *   1. error.message (OpenAI, OpenRouter, DeepSeek...), or error as a plain string;
 *   2. message (Mistral: {"object": "error", "message": "..."}), which may itself
 *      hold the detail list;
 *   3. detail[].msg, joined (the FastAPI validation errors Mistral answers a 422
 *      with), or detail as a plain string.
 *
 * @param {*} parsed the parsed error body
 * @returns {string}
 */
export function findErrorMessage(parsed) {
  if (parsed === null || typeof parsed !== 'object') return '';
  const error = parsed.error;
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message !== '') return error.message;
  if (typeof error === 'string' && error !== '') return error;
  if (typeof parsed.message === 'string' && parsed.message !== '') return parsed.message;
  if (parsed.message && typeof parsed.message === 'object') {
    const nested = findErrorMessage(parsed.message);
    if (nested !== '') return nested;
  }
  if (Array.isArray(parsed.detail)) {
    const msgs = parsed.detail
      .map(d => (d && typeof d.msg === 'string') ? d.msg : (typeof d === 'string' ? d : ''))
      .filter(m => m !== '');
    if (msgs.length > 0) return msgs.join('; ');
  }
  if (typeof parsed.detail === 'string' && parsed.detail !== '') return parsed.detail;
  return '';
}

/**
 * The message of an OpenAI-compatible error body: findErrorMessage() of the parsed
 * body, or the raw body itself when it is not JSON or has no message in a known place.
 *
 * @param {string|object} body the raw response body, or an already parsed one
 * @returns {string} '' only for an empty body
 */
export function extractErrorMessage(body) {
  if (body !== null && typeof body === 'object') {
    const found = findErrorMessage(body);
    if (found !== '') return found;
    try { return JSON.stringify(body); } catch (e) { return String(body); }
  }
  if (typeof body !== 'string') return '';
  try {
    const found = findErrorMessage(JSON.parse(body));
    if (found !== '') return found;
  } catch (e) {
    // Not JSON: the raw body is the message.
  }
  return body;
}

/**
 * Whether a parsed SSE frame is an error sent in the middle of a stream, after a
 * 200 response: {"error": {...}} (OpenAI, OpenRouter, vLLM, LM Studio), or
 * {"object": "error", ...} (Mistral).
 */
export function isStreamErrorFrame(parsed) {
  if (parsed === null || typeof parsed !== 'object') return false;
  if (parsed.error !== undefined && parsed.error !== null && parsed.error !== false) return true;
  return parsed.object === 'error';
}

// A deprecation date as a timestamp in ms, or null when there is none or it cannot
// be read. A number is taken as seconds when it is too small to be milliseconds.
function deprecationTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * The model list of the "Show only chat models" option [#1044]: the models a chat
 * cannot use are dropped, and the "-latest" aliases come first.
 *  - a model whose capabilities.completion_chat is false is dropped;
 *  - a model whose deprecation date (Mistral's `deprecation`) is in the past is dropped;
 *  - a model without these fields (any other server) stays;
 *  - the ids ending in "-latest" are moved to the top, the order is kept otherwise.
 *
 * @param {Array} models the list fetchModels() returned
 * @param {number} [now] the current time in ms
 * @returns {Array} a new array
 */
export function filterChatModels(models, now = Date.now()) {
  if (!Array.isArray(models)) return [];
  const kept = models.filter(model => {
    if (model === null || typeof model !== 'object') return false;
    if (model.capabilities && typeof model.capabilities === 'object' && model.capabilities.completion_chat === false) return false;
    const deprecated = deprecationTime(model.deprecation);
    if (deprecated !== null && deprecated <= now) return false;
    return true;
  });
  const isLatest = model => typeof model.id === 'string' && model.id.endsWith('-latest');
  return [...kept.filter(isLatest), ...kept.filter(model => !isLatest(model))];
}


export class OpenAIComp {

  host = '';
  model = '';
  apiKey = '';
  use_v1 = true;
  stream = false;
  temperature = '';
  // '' (not sent) or the value of the reasoning_effort parameter [#1044].
  reasoning_effort = '';
  extra_body = '';
  extra_headers = '';
  approved_insecure_origins = [];
  // The redirect outcome of the last request (see checkRedirected() in api-retry.js):
  // null when it says nothing, {redirected: false} for a success with no redirect, or
  // {redirected: true, url, failed}. The caller saves it (js/mzta-endpoint-redirects.js);
  // the worker forwards it with an 'endpoint_redirect' message.
  redirect_info = null;

  constructor({
    host = '',
    model = '',
    apiKey = '',
    stream = false,
    use_v1 = true,
    temperature = '',
    reasoning_effort = '',
    extra_body = '',
    extra_headers = '',
    approved_insecure_origins = [],
  } = {}) {
    this.host = (host || '').trim().replace(/\/+$/, "");
    this.model = model;
    this.stream = stream;
    this.apiKey = apiKey;
    this.use_v1 = use_v1;
    this.temperature = temperature;
    this.reasoning_effort = typeof reasoning_effort === 'string' ? reasoning_effort.trim() : '';
    this.extra_body = extra_body;
    this.extra_headers = extra_headers;
    // The unencrypted origins the caller confirmed (js/mzta-endpoint-approvals.js):
    // the endpoint is checked against them before every request [#1000].
    this.approved_insecure_origins = Array.isArray(approved_insecure_origins) ? approved_insecure_origins : [];
  }

  // The error result of a request that must not be sent, or null. Same contract as a
  // network failure, so every caller already handles it; the callers that can show a
  // localized message check the endpoint themselves before getting here.
  _endpointRefused = () => {
    const check = checkEndpoint(this.host, this.approved_insecure_origins);
    if (check.ok) return null;
    console.error("[ThunderAI] OpenAI Comp API request not sent: " + endpointProblemText(check.problem));
    return { ok: false, is_exception: true, is_aborted: false, endpoint_problem: check.problem,
      error: "OpenAI Comp API request not sent: " + endpointProblemText(check.problem) };
  }

  // Starts a request: forgets the previous redirect outcome and returns the onRedirect
  // callback that records the new one.
  _trackRedirect = () => {
    this.redirect_info = null;
    return (info) => { this.redirect_info = info; };
  }

  // The headers of a request: the user's extra headers, under the ones ThunderAI
  // manages, which always win. Never log the result: it may carry secrets (the API
  // key, or an extra header such as Azure's api-key).
  _headers = (managed) => mergeHeaders(parseExtraHeaders(this.extra_headers), managed);


  fetchModels = async (retryConfig = {}) => {
    try{
      const onRedirect = this._trackRedirect();
      const refused = this._endpointRefused();
      if (refused) return refused;
      const curr_headers = {
        "Content-Type": "application/json",
      };
      if(this.apiKey !== '') curr_headers["Authorization"] = "Bearer "+ this.apiKey;

      if(this.host.includes('openrouter.ai')) {
        curr_headers['HTTP-Referer'] = 'https://micz.it/thunderbird-addon-thunderai/';
        curr_headers['X-Title'] = 'ThunderAI';
      }

      // Some compatible endpoints take the API key in the query string:
      // fetchWithRetry() never logs the URL.
      const response = await fetchWithRetry(this.host + (this.use_v1 ? "/v1" : "") + "/models", {
          method: "GET",
          headers: this._headers(curr_headers),
      }, { label: 'OpenAI Comp', ...retryConfig, onRedirect });

      if (!response.ok) {
          const errorDetail = await response.text();
          let err_msg = "[ThunderAI] OpenAI Comp API request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail;
          console.error(err_msg);
          let output = {};
          output.ok = false;
          output.error = errorDetail;
          output.status = response.status;
          output.statusText = response.statusText;
          return output;
      }

      let output = {};
      output.ok = true;
      let output_response = await response.json();
      // The OpenAI shape is { data: [...] }, but some compatible servers answer
      // with the bare array. Anything else becomes an empty list, so the callers
      // can always iterate the response.
      if(Array.isArray(output_response)) {
        output.response = output_response;
      } else if(Array.isArray(output_response?.data)) {
        output.response = output_response.data;
      } else {
        output.response = [];
      }

      return output;
    }catch (error) {
      console.error("[ThunderAI] OpenAI Comp API request failed: " + error);
      let output = {};
      output.is_exception = true;
      output.is_redirect = isRedirectFailed(error);
      output.ok = false;
      output.error = "OpenAI Comp API request failed: " + error;
      return output;
    }
  }

  fetchResponse = async (messages, maxTokens = 0, retryConfig = {}) => {
    try{
      const onRedirect = this._trackRedirect();
      const refused = this._endpointRefused();
      if (refused) return refused;
      const tempFloat = parseFloat(this.temperature);
      const curr_headers = {
        "Content-Type": "application/json",
      };
      if(this.apiKey !== '') curr_headers["Authorization"] = "Bearer "+ this.apiKey;

      try {
        const response = await fetchWithRetry(this.host + (this.use_v1 ? "/v1" : "") + "/chat/completions", {
            method: "POST",
            headers: this._headers(curr_headers),
            // The user-supplied extra data is spread first on purpose: every
            // parameter ThunderAI manages must win over it, so a wrong entry
            // cannot change the model or break the streaming.
            // reasoning_effort is the one exception, set before it: an extra body
            // entry wins, so a value the option does not offer (e.g. "max" for
            // GLM) can still be sent [#1044].
            body: JSON.stringify({
                ...(this.reasoning_effort !== '' ? { 'reasoning_effort': this.reasoning_effort } : {}),
                ...parseExtraBody(this.extra_body),
                model: this.model,
                messages: messages,
                stream: this.stream,
                // Streamed chat completions emit the `usage` object ONLY when the
                // request asks for it, and the parameter is meaningless (some
                // servers reject an unknown field outright) on a non-streamed call,
                // so it is sent only while streaming. This must degrade gracefully:
                // several compatible backends -- llama.cpp, LM Studio, a few
                // OpenRouter models -- ignore it or never send usage anyway, and the
                // request has to succeed all the same, with extractUsage() simply
                // returning null.
                ...(this.stream ? { 'stream_options': { 'include_usage': true } } : {}),
                ...(maxTokens > 0 ? { 'max_tokens': parseInt(maxTokens) } : {}),
                ...(this.temperature != '' && !Number.isNaN(tempFloat) ? { 'temperature': tempFloat } : {})
            }),
        }, { label: 'OpenAI Comp', timeoutMs: OPENAI_COMP_CHAT_TIMEOUT_MS, ...retryConfig, onRedirect });
        return response;
      }catch (error) {
          console.error("[ThunderAI] OpenAI Comp API request failed: " + error);
          let output = {};
          output.is_exception = true;
          output.is_redirect = isRedirectFailed(error);
          output.is_aborted = retryConfig.signal?.aborted === true;
          output.ok = false;
          output.error = "OpenAI Comp API request failed: " + error;
          return output;
      }
    }catch (error) {
        console.error("[ThunderAI] OpenAI Comp API request failed: " + error);
        let output = {};
        output.is_exception = true;
        output.is_redirect = isRedirectFailed(error);
        output.ok = false;
        output.error = "OpenAI Comp API request failed: " + error;
        return output;
    }
  }

}
