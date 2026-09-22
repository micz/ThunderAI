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

// Per-model Claude API capability table.
//
// Derived from the official Anthropic documentation:
//   https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting
//     (the authoritative per-model thinking configuration table)
//   https://platform.claude.com/docs/en/build-with-claude/effort
//   https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
//   https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5
//
// Newer models changed three request-body behaviours, and sending a parameter a
// model no longer accepts is a hard 400, not a silently ignored field:
//   - `temperature` / `top_p` / `top_k` are rejected from Sonnet 5 / Opus 4.7 on.
//   - `thinking: {type:'enabled', budget_tokens: N}` is rejected from Sonnet 5 /
//     Opus 4.7 on, and deprecated on the 4.6 generation.
//   - Thinking is ON by default when `thinking` is omitted on the newest models,
//     so "no extended thinking" must now be requested explicitly.
//
// THIS TABLE MUST BE UPDATED AS NEW MODELS SHIP. A model ID that matches no
// entry falls back to ANTHROPIC_MODERN_CAPABILITIES below, and a parameter the
// table gets wrong is dropped by the one-shot retry on a 400 in anthropic.js.

// The five effort levels, in ascending order. Used both to validate a stored
// value and to build the options page selector.
export const ANTHROPIC_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

// The effort level assumed to be in force when no `output_config` is sent, used
// only by effortBlocksDisabledThinking() in anthropic.js. Defaults differ per
// model (e.g. Opus 5.5 defaults to 'medium') and can change without notice, so
// ThunderAI must never rely on this to decide what to send: a level the user
// picked is always sent, and only the empty "Default" option omits the field.
export const ANTHROPIC_DEFAULT_EFFORT = 'high';

// Users can type an arbitrary model ID into the options page, and new models
// ship faster than this table is updated. Unknown IDs are therefore assumed to
// follow the MODERN contract rather than the legacy one: guessing "modern"
// degrades a stale legacy setting into a valid (if slightly less configurable)
// request, while guessing "legacy" would send temperature/budget_tokens and earn
// a hard 400. This is a deliberate, conservative choice.
//
// For the same reason the fallback never sends `thinking: {type:'disabled'}`:
// newer models (Fable 5.x, Opus 5.5) reject it, while omitting `thinking` is
// always a valid request. The trade-off is that on an unknown model that thinks
// by default, thinking may consume part of max_tokens -- better than a 400.
export const ANTHROPIC_MODERN_CAPABILITIES = {
  thinkingModes: ['adaptive'],
  supportsBudgetTokens: false,
  supportsSamplingParams: false,
  supportsEffort: true,
  effortLevels: ANTHROPIC_EFFORT_LEVELS,
  defaultThinking: 'adaptive',
};

// An entry matches a model ID only when the ID equals its prefix, or is the
// prefix followed by a dated snapshot suffix (`-YYYYMMDD`, as in
// claude-sonnet-4-5-20250929). A point release is NOT covered by its
// predecessor: 'claude-opus-5' does not match 'claude-opus-5-5', so a new model
// falls back to ANTHROPIC_MODERN_CAPABILITIES instead of inheriting rules that
// may no longer hold, and each point release needs its own entry. Entries are
// still sorted by descending prefix length at module load, so the lookup order
// never depends on the order they are declared in here.
//
// defaultThinking: what the API does when the `thinking` field is omitted.
//   'adaptive' -> thinking runs anyway (and eats into max_tokens)
//   'none'     -> no thinking, the pre-Sonnet-5 behaviour
// disabledThinkingMaxEffort: present only where `thinking: {type:'disabled'}` is
//   accepted merely up to a given effort level (Opus 5 rejects it at xhigh/max).
const ANTHROPIC_MODEL_CAPABILITIES = [

  // --- Sonnet ---
  {
    prefix: 'claude-sonnet-5',
    capabilities: {
      thinkingModes: ['adaptive', 'disabled'],
      supportsBudgetTokens: false,
      supportsSamplingParams: false,
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultThinking: 'adaptive',
    },
  },
  {
    // budget_tokens is deprecated here but still functional.
    prefix: 'claude-sonnet-4-6',
    capabilities: {
      thinkingModes: ['adaptive', 'enabled', 'disabled'],
      supportsBudgetTokens: true,
      supportsSamplingParams: true,
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'max'],
      defaultThinking: 'none',
    },
  },
  {
    // Legacy contract: budget_tokens is the only thinking mode, effort errors.
    prefix: 'claude-sonnet-4-5',
    capabilities: {
      thinkingModes: ['enabled', 'disabled'],
      supportsBudgetTokens: true,
      supportsSamplingParams: true,
      supportsEffort: false,
      effortLevels: [],
      defaultThinking: 'none',
    },
  },

  // --- Opus ---
  {
    // Thinking cannot be disabled on this model: {type:'disabled'} is rejected.
    prefix: 'claude-opus-5-5',
    capabilities: {
      thinkingModes: ['adaptive'],
      supportsBudgetTokens: false,
      supportsSamplingParams: false,
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultThinking: 'adaptive',
    },
  },
  {
    prefix: 'claude-opus-5',
    capabilities: {
      thinkingModes: ['adaptive', 'disabled'],
      supportsBudgetTokens: false,
      supportsSamplingParams: false,
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultThinking: 'adaptive',
      disabledThinkingMaxEffort: 'high',
    },
  },
  {
    prefix: 'claude-opus-4-8',
    capabilities: {
      thinkingModes: ['adaptive', 'disabled'],
      supportsBudgetTokens: false,
      supportsSamplingParams: false,
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultThinking: 'none',
    },
  },
  {
    prefix: 'claude-opus-4-7',
    capabilities: {
      thinkingModes: ['adaptive', 'disabled'],
      supportsBudgetTokens: false,
      supportsSamplingParams: false,
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultThinking: 'none',
    },
  },
  {
    // budget_tokens is deprecated here but still functional.
    prefix: 'claude-opus-4-6',
    capabilities: {
      thinkingModes: ['adaptive', 'enabled', 'disabled'],
      supportsBudgetTokens: true,
      supportsSamplingParams: true,
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'max'],
      defaultThinking: 'none',
    },
  },
  {
    // Legacy contract, but effort is supported here (low/medium/high only).
    prefix: 'claude-opus-4-5',
    capabilities: {
      thinkingModes: ['enabled', 'disabled'],
      supportsBudgetTokens: true,
      supportsSamplingParams: true,
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high'],
      defaultThinking: 'none',
    },
  },

  // --- Haiku ---
  {
    prefix: 'claude-haiku-4-5',
    capabilities: {
      thinkingModes: ['enabled', 'disabled'],
      supportsBudgetTokens: true,
      supportsSamplingParams: true,
      supportsEffort: false,
      effortLevels: [],
      defaultThinking: 'none',
    },
  },

  // --- Fable / Mythos ---
  // Thinking cannot be turned off on these: {type:'disabled'} is rejected, so
  // the only valid options are adaptive or omitting the field.
  {
    prefix: 'claude-fable-5-1',
    capabilities: {
      thinkingModes: ['adaptive'],
      supportsBudgetTokens: false,
      supportsSamplingParams: false,
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultThinking: 'adaptive',
    },
  },
  {
    prefix: 'claude-fable-5',
    capabilities: {
      thinkingModes: ['adaptive'],
      supportsBudgetTokens: false,
      supportsSamplingParams: false,
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultThinking: 'adaptive',
    },
  },
  {
    prefix: 'claude-mythos-5-1',
    capabilities: {
      thinkingModes: ['adaptive'],
      supportsBudgetTokens: false,
      supportsSamplingParams: false,
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultThinking: 'adaptive',
    },
  },
  {
    prefix: 'claude-mythos-5',
    capabilities: {
      thinkingModes: ['adaptive'],
      supportsBudgetTokens: false,
      supportsSamplingParams: false,
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultThinking: 'adaptive',
    },
  },
  {
    prefix: 'claude-mythos-preview',
    capabilities: {
      thinkingModes: ['adaptive'],
      supportsBudgetTokens: false,
      supportsSamplingParams: false,
      supportsEffort: true,
      effortLevels: ['low', 'medium', 'high', 'max'],
      defaultThinking: 'adaptive',
    },
  },

];

// Longest prefix first. With boundary-aware matching at most one entry can match
// a given ID, so this only keeps the lookup deterministic.
const ANTHROPIC_MODEL_CAPABILITIES_SORTED =
  [...ANTHROPIC_MODEL_CAPABILITIES].sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Returns the capability descriptor for a Claude model ID.
 * An entry matches the exact ID or its dated snapshot (`<prefix>-YYYYMMDD`);
 * any other suffix -- including a point release such as '-5' or '-6' -- does
 * not match. An empty, missing or unrecognized ID returns
 * ANTHROPIC_MODERN_CAPABILITIES.
 *
 * @param {string} modelId
 * @returns {object} capability descriptor
 */
export function getAnthropicModelCapabilities(modelId) {
  if (typeof modelId !== 'string' || modelId.trim() === '') {
    return ANTHROPIC_MODERN_CAPABILITIES;
  }
  const id = modelId.trim();
  const entry = ANTHROPIC_MODEL_CAPABILITIES_SORTED.find(e =>
    id === e.prefix
    || (id.startsWith(e.prefix) && /^-\d{8}$/.test(id.slice(e.prefix.length))));
  return entry ? entry.capabilities : ANTHROPIC_MODERN_CAPABILITIES;
}
