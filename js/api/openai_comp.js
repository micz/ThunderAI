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
import { createUsageData } from './mzta-api-usage.js';

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


export class OpenAIComp {

  host = '';
  model = '';
  apiKey = '';
  use_v1 = true;
  stream = false;
  temperature = '';
  extra_body = '';

  constructor({
    host = '',
    model = '',
    apiKey = '',
    stream = false,
    use_v1 = true,
    temperature = '',
    extra_body = '',
  } = {}) {
    this.host = (host || '').trim().replace(/\/+$/, "");
    this.model = model;
    this.stream = stream;
    this.apiKey = apiKey;
    this.use_v1 = use_v1;
    this.temperature = temperature;
    this.extra_body = extra_body;
  }


  fetchModels = async () => {
    const curr_headers = {
      "Content-Type": "application/json",
    };
    if(this.apiKey !== '') curr_headers["Authorization"] = "Bearer "+ this.apiKey;
    
    if(this.host.includes('openrouter.ai')) {
      curr_headers['HTTP-Referer'] = 'https://micz.it/thunderbird-addon-thunderai/';
      curr_headers['X-Title'] = 'ThunderAI';
    }

    const response = await fetch(this.host + (this.use_v1 ? "/v1" : "") + "/models", {
        method: "GET",
        headers: curr_headers,
    });

    if (!response.ok) {
        const errorDetail = await response.text();
        let err_msg = "[ThunderAI] OpenAI Comp API request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail;
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
  }

  fetchResponse = async (messages, maxTokens = 0) => {
    try{
      const tempFloat = parseFloat(this.temperature);
      const curr_headers = {
        "Content-Type": "application/json",
      };
      if(this.apiKey !== '') curr_headers["Authorization"] = "Bearer "+ this.apiKey;

      try {
        const response = await fetch(this.host + (this.use_v1 ? "/v1" : "") + "/chat/completions", {
            method: "POST",
            headers: curr_headers,
            // The user-supplied extra data is spread first on purpose: every
            // parameter ThunderAI manages must win over it, so a wrong entry
            // cannot change the model or break the streaming.
            body: JSON.stringify({
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
        });
        return response;
      }catch (error) {
          console.error("[ThunderAI] OpenAI Comp API request failed: " + error);
          let output = {};
          output.is_exception = true;
          output.ok = false;
          output.error = "OpenAI Comp API request failed: " + error;
          return output;
      }
    }catch (error) {
        console.error("[ThunderAI] OpenAI Comp API request failed: " + error);
        let output = {};
        output.is_exception = true;
        output.ok = false;
        output.error = "OpenAI Comp API request failed: " + error;
        return output;
    }
  }

}
