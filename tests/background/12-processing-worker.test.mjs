// Spec 09: provider transparency, active buffering, busy notification and Stop.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
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
const { ProcessingWorker } = await import('../../js/mzta-processing-worker.js');
const adapters = [];
beforeEach(async () => {
    companion.available = true; companion.handle = null;
    await companion.announce(); companion.calls.length = 0;
});
afterEach(async () => { for (const adapter of adapters.splice(0)) adapter.terminate(); await flush(2); });
function adapter() {
    const provider = new Worker(new URL('../../js/workers/model-worker-openai_responses.js', import.meta.url), { type: 'module' });
    const worker = new ProcessingWorker(provider);
    const output = []; worker.onmessage = ({ data }) => output.push(data);
    adapters.push(worker);
    worker.postMessage({ type: 'init', chatgpt_api_key: 'API_SECRET', chatgpt_developer_messages: 'Alice rules' });
    return { worker, provider, output };
}

test('inactive adapter forwards all prompts, even before init settles or while a turn is pending', async () => {
    await companion.announce(false);
    const { worker, provider, output } = adapter();
    for (const message of ['first', 'second', 'third']) worker.postMessage({ type: 'chatMessage', message });
    await flush(3);
    assert.deepEqual(provider.posted.map(m => m.type), ['init', 'chatMessage', 'chatMessage', 'chatMessage']);
    assert.deepEqual(provider.posted.slice(1).map(m => m.message), ['first', 'second', 'third']);
    provider.deliver(token('live'));
    assert.equal(output.at(-1).payload.token, 'live'); // synchronous streaming, no buffering
    assert.equal(companion.calls.filter(m => m.action === 'aiProcessing.before').length, 0);
});

test('active companion transforms instructions and buffers/restores content/thinking without contaminating provider history', async () => {
    const { worker, provider, output } = adapter();
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

test('active busy sends produce a notification without disturbing the current turn', async () => {
    const { worker, provider, output } = adapter();
    worker.postMessage({ type: 'chatMessage', message: 'Alice' }); await flush(3);
    worker.postMessage({ type: 'chatMessage', message: 'second Alice' }); await flush(3);
    assert.equal(output.filter(m => m.type === 'processingBusy').length, 1);
    assert.equal(provider.posted.filter(m => m.type === 'chatMessage').length, 1);
    assert.equal(worker.busy, true);
    provider.deliver(token('[PRIVATE]'), done()); await flush(3);
    assert.equal(output.find(m => m.type === 'newToken').payload.token, 'Alice');
});

test('active failure dispatches no provider init or prompt', async () => {
    companion.handle = m => m.action === 'aiProcessing.before' ? { ok: false, error: { message: 'blocked by processor' } } : undefined;
    const { worker, provider, output } = adapter();
    worker.postMessage({ type: 'chatMessage', message: 'Alice' }); await flush(3);
    assert.equal(provider.posted.length, 0);
    assert.ok(output.some(m => m.type === 'error' && m.payload === 'blocked by processor'));
});

test('Stop during before suppresses late dispatch', async () => {
    let release;
    companion.handle = m => m.action === 'aiProcessing.before' ? new Promise(resolve => {
        release = () => resolve(companion.reply(m, { input: m.input, context: {} }));
    }) : undefined;
    const { worker, provider } = adapter();
    worker.postMessage({ type: 'chatMessage', message: 'Alice' }); await flush(3);
    assert.ok(release);
    worker.postMessage({ type: 'stop' }); release(); await flush(3);
    assert.equal(provider.posted.length, 0);
});

test('Stop during after suppresses late restored results', async () => {
    const { worker, provider, output } = adapter();
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

test('ChatGPT Web reply/replace runs the after hook on extracted HTML', async () => {
    runInThisContext(readFileSync(new URL('../../js/lib/mzta-html-lines.js', import.meta.url), 'utf8'));
    const web = await import('../../js/mzta-processing-web.js');
    web.registerProcessingWeb(7, { prompt: 'Hello Alice', targetTabId: 9, mailMessageId: 10 });
    const sender = { tab: { id: 7 }, url: 'https://chatgpt.com/', frameId: 0 };
    try {
        const prompt = await web.handleProcessingWebMessage({ command: 'processing_web_prompt' }, sender);
        assert.equal(prompt.ok, true, prompt.error); assert.ok(!prompt.text.includes('Alice'));
        const result = await web.processWebAction({ text: '<p>[PRIVATE]</p>', processingActive: true }, sender);
        assert.equal(result.text, '<p>Alice</p>'); assert.equal(result.tabId, 9);
        assert.equal(companion.calls.find(m => m.action === 'aiProcessing.after').format, 'html');
    } finally { web.disposeProcessingWeb(7); }
});
