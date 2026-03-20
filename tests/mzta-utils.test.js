import {
  getLanguageDisplayName,
  sanitizeHtml,
  sanitizeMailHeaders,
  stripHtmlKeepLines,
  htmlBodyToPlainText,
  cleanupNewlines,
  convertNewlinesToBr,
  convertNewlinesToParagraphs,
  getGPTWebModelString,
  getMenuContextCompose,
  getMenuContextDisplay,
  checkIfTagLabelExists,
  normalizeStringList,
  prepareOriginURL,
  checkAPIIntegration,
  hasSpecificIntegration,
  extractJsonObject,
  isAPIKeyValue,
  validateChatGPTWebCustomData,
  sanitizeChatGPTModelData,
  sanitizeChatGPTWebCustomData,
  getActiveSpecialPromptsIDs,
  getConnectionType,
  getMailBody,
  generateCallID,
  ChatGPTWeb_models,
  fixMsgHeader,
  extractEmail,
  convertBrToNewlines,
  compareThunderbirdVersions,
  getTagsKeyFromLabel,
  sanitizeString,
  formatBytes,
} from '../js/mzta-utils.js';

// ─── Constants ───────────────────────────────────────────────────

describe('ChatGPTWeb_models', () => {
  it('is an array of model strings', () => {
    expect(Array.isArray(ChatGPTWeb_models)).toBe(true);
    expect(ChatGPTWeb_models.length).toBeGreaterThan(0);
    ChatGPTWeb_models.forEach(m => expect(typeof m).toBe('string'));
  });
});

describe('getMenuContextCompose', () => {
  it('returns compose_action_menu', () => {
    expect(getMenuContextCompose()).toBe('compose_action_menu');
  });
});

describe('getMenuContextDisplay', () => {
  it('returns message_display_action_menu', () => {
    expect(getMenuContextDisplay()).toBe('message_display_action_menu');
  });
});

// ─── String / HTML manipulation ──────────────────────────────────

describe('sanitizeHtml', () => {
  it('strips HTML tags but keeps <br>', () => {
    expect(sanitizeHtml('<p>Hello</p><br>World')).toBe('Hello<br>World');
  });

  it('keeps <br/> and <br /> variants', () => {
    expect(sanitizeHtml('A<br/>B<br />C')).toBe('A<br/>B<br />C');
  });

  it('passes through plain text unchanged', () => {
    expect(sanitizeHtml('just text')).toBe('just text');
  });

  it('handles empty string', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  it('strips nested tags', () => {
    expect(sanitizeHtml('<div><span>Hi</span></div>')).toBe('Hi');
  });
});

describe('sanitizeMailHeaders', () => {
  it('escapes < and > to HTML entities', () => {
    expect(sanitizeMailHeaders('user@example.com <User Name>')).toBe('user@example.com &lt;User Name&gt;');
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(sanitizeMailHeaders(null)).toBe('');
    expect(sanitizeMailHeaders(undefined)).toBe('');
    expect(sanitizeMailHeaders('')).toBe('');
  });

  it('handles strings without angle brackets', () => {
    expect(sanitizeMailHeaders('plain text')).toBe('plain text');
  });
});

describe('stripHtmlKeepLines', () => {
  it('converts </p> to newlines and removes <p>', () => {
    expect(stripHtmlKeepLines('<p>line1</p><p>line2</p>')).toBe('line1\nline2');
  });

  it('converts <br> to newlines', () => {
    expect(stripHtmlKeepLines('line1<br>line2')).toBe('line1\nline2');
  });

  it('removes other HTML tags', () => {
    expect(stripHtmlKeepLines('<b>bold</b> <i>italic</i>')).toBe('bold italic');
  });

  it('trims result', () => {
    expect(stripHtmlKeepLines('  <p>text</p>  ')).toBe('text');
  });
});

describe('htmlBodyToPlainText', () => {
  it('extracts text from simple HTML', () => {
    expect(htmlBodyToPlainText('<p>Hello World</p>')).toBe('Hello World');
  });

  it('removes style elements', () => {
    expect(htmlBodyToPlainText('<style>body{color:red}</style><p>text</p>')).toBe('text');
  });

  it('removes display:none elements', () => {
    expect(htmlBodyToPlainText('<div style="display:none">hidden</div><p>visible</p>')).toBe('visible');
  });

  it('handles empty string', () => {
    expect(htmlBodyToPlainText('')).toBe('');
  });
});

describe('cleanupNewlines', () => {
  it('normalizes \\r\\n to \\n', () => {
    expect(cleanupNewlines('a\r\nb')).toBe('a\nb');
  });

  it('collapses multiple newlines to one', () => {
    expect(cleanupNewlines('a\n\n\nb')).toBe('a\nb');
  });

  it('collapses spaces/tabs before newlines', () => {
    expect(cleanupNewlines('a   \nb')).toBe('a\nb');
  });

  it('replaces &nbsp; with space', () => {
    expect(cleanupNewlines('hello&nbsp;world')).toBe('hello world');
  });

  it('trims result', () => {
    expect(cleanupNewlines('  text  ')).toBe('text');
  });
});

describe('convertNewlinesToBr', () => {
  it('converts \\n to <br>', () => {
    expect(convertNewlinesToBr('a\nb')).toBe('a<br>b');
  });

  it('handles \\r\\n', () => {
    expect(convertNewlinesToBr('a\r\nb')).toBe('a<br>b');
  });

  it('handles multiple newlines', () => {
    expect(convertNewlinesToBr('a\n\nb')).toBe('a<br><br>b');
  });
});

describe('convertNewlinesToParagraphs', () => {
  it('wraps each line in <p> tags', () => {
    expect(convertNewlinesToParagraphs('line1\nline2')).toBe('<p>line1</p><p>line2</p>');
  });

  it('handles single line', () => {
    expect(convertNewlinesToParagraphs('single')).toBe('<p>single</p>');
  });
});

describe('convertBrToNewlines', () => {
  it('converts <br> to newlines', () => {
    expect(convertBrToNewlines('a<br>b')).toBe('a\nb');
  });

  it('handles <br/> and <br /> variants', () => {
    expect(convertBrToNewlines('a<br/>b<br />c')).toBe('a\nb\nc');
  });

  it('is case-insensitive', () => {
    expect(convertBrToNewlines('a<BR>b<Br>c')).toBe('a\nb\nc');
  });
});

// ─── Model / URL helpers ─────────────────────────────────────────

describe('getGPTWebModelString', () => {
  it('maps gpt-5 to "5"', () => {
    expect(getGPTWebModelString('gpt-5')).toBe('5');
  });

  it('maps gpt-5-instant to "5 Fast"', () => {
    expect(getGPTWebModelString('gpt-5-instant')).toBe('5 Fast');
  });

  it('maps gpt-5-t-mini to "5 Thinking mini"', () => {
    expect(getGPTWebModelString('gpt-5-t-mini')).toBe('5 Thinking mini');
  });

  it('maps gpt-5-thinking to "5 Thinking"', () => {
    expect(getGPTWebModelString('gpt-5-thinking')).toBe('5 Thinking');
  });

  it('returns model string for unknown models', () => {
    expect(getGPTWebModelString('custom-model')).toBe('custom-model');
  });

  it('returns empty string for falsy input', () => {
    expect(getGPTWebModelString(null)).toBe('');
    expect(getGPTWebModelString('')).toBe('');
    expect(getGPTWebModelString(undefined)).toBe('');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(getGPTWebModelString('  GPT-5  ')).toBe('5');
  });
});

describe('prepareOriginURL', () => {
  it('appends /* to URL without trailing slash', () => {
    expect(prepareOriginURL('https://example.com')).toBe('https://example.com/*');
  });

  it('appends * to URL with trailing slash', () => {
    expect(prepareOriginURL('https://example.com/')).toBe('https://example.com/*');
  });
});

// ─── Tag helpers ─────────────────────────────────────────────────

describe('checkIfTagLabelExists', () => {
  const tags = {
    tag1: { tag: 'Important' },
    tag2: { tag: 'Work' },
    tag3: { tag: 'Personal' },
  };

  it('finds tag case-insensitively', () => {
    expect(checkIfTagLabelExists('important', tags)).toBe(true);
    expect(checkIfTagLabelExists('IMPORTANT', tags)).toBe(true);
    expect(checkIfTagLabelExists('Important', tags)).toBe(true);
  });

  it('returns false when tag not found', () => {
    expect(checkIfTagLabelExists('missing', tags)).toBe(false);
  });

  it('handles empty tags list', () => {
    expect(checkIfTagLabelExists('any', {})).toBe(false);
  });
});

describe('getTagsKeyFromLabel', () => {
  const allTags = {
    key1: { tag: 'Important' },
    key2: { tag: 'Work' },
    key3: { tag: 'Personal' },
  };

  it('returns keys for matching labels', () => {
    expect(getTagsKeyFromLabel(['important', 'work'], allTags)).toEqual(['key1', 'key2']);
  });

  it('returns empty array for no matches', () => {
    expect(getTagsKeyFromLabel(['missing'], allTags)).toEqual([]);
  });

  it('handles empty input', () => {
    expect(getTagsKeyFromLabel([], allTags)).toEqual([]);
  });
});

// ─── List / string utilities ─────────────────────────────────────

describe('normalizeStringList', () => {
  it('deduplicates and sorts comma-separated input', () => {
    expect(normalizeStringList('b, a, c, a')).toBe('a, b, c');
  });

  it('deduplicates and sorts newline-separated input', () => {
    expect(normalizeStringList('b\na\nc\na')).toBe('a, b, c');
  });

  it('returns comma-separated string by default (returnType=0)', () => {
    expect(normalizeStringList('b, a', 0)).toBe('a, b');
  });

  it('returns newline-separated string (returnType=1)', () => {
    expect(normalizeStringList('b, a', 1)).toBe('a\nb');
  });

  it('returns array (returnType=2)', () => {
    expect(normalizeStringList('b, a', 2)).toEqual(['a', 'b']);
  });

  it('lowercases all items', () => {
    expect(normalizeStringList('Apple, BANANA', 2)).toEqual(['apple', 'banana']);
  });
});

describe('generateCallID', () => {
  it('returns a string of the specified length', () => {
    expect(generateCallID(10)).toHaveLength(10);
    expect(generateCallID(20)).toHaveLength(20);
  });

  it('defaults to length 10', () => {
    expect(generateCallID()).toHaveLength(10);
  });

  it('contains only alphanumeric characters', () => {
    const id = generateCallID(100);
    expect(id).toMatch(/^[A-Za-z0-9]+$/);
  });
});

// ─── Boolean / logic helpers ─────────────────────────────────────

describe('checkAPIIntegration', () => {
  it('returns true for non-chatgpt_web connection types', () => {
    expect(checkAPIIntegration('openai_api', false, null)).toBe(true);
    expect(checkAPIIntegration('ollama', false, '')).toBe(true);
  });

  it('returns true for chatgpt_web with specific integration', () => {
    expect(checkAPIIntegration('chatgpt_web', true, 'openai_api')).toBe(true);
  });

  it('returns false for chatgpt_web without specific integration', () => {
    expect(checkAPIIntegration('chatgpt_web', false, null)).toBe(false);
    expect(checkAPIIntegration('chatgpt_web', true, null)).toBe(false);
    expect(checkAPIIntegration('chatgpt_web', true, '')).toBe(false);
  });
});

describe('hasSpecificIntegration', () => {
  it('returns true when use is true and conntype is non-empty', () => {
    expect(hasSpecificIntegration(true, 'openai_api')).toBe(true);
  });

  it('returns false when use is false', () => {
    expect(hasSpecificIntegration(false, 'openai_api')).toBe(false);
  });

  it('returns false when conntype is null or empty', () => {
    expect(hasSpecificIntegration(true, null)).toBe(false);
    expect(hasSpecificIntegration(true, '')).toBe(false);
  });
});

describe('isAPIKeyValue', () => {
  it('returns true for strings ending with _api_key', () => {
    expect(isAPIKeyValue('openai_api_key')).toBe(true);
    expect(isAPIKeyValue('chatgpt_api_key')).toBe(true);
  });

  it('returns false for other strings', () => {
    expect(isAPIKeyValue('openai_model')).toBe(false);
    expect(isAPIKeyValue('api_key_value')).toBe(false);
  });
});

// ─── JSON extraction ─────────────────────────────────────────────

describe('extractJsonObject', () => {
  it('extracts JSON from string with surrounding text', () => {
    const result = extractJsonObject('Here is the result: {"tags": ["a", "b"]} done');
    expect(result).toEqual({ tags: ['a', 'b'] });
  });

  it('returns parsed object for valid JSON string', () => {
    expect(extractJsonObject('{"key": "value"}')).toEqual({ key: 'value' });
  });

  it('extracts nested JSON', () => {
    const result = extractJsonObject('text {"a": {"b": 1}} more');
    expect(result).toEqual({ a: { b: 1 } });
  });

  it('throws on no JSON found', () => {
    expect(() => extractJsonObject('no json here')).toThrow('No JSON object found');
  });

  it('throws on invalid JSON', () => {
    expect(() => extractJsonObject('{invalid json}')).toThrow();
  });
});

// ─── ChatGPT validation / sanitization ───────────────────────────

describe('validateChatGPTWebCustomData', () => {
  it('validates /g/ paths with alphanumeric chars', () => {
    expect(validateChatGPTWebCustomData('/g/abc-123')).toBe(true);
    expect(validateChatGPTWebCustomData('/g/my-gpt/test')).toBe(true);
  });

  it('rejects invalid paths', () => {
    expect(validateChatGPTWebCustomData('invalid')).toBe(false);
    expect(validateChatGPTWebCustomData('/g/')).toBe(false);
    expect(validateChatGPTWebCustomData('/g/test space')).toBe(false);
  });

  it('accepts empty string', () => {
    expect(validateChatGPTWebCustomData('')).toBe(true);
  });
});

describe('sanitizeChatGPTModelData', () => {
  it('encodes and lowercases input', () => {
    expect(sanitizeChatGPTModelData('GPT-5')).toBe('gpt-5');
  });

  it('encodes special characters', () => {
    expect(sanitizeChatGPTModelData('model name')).toBe('model%20name');
  });

  it('returns empty string for falsy input', () => {
    expect(sanitizeChatGPTModelData(null)).toBe('');
    expect(sanitizeChatGPTModelData('')).toBe('');
    expect(sanitizeChatGPTModelData(undefined)).toBe('');
  });
});

describe('sanitizeChatGPTWebCustomData', () => {
  it('removes non-alphanumeric/dash/slash characters', () => {
    expect(sanitizeChatGPTWebCustomData('/g/test-path')).toBe('/g/test-path');
    expect(sanitizeChatGPTWebCustomData('/g/test path!')).toBe('/g/testpath');
  });

  it('returns empty string for falsy input', () => {
    expect(sanitizeChatGPTWebCustomData(null)).toBe('');
    expect(sanitizeChatGPTWebCustomData('')).toBe('');
  });
});

// ─── Special prompts ─────────────────────────────────────────────

describe('getActiveSpecialPromptsIDs', () => {
  it('returns empty array with all false', () => {
    expect(getActiveSpecialPromptsIDs({})).toEqual([]);
  });

  it('includes prompt_add_tags when addtags is true', () => {
    const result = getActiveSpecialPromptsIDs({ addtags: true });
    expect(result).toContain('prompt_add_tags');
  });

  it('includes calendar and task prompts when enabled', () => {
    const result = getActiveSpecialPromptsIDs({
      get_calendar_event: true,
      get_calendar_event_from_clipboard: true,
      get_task: true,
    });
    expect(result).toContain('prompt_get_calendar_event');
    expect(result).toContain('prompt_get_calendar_event_from_clipboard');
    expect(result).toContain('prompt_get_task');
  });

  it('on chatgpt_web: only includes add_tags if both addtags and addtags_api', () => {
    const result = getActiveSpecialPromptsIDs({
      is_chatgpt_web: true,
      addtags: true,
      addtags_api: true,
    });
    expect(result).toEqual(['prompt_add_tags']);
  });

  it('on chatgpt_web: excludes add_tags if addtags_api is false', () => {
    const result = getActiveSpecialPromptsIDs({
      is_chatgpt_web: true,
      addtags: true,
      addtags_api: false,
    });
    expect(result).toEqual([]);
  });

  it('on chatgpt_web: excludes calendar/task prompts', () => {
    const result = getActiveSpecialPromptsIDs({
      is_chatgpt_web: true,
      get_calendar_event: true,
      get_task: true,
    });
    expect(result).toEqual([]);
  });
});

// ─── getConnectionType ───────────────────────────────────────────

describe('getConnectionType', () => {
  it('returns default connection_type when no prefix', () => {
    const prefs = { connection_type: 'openai_api' };
    expect(getConnectionType(prefs, null)).toBe('openai_api');
  });

  it('returns prompt api_type when no specific type and prompt has api_type', () => {
    const prefs = { connection_type: 'openai_api' };
    const prompt = { api_type: 'ollama_api' };
    expect(getConnectionType(prefs, prompt)).toBe('ollama_api');
  });

  it('returns default when prefs is null', () => {
    expect(getConnectionType(null, null)).toBe('');
  });

  it('returns prompt api_type over default when prompt has api_type', () => {
    const prefs = { connection_type: 'openai_api' };
    const prompt = { api_type: 'claude_api' };
    expect(getConnectionType(prefs, prompt)).toBe('claude_api');
  });
});

// ─── getMailBody ─────────────────────────────────────────────────

describe('getMailBody', () => {
  it('extracts text and html from message parts', () => {
    const msg = {
      parts: [
        { contentType: 'text/plain', body: 'Hello plain' },
        { contentType: 'text/html', body: '<p>Hello html</p>' },
      ],
    };
    expect(getMailBody(msg)).toEqual({ text: 'Hello plain', html: '<p>Hello html</p>' });
  });

  it('converts text to html with <br> if no html part', () => {
    const msg = {
      parts: [{ contentType: 'text/plain', body: 'line1\nline2' }],
    };
    expect(getMailBody(msg)).toEqual({ text: 'line1\nline2', html: 'line1<br>line2' });
  });

  it('handles nested parts', () => {
    const msg = {
      parts: [
        {
          contentType: 'multipart/alternative',
          parts: [
            { contentType: 'text/plain', body: 'nested text' },
            { contentType: 'text/html', body: '<p>nested html</p>' },
          ],
        },
      ],
    };
    expect(getMailBody(msg)).toEqual({ text: 'nested text', html: '<p>nested html</p>' });
  });

  it('returns empty strings when no parts', () => {
    expect(getMailBody({ parts: [] })).toEqual({ text: '', html: '' });
    expect(getMailBody({})).toEqual({ text: '', html: '' });
  });
});

// ─── getLanguageDisplayName ──────────────────────────────────────

describe('getLanguageDisplayName', () => {
  it('returns capitalized language name', () => {
    const name = getLanguageDisplayName('en');
    expect(name).toBe('English');
  });

  it('returns localized name for other languages', () => {
    const name = getLanguageDisplayName('fr');
    expect(name.charAt(0)).toBe(name.charAt(0).toUpperCase());
    expect(name.length).toBeGreaterThan(0);
  });
});

// ─── fixMsgHeader ────────────────────────────────────────────────

describe('fixMsgHeader', () => {
  it('adds missing bccList, ccList, and recipients', () => {
    const header = {};
    const result = fixMsgHeader(header);
    expect(result.bccList).toEqual([]);
    expect(result.ccList).toEqual([]);
    expect(result.recipients).toEqual([]);
  });

  it('preserves existing values', () => {
    const header = {
      bccList: ['a@b.com'],
      ccList: ['c@d.com'],
      recipients: ['e@f.com'],
    };
    const result = fixMsgHeader(header);
    expect(result.bccList).toEqual(['a@b.com']);
    expect(result.ccList).toEqual(['c@d.com']);
    expect(result.recipients).toEqual(['e@f.com']);
  });
});

// ─── extractEmail ────────────────────────────────────────────────

describe('extractEmail', () => {
  it('extracts email from text', () => {
    expect(extractEmail('John Doe <john@example.com>')).toBe('john@example.com');
  });

  it('extracts first email when multiple present', () => {
    expect(extractEmail('a@b.com and c@d.com')).toBe('a@b.com');
  });

  it('returns empty string for empty/undefined input', () => {
    expect(extractEmail('')).toBe('');
    expect(extractEmail(undefined)).toBe('');
  });

  it('returns empty string when no email found', () => {
    expect(extractEmail('no email here')).toBe('');
  });
});

// ─── compareThunderbirdVersions ──────────────────────────────────

describe('compareThunderbirdVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareThunderbirdVersions('128.0', '128.0')).toBe(0);
  });

  it('returns 1 when first version is greater', () => {
    expect(compareThunderbirdVersions('129.0', '128.0')).toBe(1);
  });

  it('returns -1 when first version is lesser', () => {
    expect(compareThunderbirdVersions('127.0', '128.0')).toBe(-1);
  });

  it('handles different length version strings', () => {
    expect(compareThunderbirdVersions('128.0.1', '128.0')).toBe(1);
    expect(compareThunderbirdVersions('128', '128.0.0')).toBe(0);
  });

  it('compares multi-segment versions correctly', () => {
    expect(compareThunderbirdVersions('128.1.2', '128.1.3')).toBe(-1);
  });
});

// ─── sanitizeString ──────────────────────────────────────────────

describe('sanitizeString', () => {
  it('lowercases and removes invalid characters', () => {
    expect(sanitizeString('Hello World')).toBe('helloworld');
  });

  it('removes special characters like < > * "', () => {
    expect(sanitizeString('test<>*"val')).toBe('testval');
  });

  it('encodes non-ASCII characters', () => {
    const result = sanitizeString('café');
    expect(result).toBe('cafu00e9');
  });

  it('truncates to 29 characters', () => {
    const long = 'a'.repeat(50);
    expect(sanitizeString(long)).toHaveLength(29);
  });

  it('handles empty string', () => {
    expect(sanitizeString('')).toBe('');
  });
});

// ─── formatBytes ─────────────────────────────────────────────────

describe('formatBytes', () => {
  it('returns "0 Bytes" for zero', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
  });

  it('formats bytes correctly', () => {
    expect(formatBytes(500)).toBe('500.00 Bytes');
  });

  it('formats kilobytes correctly', () => {
    expect(formatBytes(1024)).toBe('1.00 KB');
  });

  it('formats megabytes correctly', () => {
    expect(formatBytes(1048576)).toBe('1.00 MB');
  });

  it('respects decimals parameter', () => {
    expect(formatBytes(1500, 0)).toBe('1 KB');
    expect(formatBytes(1500, 1)).toBe('1.5 KB');
  });
});
