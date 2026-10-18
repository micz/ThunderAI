import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const loaderFile = 'js/mzta-chatgpt-loader.js';
const source = readFileSync(new URL(loaderFile, root), 'utf8');

test('The initial popup loader is declared without dynamic background registration', () => {
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
    const loaders = manifest.content_scripts.filter(entry => entry.js.includes(loaderFile));
    assert.equal(loaders.length, 1, 'Loader is not registered in the manifest');
    assert.deepEqual(loaders[0].matches, ['https://*.chatgpt.com/*']);
    assert.equal(loaders[0].run_at, 'document_start');
    assert.equal(loaders[0].all_frames ?? false, false);
    const diff = manifest.content_scripts.find(entry => entry.js.includes('js/lib/diff.js'));
    assert.equal(diff.all_frames, true, 'Existing diff frame configuration was changed');
    const background = readFileSync(new URL('mzta-background.js', root), 'utf8');
    assert.equal(background.includes(loaderFile), false, 'Loader is registered again in the background');
});

// Run the production loader with only its DOM/lifecycle/extension boundaries replaced.
function boot({ readyState = 'loading', visible = false } = {}) {
    const messages = [];
    const timers = new Map();
    const listeners = new Map();
    const observers = [];
    let sequence = 0;
    let now = 5;
    const window = {
        location: { search: '?call_id=test-call&model=gpt-6' },
        addEventListener: (type, fn) => listeners.set(type, fn),
        removeEventListener: type => listeners.delete(type)
    };
    const document = {
        body: {}, documentElement: {}, readyState,
        querySelectorAll: () => [{ getClientRects: () => visible ? [{}] : [] }]
    };
    const setTimer = (fn, delay, type) => {
        const id = ++sequence; timers.set(id, { fn, delay, type }); return id;
    };
    runInNewContext(source, {
        window, document, URLSearchParams, console,
        performance: { now: () => now },
        MutationObserver: class {
            constructor(fn) { this.fn = fn; this.connected = false; observers.push(this); }
            observe() { this.connected = true; }
            disconnect() { this.connected = false; }
        },
        setTimeout: (fn, delay) => setTimer(fn, delay, 'timeout'),
        setInterval: (fn, delay) => setTimer(fn, delay, 'interval'),
        clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
        browser: { runtime: { sendMessage: async message => { messages.push(message); } } }
    });
    return {
        messages, window,
        revealComposer() { visible = true; },
        mutation() { observers.filter(o => o.connected).forEach(o => o.fn()); },
        load() { listeners.get('load')?.(); },
        poll() { [...timers.values()].filter(t => t.type === 'interval').forEach(t => t.fn()); },
        timeout() {
            now = 15000;
            const entry = [...timers].find(([, t]) => t.type === 'timeout');
            assert.ok(entry); assert.equal(entry[1].delay, 14995);
            timers.delete(entry[0]); entry[1].fn();
        },
        clean() {
            assert.equal(timers.size, 0, 'Loader timers remain active');
            assert.equal(listeners.size, 0, 'Load listeners remain attached');
            assert.ok(observers.every(o => !o.connected), 'Loader observers remain connected');
        }
    };
}

test('Sends ready before load when the initial document has a visible composer', () => {
    const h = boot({ visible: true });
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].command, 'chatgpt_web_ready_test-call');
    assert.equal(h.messages[0].readyReason, 'composer');
    assert.equal(h.messages[0].readyStateAtSend, 'loading');
    h.clean();
});

test('Preserves the initial call_id when the SPA removes the query', () => {
    const h = boot();
    h.window.location.search = '';
    assert.equal(h.messages.length, 0);
    h.revealComposer(); h.mutation(); h.poll(); h.load();
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].command, 'chatgpt_web_ready_test-call');
    h.clean();
});

test('Polling finds the composer without a MutationObserver notification', () => {
    const h = boot(); h.revealComposer(); h.poll();
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].readyReason, 'composer'); h.clean();
});

test('Rejects a hidden composer and sends ready once after timeout', () => {
    const h = boot(); h.mutation(); h.poll();
    assert.equal(h.messages.length, 0);
    h.timeout(); h.revealComposer(); h.mutation(); h.load();
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].readyReason, 'timeout'); h.clean();
});

test('Sends ready once when load races with composer readiness', () => {
    const h = boot(); h.load(); h.revealComposer(); h.mutation(); h.poll();
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].readyReason, 'load'); h.clean();
});

test('Sends ready and cleans up for an already complete document', () => {
    const h = boot({ readyState: 'complete' });
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].readyReason, 'load'); h.clean();
});
