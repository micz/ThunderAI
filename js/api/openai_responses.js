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


export class OpenAI {

  apiKey = '';
  model = '';
  developer_messages = '';
  temperature = '';
  stream = false;
  store = false;

  constructor({
    apiKey = '',
    model = '',
    developer_messages = '',
    temperature = '',
    stream = false,
    store = false
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.developer_messages = developer_messages;
    this.temperature = temperature;
    this.stream = stream;
    this.store = store;
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

  fetchResponse = async (messages, maxTokens = 0, previous_response_id = null) => {

    const input = messages.map(msg => ({
      role: msg.role,
      content: [{ type: "input_text", text: msg.content }]
    }));

    let request_body = { 
              model: this.model, 
              input: input,
              stream: this.stream,
              store: this.store,
              ...(this.temperature != '' ? { 'temperature': this.temperature } : {}),
              ...(maxTokens > 0 ? { 'max_output_tokens': parseInt(maxTokens) } : {}),
              ...(previous_response_id && this.store ? { 'previous_response_id': previous_response_id } : {})
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