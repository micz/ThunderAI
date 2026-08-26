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
// entry falls back to ANTHROPIC_MODERN_CAPABILITIES below.

// The five effort levels, in ascending order. Used both to validate a stored
// value and to build the options page selector.
export const ANTHROPIC_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

// `high` is the API default: sending it is equivalent to omitting `output_config`
// entirely, so we omit it. Kept as a named constant so this is easy to change if
// the default ever moves.
export const ANTHROPIC_DEFAULT_EFFORT = 'high';

// Users can type an arbitrary model ID into the options page, and new models
// ship faster than this table is updated. Unknown IDs are therefore assumed to
// follow the MODERN contract rather than the legacy one: guessing "modern"
// degrades a stale legacy setting into a valid (if slightly less configurable)
// request, while guessing "legacy" would send temperature/budget_tokens and earn
// a hard 400. This is a deliberate, conservative choice.
export const ANTHROPIC_MODERN_CAPABILITIES = {
  thinkingModes: ['adaptive', 'disabled'],
  supportsBudgetTokens: false,
  supportsSamplingParams: false,
  supportsEffort: true,
  effortLevels: ANTHROPIC_EFFORT_LEVELS,
  defaultThinking: 'adaptive',
};

// Matched by model ID prefix, so dated variants (claude-sonnet-4-5-20250929)
// resolve to their family. Entries are sorted by descending prefix length at
// module load, so a longer, more specific prefix always wins regardless of the
// order they are declared in here.
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

// Longest prefix first, so 'claude-opus-4-8' can never be shadowed by a shorter
// entry that happens to be declared earlier.
const ANTHROPIC_MODEL_CAPABILITIES_SORTED =
  [...ANTHROPIC_MODEL_CAPABILITIES].sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Returns the capability descriptor for a Claude model ID.
 * Matching is by prefix, so dated variants resolve to their family.
 * An empty, missing or unrecognized ID returns ANTHROPIC_MODERN_CAPABILITIES.
 *
 * @param {string} modelId
 * @returns {object} capability descriptor
 */
export function getAnthropicModelCapabilities(modelId) {
  if (typeof modelId !== 'string' || modelId.trim() === '') {
    return ANTHROPIC_MODERN_CAPABILITIES;
  }
  const id = modelId.trim();
  const entry = ANTHROPIC_MODEL_CAPABILITIES_SORTED.find(e => id.startsWith(e.prefix));
  return entry ? entry.capabilities : ANTHROPIC_MODERN_CAPABILITIES;
}
