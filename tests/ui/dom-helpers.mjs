/*
 *  Helpers of the ui area's DOM files. Area-local: they build on the ctx openPage() returns
 *  (tests/helpers/core/dom-harness.mjs) and change nothing in the core.
 *
 *  No jsdom import here: the page's globals are already installed by openPage().
 */

/**
 * Script the network for ONE DOM file. The harness's fetch stub records every call and rejects;
 * the provider clients look `fetch` up on the global object at call time (fetchWithRetry() in
 * js/api/api-retry.js, the direct probes), so a file may replace it after openPage(). This keeps
 * the stub's contract - every call is recorded in ctx.fetchCalls, an unscripted call rejects
 * like the stub's - and adds answers, each consumed by the first call it matches:
 *
 *   const net = scriptFetch(ctx);
 *   net.answer('https://api.openai.com/v1/models', () => json({ data: [...] }));
 *   net.answer(url => url.endsWith('/api/version'), () => json({ version: '0.5.0' }));
 *   net.fail('https://...');                       // a network error (TypeError), as Firefox
 *   const req = net.hang('https://...');           // no answer until the request is aborted
 *   net.pending()                                  // the answers no call consumed yet
 *
 * A matcher is a string (the exact url), a RegExp or a predicate on (url, init).
 */
export function scriptFetch(ctx) {
    const answers = [];
    const matches = (m, url, init) => typeof m === 'string' ? m === url
        : m instanceof RegExp ? m.test(url) : m(url, init);
    globalThis.fetch = async (input, init) => {
        const url = String(input && input.url || input);
        ctx.fetchCalls.push({ url, init });
        if (init?.signal?.aborted) throw init.signal.reason;
        const i = answers.findIndex(a => matches(a.match, url, init));
        if (i === -1) throw new TypeError('fetch is disabled in the DOM tests (unscripted: ' + url + ')');
        const [a] = answers.splice(i, 1);
        return a.respond(url, init);
    };
    return {
        answer(match, respond) { answers.push({ match, respond }); },
        fail(match) { answers.push({ match, respond: () => { throw new TypeError('NetworkError when attempting to fetch resource.'); } }); },
        /**
         * A server that never answers: the call stays pending until its signal aborts it, then
         * rejects with the signal's reason, as fetch() does. Returns {called, aborted, reason}.
         */
        hang(match) {
            const req = { called: false, aborted: false, reason: undefined };
            answers.push({
                match,
                respond: (url, init) => new Promise((resolve, reject) => {
                    req.called = true;
                    init?.signal?.addEventListener('abort', () => {
                        req.aborted = true;
                        req.reason = init.signal.reason;
                        reject(init.signal.reason);
                    }, { once: true });
                }),
            });
            return req;
        },
        pending: () => answers.map(a => String(a.match)),
    };
}

/**
 * Fake time for the timers longer than `over` ms (default 1 s) that the page starts while it is
 * installed: the connection test's ~10 s and "Update list"'s 20 s time-outs, the 30 s fade of the
 * green status. settle() never waits for such timers (tests/helpers/core/dom-harness.mjs), so
 * holding them changes nothing it tracks; the shorter ones still go to the harness's tracked
 * setTimeout. The page's modules call the bare `setTimeout`, looked up on globalThis at call
 * time, so the clock replaces the global pair (the harness's wrappers) and puts them back on
 * uninstall(); timers still held then never fire.
 *
 *   const clock = holdLongTimers(ctx);
 *   await ctx.click(link);                 // the page starts its 10 s timer: held
 *   await clock.advance(9999);             // nothing due yet
 *   await clock.advance(1);                // the due timers run, in due order then start order
 *   clock.uninstall();
 *
 * advance() settles the page after each timer it runs, as the event loop would give the page a
 * turn between two timer tasks.
 */
export function holdLongTimers(ctx, { over = 1000 } = {}) {
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    class Held {}
    const held = new Map();     // Held handle -> {due, seq, fn, args}
    let now = 0;
    let seq = 0;
    globalThis.setTimeout = function (fn, ms = 0, ...args) {
        if (!(Number(ms) > over)) return realSet.call(this, fn, ms, ...args);
        const handle = new Held();
        held.set(handle, { due: now + Number(ms), seq: seq++, fn: typeof fn === 'function' ? fn : () => {}, args });
        return handle;
    };
    globalThis.clearTimeout = function (handle) {
        if (handle instanceof Held) { held.delete(handle); return; }
        return realClear.call(this, handle);
    };
    return {
        /** The delays (ms from now) of the timers held and not yet run. */
        pending: () => [...held.values()].map(t => t.due - now),
        async advance(ms) {
            const target = now + ms;
            for (;;) {
                const next = [...held.entries()]
                    .filter(([, t]) => t.due <= target)
                    .sort(([, a], [, b]) => a.due - b.due || a.seq - b.seq)[0];
                if (!next) break;
                const [handle, t] = next;
                held.delete(handle);
                now = t.due;
                t.fn(...t.args);
                await ctx.settle();
            }
            now = target;
            await ctx.settle();
        },
        uninstall() {
            globalThis.setTimeout = realSet;
            globalThis.clearTimeout = realClear;
        },
    };
}

/** A JSON Response (Node's own, as the providers parse it). */
export function json(body, { status = 200, statusText = 'OK' } = {}) {
    return new Response(JSON.stringify(body), { status, statusText, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Settle the page until `pred()` holds, or throw after `ms`. settle() alone may return while a
 * scripted Response body is still being read (that is not a browser-mock promise it tracks).
 */
export async function until(ctx, pred, what = 'the condition', ms = 5000) {
    const start = Date.now();
    for (;;) {
        await ctx.settle();
        if (pred()) return;
        if (Date.now() - start > ms) throw new Error('until(): ' + what + ' did not happen within ' + ms + ' ms');
        await new Promise(r => setTimeout(r, 10));
    }
}

/** Whether an element is shown as far as the DOM says (inline display, `hidden`, an ancestor's). */
export function shown(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        if (e.hidden || e.style.display === 'none' || e.classList.contains('hidden')) return false;
    }
    return true;
}

/** Set a control's value as the user would and fire the events the page listens to. */
export async function userSets(ctx, el, value) {
    if (el.type === 'checkbox') {
        if (el.checked !== value) await ctx.click(el);
        return;
    }
    el.value = value;
    await ctx.fire(el, 'input');
    await ctx.fire(el, 'change');
}

/** The storage.local writes since `since` (an index into ctx.ctl.calls), merged into one object. */
export function writtenSince(ctx, since) {
    return Object.assign({}, ...ctx.localWrites(since).map(c => c.items));
}
