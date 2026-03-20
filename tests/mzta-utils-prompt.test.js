import { taPromptUtils } from '../js/mzta-utils-prompt.js';

// ─── finalizePrompt_get_calendar_event ───────────────────────────

describe('taPromptUtils.finalizePrompt_get_calendar_event', () => {
  it('removes {%cc_list%} placeholder', () => {
    const result = taPromptUtils.finalizePrompt_get_calendar_event('Send to {%cc_list%} please');
    expect(result).toBe('Send to  please');
  });

  it('removes {%recipients%} placeholder', () => {
    const result = taPromptUtils.finalizePrompt_get_calendar_event('Invite {%recipients%} now');
    expect(result).toBe('Invite  now');
  });

  it('removes both placeholders', () => {
    const result = taPromptUtils.finalizePrompt_get_calendar_event('To: {%recipients%}, CC: {%cc_list%}');
    expect(result).toBe('To: , CC: ');
  });

  it('returns prompt unchanged if no placeholders present', () => {
    const prompt = 'Create a calendar event from this email';
    expect(taPromptUtils.finalizePrompt_get_calendar_event(prompt)).toBe(prompt);
  });
});

// ─── getTagsFromResponse ─────────────────────────────────────────

describe('taPromptUtils.getTagsFromResponse', () => {
  it('parses JSON response with tags array', () => {
    const response = '{"tags": ["urgent", "work"]}';
    expect(taPromptUtils.getTagsFromResponse(response)).toEqual(['urgent', 'work']);
  });

  it('parses JSON response with tags as string', () => {
    const response = '{"tags": "urgent, work"}';
    expect(taPromptUtils.getTagsFromResponse(response)).toEqual(['urgent', 'work']);
  });

  it('handles JSON embedded in text', () => {
    const response = 'Here are the tags: {"tags": ["a", "b"]} done';
    expect(taPromptUtils.getTagsFromResponse(response)).toEqual(['a', 'b']);
  });

  it('falls back to comma splitting on invalid JSON', () => {
    const response = 'urgent, work, personal';
    expect(taPromptUtils.getTagsFromResponse(response)).toEqual(['urgent', 'work', 'personal']);
  });

  it('returns empty array for empty input', () => {
    expect(taPromptUtils.getTagsFromResponse('')).toEqual([]);
    expect(taPromptUtils.getTagsFromResponse(null)).toEqual([]);
    expect(taPromptUtils.getTagsFromResponse(undefined)).toEqual([]);
  });

  it('filters tags when filter_tags is true', () => {
    const response = '{"tags": ["urgent", "work", "personal"]}';
    const result = taPromptUtils.getTagsFromResponse(response, true, 'urgent, personal');
    expect(result).toEqual(['urgent', 'personal']);
  });

  it('filter is case-insensitive', () => {
    const response = '{"tags": ["Urgent", "WORK"]}';
    const result = taPromptUtils.getTagsFromResponse(response, true, 'urgent, work');
    expect(result).toEqual(['Urgent', 'WORK']);
  });

  it('does not filter when filter_tags is false', () => {
    const response = '{"tags": ["urgent", "work"]}';
    const result = taPromptUtils.getTagsFromResponse(response, false, 'urgent');
    expect(result).toEqual(['urgent', 'work']);
  });
});
