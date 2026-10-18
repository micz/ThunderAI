/*
 *  The fetch model of the api area: a scripted stand-in for the global `fetch`.
 *
 *  Every network call of js/api/* goes through fetchWithRetry() (js/api/api-retry.js), which
 *  calls the global `fetch` at call time; a few probes (Ollama fetchVersion/fetchModelInfo, the
 *  fetchModelInfo of Gemini and Claude) call it directly. Both reach this model once it is
 *  installed on globalThis.
 *
 *  A test scripts the calls it expects, in order:
 *
 *      const net = installFetchModel();
 *      net.expect({ method: 'POST', url: 'https://api.anthropic.com/v1/messages' },
 *                 () => jsonResponse({...}, { status: 400 }));
 *      net.expect(/\/api\/chat$/, NET.networkError());     // a rejected fetch
 *      net.expect(/\/api\/chat$/, NET.hang);               // never answers until aborted
 *
 *  Each call is matched against the HEAD of the queue only (strict order) and consumes it. The
 *  answer is a function of the recorded call returning a Response (or a promise of one), or one
 *  of the NET helpers. A Response is built fresh per call: bodies are single-use.
 *
 *  No network, ever: a call nothing was scripted for is RECORDED as a violation and then
 *  rejected with an UnscriptedFetchError naming the URL. Recording comes first because the
 *  clients catch fetch failures (fetchWithRetry() even retries them), so the rejection alone
 *  could be swallowed. guard() (harness.mjs wraps every test of the area in it) fails the test
 *  at once when a violation happens - it does not wait for a retry backoff - and, at the end,
 *  when a violation was swallowed or a scripted answer was never consumed.
 *
 *  Like the real fetch, a call whose signal is already aborted rejects with the signal's reason,
 *  and an answer still pending (NET.hang, a deferred) rejects with the reason when the signal
 *  aborts. Also like the real fetch, the signal still matters once a Response is returned: an
 *  abort then errors its body stream with the signal's reason, so a pending `response.text()` or
 *  `reader.read()` rejects (a body already read to the end is unaffected). The scripted Response
 *  is handed over with its body piped through a stream the signal can error, keeping its status,
 *  statusText and headers.
 */

export class UnscriptedFetchError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UnscriptedFetchError';
    }
}

/** Answers that are not a Response. */
export const NET = {
    /** Never answers; rejects with the signal's reason when the request is aborted. */
    hang: Symbol('hang'),
    /** A rejected fetch, as Firefox reports an unreachable server or a CORS rejection. */
    networkError(message = 'NetworkError when attempting to fetch resource.') {
        return () => { throw new TypeError(message); };
    },
};

function headerObject(h) {
    const out = {};
    for (const [k, v] of new Headers(h || {})) out[k] = v;
    return out;
}

function matches(m, call) {
    if (typeof m === 'string') return call.url === m;
    if (m instanceof RegExp) return m.test(call.url);
    if (typeof m === 'function') return !!m(call);
    if (m && typeof m === 'object') {
        if (m.method && m.method !== call.method) return false;
        if (m.url !== undefined) return matches(m.url, call);
        return true;
    }
    return false;
}

function describeMatcher(m) {
    if (typeof m === 'string' || m instanceof RegExp) return String(m);
    if (m && typeof m === 'object') return (m.method ? m.method + ' ' : '') + String(m.url ?? '*');
    return 'a predicate';
}

/**
 * The Response as the real fetch hands it over: its body errors with the signal's reason when
 * the signal aborts. pipeThrough() with a signal aborts the writable side on abort, which errors
 * the readable side with the reason (and cancels the scripted stream, as a cut connection would).
 */
function abortableBody(r, signal) {
    if (r.body === null) return r;
    return new Response(r.body.pipeThrough(new TransformStream(), { signal }), {
        status: r.status,
        statusText: r.statusText,
        headers: r.headers,
    });
}

export function installFetchModel() {
    const original = globalThis.fetch;
    const queue = [];
    const calls = [];
    const violations = [];
    let onViolation = null;

    function violate(err) {
        violations.push(err);
        if (onViolation) onViolation(err);
    }

    function fetchModel(input, init = {}) {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        const body = init.body === undefined ? undefined : String(init.body);
        const call = {
            url,
            method: (init.method || 'GET').toUpperCase(),
            headers: headerObject(init.headers),
            body,
            signal: init.signal || null,
            t: Date.now(),
            json() { return JSON.parse(body); },
        };
        calls.push(call);

        const head = queue[0];
        if (!head || !matches(head.match, call)) {
            const err = new UnscriptedFetchError('unscripted fetch: ' + call.method + ' ' + url
                + (head ? ' (the next scripted call is ' + describeMatcher(head.match) + ')' : ' (nothing scripted)'));
            violate(err);
            return Promise.reject(err);
        }
        queue.shift();

        const signal = call.signal;
        if (signal && signal.aborted) return Promise.reject(signal.reason);

        return new Promise((resolve, reject) => {
            const onAbort = () => reject(signal.reason);
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
            const settle = (fn, v) => {
                if (signal) signal.removeEventListener('abort', onAbort);
                fn(v);
            };
            if (head.answer === NET.hang) return;   // only the abort listener can settle it
            let out;
            try {
                out = typeof head.answer === 'function' ? head.answer(call) : head.answer;
            } catch (e) {
                settle(reject, e);
                return;
            }
            Promise.resolve(out).then(
                r => {
                    if (!(r instanceof Response)) {
                        const err = new Error('the scripted answer for ' + url + ' is not a Response');
                        violate(err);
                        settle(reject, err);
                    } else {
                        settle(resolve, signal ? abortableBody(r, signal) : r);
                    }
                },
                e => settle(reject, e),
            );
        });
    }

    globalThis.fetch = fetchModel;

    return {
        calls,
        violations,
        /** Script the next call: a matcher (URL string, RegExp, {method, url}, predicate) and an answer. */
        expect(match, answer) {
            queue.push({ match, answer });
            return this;
        },
        /** How many scripted answers are still waiting for their call. */
        pending() { return queue.length; },
        /** Forget the remaining script and the recorded calls (between two tests). */
        reset() {
            queue.length = 0;
            calls.length = 0;
            violations.length = 0;
        },
        /**
         * Wrap a test function: a violation fails it at once, and at the end every scripted
         * answer must have been consumed and no violation swallowed.
         */
        guard(fn) {
            return async (t) => {
                this.reset();
                let rejectViolation;
                const violated = new Promise((_, rej) => { rejectViolation = rej; });
                violated.catch(() => {});
                onViolation = (err) => rejectViolation(err);
                try {
                    await Promise.race([Promise.resolve().then(() => fn(t)), violated]);
                    if (violations.length) throw violations[0];
                    if (queue.length) {
                        throw new Error(queue.length + ' scripted fetch answer(s) never consumed, the next: '
                            + describeMatcher(queue[0].match));
                    }
                } finally {
                    onViolation = null;
                }
            };
        },
        restore() { globalThis.fetch = original; },
    };
}
