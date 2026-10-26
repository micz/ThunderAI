// Spec 09: provider transparency, active buffering, busy notification and Stop.
import assert from 'node:assert/strict';
import {
    test,
    beforeEach,
    afterEach
} from 'node:test';
import {
    moduleContext,
    flush
} from './context.mjs';
import { fakeProcessingCompanion } from './processing-companion.mjs';
import {
    token,
    thinking,
    done
} from './fake-worker.mjs';

const companion = fakeProcessingCompanion();
const ctx = await moduleContext({ processor: m => companion.receive(m) });
const { createProviderWorker, ProcessingWorker } = await import('../../js/mzta-processing-worker.js');
const adapters = [];
beforeEach(async () => {
    companion.available = true; companion.handle = null;
    await companion.activate(); companion.calls.length = 0;
});
afterEach(async () => { for (const adapter of adapters.splice(0)) adapter.terminate(); await flush(2); });
async function adapter() {
    const worker = await createProviderWorker(new URL('../../js/workers/model-worker-openai_responses.js', import.meta.url),
        { client: ctx.processingClient });
    const provider = ctx.workers.last();
    const output = []; worker.onmessage = ({ data }) => output.push(data);
    const statuses = [];
    if (worker instanceof ProcessingWorker) worker.onprocessingstatus = status => statuses.push(status);
    adapters.push(worker);
    worker.postMessage({ type: 'init', chatgpt_api_key: 'API_SECRET', chatgpt_developer_messages: 'Alice rules' });
    return { worker, provider, output, statuses };
}

test('inactive adapter forwards all prompts, even before init settles or while a turn is pending', async () => {
    await companion.activate(false);
    const { worker, provider, output } = await adapter();
    assert.equal(worker, provider);
    assert.equal(worker instanceof ProcessingWorker, false);
    for (const message of ['first', 'second', 'third']) worker.postMessage({ type: 'chatMessage', message });
    await flush(3);
    assert.deepEqual(provider.posted.map(m => m.type), ['init', 'chatMessage', 'chatMessage', 'chatMessage']);
    assert.deepEqual(provider.posted.slice(1).map(m => m.message), ['first', 'second', 'third']);
    provider.deliver(token('live'));
    assert.equal(output.at(-1).payload.token, 'live'); // synchronous streaming, no buffering
    assert.equal(companion.calls.filter(m => m.action === 'aiProcessing.before').length, 0);
});

test('active companion transforms instructions and buffers/restores content/thinking without contaminating provider history', async () => {
    const { worker, provider, output } = await adapter();
    worker.postMessage({ type: 'chatMessage', message: 'Hello Alice' }); await flush(3);
    assert.equal(provider.init.chatgpt_developer_messages, '[PRIVATE] rules');
    assert.equal(provider.prompt, 'Hello [PRIVATE]');
    assert.ok(!JSON.stringify(companion.calls).includes('API_SECRET'));
    provider.deliver(thinking('[PRIVATE] thinks'), token('Hi [PRIVATE]'));
    await flush(2);
    assert.equal(output.some(m => m.type === 'newToken'), false);
    provider.deliver(done()); await flush(3);
    assert.equal(output.find(m => m.type === 'newToken').payload.token, 'Hi Alice');
    assert.equal(output.find(m => m.type === 'newThinkingToken').payload.token, 'Alice thinks');
    worker.postMessage({ type: 'chatMessage', message: 'Again Alice' }); await flush(3);
    assert.equal(provider.posted.at(-1).message, 'Again [PRIVATE]');
    assert.ok(!JSON.stringify(provider.posted).includes('Alice'));
});

test('active usage reaches the chat after the restored content and before tokensDone', async () => {
    const { worker, provider, output } = await adapter();
    worker.postMessage({ type: 'chatMessage', message: 'Alice' }); await flush(3);
    provider.deliver(token('Hi [PRIVATE]'), { type: 'usage', messageId: 'm1', payload: { total_tokens: 7 } });
    await flush(2);
    assert.equal(output.some(m => m.type === 'usage'), false);
    provider.deliver(done()); await flush(3);
    assert.deepEqual(output.filter(m => ['newToken', 'usage', 'tokensDone'].includes(m.type)).map(m => m.type),
        ['newToken', 'usage', 'tokensDone']);
    assert.deepEqual(output.find(m => m.type === 'usage'), { type: 'usage', messageId: 'm1', payload: { total_tokens: 7 } });
});

test('active busy sends produce a notification without disturbing the current turn', async () => {
    const { worker, provider, output, statuses } = await adapter();
    worker.postMessage({ type: 'chatMessage', message: 'Alice' }); await flush(3);
    worker.postMessage({ type: 'chatMessage', message: 'second Alice' }); await flush(3);
    assert.equal(statuses.filter(status => status.type === 'busy').length, 1);
    assert.equal(output.some(m => m.type.startsWith('processing')), false);
    assert.equal(provider.posted.filter(m => m.type === 'chatMessage').length, 1);
    assert.equal(worker.busy, true);
    provider.deliver(token('[PRIVATE]'), done()); await flush(3);
    assert.equal(output.find(m => m.type === 'newToken').payload.token, 'Alice');
});

test('active failure dispatches no provider init or prompt', async () => {
    companion.handle = m => m.action === 'aiProcessing.before' ? { ok: false, error: { message: 'blocked by processor' } } : undefined;
    const { worker, provider, output } = await adapter();
    worker.postMessage({ type: 'chatMessage', message: 'Alice' }); await flush(3);
    assert.equal(provider.posted.length, 0);
    assert.ok(output.some(m => m.type === 'error' && m.payload === 'blocked by processor'));
});

test('factory fails closed before constructing any worker when an expected companion is missing', async () => {
    companion.available = false;
    const count = ctx.workers.created.length;
    await assert.rejects(createProviderWorker(new URL('../../js/workers/model-worker-openai_responses.js', import.meta.url),
        { client: ctx.processingClient }), /unavailable/);
    assert.equal(ctx.workers.created.length, count);
});

test('an unclassified new provider string field also blocks at runtime', async () => {
    const { integration_options_config } = await import('../../options/mzta-options-default.js');
    integration_options_config.ollama.future_prompt = '';
    try {
        const { worker, provider, output } = await adapter();
        worker.postMessage({ type: 'init', ollama_future_prompt: 'Alice secret' });
        worker.postMessage({ type: 'chatMessage', message: 'Alice' });
        await flush(3);
        assert.equal(provider.posted.length, 0);
        assert.ok(output.some(m => m.type === 'error' && /unclassified/i.test(m.payload)));
    } finally {
        delete integration_options_config.ollama.future_prompt;
    }
});

test('provider abort releases the active session for the next request', async () => {
    const { worker, provider } = await adapter();
    worker.postMessage({ type: 'chatMessage', message: 'Alice' });
    await flush(3);
    provider.deliver({ type: 'requestAborted' });
    await flush(3);
    worker.postMessage({ type: 'chatMessage', message: 'Again Alice' });
    await flush(3);
    assert.equal(provider.posted.at(-1).message, 'Again [PRIVATE]');
});

test('Stop during before suppresses late dispatch', async () => {
    let release;
    companion.handle = m => m.action === 'aiProcessing.before' ? new Promise(resolve => {
        release = () => resolve(companion.reply(m, { input: m.input, context: {} }));
    }) : undefined;
    const { worker, provider } = await adapter();
    worker.postMessage({ type: 'chatMessage', message: 'Alice' }); await flush(3);
    assert.ok(release);
    worker.postMessage({ type: 'stop' }); release(); await flush(3);
    assert.equal(provider.posted.length, 0);
});

test('Stop during after suppresses late restored results', async () => {
    const { worker, provider, output } = await adapter();
    worker.postMessage({ type: 'chatMessage', message: 'Alice' }); await flush(3);
    let release;
    companion.handle = m => m.action === 'aiProcessing.after' ? new Promise(resolve => {
        release = () => resolve(companion.reply(m, { output: { content: 'Alice', thinking: '' } }));
    }) : undefined;
    provider.deliver(token('[PRIVATE]'), done()); await flush(3);
    assert.ok(release);
    worker.postMessage({ type: 'stop' }); release(); await flush(3);
    assert.equal(output.some(m => m.type === 'newToken'), false);
});
