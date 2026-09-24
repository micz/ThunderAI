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
  getAnthropicModelCapabilities,
  ANTHROPIC_EFFORT_LEVELS,
  ANTHROPIC_DEFAULT_EFFORT
} from './anthropic_model_capabilities.js';
import { createUsageData, isUsageDataEmpty, toUsageNumber } from './mzta-api-usage.js';

// Smallest extended thinking budget the Messages API accepts. Anything lower is
// rejected with a 400, so the request builder drops the budget below it and the
// options page warns about it -- both read this constant, so the two rules cannot
// drift apart.
export const ANTHROPIC_MIN_THINKING_BUDGET = 1024;

// The Messages API reports token usage on every response.
export const supportsUsageData = true;

/**
 * Normalize the usage the Messages API reports.
 *
 * The streamed usage is split across two events, so this returns a PARTIAL
 * object and the caller combines the pieces with mergeUsageData():
 *   - `message_start` carries the input tokens and the two cache counters, under
 *     event.message.usage;
 *   - `message_delta` carries the output tokens, under event.usage. That count is
 *     cumulative, so the last event simply wins.
 * A non-streamed body holds both halves in its top-level `usage` object and is
 * accepted by the same code path.
 *
 * Never throws: every access is guarded, because a partial or unexpected payload
 * must not break the stream it is being read from.
 *
 * @param {object} raw a stream event or a full response body
 * @returns {object|null} the normalized (possibly partial) usage, or null
 */
export function extractUsage(raw) {
  try{
    if(raw === null || typeof raw !== 'object') return null;

    // message_start nests both the usage and the model inside `message`; the other
    // shapes keep them at the top level.
    const source = (raw.message !== null && typeof raw.message === 'object') ? raw.message : raw;
    const usage = source.usage;
    if(usage === null || typeof usage !== 'object') return null;

    // Claude's input_tokens EXCLUDES the cached part: the documented total input is
    // input_tokens + cache_read_input_tokens + cache_creation_input_tokens. Every
    // other provider reports an input count that already includes its cached
    // tokens, and the normalized contract is "cached_input_tokens and
    // cache_creation_tokens are subsets of input_tokens", so the sum is taken here.
    // A cache counter that is absent adds nothing; a missing input_tokens stays null.
    const cache_read = toUsageNumber(usage.cache_read_input_tokens);
    const cache_creation = toUsageNumber(usage.cache_creation_input_tokens);
    let input_tokens = toUsageNumber(usage.input_tokens);
    if(input_tokens !== null){
      input_tokens += (cache_read ?? 0) + (cache_creation ?? 0);
    }

    const partial = createUsageData({
      provider: 'anthropic',
      model: source.model,
      input_tokens: input_tokens,
      output_tokens: usage.output_tokens,
      cached_input_tokens: cache_read,
      cache_creation_tokens: cache_creation,
    });

    // A usage object holding no counter at all -- some events carry an empty one --
    // is worth nothing to the caller and would only overwrite a model already known.
    return isUsageDataEmpty(partial) ? null : partial;
  }catch(error){
    console.warn("[ThunderAI] Claude usage data could not be read, ignoring it: " + error);
    return null;
  }
}


export class Anthropic {

  apiKey = '';
  version = '';
  model = '';
  system_prompt = '';
  temperature = '';
  top_p = '';
  top_k = '';
  stop_sequences = '';
  max_tokens = 4096;
  extended_thinking_budget = 0;
  effort = '';
  stream = false;

  constructor({
    apiKey = '',
    version = '',
    model = '',
    system_prompt = '',
    temperature = '',
    top_p = '',
    top_k = '',
    stop_sequences = '',
    max_tokens = 4096,
    extended_thinking_budget = 0,
    effort = '',
    stream = false,
  } = {}) {
    this.apiKey = apiKey;
    this.version = version;
    this.model = model;
    this.system_prompt = system_prompt;
    this.temperature = temperature;
    this.top_p = top_p;
    this.top_k = top_k;
    this.stop_sequences = stop_sequences;
    this.max_tokens = max_tokens > 0 ? max_tokens : 4096;
    this.extended_thinking_budget = extended_thinking_budget;
    this.effort = effort;
    this.stream = stream;
  }


  /**
   * GET /v1/models/{model_id} -- one model's metadata, notably max_input_tokens
   * (the context window). Same result contract as fetchModels(), with the
   * ModelInfo object as the response.
   */
  fetchModelInfo = async (model) => {
    try{
      const response = await fetch("https://api.anthropic.com/v1/models/" + encodeURIComponent(model), {
          method: "GET",
          headers: {
              "Content-Type": "application/json",
              "x-api-key": this.apiKey,
              "anthropic-version": this.version,
          },
      });

      if (!response.ok) {
          const errorDetail = await response.text();
          console.error("[ThunderAI] Claude API request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail);
          let output = {};
          output.ok = false;
          output.error = errorDetail;
          return output;
      }

      let output = {};
      output.ok = true;
      output.response = await response.json();
      return output;
    }catch (error) {
      console.error("[ThunderAI] Claude API request failed: " + error);
      let output = {};
      output.is_exception = true;
      output.ok = false;
      output.error = "Claude API request failed: " + error;
      return output;
    }
  }

  fetchModels = async () => {
    try{
      const response = await fetch("https://api.anthropic.com/v1/models", {
          method: "GET",
          headers: {
              "Content-Type": "application/json",
              "x-api-key": this.apiKey,
              "anthropic-version": this.version,
          },
      });

      if (!response.ok) {
          const errorDetail = await response.text();
          let err_msg = "[ThunderAI] Claude API request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail;
          console.error(err_msg);
          let output = {};
          output.ok = false;
          output.error = errorDetail;
          return output;
      }

      let output = {};
      output.ok = true;
      let output_response = await response.json();
      output.response = output_response.data;

      return output;
    }catch (error) {
      console.error("[ThunderAI] Claude API request failed: " + error);
      let output = {};
      output.is_exception = true;
      output.ok = false;
      output.error = "Claude API request failed: " + error;
      return output;
    }
  }

  fetchResponse = async (messages) => {

    try {

      const maxTokens = parseInt(this.max_tokens);

      let claude_body = {
              model: this.model,
              max_tokens: maxTokens,
              messages: messages,
              stream: this.stream,
            };

      // An unset system prompt must omit the field, not send an empty string:
      // an empty system block carries no instruction and is rejected outright by
      // some model versions.
      const systemPrompt = String(this.system_prompt ?? '').trim();
      if(systemPrompt !== '') {
        claude_body.system = systemPrompt;
      }

      // Which parameters this model actually accepts. Sending one it rejects is
      // a hard 400, so every field below is gated on the capability table.
      const caps = getAnthropicModelCapabilities(this.model);

      // Sampling params are independent of the thinking configuration now: on a
      // model that accepts them the user's value is sent whatever thinking does,
      // and on a model that rejects them it is never sent at all. The stored
      // value is left untouched either way, so switching back to an older model
      // restores it.
      const tempFloat = parseFloat(this.temperature);
      if(caps.supportsSamplingParams && this.temperature != '' && !Number.isNaN(tempFloat)) {
        claude_body.temperature = tempFloat;
      }

      // top_p and top_k follow exactly the same rule, and are sent independently
      // of each other and of temperature. The API accepts the combination -- it
      // only advises against it -- so there is deliberately no mutual exclusion
      // here: silently dropping one of two values the user explicitly set would
      // be the more surprising behaviour.
      const topPFloat = parseFloat(this.top_p);
      if(caps.supportsSamplingParams && this.top_p != '' && !Number.isNaN(topPFloat)) {
        claude_body.top_p = topPFloat;
      }

      const topKInt = parseInt(this.top_k);
      if(caps.supportsSamplingParams && this.top_k != '' && !Number.isNaN(topKInt)) {
        claude_body.top_k = topKInt;
      }

      // Not capability-gated: every model accepts stop_sequences. Stored as one
      // sequence per line; blank lines are dropped here rather than at save time,
      // so the user's formatting of the textarea is left alone.
      const stopSequences = String(this.stop_sequences ?? '')
        .split(/\r?\n/)
        .map(seq => seq.trim())
        .filter(seq => seq !== '');
      if(stopSequences.length > 0) {
        claude_body.stop_sequences = stopSequences;
      }

      // A level the user picked is always sent, even one that looks like the API
      // default: defaults differ per model and can change without notice, so
      // omitting it would silently ignore an explicit choice. Only the empty
      // "Default (decided by the API)" option, which is the stored default,
      // leaves the field out.
      const effort = (this.effort || '').trim();
      const effortIsValid = caps.supportsEffort && effort !== '' && caps.effortLevels.includes(effort);
      if(effortIsValid) {
        claude_body.output_config = { effort: effort };
      }

      // The API constrains the budget on both sides: it must be at least
      // ANTHROPIC_MIN_THINKING_BUDGET and strictly below max_tokens. Violating
      // either is a hard 400, and with the default max_tokens of 4096 both are
      // easy to hit by hand. A budget that fails a constraint is treated as "no
      // extended thinking" and falls through to the disabled/omitted logic below,
      // so the request stays valid. The stored pref is never rewritten -- the user
      // may raise max_tokens later and expect their budget back.
      const thinkingBudget = parseInt(this.extended_thinking_budget);
      let wantsThinking = !Number.isNaN(thinkingBudget) && thinkingBudget > 0;

      if(wantsThinking && thinkingBudget < ANTHROPIC_MIN_THINKING_BUDGET) {
        console.warn("[ThunderAI] Anthropic: extended thinking budget " + thinkingBudget
          + " is below the API minimum of " + ANTHROPIC_MIN_THINKING_BUDGET
          + " tokens; extended thinking will not be requested.");
        wantsThinking = false;
      } else if(wantsThinking && !Number.isNaN(maxTokens) && thinkingBudget >= maxTokens) {
        console.warn("[ThunderAI] Anthropic: extended thinking budget " + thinkingBudget
          + " must be lower than max_tokens (" + maxTokens
          + "); extended thinking will not be requested.");
        wantsThinking = false;
      }

      if(wantsThinking && caps.supportsBudgetTokens && caps.thinkingModes.includes('enabled')) {
        claude_body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
      } else if(!wantsThinking && caps.defaultThinking === 'adaptive'
                && caps.thinkingModes.includes('disabled')
                && !effortBlocksDisabledThinking(caps, effortIsValid ? effort : ANTHROPIC_DEFAULT_EFFORT)) {
        // A budget of 0 has always meant "no extended thinking". On models where
        // thinking runs unless told otherwise, that intent has to be sent
        // explicitly now, or max_tokens gets spent on thinking and truncates the
        // reply. Only sent where it changes something: on models that already
        // default to no thinking the field stays omitted, so their request bodies
        // are byte-identical to what they were before.
        claude_body.thinking = { type: 'disabled' };
      }
      // Every other combination -- a budget set on a model that rejects
      // budget_tokens, thinking off on a model that cannot turn it off -- omits
      // the field entirely, which is always a valid request.

      // console.log(">>>>>>>>>>>>>>>>> [ThunderAI] Anthropic API request: " + JSON.stringify(claude_body));

      const response = await this._postMessages(claude_body);
      if(response.status !== 400) return response;

      // Safety net for a table that lags behind the API: a 400 naming a parameter
      // we actually sent is retried exactly once without it. The 400 arrives
      // before any stream data, so this works for streaming requests too. The
      // error body is read from a clone, so when there is nothing to drop -- or
      // the retry fails as well -- the original response is returned unread and
      // the worker reports it with the describeAnthropicError() hint as before.
      let errorMessage = '';
      try {
        const errorJSON = await response.clone().json();
        errorMessage = errorJSON?.error?.message ?? '';
      } catch(e) {
        return response;
      }
      const dropped = dropRejectedParams(claude_body, errorMessage);
      if(!dropped) return response;

      console.warn("[ThunderAI] Anthropic: model " + this.model + " rejected the request (400);"
        + " retrying once without: " + dropped.params.join(", ") + ". Detail: " + errorMessage);
      try {
        const retryResponse = await this._postMessages(dropped.body);
        return retryResponse.ok ? retryResponse : response;
      } catch(e) {
        return response;
      }
    }catch (error) {
        console.error("[ThunderAI] Claude API request failed: " + error);
        let output = {};
        output.is_exception = true;
        output.ok = false;
        output.error = "Claude API request failed: " + error;
        return output;
    }
  }

  _postMessages = (claude_body) => {
    return fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { 
            "Content-Type": "application/json", 
            "x-api-key": this.apiKey,
            "anthropic-version": this.version,
            "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(claude_body),
    });
  }

}

/**
 * True when `thinking: {type:'disabled'}` must not be sent because the resolved
 * effort level outranks what this model accepts alongside it. Opus 5 rejects the
 * combination at xhigh/max; models without the restriction never block.
 *
 * @param {object} caps capability descriptor
 * @param {string} effort the effort level that will actually be in force
 * @returns {boolean}
 */
function effortBlocksDisabledThinking(caps, effort) {
  if(!caps.disabledThinkingMaxEffort) return false;
  const maxIdx = ANTHROPIC_EFFORT_LEVELS.indexOf(caps.disabledThinkingMaxEffort);
  const curIdx = ANTHROPIC_EFFORT_LEVELS.indexOf(effort);
  if(maxIdx === -1 || curIdx === -1) return false;
  return curIdx > maxIdx;
}

// Maps a parameter name that can appear in a 400 error message to the i18n key
// of the hint explaining it, and to the top-level request fields the retry in
// fetchResponse() drops. Order matters: the first match wins, and the more
// specific names are checked first so "thinking.type" is not swallowed by a
// looser match. The bare 'output_config' and 'thinking' needles come last, as
// catch-alls for messages that name the field rather than the sub-property:
// 'thinking' in particular also appears in messages about other parameters
// ("temperature is not supported with thinking").
//
// The three sampling params are dropped together: they share one capability,
// so a model that rejects one rejects all of them, and dropping them one at a
// time would spend the single retry on a request that is bound to fail again.
const ANTHROPIC_SAMPLING_PARAMS = ['temperature', 'top_p', 'top_k'];
const ANTHROPIC_ERROR_HINTS = [
  { needle: 'budget_tokens', key: 'anthropic_err_hint_budget_tokens', drop: ['thinking'] },
  { needle: 'thinking.type', key: 'anthropic_err_hint_thinking_type', drop: ['thinking'] },
  { needle: 'temperature',   key: 'anthropic_err_hint_temperature',   drop: ANTHROPIC_SAMPLING_PARAMS },
  { needle: 'top_p',         key: 'anthropic_err_hint_temperature',   drop: ANTHROPIC_SAMPLING_PARAMS },
  { needle: 'top_k',         key: 'anthropic_err_hint_temperature',   drop: ANTHROPIC_SAMPLING_PARAMS },
  { needle: 'effort',        key: 'anthropic_err_hint_effort',        drop: ['output_config'] },
  { needle: 'output_config', key: 'anthropic_err_hint_effort',        drop: ['output_config'] },
  { needle: 'thinking',      key: 'anthropic_err_hint_thinking_type', drop: ['thinking'] },
];

/**
 * Finds the first ANTHROPIC_ERROR_HINTS entry whose needle appears in a 400
 * message and whose fields are actually in the request body, and returns a copy
 * of the body without them. Returns null when the message names nothing we sent,
 * in which case retrying could not change the outcome.
 *
 * @param {object} claude_body the request body that was rejected
 * @param {string} detailMessage the message text returned by the API
 * @returns {{body: object, params: string[]}|null}
 */
function dropRejectedParams(claude_body, detailMessage) {
  if(!detailMessage) return null;
  const haystack = String(detailMessage).toLowerCase();
  for(const hint of ANTHROPIC_ERROR_HINTS) {
    if(!haystack.includes(hint.needle)) continue;
    const params = hint.drop.filter(param => param in claude_body);
    if(params.length === 0) continue;
    const body = { ...claude_body };
    params.forEach(param => delete body[param]);
    return { body, params };
  }
  return null;
}

/**
 * Prepends a localized hint to a 400 error detail when the API message names a
 * parameter that is incompatible with the selected model. Falls back to the raw
 * detail when the message is not recognized.
 *
 * The hints are passed in rather than read from browser.i18n, because this runs
 * inside a Web Worker where that API is unavailable -- same reason the worker
 * already carries i18nStrings for "anthropic_api_request_failed".
 *
 * @param {string} detailMessage the message text returned by the API
 * @param {string} model the model ID the request was sent with
 * @param {object} i18nStrings localized strings, keyed by message name
 * @returns {string}
 */
export function describeAnthropicError(detailMessage, model, i18nStrings) {
  if(!detailMessage) return detailMessage;
  const haystack = String(detailMessage).toLowerCase();
  const hint = ANTHROPIC_ERROR_HINTS.find(h => haystack.includes(h.needle));
  if(!hint) return detailMessage;
  let hint_text = (i18nStrings && i18nStrings[hint.key]) ? i18nStrings[hint.key] : '';
  if(hint_text === '') return detailMessage;
  if(model) hint_text = hint_text.replace('$MODEL$', model);
  return hint_text + " " + detailMessage;
}
