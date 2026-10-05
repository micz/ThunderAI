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
        pending: () => answers.map(a => String(a.match)),
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
