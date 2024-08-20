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


export class Ollama {
    host = '';
    model = '';
    stream = false;
  
    constructor(host, model, stream = false) {
      this.host = host.trim().replace(/\/+$/, "");
      this.model = model;
      this.stream = stream;
    }

    fetchModels = async () => {
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
    }
}