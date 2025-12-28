/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2025  Mic (m@micz.it)

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


export class OpenAIComp {

  host = '';
  model = '';
  apiKey = '';
  use_v1 = true;
  stream = false;
  openai_comp_temperature = '';

  constructor({
    host = '',
    model = '',
    apiKey = '',
    stream = false,
    use_v1 = true,
    openai_comp_temperature = '',
  } = {}) {
    this.host = (host || '').trim().replace(/\/+$/, "");
    this.model = model;
    this.stream = stream;
    this.apiKey = apiKey;
    this.use_v1 = use_v1;
    this.openai_comp_temperature = openai_comp_temperature;
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
        let err_msg = "[ThunderAI] OpenAI API Comp request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail;
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
      const curr_headers = {
        "Content-Type": "application/json",
      };
      if(this.apiKey !== '') curr_headers["Authorization"] = "Bearer "+ this.apiKey;

      try {
        const response = await fetch(this.host + (this.use_v1 ? "/v1" : "") + "/chat/completions", {
            method: "POST",
            headers: curr_headers,
            body: JSON.stringify({ 
                model: this.model, 
                messages: messages,
                stream: this.stream,
                ...(maxTokens > 0 ? { 'max_tokens': parseInt(maxTokens) } : {}),
                ...(parseFloat(this.openai_comp_temperature) != NaN ? { 'temperature': parseFloat(this.openai_comp_temperature) } : {})
            }),
        });
        return response;
      }catch (error) {
          console.error("[ThunderAI] OpenAI API Comp request failed: " + error);
          let output = {};
          output.is_exception = true;
          output.ok = false;
          output.error = "OpenAI API Comp request failed: " + error;
          return output;
      }
    }catch (error) {
        console.error("[ThunderAI] OpenAI API Comp request failed: " + error);
        let output = {};
        output.is_exception = true;
        output.ok = false;
        output.error = "OpenAI API Comp request failed: " + error;
        return output;
    }
  }

}
