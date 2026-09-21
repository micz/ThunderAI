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


import { parseExtraBody } from './api-utils.js';


export class Ollama {
    host = '';
    apiKey = '';
    model = '';
    stream = false;
    num_ctx = 0;
    temperature = '';
    think = '';
    format_json = false;
    keep_alive = '';
    system_prompt = '';
    extra_options = '';

    constructor({
      host = '',
      api_key = '',
      model = '',
      stream = false,
      num_ctx = 0,
      temperature = '',
      think = '',
      format_json = false,
      keep_alive = '',
      system_prompt = '',
      extra_options = '',
    } = {}) {
      this.host = (host || '').trim().replace(/\/+$/, "");
      this.apiKey = (api_key || '').trim();
      this.model = model;
      this.stream = stream;
      this.num_ctx = num_ctx;
      this.temperature = temperature;
      this.think = normalizeThink(think);
      this.format_json = format_json;
      this.keep_alive = (keep_alive || '').trim();
      // Not used when building the body: the worker prepends it as a system
      // message. Declared here so the generic `ollama_` config sweep in
      // model-worker-ollama.js does not drop it.
      this.system_prompt = system_prompt;
      this.extra_options = extra_options;
    }

    // Headers shared by every endpoint. The key is optional: it covers both the
    // hosted API at ollama.com and a self-hosted server behind a reverse proxy
    // that adds authentication.
    _headers = () => {
      const headers = { "Content-Type": "application/json" };
      if (this.apiKey !== '') headers["Authorization"] = "Bearer " + this.apiKey;
      return headers;
    }

    fetchModels = async () => {
      try{
        const response = await fetch(this.host + "/api/tags", {
            method: "GET",
            headers: this._headers(),
        });

        if (!response.ok) {
            const errorDetail = await response.text();
            let err_msg = "[ThunderAI] Ollama API request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail;
            console.error(err_msg);
            let output = {};
            output.ok = false;
            output.error = errorDetail;
            return output;
        }

        let output = {};
        output.ok = true;
        let output_response = await response.json();
        output.response = output_response;

        //console.log(">>>>>>>>>> output_response: " + JSON.stringify(output_response));

        return output;
      }catch (error) {
        console.error("[ThunderAI] Ollama API request failed: " + error);
        let output = {};
        output.is_exception = true;
        output.ok = false;
        output.error = "Ollama API request failed: " + error;
        return output;
      }
    }

    
    fetchResponse = async (messages) => {
      try {
        const tempFloat = parseFloat(this.temperature);

        // Both num_ctx and temperature live under the same "options" key: they must be
        // merged into a single object, otherwise one silently overwrites the other.
        //
        // The user-supplied extra options are spread FIRST, so num_ctx and temperature
        // -- the two ThunderAI manages -- always win over a conflicting raw entry.
        // Unlike chatgpt_extra_body and openai_comp_extra_body, this one belongs inside
        // `options` rather than at the top level of the body: that is where Ollama takes
        // top_p, top_k, min_p, seed, num_predict, repeat_penalty, stop and num_keep.
        const options_obj = {
            ...parseExtraBody(this.extra_options),
            ...(this.num_ctx > 0 ? { num_ctx: parseInt(this.num_ctx) } : {}),
            ...(this.temperature != '' && !Number.isNaN(tempFloat) ? { temperature: tempFloat } : {}),
        };

        //console.log(">>>>>>>>>>  messages: " +JSON.stringify(messages));
        const response = await fetch(this.host + "/api/chat", {
            method: "POST",
            headers: this._headers(),
            body: JSON.stringify({
                model: this.model,
                messages: messages,
                stream: this.stream,
                // Omitted entirely when off: a model that takes no thinking level
                // rejects an explicit null, and `false` is not the same as absent
                // for servers that read the field's presence.
                ...(this.think !== '' ? { think: this.think === 'true' ? true : this.think } : {}),
                ...(this.format_json ? { format: "json" } : {}),
                ...(this.keep_alive !== '' ? { keep_alive: this.keep_alive } : {}),
                ...(Object.keys(options_obj).length > 0 ? { options: options_obj } : {}),
            }),
        });
        return response;
      }catch (error) {
          console.error("[ThunderAI] Ollama API request failed: " + error);
          let output = {};
          output.is_exception = true;
          output.ok = false;
          output.error = "Ollama API request failed: " + error;
          return output;
      }
    }

}

/**
 * Coerce a stored `think` value to the level format.
 *
 * `ollama_think` used to be a boolean checkbox: `true` meant "think", `false`
 * meant "don't". The pref is now a level ('' | 'true' | 'low' | 'medium' |
 * 'high' | 'max'), and a one-shot migration rewrites the global pref -- but a
 * legacy boolean can still arrive here from a per-prompt override, because the
 * config default is a string now and mzta-special-commands.js therefore no
 * longer coerces that key. Normalizing at construction covers every caller.
 *
 * @param {*} think the stored value, possibly a legacy boolean
 * @returns {string} '' when thinking is off, otherwise the level
 */
function normalizeThink(think) {
  if (think === true) return 'true';
  if (think === false || think === null || think === undefined) return '';
  return String(think);
}
