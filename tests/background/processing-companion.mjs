// Scripted API v1 companion, not a detector/model. Tests exercise the real broker
// and worker adapter against this external transport boundary.
export function fakeProcessingCompanion() {
    const fake = {
        available: true, instanceId: 'processor-instance', calls: [], handle: null,
        model: { ready: true, downloading: false, progress: null, error: null },
        status() { return { ok: true, protocol: 1, instanceId: fake.instanceId, version: '1.0.0', ...fake.model }; },
        async receive(message) {
            fake.calls.push(structuredClone(message));
            if (!fake.available) throw new Error('Could not establish connection. Receiving end does not exist.');
            if (fake.handle) {
                const result = fake.handle(message);
                if (result !== undefined) return result;
            }
            if (message.action === 'aiProcessing.hello') return fake.status();
            if (message.instanceId !== fake.instanceId) return { ok: false, error: { message: 'expired instance' } };
            if (message.action === 'aiProcessing.before') return fake.reply(message, {
                input: { message: mask(message.input.message), instructions: map(message.input.instructions, mask),
                    extraBody: map(message.input.extraBody, mask) }, context: { token: message.requestId },
            });
            if (message.action === 'aiProcessing.after') return fake.reply(message, {
                output: map(message.output, restore),
            });
            return fake.reply(message);
        },
        reply(message, result = {}) { return { ...fake.status(), callId: message.callId, ...result }; },
        // The companion's model changed (spec 09 "Model readiness"): what it sends ThunderAI.
        readinessChanged(model = {}, instanceId = fake.instanceId) {
            Object.assign(fake.model, model);
            return externalProcessingMessage({ action: 'aiProcessing.readinessChanged', protocol: 1, instanceId, ...fake.model });
        },
        // ThunderAI's own switch (spec 09 "Activation switch"), as its options page writes it.
        async activate(enabled = true) {
            await browser.storage.local.set({ ai_processing_enabled: enabled });
        },
    };
    return fake;
}
const mask = value => value.replaceAll('Alice', '[PRIVATE]');
const restore = value => value.replaceAll('[PRIVATE]', 'Alice');
const map = (object, fn) => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, fn(value)]));

export async function externalProcessingMessage(message, id = 'thunderai-privacy@micz.it') {
    for (const fn of browser.runtime.onMessageExternal._listeners) {
        const result = fn(message, { id });
        if (result !== undefined) return result;
    }
}

export function progressFor(message, current, overrides = {}) {
    return { ...message, action: 'aiProcessing.progress', progress: { phase: 'prompt', current, total: 3 }, ...overrides };
}
