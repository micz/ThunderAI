// The ChatGPT page loader, js/mzta-chatgpt-loader.js: how it is declared, and when it tells the
// background the page is ready.
//
// Spec 04 "ChatGPT Web": "Loader declaration" (a manifest content script at document_start in the
// top frame of chatgpt.com, no longer registered by the background; diff.js keeps all frames) and
// "Readiness does not wait for the document (issue #924)" (`chatgpt_web_ready_<call_id>` sent once,
// on the first of a visible composer, `load` - or a complete document at start - and the timeout 15 s
// after navigation start; the hidden composer does not count; the message's fields).
//
// The loader runs as it is shipped, in a vm context of its own per boot, against the core mock
// (its runtime.sendMessage reaches the mock's `remote`, which records it) and the area's clock
// (./fake-clock.mjs). Level 1 has no DOM: the document is a stand-in holding only what the loader
// reads - its readyState, a body, and the composers querySelectorAll() finds, visible or not - and a
// MutationObserver stand-in a test fires by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { installBrowserMock } from '../helpers/core/browser-mock.mjs';
import { repoPath } from '../helpers/core/load.mjs';
import {
    createClock,
    flush
} from './fake-clock.mjs';

const LOADER = 'js/mzta-chatgpt-loader.js';
const SOURCE = readFileSync(repoPath(LOADER), 'utf8');
const S_DECL = 'spec 04 "ChatGPT Web" (Loader declaration)';
const S_READY = 'spec 04 "ChatGPT Web" (Readiness does not wait for the document)';

/** One run of the loader in a page whose navigation started 5 ms before it. */
async function boot({ readyState = 'loading', visible = false } = {}) {
    const ctl = installBrowserMock({ remote: () => undefined, senderUrl: 'https://chatgpt.com/?call_id=test-call&model=gpt-6' });
    const clock = createClock({ start: 5 });
    const listeners = new Map();
    const observers = [];
    let composerVisible = visible;
    const window = {
        location: { search: '?call_id=test-call&model=gpt-6' },
        addEventListener: (type, fn) => listeners.set(type, fn),
        removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
    };
    const document = {
        body: {},
        documentElement: {},
        readyState,
        querySelectorAll: () => [{ getClientRects: () => (composerVisible ? [{}] : []) }],
    };
    class MutationObserver {
        constructor(fn) { this.fn = fn; this.connected = false; observers.push(this); }
        observe() { this.connected = true; }
        disconnect() { this.connected = false; }
    }
    vm.runInNewContext(SOURCE, {
        window, document, URLSearchParams, console, MutationObserver,
        ...clock.globals,
        browser: ctl.browser,
    }, { filename: LOADER });
    await flush();
    return {
        ctl, window, document, clock,
        ready: () => ctl.sent.filter(m => typeof m?.command === 'string' && m.command.startsWith('chatgpt_web_ready_')),
        revealComposer() { composerVisible = true; },
        async mutation() { observers.filter(o => o.connected).forEach(o => o.fn()); await flush(); },
        async load() { listeners.get('load')?.(); await flush(); },
        assertClean() {
            assert.deepEqual(clock.pending(), [], 'loader timers left running');
            assert.equal(listeners.size, 0, 'load listener left attached');
            assert.ok(observers.every(o => !o.connected), 'loader observer left connected');
        },
    };
}

test(`${S_DECL}: one manifest content script at document_start, top frame of chatgpt.com, not registered by the background`, () => {
    const manifest = JSON.parse(readFileSync(repoPath('manifest.json'), 'utf8'));
    const loaders = manifest.content_scripts.filter(entry => entry.js.includes(LOADER));
    assert.equal(loaders.length, 1, 'the loader is not declared once in the manifest');
    assert.deepEqual(loaders[0].matches, ['https://*.chatgpt.com/*']);
    assert.equal(loaders[0].run_at, 'document_start');
    assert.equal(loaders[0].all_frames ?? false, false);
    const diff = manifest.content_scripts.find(entry => entry.js.includes('js/lib/diff.js'));
    assert.equal(diff.all_frames, true, 'diff.js no longer injected into all frames');
    const background = readFileSync(repoPath('mzta-background.js'), 'utf8');
    assert.equal(background.includes(LOADER), false, 'the background registers the loader again');
});

test(`${S_READY}: a visible composer before load sends ready at once, with its fields`, async () => {
    const h = await boot({ visible: true });
    assert.equal(h.ready().length, 1);
    const m = h.ready()[0];
    assert.equal(m.command, 'chatgpt_web_ready_test-call');
    assert.equal(m.readyReason, 'composer');
    assert.equal(m.readyStateAtSend, 'loading');
    assert.equal(m.loaderStartMs, 5);
    assert.equal(typeof m.readySentMs, 'number');
    h.assertClean();
});

test(`${S_READY}: the call_id read at start is kept when the page drops the query`, async () => {
    const h = await boot();
    h.window.location.search = '';
    assert.equal(h.ready().length, 0);
    h.revealComposer();
    await h.mutation();
    await h.clock.advance(250);
    await h.load();
    assert.equal(h.ready().length, 1);
    assert.equal(h.ready()[0].command, 'chatgpt_web_ready_test-call');
    h.assertClean();
});

test(`${S_READY}: the 250 ms poll finds a composer no mutation reported`, async () => {
    const h = await boot();
    h.revealComposer();
    await h.clock.advance(249);
    assert.equal(h.ready().length, 0);
    await h.clock.advance(1);
    assert.equal(h.ready().length, 1);
    assert.equal(h.ready()[0].readyReason, 'composer');
    h.assertClean();
});

test(`${S_READY}: a hidden composer does not count; the timeout, 15 s after navigation start, sends ready once`, async () => {
    const h = await boot();
    await h.mutation();
    await h.clock.advance(14994);
    assert.equal(h.ready().length, 0, 'ready sent for a hidden composer, or before the timeout');
    await h.clock.advance(1);
    assert.equal(h.clock.now(), 15000);
    assert.equal(h.ready().length, 1);
    assert.equal(h.ready()[0].readyReason, 'timeout');
    h.revealComposer();
    await h.mutation();
    await h.load();
    assert.equal(h.ready().length, 1, 'ready sent twice');
    h.assertClean();
});

test(`${S_READY}: load racing a composer sends ready once, for the first of them`, async () => {
    const h = await boot();
    await h.load();
    h.revealComposer();
    await h.mutation();
    await h.clock.advance(250);
    assert.equal(h.ready().length, 1);
    assert.equal(h.ready()[0].readyReason, 'load');
    h.assertClean();
});

test(`${S_READY}: a document already complete at start sends ready at once (load), nothing left running`, async () => {
    const h = await boot({ readyState: 'complete' });
    assert.equal(h.ready().length, 1);
    assert.equal(h.ready()[0].readyReason, 'load');
    assert.equal(h.ready()[0].readyStateAtSend, 'complete');
    h.assertClean();
});
