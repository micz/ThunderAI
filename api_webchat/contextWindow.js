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

// The context window of the model a chat window talks to, for the Context row
// of the usage popover. Always what the provider or the configuration states, never a
// guess from a hardcoded per-model table: when nothing states it the result is
// null and the popover shows the context count without a maximum.
//
// Every function here resolves to a positive number or null and never throws: a
// failed lookup must not disturb the chat, it only costs the bar.

import { Ollama } from '../js/api/ollama.js';
import { GoogleGemini } from '../js/api/google_gemini.js';
import { Anthropic } from '../js/api/anthropic.js';

function positive(value) {
    const n = Number(value);
    return (Number.isFinite(n) && n > 0) ? Math.floor(n) : null;
}

// Ollama names a model "name:tag" and fills in ":latest" when the tag is omitted,
// so "llama3" in the settings is the "llama3:latest" that /api/ps lists.
function sameOllamaModel(a, b) {
    const norm = (m) => {
        const s = (typeof m === 'string') ? m.trim() : '';
        if (s === '') return null;
        return s.includes(':') ? s : s + ':latest';
    };
    const na = norm(a);
    return na !== null && na === norm(b);
}

// Ollama, most to least authoritative:
//   1. num_ctx in the ThunderAI settings -- sent with every request, so it wins
//   2. /api/ps context_length -- what the server runs the loaded model with; the
//      model is loaded once an answer has come back, which is when this is called
//   3. num_ctx in the Modelfile parameters, from /api/show
//   4. <arch>.context_length in /api/show model_info -- the model's maximum, the
//      right figure for a cloud model, which /api/ps does not list
async function resolveOllama(prefs) {
    const configured = positive(prefs.ollama_num_ctx);
    if (configured !== null) return configured;

    const api = new Ollama({ host: prefs.ollama_host, api_key: prefs.ollama_api_key, model: prefs.ollama_model });
    const model = prefs.ollama_model;

    const ps = await api.fetchRunningModels();
    if (ps.ok && Array.isArray(ps.response?.models)) {
        const running = ps.response.models.find(m => sameOllamaModel(m?.model, model) || sameOllamaModel(m?.name, model));
        const ctx = positive(running?.context_length);
        if (ctx !== null) return ctx;
    }

    const show = await api.fetchModelInfo(model);
    if (!show.ok || show.response === null || typeof show.response !== 'object') return null;
    const params = typeof show.response.parameters === 'string' ? show.response.parameters : '';
    const match = params.match(/^\s*num_ctx\s+(\d+)\s*$/m);
    if (match) {
        const ctx = positive(match[1]);
        if (ctx !== null) return ctx;
    }
    const info = show.response.model_info;
    if (info !== null && typeof info === 'object') {
        for (const [key, value] of Object.entries(info)) {
            if (key.endsWith('.context_length')) {
                const ctx = positive(value);
                if (ctx !== null) return ctx;
            }
        }
    }
    return null;
}

async function resolveGemini(prefs) {
    const api = new GoogleGemini({ apiKey: prefs.google_gemini_api_key, model: prefs.google_gemini_model });
    const res = await api.fetchModelInfo(prefs.google_gemini_model);
    return res.ok ? positive(res.response?.inputTokenLimit) : null;
}

async function resolveAnthropic(prefs) {
    const api = new Anthropic({ apiKey: prefs.anthropic_api_key, version: prefs.anthropic_version, model: prefs.anthropic_model });
    const res = await api.fetchModelInfo(prefs.anthropic_model);
    return res.ok ? positive(res.response?.max_input_tokens) : null;
}

/**
 * The context window of the configured model, or null when nothing states it.
 * The OpenAI APIs expose no context window at all, so they always get null.
 *
 * @param {string} integration 'ollama', 'google_gemini', 'anthropic', ...
 * @param {object} prefs the prefs the chat window loaded for that integration
 * @returns {Promise<number|null>}
 */
export async function resolveContextWindow(integration, prefs) {
    try {
        switch (integration) {
            case 'ollama': return await resolveOllama(prefs);
            case 'google_gemini': return await resolveGemini(prefs);
            case 'anthropic': return await resolveAnthropic(prefs);
            default: return null;
        }
    } catch (error) {
        console.warn('[ThunderAI] The model context window could not be read, the usage popover will show the context without a maximum: ' + error);
        return null;
    }
}
