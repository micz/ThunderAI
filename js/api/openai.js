/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024  Mic (m@micz.it)

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

  constructor(apiKey) {
    this.apiKey = apiKey;
  }


  fetchModels = async () => {
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
        console.log(err_msg);
        throw new Error(err_msg);
    }
    return await response.json();
  }

  fetchResponse = async (model, messages, maxTokens) => {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { 
            "Content-Type": "application/json", 
            Authorization: "Bearer "+ this.apiKey
        },
        body: JSON.stringify({ 
            model, 
            messages: messages, 
            ...(maxTokens > 0 ? { 'max_tokens': parseInt(maxTokens) } : {})
        }),
    });

    if (!response.ok) {
        const errorDetail = await response.text();
        let err_msg = "[ThunderAI] OpenAI API request failed: " + response.status + " " + response.statusText + ", Detail: " + errorDetail;
        console.log(err_msg);
        throw new Error(err_msg);
    }

    const responseData = await response.json();
    return responseData.choices[0].message.content;
  }

}