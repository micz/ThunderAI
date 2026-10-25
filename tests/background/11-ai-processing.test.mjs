// Spec 09: the activation switch, discovery, trust, constrained hook replies and fail-closed lifecycle.
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
    await companion.activate(false);
    await flush(2);
    companion.calls.length = 0;
});
const settingChanges = () => companion.calls.filter(m => m.action === 'aiProcessing.settingChanged');

test('switched off, the companion is never contacted and content is unchanged', async () => {
    const session = createAIProcessingSession();
    const original = input();
    assert.deepEqual((await session.onBeforeSendToProvider(original)).input, original);
    assert.deepEqual(await session.onAfterReceiveFromProvider({ content: 'answer', thinking: '' }), { content: 'answer', thinking: '' });
    assert.equal((await getAIProcessingStatus()).enabled, false);
    assert.deepEqual(companion.calls, []);
    session.dispose();
});

test('probe reports a missing, incompatible or compatible companion whatever the switch, and never throws', async () => {
    companion.available = false;
    assert.deepEqual(await client.probe(), { installed: false, compatible: false });
    companion.available = true;
    for (const status of [null, '99.0.0', { ok: true, protocol: 99, instanceId: 'x' }]) {
        companion.handle = m => m.action === 'aiProcessing.hello' ? Promise.resolve(status) : undefined;
        assert.deepEqual(await client.probe(), { installed: true, compatible: false });
    }
    companion.handle = null;
    assert.deepEqual(await client.probe(), { installed: true, compatible: true, version: '1.0.0' });
});

test('switched on, an incompatible or missing processor blocks', async () => {
    await companion.activate();
    companion.handle = m => m.action === 'aiProcessing.hello' ? { ok: true, protocol: 99, instanceId: 'x' } : undefined;
    await assert.rejects(getAIProcessingStatus(), /incompatible/);
    companion.available = false;
    await assert.rejects(getAIProcessingStatus(), /unavailable/);
});

test('active hooks transform input/response and return opaque context', async () => {
    await companion.activate();
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

test('the companion reads and writes the switch; every write is mirrored back with settingChanged', async () => {
    assert.deepEqual(await externalProcessingMessage({ action: 'aiProcessing.getSetting', protocol: 1 }),
        { ok: true, protocol: 1, enabled: false, locked: false });
    assert.deepEqual(await externalProcessingMessage({ action: 'aiProcessing.setSetting', protocol: 1, enabled: true }),
        { ok: true, protocol: 1, enabled: true, locked: false });
    assert.equal(ctx.ctl.localData().ai_processing_enabled, true);
    await flush(3);
    assert.deepEqual(settingChanges().map(m => [m.protocol, m.enabled, m.locked]), [[1, true, false]]);
    await companion.activate(false); // the options page
    await flush(3);
    assert.deepEqual(settingChanges().map(m => m.enabled), [true, false]);
    for (const bad of [{ enabled: 'yes' }, { enabled: true, protocol: 99 }]) {
        assert.equal((await externalProcessingMessage({ action: 'aiProcessing.setSetting', protocol: 1, ...bad })).ok, false);
    }
    assert.equal(ctx.ctl.localData().ai_processing_enabled, false);
});

test('a switch locked by policy is reported and cannot be changed by the companion', async t => {
    const { mztaManaged } = await import('../../js/mzta-managed.js');
    const locked = key => key === 'ai_processing_enabled';
    t.mock.method(mztaManaged, 'isManagedLocked', locked);
    t.mock.method(mztaManaged, 'getManagedValue', key => locked(key) ? true : undefined);
    assert.deepEqual(await externalProcessingMessage({ action: 'aiProcessing.getSetting', protocol: 1 }),
        { ok: true, protocol: 1, enabled: true, locked: true });
    const refused = await externalProcessingMessage({ action: 'aiProcessing.setSetting', protocol: 1, enabled: false });
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, 'ai_processing_setting_locked');
    assert.equal(ctx.ctl.localData().ai_processing_enabled, false, 'nothing written');
});

test('before rejects added/removed keys and non-string values', async () => {
    await companion.activate();
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
    await companion.activate();
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

test('untrusted setting writes and non-extension broker requests are rejected', async () => {
    assert.equal((await externalProcessingMessage({ action: 'aiProcessing.setSetting', protocol: 1, enabled: true }, 'wrong-id')).ok, false);
    assert.equal(ctx.ctl.localData().ai_processing_enabled, false);
    await assert.rejects(ctx.ctl.dispatchMessage({ command: 'ai_processing', operation: 'status', data: {} },
        { id: browser.runtime.id, url: 'https://chatgpt.com/', tab: { id: 1 } }), /trusted extension/);
});

test('a missing processor fails closed while switched on, including after restart', async () => {
    await companion.activate(); companion.available = false;
    await assert.rejects(createAIProcessingSession().onBeforeSendToProvider(input()), /unavailable/);
    ctx.processingBroker.dispose();
    ctx.processingBroker = createAIProcessingBroker();
    await ctx.processingBroker.ready;
    client = createAIProcessingClient(ctx.processingBroker.dispatch);
    await assert.rejects(client.createSession().ready(), /unavailable/);
});

test('timeout cancels work; only matching, advancing progress renews its budget', async t => {
    await companion.activate();
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

test('switched off a slow companion is never waited for; switched on a slow hello fails with a stable code even without locale text', async t => {
    companion.handle = m => m.action === 'aiProcessing.hello' ? new Promise(() => {}) : undefined;
    assert.equal((await getAIProcessingStatus()).enabled, false);
    await companion.activate();
    t.mock.timers.enable({ apis: ['setTimeout'] });
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
    await companion.activate();
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
    await companion.activate();
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
    await companion.activate();
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
