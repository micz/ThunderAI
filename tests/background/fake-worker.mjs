/*
 *  The model Worker of mzta_specialCommand, scripted.
 *
 *  js/mzta-special-commands.js creates `new Worker(new URL('./workers/model-worker-<x>.js',
 *  import.meta.url), {type: 'module'})`. Node has no global Worker, and the real workers are the
 *  api area's business (tests/api/). Here the background is tested against the worker-to-caller
 *  contract of spec 04 ("Worker Lifecycle & Timeout", "Thinking in special commands"), from the
 *  caller's side, with no model, no fetch and no thread.
 *
 *  installFakeWorker() puts a fake `Worker` constructor on globalThis, where the module finds it as
 *  a bare name. The fake
 *
 *   - accepts only the five model workers of js/workers/ (or the ones the test allows) and THROWS
 *     on any other url or option, recording it in `unexpected`: an unexpected worker fails loudly;
 *   - records every message posted to each worker (init, chatMessage) in `posted`, cloned, and
 *     refuses a post after terminate();
 *   - delivers worker messages to the caller with `w.deliver(...messages)`, in order, through the
 *     caller's own `onmessage` (synchronously, as one event each); `w.crash(error)` calls onerror;
 *   - answers each chatMessage through `respond`, when the test sets one: a function
 *     (worker, prompt) => void that delivers (or holds) the answer. The helpers below build the
 *     usual ones. Without a responder a chatMessage stays unanswered until the test delivers.
 *
 *  The same idea as tests/webchat/fake-worker.mjs (an area never imports another area's helpers):
 *  that one drives a page and settles it after each message; this one drives a module directly.
 *
 *  Not a test file (no .test.mjs suffix). Imports nothing.
 */

export const MODEL_WORKERS = [
    'model-worker-openai_responses.js',
    'model-worker-google_gemini.js',
    'model-worker-ollama.js',
    'model-worker-openai_comp.js',
    'model-worker-anthropic.js',
];

const clone = v => (v === undefined ? undefined : structuredClone(v));

/**
 * Install the fake Worker. Returns its controller:
 *
 *   created            every worker, in creation order ({file, url, options, posted, terminated})
 *   unexpected         every refused construction ({url, options})
 *   respond            (worker, prompt) => void, or null: called (in a microtask) on each chatMessage
 *   prompts()          the prompt of every chatMessage, in order
 *   live()             the workers not terminated
 *   last()             the last worker created
 */
export function installFakeWorker({ allowed = MODEL_WORKERS } = {}) {
    const ctl = {
        created: [],
        unexpected: [],
        respond: null,
        prompts() {
            return ctl.created.flatMap(w => w.posted.filter(p => p.type === 'chatMessage').map(p => p.message));
        },
        live() { return ctl.created.filter(w => !w.terminated); },
        last() { return ctl.created[ctl.created.length - 1] || null; },
    };

    class FakeWorker {
        constructor(url, options) {
            const href = String(url);
            const m = /\/js\/workers\/([^/?#]+)$/.exec(href);
            if (!m || !allowed.includes(m[1]) || options?.type !== 'module') {
                ctl.unexpected.push({ url: href, options: clone(options) });
                throw new Error('fake Worker: unexpected worker ' + href + ' ' + JSON.stringify(options));
            }
            this.file = m[1];
            this.url = href;
            this.options = clone(options);
            this.posted = [];
            this.terminated = false;
            this.onmessage = null;
            this.onerror = null;
            ctl.created.push(this);
        }

        postMessage(message) {
            if (this.terminated) throw new Error('fake Worker: postMessage after terminate()');
            this.posted.push(clone(message));
            if (message && message.type === 'chatMessage' && ctl.respond) {
                const respond = ctl.respond;
                queueMicrotask(() => respond(this, message.message));
            }
        }

        terminate() { this.terminated = true; }

        /** The init message posted to this worker. */
        get init() { return this.posted.find(p => p.type === 'init') || null; }

        /** The prompt of this worker's chatMessage. */
        get prompt() { return this.posted.find(p => p.type === 'chatMessage')?.message ?? null; }

        /** Deliver worker messages ({type, payload, ...}) to the caller, in order. */
        deliver(...messages) {
            for (const data of messages) {
                if (this.terminated) throw new Error('fake Worker: deliver() after terminate(): the caller is gone');
                if (typeof this.onmessage !== 'function') throw new Error('fake Worker: the caller has no onmessage handler');
                this.onmessage({ data: clone(data) });
            }
        }

        /** The worker failing as a whole (a script error): onerror. */
        crash(error = { message: 'boom', filename: 'model-worker.js', lineno: 1, colno: 1 }) {
            if (typeof this.onerror !== 'function') throw new Error('fake Worker: the caller has no onerror handler');
            this.onerror(error);
        }
    }

    globalThis.Worker = FakeWorker;
    return ctl;
}

// Worker messages, as the model workers post them (spec 04).
export const token = t => ({ type: 'newToken', payload: { token: t } });
export const thinking = t => ({ type: 'newThinkingToken', payload: { token: t } });
export const done = () => ({ type: 'tokensDone', payload: {} });
export const sent = () => ({ type: 'messageSent', payload: {} });
export const retry = status => ({ type: 'newRetryAttempt', payload: { status, attempt: 1, maxRetries: 3, delayMs: 1000 } });
export const error = (payload, extra = {}) => ({ type: 'error', payload, ...extra });

/** A responder that answers every prompt with `answerFor(prompt, worker)`, as tokens then done. */
export function answering(answerFor) {
    return (w, prompt) => {
        const answer = answerFor(prompt, w);
        if (answer && answer.error !== undefined) {
            w.deliver(error(answer.error, answer.extra || {}));
            return;
        }
        w.deliver(sent(), token(String(answer)), done());
    };
}

/**
 * A responder that holds every prompt until the test releases it: `held` lists the pending
 * {worker, prompt, answer(text), fail(payload, extra)}, in arrival order.
 */
export function holding() {
    const held = [];
    const respond = (w, prompt) => {
        held.push({
            worker: w,
            prompt,
            answer(text) { w.deliver(token(String(text)), done()); },
            fail(payload, extra = {}) { w.deliver(error(payload, extra)); },
        });
    };
    return { respond, held };
}
