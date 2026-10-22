/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Tests for the OpenAI-compatible API: URL building, host permission
 *  patterns and the preconfigured services list.
 *
 *  Run with: node --test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// openai_comp_configs.js reads browser.i18n at import time → provide a minimal stub first.
// mzta-utils.js pulls in mzta-prefs.js, which touches browser.storage at import
// time → provide a minimal stub before any module import.
globalThis.browser = {
  i18n: { getMessage: (key) => key },
  storage: {
    local: { async get() { return {}; }, async set() {}, async remove() {} },
    sync: { async get() { return {}; }, async set() {} },
    onChanged: { addListener() {} },
  },
};


const { OpenAIComp } = await import('../js/api/openai_comp.js');
const { getOriginPermissionPattern } = await import('../js/mzta-utils.js');
const { openAICompConfigs } = await import('../js/api/openai_comp_configs.js');

describe('OpenAIComp.buildApiUrl()', () => {
  const cases = [
    // [host, use_v1, expected chat/completions URL]
    ['https://api.z.ai/api/paas/v4', false, 'https://api.z.ai/api/paas/v4/chat/completions'],
    // Hosts already ending with a version segment must never get "/v1" appended,
    // no matter how use_v1 is set (this was the Z.ai bug).
    ['https://api.z.ai/api/paas/v4', true, 'https://api.z.ai/api/paas/v4/chat/completions'],
    ['https://api.z.ai/api/coding/paas/v4/', true, 'https://api.z.ai/api/coding/paas/v4/chat/completions'],
    ['https://example.com/api/v1', true, 'https://example.com/api/v1/chat/completions'],
    // Plain hosts keep the classic behaviour.
    ['https://api.x.ai', true, 'https://api.x.ai/v1/chat/completions'],
    ['https://api.deepseek.com', false, 'https://api.deepseek.com/chat/completions'],
    ['https://api.deepseek.com/v1', true, 'https://api.deepseek.com/v1/chat/completions'],
    ['https://openrouter.ai/api', true, 'https://openrouter.ai/api/v1/chat/completions'],
    ['https://api.perplexity.ai', false, 'https://api.perplexity.ai/chat/completions'],
    ['http://localhost:8080/v1', true, 'http://localhost:8080/v1/chat/completions'],
  ];

  for (const [host, use_v1, expected] of cases) {
    test(`host=${host} use_v1=${use_v1}`, () => {
      const client = new OpenAIComp({ host, use_v1 });
      assert.equal(client.buildApiUrl('/chat/completions'), expected);
      assert.equal(client.buildApiUrl('/models'), expected.replace('/chat/completions', '/models'));
    });
  }

  test('whitespace and trailing slashes in the host are tolerated', () => {
    const client = new OpenAIComp({ host: '  https://api.z.ai/api/paas/v4/  ', use_v1: true });
    assert.equal(client.buildApiUrl('/chat/completions'), 'https://api.z.ai/api/paas/v4/chat/completions');
  });

  test('default constructor keeps appending /v1', () => {
    const client = new OpenAIComp({ host: 'https://api.example.com' });
    assert.equal(client.buildApiUrl('/chat/completions'), 'https://api.example.com/v1/chat/completions');
  });
});

describe('getOriginPermissionPattern()', () => {
  test('covers the whole origin, not just the API path', () => {
    assert.equal(getOriginPermissionPattern('https://api.z.ai/api/paas/v4'), 'https://api.z.ai/*');
    assert.equal(getOriginPermissionPattern('http://localhost:8080/v1'), 'http://localhost:8080/*');
  });

  test('falls back to prepareOriginURL() for unparsable input', () => {
    assert.equal(getOriginPermissionPattern('not a url'), 'not a url/*');
  });
});

describe('openAICompConfigs', () => {
  test('provides a Z.ai preset with the versioned host and use_v1 disabled', () => {
    const zai = openAICompConfigs.find((cfg) => cfg.id === 'zai');
    assert.ok(zai, 'Z.ai preset is missing');
    assert.equal(zai.host, 'https://api.z.ai/api/paas/v4');
    assert.equal(zai.use_v1, false);
    assert.equal(zai.chat_name, 'Z.ai');
  });

  test('preset ids are unique', () => {
    const ids = openAICompConfigs.map((cfg) => cfg.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
