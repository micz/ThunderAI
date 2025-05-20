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


export class Anthropic {

  apiKey = '';
  version = '';
  model = '';
  developer_messages = '';
  stream = false;

  constructor(apiKey, version, model, developer_messages, stream) {
    this.apiKey = apiKey;
    this.version = version;
    this.model = model;
    this.developer_messages = developer_messages;
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
          let err_msg = "[ThunderAI] Anthropic API request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail;
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
      console.error("[ThunderAI] Anthropic API request failed: " + error);
      let output = {};
      output.is_exception = true;
      output.ok = false;
      output.error = "Anthropic API request failed: " + error;
      return output;
    }
  }

  fetchResponse = async (messages, maxTokens = 0) => {

    if(this.developer_messages !== ''){
       messages.push({role: "developer", content: [{"type": "text", "text": this.developer_messages}]});
    }

    // console.log(">>>>>>>>>>> Anthropic API request: " + JSON.stringify(messages));

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { 
              "Content-Type": "application/json", 
              "x-api-key": this.apiKey,
              "anthropic-version": this.version,
          },
          body: JSON.stringify({ 
              model: this.model, 
              messages: messages,
              stream: this.stream,
              ...(maxTokens > 0 ? { 'max_tokens': parseInt(maxTokens) } : {})
          }),
      });
      return response;
    }catch (error) {
        console.error("[ThunderAI] Anthropic API request failed: " + error);
        let output = {};
        output.is_exception = true;
        output.ok = false;
        output.error = "Anthropic API request failed: " + error;
        return output;
    }
  }

}