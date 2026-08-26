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


export class Anthropic {

  apiKey = '';
  version = '';
  model = '';
  system_prompt = '';
  temperature = '';
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
    this.max_tokens = max_tokens > 0 ? max_tokens : 4096;
    this.extended_thinking_budget = extended_thinking_budget;
    this.effort = effort;
    this.stream = stream;
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

      let claude_body = {
              model: this.model,
              max_tokens: parseInt(this.max_tokens),
              system: this.system_prompt,
              messages: messages,
              stream: this.stream,
            };

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

      // Effort is omitted when it equals the API default, so an untouched
      // configuration keeps producing exactly the request body it produced before.
      const effort = (this.effort || '').trim();
      const effortIsValid = caps.supportsEffort && effort !== '' && caps.effortLevels.includes(effort);
      if(effortIsValid && effort !== ANTHROPIC_DEFAULT_EFFORT) {
        claude_body.output_config = { effort: effort };
      }

      const thinkingBudget = parseInt(this.extended_thinking_budget);
      const wantsThinking = !Number.isNaN(thinkingBudget) && thinkingBudget > 0;

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

      const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { 
              "Content-Type": "application/json", 
              "x-api-key": this.apiKey,
              "anthropic-version": this.version,
              "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify(claude_body),
      });
      return response;
    }catch (error) {
        console.error("[ThunderAI] Claude API request failed: " + error);
        let output = {};
        output.is_exception = true;
        output.ok = false;
        output.error = "Claude API request failed: " + error;
        return output;
    }
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
// of the hint explaining it. Order matters: the first match wins, and the more
// specific names are checked first so "thinking.type" is not swallowed by a
// looser match.
const ANTHROPIC_ERROR_HINTS = [
  { needle: 'budget_tokens', key: 'anthropic_err_hint_budget_tokens' },
  { needle: 'thinking.type', key: 'anthropic_err_hint_thinking_type' },
  { needle: 'temperature',   key: 'anthropic_err_hint_temperature' },
  { needle: 'top_p',         key: 'anthropic_err_hint_temperature' },
  { needle: 'top_k',         key: 'anthropic_err_hint_temperature' },
  { needle: 'effort',        key: 'anthropic_err_hint_effort' },
];

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
