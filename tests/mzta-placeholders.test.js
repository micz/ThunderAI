import {
  mapPlaceholderToSuggestion,
  prepareCustomDataPHsForExport,
  placeholdersUtils,
} from '../js/mzta-placeholders.js';

// ─── mapPlaceholderToSuggestion ──────────────────────────────────

describe('mapPlaceholderToSuggestion', () => {
  it('transforms non-dynamic placeholder', () => {
    const p = { id: 'mail_subject', type: 'default', is_dynamic: 0 };
    expect(mapPlaceholderToSuggestion(p)).toEqual({
      command: '{%mail_subject%}',
      type: 'default',
      is_dynamic: 0,
    });
  });

  it('transforms dynamic placeholder (adds colon)', () => {
    const p = { id: 'mail_headers', type: 'default', is_dynamic: 1 };
    expect(mapPlaceholderToSuggestion(p)).toEqual({
      command: '{%mail_headers:%}',
      type: 'default',
      is_dynamic: 1,
    });
  });
});

// ─── prepareCustomDataPHsForExport ───────────────────────────────

describe('prepareCustomDataPHsForExport', () => {
  it('removes idnum from non-default placeholders', () => {
    const placeholders = [
      { id: 'thunderai_custom_test', is_default: 0, idnum: 1, text: 'hello' },
    ];
    const result = prepareCustomDataPHsForExport(placeholders);
    expect(result[0]).not.toHaveProperty('idnum');
    expect(result[0].text).toBe('hello');
  });

  it('keeps idnum for default placeholders', () => {
    const placeholders = [
      { id: 'mail_subject', is_default: 1, idnum: 1 },
    ];
    const result = prepareCustomDataPHsForExport(placeholders);
    expect(result[0].idnum).toBe(1);
  });
});

// ─── placeholdersUtils ───────────────────────────────────────────

describe('placeholdersUtils.validateCustomDataPH_ID', () => {
  it('prepends prefix if missing', () => {
    expect(placeholdersUtils.validateCustomDataPH_ID('my_ph')).toBe('thunderai_custom_my_ph');
  });

  it('returns unchanged if prefix already present', () => {
    expect(placeholdersUtils.validateCustomDataPH_ID('thunderai_custom_my_ph')).toBe('thunderai_custom_my_ph');
  });
});

describe('placeholdersUtils.stripCustomDataPH_ID_Prefix', () => {
  it('removes prefix if present', () => {
    expect(placeholdersUtils.stripCustomDataPH_ID_Prefix('thunderai_custom_my_ph')).toBe('my_ph');
  });

  it('returns unchanged if prefix not present', () => {
    expect(placeholdersUtils.stripCustomDataPH_ID_Prefix('other_ph')).toBe('other_ph');
  });
});

describe('placeholdersUtils.hasPlaceholder', () => {
  it('detects any placeholder when no specific placeholder given', () => {
    expect(placeholdersUtils.hasPlaceholder('Hello {%mail_subject%}')).toBe(true);
  });

  it('returns false when no placeholder present', () => {
    expect(placeholdersUtils.hasPlaceholder('Hello world')).toBe(false);
  });

  it('detects specific placeholder', () => {
    expect(placeholdersUtils.hasPlaceholder('Text {%mail_subject%}', 'mail_subject')).toBe(true);
  });

  it('returns false for non-matching specific placeholder', () => {
    expect(placeholdersUtils.hasPlaceholder('Text {%mail_subject%}', 'author')).toBe(false);
  });

  it('detects dynamic placeholder with value', () => {
    expect(placeholdersUtils.hasPlaceholder('Header: {%mail_headers:X-Custom%}', 'mail_headers')).toBe(true);
  });
});

describe('placeholdersUtils.hasCustomPlaceholder', () => {
  it('detects thunderai_custom_ placeholders', () => {
    expect(placeholdersUtils.hasCustomPlaceholder('Text {%thunderai_custom_myph%}')).toBe(true);
  });

  it('returns false when none present', () => {
    expect(placeholdersUtils.hasCustomPlaceholder('Text {%mail_subject%}')).toBe(false);
  });

  it('checks specific custom placeholder', () => {
    expect(placeholdersUtils.hasCustomPlaceholder('{%thunderai_custom_test%}', 'thunderai_custom_test')).toBe(true);
    expect(placeholdersUtils.hasCustomPlaceholder('{%thunderai_custom_other%}', 'thunderai_custom_test')).toBe(false);
  });
});

describe('placeholdersUtils.getPlaceholdersAdditionalTextArray', () => {
  it('extracts additional_text placeholders', () => {
    const result = placeholdersUtils.getPlaceholdersAdditionalTextArray('Text {%additional_text%}');
    expect(result).toEqual([{ placeholder: '{%additional_text%}', info: '' }]);
  });

  it('extracts additional_text with custom info', () => {
    const result = placeholdersUtils.getPlaceholdersAdditionalTextArray('Text {%additional_text:Subject line%}');
    expect(result).toEqual([{ placeholder: '{%additional_text:Subject line%}', info: 'Subject line' }]);
  });

  it('deduplicates entries with same info', () => {
    const text = '{%additional_text:#1%} and {%additional_text:#1%}';
    const result = placeholdersUtils.getPlaceholdersAdditionalTextArray(text);
    expect(result).toHaveLength(1);
  });

  it('returns multiple entries with different info', () => {
    const text = '{%additional_text:#1%} and {%additional_text:#2%}';
    const result = placeholdersUtils.getPlaceholdersAdditionalTextArray(text);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when none found', () => {
    expect(placeholdersUtils.getPlaceholdersAdditionalTextArray('no placeholders')).toEqual([]);
  });
});

describe('placeholdersUtils.failSafePlaceholders', () => {
  it('returns empty string for null', () => {
    expect(placeholdersUtils.failSafePlaceholders(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(placeholdersUtils.failSafePlaceholders(undefined)).toBe('');
  });

  it('passes through strings unchanged', () => {
    expect(placeholdersUtils.failSafePlaceholders('hello')).toBe('hello');
  });

  it('passes through numbers unchanged', () => {
    expect(placeholdersUtils.failSafePlaceholders(42)).toBe(42);
  });

  it('passes through empty string', () => {
    expect(placeholdersUtils.failSafePlaceholders('')).toBe('');
  });
});

describe('placeholdersUtils.replacePlaceholders', () => {
  it('replaces known placeholders with provided values', () => {
    const result = placeholdersUtils.replacePlaceholders({
      text: 'Subject: {%mail_subject%}',
      replacements: { mail_subject: 'Test Email' },
    });
    expect(result).toBe('Subject: Test Email');
  });

  it('replaces multiple placeholders', () => {
    const result = placeholdersUtils.replacePlaceholders({
      text: 'From: {%author%}, Subject: {%mail_subject%}',
      replacements: { author: 'John', mail_subject: 'Hello' },
    });
    expect(result).toBe('From: John, Subject: Hello');
  });

  it('leaves unknown placeholders unchanged', () => {
    const result = placeholdersUtils.replacePlaceholders({
      text: 'Value: {%nonexistent_thing%}',
      replacements: {},
    });
    expect(result).toBe('Value: {%nonexistent_thing%}');
  });

  it('skips additional_text when skip_additional_text is true', () => {
    const result = placeholdersUtils.replacePlaceholders({
      text: 'Text: {%additional_text%}',
      replacements: { additional_text: 'replaced' },
      skip_additional_text: true,
    });
    expect(result).toBe('Text: {%additional_text%}');
  });

  it('skips additional_text with suffix when skip_additional_text is true', () => {
    const result = placeholdersUtils.replacePlaceholders({
      text: 'Text: {%additional_text:#1%}',
      replacements: {},
      skip_additional_text: true,
    });
    expect(result).toBe('Text: {%additional_text:#1%}');
  });

  it('handles empty args gracefully', () => {
    const result = placeholdersUtils.replacePlaceholders();
    expect(result).toBe('');
  });
});
