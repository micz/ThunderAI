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

import { parseExtraBody } from './api-utils.js';
import { getOpenAIModelCapabilities } from './openai_model_capabilities.js';

// The API rejects a max_output_tokens below this value, so a smaller number is
// treated as "not configured" rather than sent and refused.
export const OPENAI_MIN_MAX_OUTPUT_TOKENS = 16;


export class OpenAI {

  apiKey = '';
  model = '';
  developer_messages = '';
  temperature = '';
  stream = false;
  store = false;
  reasoning_summary = '';
  reasoning_effort = '';
  extra_body = '';
  max_output_tokens = 0;
  verbosity = '';
  text_format = '';
  text_format_schema_name = '';
  text_format_schema = '';
  top_p = '';
  truncation = '';
  prompt_cache_key = '';
  service_tier = '';
  safety_identifier = '';
  include_encrypted_reasoning = false;

  constructor({
    apiKey = '',
    model = '',
    developer_messages = '',
    temperature = '',
    stream = false,
    store = false,
    reasoning_summary = '',
    reasoning_effort = '',
    extra_body = '',
    max_output_tokens = 0,
    verbosity = '',
    text_format = '',
    text_format_schema_name = '',
    text_format_schema = '',
    top_p = '',
    truncation = '',
    prompt_cache_key = '',
    service_tier = '',
    safety_identifier = '',
    include_encrypted_reasoning = false
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.developer_messages = developer_messages;
    this.temperature = temperature;
    this.stream = stream;
    this.store = store;
    this.reasoning_summary = reasoning_summary;
    this.reasoning_effort = reasoning_effort;
    this.extra_body = extra_body;
    this.max_output_tokens = max_output_tokens;
    this.verbosity = verbosity;
    this.text_format = text_format;
    this.text_format_schema_name = text_format_schema_name;
    this.text_format_schema = text_format_schema;
    this.top_p = top_p;
    this.truncation = truncation;
    this.prompt_cache_key = prompt_cache_key;
    this.service_tier = service_tier;
    this.safety_identifier = safety_identifier;
    this.include_encrypted_reasoning = include_encrypted_reasoning;
  }


  // The structured output schema, as an object, or null when it cannot be used.
  // parseExtraBody() is deliberately not reused here: it falls back to {}, and {}
  // is itself a valid JSON Schema, so a malformed textarea would silently send an
  // empty schema instead of dropping the format.
  _parseTextFormatSchema = () => {
    if(typeof this.text_format_schema !== 'string' || this.text_format_schema.trim() === ''){
      return null;
    }
    try{
      const parsed = JSON.parse(this.text_format_schema);
      if(parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)){
        console.warn("[ThunderAI] OpenAI text format schema is not a JSON object, ignoring it.");
        return null;
      }
      return parsed;
    }catch(error){
      console.warn("[ThunderAI] OpenAI text format schema is not valid JSON, ignoring it: " + error);
      return null;
    }
  }

  // The `text.format` object, or null when nothing valid is configured.
  // json_schema needs both a name and a schema: a partial object is a hard 400,
  // so an incomplete configuration drops the format entirely rather than sending
  // half of it.
  _buildTextFormat = () => {
    if(this.text_format === 'json_object'){
      return { type: 'json_object' };
    }
    if(this.text_format === 'json_schema'){
      const schema_name = (this.text_format_schema_name || '').trim();
      const schema = this._parseTextFormatSchema();
      if(schema_name === '' || schema === null){
        console.warn("[ThunderAI] OpenAI json_schema format needs both a name and a valid schema, ignoring it.");
        return null;
      }
      return { type: 'json_schema', name: schema_name, schema: schema };
    }
    return null;
  }


  fetchModels = async () => {
    try{
      const response = await fetch("https://api.openai.com/v1/models", {
          method: "GET",
          headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer "+ this.apiKey
          },
      });

      if (!response.ok) {
          const errorDetail = await response.text();
          let err_msg = "[ThunderAI] OpenAI API request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail;
          console.error(err_msg);
          let output = {};
          output.ok = false;
          output.error = errorDetail;
          return output;
      }

      let output = {};
      output.ok = true;
      let output_response = await response.json();
      output.response = output_response.data.filter(item => item.id.startsWith('gpt-') || item.id.startsWith('o1-') || item.id.startsWith('o4-') || item.id.startsWith('o3-')).sort((a, b) => b.id.localeCompare(a.id));

      return output;
    }catch (error) {
      console.error("[ThunderAI] OpenAI API request failed: " + error);
      let output = {};
      output.is_exception = true;
      output.ok = false;
      output.error = "OpenAI API request failed: " + error;
      return output;
    }
  }

  fetchResponse = async (messages, previous_response_id = null) => {

    const input = messages.map(msg => ({
      role: msg.role,
      content: [{ type: "input_text", text: msg.content }]
    }));

    // Which parameters this model actually accepts. Sending one it rejects is a
    // hard 400, so the gated fields below are checked against the table.
    const caps = getOpenAIModelCapabilities(this.model);

    const tempFloat = parseFloat(this.temperature);
    const topPFloat = parseFloat(this.top_p);
    const maxOutputTokensInt = parseInt(this.max_output_tokens);

    // The reasoning object is sent only when at least one of its properties has been
    // configured: models without reasoning support reject it, so an empty configuration
    // must leave the request body untouched.
    const reasoning_obj = caps.supportsReasoning ? {
              ...(this.reasoning_summary != '' ? { 'summary': this.reasoning_summary } : {}),
              ...(this.reasoning_effort != '' ? { 'effort': this.reasoning_effort } : {})
          } : {}

    // The text object follows the same defensive rule as the reasoning one: it is
    // built first and only emitted when something is actually configured, so models
    // that reject it keep the request body they had before this option existed.
    const text_format_obj = this._buildTextFormat();
    const text_obj = {
              ...(caps.supportsVerbosity && this.verbosity != '' ? { 'verbosity': this.verbosity } : {}),
              ...(text_format_obj !== null ? { 'format': text_format_obj } : {})
          }

    // A capability-gated parameter is dropped from the extra body as well: the
    // whole point of the gating is that the selected model answers a 400 to it, and
    // a field left out of the body literal because the model rejects it would
    // otherwise be re-introduced by a stale extra_body entry -- turning a gated
    // field into the exact error the table exists to prevent.
    const extra_body_obj = parseExtraBody(this.extra_body);
    if(!caps.supportsSamplingParams){
      delete extra_body_obj.temperature;
      delete extra_body_obj.top_p;
    }
    if(!caps.supportsReasoning){
      delete extra_body_obj.reasoning;
    }
    // `verbosity` lives inside the text object, so the whole object is dropped
    // rather than the key: a text object ThunderAI also builds is replaced by the
    // literal below anyway, and one it does not build cannot be merged safely.
    if(!caps.supportsVerbosity && extra_body_obj.text !== null && typeof extra_body_obj.text === 'object'
       && 'verbosity' in extra_body_obj.text){
      delete extra_body_obj.text;
    }

    // The user-supplied extra data is spread first on purpose: every parameter
    // ThunderAI manages must win over it, so a wrong entry cannot change the
    // model or break the streaming.
    let request_body = {
              ...extra_body_obj,
              model: this.model,
              input: input,
              stream: this.stream,
              store: this.store,
              ...(caps.supportsSamplingParams && this.temperature != '' && !Number.isNaN(tempFloat) ? { 'temperature': tempFloat } : {}),
              ...(caps.supportsSamplingParams && this.top_p != '' && !Number.isNaN(topPFloat) ? { 'top_p': topPFloat } : {}),
              ...(!Number.isNaN(maxOutputTokensInt) && maxOutputTokensInt >= OPENAI_MIN_MAX_OUTPUT_TOKENS ? { 'max_output_tokens': maxOutputTokensInt } : {}),
              ...(this.truncation != '' ? { 'truncation': this.truncation } : {}),
              ...(this.prompt_cache_key != '' ? { 'prompt_cache_key': this.prompt_cache_key } : {}),
              ...(this.service_tier != '' ? { 'service_tier': this.service_tier } : {}),
              ...(this.safety_identifier != '' ? { 'safety_identifier': this.safety_identifier } : {}),
              // Only ever sent when asked for: an empty include array is not a
              // valid request.
              ...(this.include_encrypted_reasoning ? { 'include': ['reasoning.encrypted_content'] } : {}),
              ...(previous_response_id && this.store ? { 'previous_response_id': previous_response_id } : {}),
              ...(Object.keys(reasoning_obj).length > 0 ? { 'reasoning': reasoning_obj } : {}),
              ...(Object.keys(text_obj).length > 0 ? { 'text': text_obj } : {})
          }

    if(this.developer_messages !== ''){
       request_body.instructions = this.developer_messages;
    }

    // console.log(">>>>>>>>>>> OpenAI API request: " + JSON.stringify(messages));

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { 
              "Content-Type": "application/json", 
              Authorization: "Bearer "+ this.apiKey
          },
          body: JSON.stringify(request_body),
      });
      return response;
    }catch (error) {
        console.error("[ThunderAI] OpenAI Responses API request failed: " + error);
        let output = {};
        output.is_exception = true;
        output.ok = false;
        output.error = "OpenAI Responses API request failed: " + error;
        return output;
    }
  }

}