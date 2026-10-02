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


// Accept legacy checkbox values and the string values saved by the select.
export function normalizeOllamaThink(value) {
    if (value === null || value === 'null') return null;
    if (value === true || value === 1) return true;
    if (typeof value !== 'string') return false;
    if (value === '' || value === 'false' || value === 'off') return false;
    if (value === 'true') return true;
    return value;
}

export function getOllamaThinkingValues(thinking) {
    return Array.isArray(thinking?.values)
        ? [...new Set(thinking.values.filter(value => typeof value === 'boolean' || (typeof value === 'string' && value !== '')))]
        : [];
}

export function resolveOllamaThink(value, thinking) {
    const think = normalizeOllamaThink(value);
    // An explicit Off must not become the model's potentially enabled default.
    if (think === false) return false;
    return getOllamaThinkingValues(thinking).includes(think) ? think : null;
}

export class Ollama {
    host = '';
    model = '';
    stream = false;
    num_ctx = 0;
    temperature = '';
    think = false;
    format_json = false;

    constructor({
      host = '',
      model = '',
      stream = false,
      num_ctx = 0,
      temperature = '',
      think = false,
      format_json = false,
    } = {}) {
      this.host = (host || '').trim().replace(/\/+$/, "");
      this.model = model;
      this.stream = stream;
      this.num_ctx = num_ctx;
      this.temperature = temperature;
      this.think = normalizeOllamaThink(think);
      this.format_json = format_json;
    }

    fetchModels = async () => {
      try{
        const response = await fetch(this.host + "/api/tags", {
            method: "GET",
            headers: {
                "Content-Type": "application/json"
            },
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

    
    fetchModelInfo = async () => {
      try {
        const response = await fetch(this.host + "/api/show", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return { ok: false, error: `${response.status} ${await response.text()}` };
        const data = await response.json();
        if (data?.error) return { ok: false, error: String(data.error) };
        return { ok: true, response: data };
      } catch (error) {
        console.error("[ThunderAI] Ollama model information request failed: " + error);
        return { ok: false, is_exception: true, error: String(error) };
      }
    }

    fetchResponse = async (messages) => {
      try {
        // Validate stored settings too, including prompts used without opening their UI.
        let think = this.think === false ? false : null;
        if (this.think !== null && this.think !== false) {
          const info = await this.fetchModelInfo();
          if (info.ok) think = resolveOllamaThink(this.think, info.response?.thinking);
        }
        const tempFloat = parseFloat(this.temperature);
        //console.log(">>>>>>>>>>  messages: " +JSON.stringify(messages));
        const response = await fetch(this.host + "/api/chat", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json", 
            },
            body: JSON.stringify({ 
                model: this.model, 
                messages: messages,
                stream: this.stream,
                ...(think !== null ? { think } : {}),
                ...(this.format_json ? { format: "json" } : {}),
                ...(this.num_ctx > 0 ? { options: { num_ctx: parseInt(this.num_ctx) } } : {}),
                ...(this.temperature != '' && !Number.isNaN(tempFloat) ? { options: { temperature: tempFloat } } : {}),
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
