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
const { createAIProcessingSession, getAIProcessingStatus } = await import('../../js/mzta-ai-processing.js');
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
    const restarted = await import('../../js/mzta-ai-processing.js?restart-contract-test');
    await restarted.initializeAIProcessing();
    await assert.rejects(restarted.createAIProcessingSession().ready(), /unavailable/);
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
