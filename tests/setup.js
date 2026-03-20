import { vi } from 'vitest';

// Global mock for Thunderbird's browser.* WebExtension APIs
const browser = {
  i18n: {
    getMessage: vi.fn((key) => `[${key}]`),
    getUILanguage: vi.fn(() => 'en-US'),
  },
  accounts: {
    list: vi.fn(async () => []),
  },
  storage: {
    sync: {
      get: vi.fn(async (defaults) => {
        if (typeof defaults === 'object' && defaults !== null) {
          return { ...defaults };
        }
        return {};
      }),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
    local: {
      get: vi.fn(async (defaults) => {
        if (typeof defaults === 'object' && defaults !== null) {
          return { ...defaults };
        }
        return {};
      }),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
  },
  messages: {
    getFull: vi.fn(async () => ({ headers: {}, parts: [] })),
    get: vi.fn(async () => ({ tags: [] })),
    tags: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => {}),
    },
    update: vi.fn(async () => {}),
    listAttachments: vi.fn(async () => []),
  },
  tabs: {
    query: vi.fn(async () => []),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
  },
  compose: {
    getComposeDetails: vi.fn(async () => ({ body: '', subject: '' })),
    setComposeDetails: vi.fn(async () => {}),
  },
  permissions: {
    contains: vi.fn(async () => false),
    request: vi.fn(async () => true),
  },
  runtime: {
    getURL: vi.fn((path) => `moz-extension://fake-id/${path}`),
    sendMessage: vi.fn(async () => null),
  },
  mailTabs: {
    getSelectedMessages: vi.fn(async () => ({ messages: [{ subject: '' }] })),
  },
};

// Global mock for Thunderbird's messenger.* APIs
const messenger = {
  messageDisplay: {
    getDisplayedMessage: vi.fn(async () => ({ subject: '' })),
  },
  compose: {
    getComposeDetails: vi.fn(async () => ({ body: '' })),
    setComposeDetails: vi.fn(async () => {}),
  },
  messages: {
    continueList: vi.fn(async () => ({ messages: [] })),
  },
};

// Attach to globalThis so module-level code can access them
globalThis.browser = browser;
globalThis.messenger = messenger;
