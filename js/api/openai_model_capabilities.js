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

// Per-model OpenAI Responses API capability table.
//
// Derived from the official OpenAI documentation:
//   https://platform.openai.com/docs/api-reference/responses/create
//   https://platform.openai.com/docs/guides/reasoning
//   https://platform.openai.com/docs/guides/latest-model
//
// Sending a parameter a model does not accept is a hard 400 here too, not a
// silently ignored field:
//   - `temperature` and `top_p` are rejected by every reasoning model (the gpt-5
//     family and the o-series): they do not do sampling the way the chat models do.
//   - `text.verbosity` is understood only by the gpt-5 family.
//   - `reasoning` (summary / effort) is meaningful only on reasoning models; the
//     chat models reject it.
//
// Unlike Ollama there is no way to probe this at runtime: GET /v1/models returns
// only {id, object, created, owned_by} and there is no per-model metadata
// endpoint, so a local table is the only option.
//
// THIS TABLE MUST BE UPDATED AS NEW MODELS SHIP. A model ID that matches no
// entry falls back to OPENAI_PERMISSIVE_CAPABILITIES below.

// The reasoning effort levels accepted by the Responses API, in ascending order
// after the explicit "off" value. Used to build the options page selector.
export const OPENAI_REASONING_EFFORT_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

// The verbosity levels accepted by `text.verbosity`.
export const OPENAI_VERBOSITY_LEVELS = ['low', 'medium', 'high'];

// Users can type an arbitrary model ID into the options page, and new models ship
// faster than this table is updated. An unrecognized ID therefore allows
// everything rather than disabling fields wrongly: a field left enabled at worst
// produces an API error naming the parameter, while a field wrongly disabled
// hides a setting the user legitimately needs and gives no clue why. This is a
// deliberate, conservative choice.
export const OPENAI_PERMISSIVE_CAPABILITIES = {
  supportsSamplingParams: true,
  supportsReasoning: true,
  supportsVerbosity: true,
};

// Matched by model ID prefix, so dated and sized variants (gpt-5-mini,
// o3-2025-04-16) resolve to their family. Entries are sorted by descending prefix
// length at module load, so a longer, more specific prefix always wins regardless
// of the order they are declared in here.
const OPENAI_MODEL_CAPABILITIES = [

  // --- Reasoning models ---
  {
    // The only family that understands text.verbosity.
    prefix: 'gpt-5',
    capabilities: {
      supportsSamplingParams: false,
      supportsReasoning: true,
      supportsVerbosity: true,
    },
  },
  {
    prefix: 'o1',
    capabilities: {
      supportsSamplingParams: false,
      supportsReasoning: true,
      supportsVerbosity: false,
    },
  },
  {
    prefix: 'o3',
    capabilities: {
      supportsSamplingParams: false,
      supportsReasoning: true,
      supportsVerbosity: false,
    },
  },
  {
    prefix: 'o4',
    capabilities: {
      supportsSamplingParams: false,
      supportsReasoning: true,
      supportsVerbosity: false,
    },
  },

  // --- Chat models ---
  // These sample normally but have no reasoning stage at all, so `reasoning` and
  // `text.verbosity` are rejected.
  {
    prefix: 'gpt-4',
    capabilities: {
      supportsSamplingParams: true,
      supportsReasoning: false,
      supportsVerbosity: false,
    },
  },
  {
    // The ChatGPT-tuned variant of gpt-4o, listed separately because its ID does
    // not start with 'gpt-4'.
    prefix: 'chatgpt-4o',
    capabilities: {
      supportsSamplingParams: true,
      supportsReasoning: false,
      supportsVerbosity: false,
    },
  },
  {
    prefix: 'gpt-3.5',
    capabilities: {
      supportsSamplingParams: true,
      supportsReasoning: false,
      supportsVerbosity: false,
    },
  },

];

// Longest prefix first, so 'chatgpt-4o' can never be shadowed by a shorter entry
// that happens to be declared earlier.
const OPENAI_MODEL_CAPABILITIES_SORTED =
  [...OPENAI_MODEL_CAPABILITIES].sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Returns the capability descriptor for an OpenAI model ID.
 * Matching is by prefix, so dated and sized variants resolve to their family.
 * An empty, missing or unrecognized ID returns OPENAI_PERMISSIVE_CAPABILITIES.
 *
 * @param {string} modelId
 * @returns {object} capability descriptor
 */
export function getOpenAIModelCapabilities(modelId) {
  if (typeof modelId !== 'string' || modelId.trim() === '') {
    return OPENAI_PERMISSIVE_CAPABILITIES;
  }
  const id = modelId.trim();
  const entry = OPENAI_MODEL_CAPABILITIES_SORTED.find(e => id.startsWith(e.prefix));
  return entry ? entry.capabilities : OPENAI_PERMISSIVE_CAPABILITIES;
}
