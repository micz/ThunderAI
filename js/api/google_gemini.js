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



export class GoogleGemini {

  apiKey = '';
  model = '';
  system_instruction = '';
  stream = false;
  thinking_budget = ''; // Model default

  constructor({
    apiKey = '',
    model = '',
    system_instruction = '',
    stream = false,
    thinking_budget = '',
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.system_instruction = system_instruction;
    this.stream = stream;
    this.thinking_budget = String(thinking_budget ?? '').trim();
    /* Info from: https://ai.google.dev/gemini-api/docs/thinking?#set-budget
      # Turn on thinking with a specific token limit: "thinking_budget": 1024
      # Thinking off: "thinking_budget": 0
      # Turn on dynamic thinking: "thinking_budget": -1
      # Keep model default thinking: "thinking_budget": ""
    */
  }


  fetchModels = async () => {
    try{
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + this.apiKey, {
          method: "GET",
          headers: {
              "Content-Type": "application/json"
          },
      });

      if (!response.ok) {
          const errorDetail = await response.text();
          let err_msg = "[ThunderAI] Google Gemini API request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail;
          console.error(err_msg);
          let output = {};
          output.ok = false;
          output.error = errorDetail;
          return output;
      }

      let output = {};
      output.ok = true;
      let output_response = await response.json();
      //console.log("[ThunderAI] Google Gemini API response: " + JSON.stringify(output_response));
      output.response = output_response.models;

      return output;
    }catch (error) {
      console.error("[ThunderAI] Google Gemini API request failed: " + error);
      let output = {};
      output.is_exception = true;
      output.ok = false;
      output.error = "Google Gemini API request failed: " + error;
      return output;
    }
  }
  
  fetchResponse = async (messages) => {
    try {

      let google_gemini_body = {
        contents:messages
      };

      // console.log("[ThunderAI] Google Gemini API system_instruction: " + JSON.stringify(this.system_instruction));

      if(this.system_instruction !== '') {
        google_gemini_body.system_instruction = {
          parts:{
            text: this.system_instruction
          }
        };
      }

      if(this.thinking_budget !== '') {
        google_gemini_body.generationConfig = {
          thinkingConfig: {
            thinking_budget: this.thinking_budget,
          }
        };
      }

      // console.log("[ThunderAI] Google Gemini API request: " + JSON.stringify(google_gemini_body));

      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + this.model + ":" + (this.stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?') + "key=" + this.apiKey, {
          method: "POST",
          headers: { 
              "Content-Type": "application/json"
          },
          body: JSON.stringify(google_gemini_body),
      });
      return response;
    }catch (error) {
        console.error("[ThunderAI] Google Gemini API request failed: " + error);
        let output = {};
        output.is_exception = true;
        output.ok = false;
        output.error = "Google Gemini API request failed: " + error;
        return output;
    }
  }

}