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
  stream = false;
  store = false;

  constructor(apiKey, model, developer_messages, stream, store) {
    this.apiKey = apiKey;
    this.model = model;
    this.developer_messages = developer_messages;
    this.stream = stream;
    this.store = store;
    this.adaptiveStreaming = true; // Enable adaptive streaming based on request size
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
      output.response = output_response.data.filter(item => item.id.startsWith('gpt-')).sort((a, b) => b.id.localeCompare(a.id));

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

  fetchResponse = async (messages, maxTokens = 0) => {
   
    if(this.developer_messages !== ''){
       messages.push({role: "developer", content: [{"type": "text", "text": this.developer_messages}]});
    }


    // console.log(">>>>>>>>>>> OpenAI API request: " + JSON.stringify(messages));
    
    // Determine if we should use streaming based on request complexity
    const messageLength = messages.map(m => m.content).join('').length;
    const shouldStream = this.stream && (messageLength > 500 || !this.adaptiveStreaming);
    
    const requestBody = { 
        model: this.model, 
        messages: messages,
        stream: shouldStream,
        store: this.store,
        ...(maxTokens > 0 ? { 'max_tokens': parseInt(maxTokens) } : {})
    };

    try {

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: headers,
          body: bodyString,
      });
      
      return response;
    }catch (error) {
        console.error("[ThunderAI] OpenAI API request failed: " + error);
        let output = {};
        output.is_exception = true;
        output.ok = false;
        output.error = "OpenAI API request failed: " + error;
        return output;
    }
  }

  async countTokensUsingAPI(model, text) {
    const response = await fetch('https://api.openai.com/v1/engines/'+model+'/tokenizer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.apiKey
      },
      body: JSON.stringify({ text })
    });
    
    const data = await response.json();
    return data.token_count;
  }

}