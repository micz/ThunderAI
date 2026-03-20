import { preparePromptsForExport } from '../js/mzta-prompts.js';

describe('preparePromptsForExport', () => {
  // Helper: create a custom prompt with integration keys
  function makeCustomPrompt(overrides = {}) {
    return {
      id: 'custom_1',
      is_default: 0,
      idnum: 5,
      text: 'Do something',
      enabled: 1,
      api_type: '',
      chatgpt_api_key: 'key1',
      chatgpt_model: 'gpt-5',
      ollama_host: 'http://localhost',
      ollama_model: 'llama3',
      ...overrides,
    };
  }

  // Helper: create a default prompt
  function makeDefaultPrompt(overrides = {}) {
    return {
      id: 'prompt_reply',
      is_default: 1,
      idnum: 1,
      text: 'Reply to this email',
      enabled: 1,
      position_compose: 1,
      position_display: 2,
      need_custom_text: 0,
      api_type: '',
      chatgpt_api_key: 'key1',
      chatgpt_model: 'gpt-5',
      ollama_host: 'http://localhost',
      ...overrides,
    };
  }

  it('removes api_type and integration keys when include_api_settings is false', () => {
    const prompts = [makeCustomPrompt()];
    const result = preparePromptsForExport(prompts, false);
    expect(result[0]).not.toHaveProperty('api_type');
    expect(result[0]).not.toHaveProperty('chatgpt_api_key');
    expect(result[0]).not.toHaveProperty('chatgpt_model');
    expect(result[0]).not.toHaveProperty('ollama_host');
    expect(result[0]).not.toHaveProperty('ollama_model');
    expect(result[0].text).toBe('Do something');
  });

  it('removes idnum from custom prompts', () => {
    const prompts = [makeCustomPrompt()];
    const result = preparePromptsForExport(prompts, false);
    expect(result[0]).not.toHaveProperty('idnum');
  });

  it('for default prompts, keeps only allowed keys when include_api_settings is false', () => {
    const prompts = [makeDefaultPrompt()];
    const result = preparePromptsForExport(prompts, false);
    const keys = Object.keys(result[0]);
    expect(keys).toContain('id');
    expect(keys).toContain('enabled');
    expect(keys).toContain('position_compose');
    expect(keys).toContain('position_display');
    expect(keys).toContain('need_custom_text');
    expect(keys).not.toContain('text');
    expect(keys).not.toContain('api_type');
    expect(keys).not.toContain('chatgpt_api_key');
  });

  it('keeps api_type when include_api_settings is true', () => {
    const prompts = [makeCustomPrompt({ api_type: 'chatgpt_api' })];
    const result = preparePromptsForExport(prompts, true);
    expect(result[0].api_type).toBe('chatgpt_api');
  });

  it('keeps only active integration keys when api_type is set and include_api_settings is true', () => {
    const prompts = [makeCustomPrompt({ api_type: 'chatgpt_api' })];
    const result = preparePromptsForExport(prompts, true);
    // chatgpt keys should remain (active integration = "chatgpt" from "chatgpt_api")
    expect(result[0]).toHaveProperty('chatgpt_api_key');
    expect(result[0]).toHaveProperty('chatgpt_model');
    // ollama keys should be removed
    expect(result[0]).not.toHaveProperty('ollama_host');
    expect(result[0]).not.toHaveProperty('ollama_model');
  });

  it('does not mutate the original array', () => {
    const original = [makeCustomPrompt()];
    const originalCopy = JSON.parse(JSON.stringify(original));
    preparePromptsForExport(original, false);
    expect(original).toEqual(originalCopy);
  });

  it('handles empty prompts array', () => {
    expect(preparePromptsForExport([], false)).toEqual([]);
  });
});
