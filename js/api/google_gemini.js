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

export class GoogleGemini {

  apiKey = '';
  model = '';
  system_instruction = '';
  stream = false;
  thinking_budget = ''; // Model default
  temperature = ''; // no temperature defined
  max_output_tokens = 0; // 0 means unset: let the model decide
  // Kept as strings, not numbers: an empty pref must stay distinguishable from a
  // legitimate 0, which is a valid value for both.
  top_p = '';
  top_k = '';
  extra_body = '';

  constructor({
    apiKey = '',
    model = '',
    system_instruction = '',
    stream = false,
    thinking_budget = '',
    temperature = '',
    max_output_tokens = 0,
    top_p = '',
    top_k = '',
    extra_body = '',
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.system_instruction = system_instruction;
    this.stream = stream;
    this.thinking_budget = String(thinking_budget ?? '').trim();
    this.temperature = String(temperature ?? '').trim();
    this.max_output_tokens = max_output_tokens;
    this.top_p = String(top_p ?? '').trim();
    this.top_k = String(top_k ?? '').trim();
    this.extra_body = extra_body;
    /* Info from: https://ai.google.dev/gemini-api/docs/thinking?#set-budget
      # Turn on thinking with a specific token limit: "thinking_budget": 1024
      # Thinking off: "thinking_budget": 0
      # Turn on dynamic thinking: "thinking_budget": -1
      # Keep model default thinking: "thinking_budget": ""
      Note that this budget only governs how much the model reasons. Whether the
      reasoning is returned to us is a separate flag, includeThoughts, set in
      fetchResponse().
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

      // Two-level merge: the parameters ThunderAI manages live inside the nested
      // generationConfig object, so a single root-level spread would let a user's
      // generationConfig silently wipe out thinkingConfig and temperature (or the
      // reverse). The extra body is therefore spread at the root AND, separately,
      // inside generationConfig, with the managed keys applied last at both levels
      // so they always win. A user can add root keys such as safetySettings or
      // tools, but can never override contents or system_instruction.
      const parsedExtraBody = parseExtraBody(this.extra_body);
      const extraGenerationConfig = (parsedExtraBody.generationConfig !== null
        && typeof parsedExtraBody.generationConfig === 'object'
        && !Array.isArray(parsedExtraBody.generationConfig))
          ? parsedExtraBody.generationConfig : {};

      let google_gemini_body = {
        ...parsedExtraBody,
        contents: messages,
        generationConfig: { ...extraGenerationConfig },
      };

      // console.log("[ThunderAI] Google Gemini API system_instruction: " + JSON.stringify(this.system_instruction));

      if(this.system_instruction !== '') {
        google_gemini_body.system_instruction = {
          parts:{
            text: this.system_instruction
          }
        };
      }

      // thinkingBudget and includeThoughts are independent: the first decides how
      // much the model reasons, the second whether that reasoning is returned at
      // all. Without includeThoughts the API bills the thinking tokens
      // (usageMetadata.thoughtsTokenCount) but emits no part flagged
      // thought: true, so the webchat has nothing to show.
      // The whole thinkingConfig is omitted unless the user expressed a
      // preference: models with no thinking support (the Gemini 2.0 family)
      // reject the key outright with an HTTP 400, so an empty budget must leave
      // the request untouched and let the model decide. The trade-off is that a
      // thinking-capable model reasoning on its own default is no longer asked
      // for includeThoughts, so its thinking block is not shown in the webchat
      // unless a budget is set -- preferable to breaking non-thinking models.
      const thinkingBudget = parseInt(this.thinking_budget);
      const hasBudget = this.thinking_budget !== '' && !Number.isNaN(thinkingBudget);

      const thinkingConfig = {};
      // Omitted on a model default so the model keeps choosing, and on an
      // unparsable preference so a bad value is never forwarded as-is.
      if(hasBudget) {
        thinkingConfig.thinkingBudget = thinkingBudget;
      }
      // A budget of 0 disables thinking, so there would be no thoughts to ask for.
      if(!hasBudget || thinkingBudget !== 0) {
        thinkingConfig.includeThoughts = true;
      }
      if(hasBudget && Object.keys(thinkingConfig).length > 0) {
        google_gemini_body.generationConfig.thinkingConfig = thinkingConfig;
      }

      const tempFloat = parseFloat(this.temperature);

      if(this.temperature != '' && !Number.isNaN(tempFloat)) {
        google_gemini_body.generationConfig.temperature = tempFloat;
      }

      const maxOutputTokensInt = parseInt(this.max_output_tokens);

      if(!Number.isNaN(maxOutputTokensInt) && maxOutputTokensInt > 0) {
        google_gemini_body.generationConfig.maxOutputTokens = maxOutputTokensInt;
      }

      const topPFloat = parseFloat(this.top_p);

      if(this.top_p !== '' && !Number.isNaN(topPFloat)) {
        google_gemini_body.generationConfig.topP = topPFloat;
      }

      const topKInt = parseInt(this.top_k);

      if(this.top_k !== '' && !Number.isNaN(topKInt)) {
        google_gemini_body.generationConfig.topK = topKInt;
      }

      //  console.log(">>>>>>>>>>>>>>>>> [ThunderAI] Google Gemini API request: " + JSON.stringify(google_gemini_body));

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