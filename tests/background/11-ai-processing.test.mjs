// Spec 09: discovery, trust, constrained hook replies and fail-closed lifecycle.
import assert from 'node:assert/strict';
import {
    test,
    beforeEach
} from 'node:test';
import {
    moduleContext,
    flush
} from './context.mjs';
import {
    fakeProcessingCompanion,
    externalProcessingMessage,
    progressFor
} from './processing-companion.mjs';

const companion = fakeProcessingCompanion();
const ctx = await moduleContext({ local: { special_command_timeout: 1000 }, processor: m => companion.receive(m) });
const { createAIProcessingBroker } = await import('../../js/mzta-ai-processing-broker.js');
const { createAIProcessingClient, createRuntimeProcessingTransport } = await import('../../js/mzta-ai-processing-client.js');
let client = ctx.processingClient;
const createAIProcessingSession = options => client.createSession(options);
const getAIProcessingStatus = () => client.getStatus();
const input = () => ({ message: 'Alice', instructions: { system: 'Alice rules' }, extraBody: { body: '{"name":"Alice"}' } });
beforeEach(async () => {
    companion.handle = null; companion.available = true;
    await companion.announce(false);
    companion.calls.length = 0;
});

test('missing/inactive companion preserves content; absence is briefly cached', async () => {
    companion.available = false;
    const session = createAIProcessingSession();
    const original = input();
    assert.deepEqual((await session.onBeforeSendToProvider(original)).input, original);
    assert.deepEqual(await session.onAfterReceiveFromProvider({ content: 'answer', thinking: '' }), { content: 'answer', thinking: '' });
    await getAIProcessingStatus();
    assert.equal(companion.calls.filter(m => m.action === 'aiProcessing.hello').length, 1);
    session.dispose();
});

test('legacy/malformed inactive replies do not require a never-enabled processor', async () => {
    for (const status of [null, '99.0.0', { enabled: false, protocol: 99 }]) {
        companion.handle = m => m.action === 'aiProcessing.hello' ? Promise.resolve(status) : undefined;
        assert.equal((await getAIProcessingStatus()).enabled, false);
    }
});

test('incompatible enabled processor blocks and persists its active receipt', async () => {
    companion.handle = m => m.action === 'aiProcessing.hello' ? { enabled: true, protocol: 99 } : undefined;
    await assert.rejects(getAIProcessingStatus(), /incompatible/);
    assert.equal(ctx.ctl.localData().aiProcessingRegistration.expected, true);
    companion.available = false;
    await assert.rejects(getAIProcessingStatus(), /unavailable/);
});

test('active hooks transform input/response and return opaque context', async () => {
    await companion.announce();
    const session = createAIProcessingSession();
    const result = await session.onBeforeSendToProvider(input());
    assert.equal(result.input.message, '[PRIVATE]');
    assert.equal(result.input.instructions.system, '[PRIVATE] rules');
    assert.equal(result.input.extraBody.body, '{"name":"[PRIVATE]"}');
    assert.ok(result.context.token);
    assert.deepEqual(await session.onAfterReceiveFromProvider({ content: '[PRIVATE]', thinking: '[PRIVATE] thinks' }),
        { content: 'Alice', thinking: 'Alice thinks' });
    session.dispose(); await flush(2);
});

test('incompatible active registration cannot be mistaken for an absent processor', async () => {
    await assert.rejects(externalProcessingMessage({ action: 'aiProcessing.register', ...companion.status(), enabled: true, protocol: 99 }), /incompatible/);
    assert.equal(ctx.ctl.localData().aiProcessingRegistration.expected, true);
    companion.available = false;
    await assert.rejects(getAIProcessingStatus(), /unavailable/);
});

test('before rejects added/removed keys and non-string values', async () => {
    await companion.announce();
    for (const mutate of [x => { x.instructions.extra = 'injected'; }, x => { delete x.instructions.system; },
        x => { x.instructions.system = 42; }, x => { x.extraBody.body = {}; }]) {
        companion.handle = m => {
            if (m.action !== 'aiProcessing.before') return;
            const changed = structuredClone(m.input); mutate(changed);
            return companion.reply(m, { input: changed, context: {} });
        };
        const session = createAIProcessingSession();
        await assert.rejects(session.onBeforeSendToProvider(input()), /invalid/);
        session.dispose(); await flush(2);
    }
});

test('wrong reply instance/call IDs and invalid output are rejected', async () => {
    await companion.announce();
    for (const change of [{ instanceId: 'other' }, { callId: 'other' }]) {
        companion.handle = m => m.action === 'aiProcessing.before' ? companion.reply(m, { input: m.input, context: {}, ...change }) : undefined;
        const session = createAIProcessingSession();
        await assert.rejects(session.onBeforeSendToProvider(input()), /incompatible/);
        session.dispose(); await flush(2);
    }
    companion.handle = null;
    const session = createAIProcessingSession();
    await session.onBeforeSendToProvider(input());
    companion.handle = m => m.action === 'aiProcessing.after' ? companion.reply(m, { output: { content: 42, thinking: '' } }) : undefined;
    await assert.rejects(session.onAfterReceiveFromProvider({ content: 'x', thinking: '' }), /invalid/);
    session.dispose(); await flush(2);
});

test('untrusted registration and non-extension broker requests are rejected', async () => {
    assert.equal((await externalProcessingMessage({ action: 'aiProcessing.register', ...companion.status(), enabled: true }, 'wrong-id')).ok, false);
    assert.equal(ctx.ctl.localData().aiProcessingRegistration.expected, false);
    await assert.rejects(ctx.ctl.dispatchMessage({ command: 'ai_processing', operation: 'status', data: {} },
        { id: browser.runtime.id, url: 'https://chatgpt.com/', tab: { id: 1 } }), /trusted extension/);
});

test('missing previously active processor fails closed, including after restart', async () => {
    await companion.announce(); companion.available = false;
    await assert.rejects(createAIProcessingSession().onBeforeSendToProvider(input()), /unavailable/);
    ctx.processingBroker.dispose();
    ctx.processingBroker = createAIProcessingBroker();
    await ctx.processingBroker.ready;
    client = createAIProcessingClient(ctx.processingBroker.dispatch);
    await assert.rejects(client.createSession().ready(), /unavailable/);
});

test('timeout cancels work; only matching, advancing progress renews its budget', async t => {
    await companion.announce();
    const session = createAIProcessingSession(); await session.ready();
    let request;
    companion.handle = m => {
        if (m.action === 'aiProcessing.before') { request = m; return new Promise(() => {}); }
    };
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const call = session.onBeforeSendToProvider(input()); call.catch(() => {});
    await flush(2);
    t.mock.timers.tick(600);
    await externalProcessingMessage(progressFor(request, 1));
    t.mock.timers.tick(600);
    await externalProcessingMessage(progressFor(request, 1)); // duplicate, no renewal
    await externalProcessingMessage(progressFor(request, 2, { requestId: 'stale' }));
    await externalProcessingMessage(progressFor(request, 2), 'wrong-id');
    t.mock.timers.tick(400);
    await assert.rejects(call, /timed out/);
    assert.ok(companion.calls.some(m => m.action === 'aiProcessing.cancel' && m.requestId === request.requestId));
    session.dispose(); await flush(2);
});

test('importing broker/client registers no listeners', async () => {
    const before = [browser.runtime.onMessage._listeners.length, browser.runtime.onMessageExternal._listeners.length];
    await import('../../js/mzta-ai-processing-broker.js?import-only');
    await import('../../js/mzta-ai-processing-client.js?import-only');
    assert.deepEqual([browser.runtime.onMessage._listeners.length, browser.runtime.onMessageExternal._listeners.length], before);
});

test('a never-enabled slow hello is optional; an expected slow hello fails with a stable code even without locale text', async t => {
    companion.handle = m => m.action === 'aiProcessing.hello' ? new Promise(() => {}) : undefined;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const inactive = getAIProcessingStatus();
    await flush(2);
    t.mock.timers.tick(5000);
    assert.equal((await inactive).enabled, false);
    await companion.announce();
    const original = browser.i18n.getMessage;
    browser.i18n.getMessage = () => '';
    try {
        const active = getAIProcessingStatus(); active.catch(() => {});
        await flush(2);
        t.mock.timers.tick(5000);
        await assert.rejects(active, error => error.code === 'ai_processing_timeout');
    } finally {
        browser.i18n.getMessage = original;
    }
});

test('page transport routes through the broker, lazily relays matching progress, and removes its listener', async () => {
    await companion.announce();
    const pageClient = createAIProcessingClient(createRuntimeProcessingTransport());
    const session = pageClient.createSession();
    const listenerCount = browser.runtime.onMessage._listeners.length;
    await session.ready();
    assert.equal(browser.runtime.onMessage._listeners.length, listenerCount);
    let request, release;
    companion.handle = m => m.action === 'aiProcessing.before' ? new Promise(resolve => {
        request = m;
        release = () => resolve(companion.reply(m, { input: m.input, context: { token: m.requestId } }));
    }) : undefined;
    const progress = [];
    const call = session.onBeforeSendToProvider(input(), { onProgress: value => progress.push(value) });
    await flush(2);
    assert.equal(browser.runtime.onMessage._listeners.length, listenerCount + 1);
    await externalProcessingMessage(progressFor(request, 1));
    await externalProcessingMessage(progressFor(request, 1));
    await ctx.ctl.dispatchMessage({ command: 'ai_processing_progress', callId: request.callId, progress: { current: 99 } }, { id: 'untrusted' });
    await flush(2);
    assert.equal(progress.length, 1);
    assert.equal(progress[0].current, 1);
    release(); await call;
    assert.equal(browser.runtime.onMessage._listeners.length, listenerCount);
    await session.dispose();
});

test('page transport cleans up progress listeners on failure and cancellation', async () => {
    await companion.announce();
    const pageClient = createAIProcessingClient(createRuntimeProcessingTransport());
    const listenerCount = browser.runtime.onMessage._listeners.length;
    for (const cancel of [false, true]) {
        const session = pageClient.createSession(); await session.ready();
        companion.handle = m => m.action === 'aiProcessing.before' ? (cancel ? new Promise(() => {}) : { ok: false }) : undefined;
        const call = session.onBeforeSendToProvider(input(), { onProgress: () => {} }); call.catch(() => {});
        await flush(2);
        if (cancel) session.cancel();
        await assert.rejects(call);
        assert.equal(browser.runtime.onMessage._listeners.length, listenerCount);
        await session.dispose();
    }
});

test('one active session cannot replace a pending request or overlap restoration hooks', async () => {
    await companion.announce();
    const session = createAIProcessingSession();
    await session.onBeforeSendToProvider(input());
    const calls = companion.calls.filter(m => m.action === 'aiProcessing.before').length;
    await assert.rejects(session.onBeforeSendToProvider(input()), error => error.code === 'ai_processing_busy');
    assert.equal(companion.calls.filter(m => m.action === 'aiProcessing.before').length, calls);
    let release;
    companion.handle = m => m.action === 'aiProcessing.after' ? new Promise(resolve => {
        release = () => resolve(companion.reply(m, { output: m.output }));
    }) : undefined;
    const after = session.onAfterReceiveFromProvider({ content: 'x', thinking: '' });
    await flush(2);
    await assert.rejects(session.onAfterReceiveFromProvider({ content: 'y', thinking: '' }), error => error.code === 'ai_processing_busy');
    release(); await after;
    companion.handle = null;
    await session.onBeforeSendToProvider(input()); // prior turn finished
    await session.dispose();
});
