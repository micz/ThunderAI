/*
 *  A controlled clock for the ChatGPT Web content scripts.
 *
 *  The two scripts look their timers up as bare names (setTimeout, setInterval, Date.now(),
 *  performance.now()). Each run of a script gets one clock, handed to it as those names: no real
 *  time passes, and a test moves the time with advance(). Every due callback runs in time order
 *  (a tie in creation order), each followed by a flush of the promise jobs and the mutation
 *  observers it queued, so a callback that resolves a promise sees its continuation run before the
 *  next one fires, as in a browser.
 *
 *  pending() names what is still scheduled (kind, delay, the callback's name), which is how the
 *  tests check that a script cleaned up its own timers.
 *
 *  No jsdom here, so level 1 can import it.
 */

/** Let the promise jobs and the mutation observer callbacks queued so far run. */
export async function flush() {
    for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
}

export function createClock({ start = 0 } = {}) {
    let now = start;
    let seq = 0;
    const jobs = new Map();
    const errors = [];

    const add = (kind, fn, delay, args) => {
        const id = ++seq;
        const ms = Math.max(0, Number(delay) || 0);
        jobs.set(id, {
            kind,
            fn: typeof fn === 'function' ? fn : () => {},
            args,
            delay: ms,
            at: now + ms,
            every: kind === 'interval' ? Math.max(1, ms) : 0,
        });
        return id;
    };
    const clear = id => { jobs.delete(id); };

    class ClockDate extends Date {
        constructor(...args) {
            if (args.length) super(...args);
            else super(now);
        }
        static now() { return now; }
    }

    /** The names a script reads its time from. */
    const globals = {
        setTimeout: (fn, delay, ...args) => add('timeout', fn, delay, args),
        setInterval: (fn, delay, ...args) => add('interval', fn, delay, args),
        clearTimeout: clear,
        clearInterval: clear,
        Date: ClockDate,
        // the navigation timing entry is not modelled: the debug timing line reads null
        performance: { now: () => now, getEntriesByType: () => [] },
    };

    return {
        globals,
        now: () => now,
        /** What is still scheduled: [{kind, delay, name, at}]. */
        pending() {
            return [...jobs.values()].map(j => ({ kind: j.kind, delay: j.delay, name: j.fn.name, at: j.at }));
        },
        /** Exceptions thrown by a callback (a browser reports them and goes on). */
        errors,
        /** Move the time forward by `ms`, running every callback that falls due, in order. */
        async advance(ms) {
            const end = now + ms;
            await flush();
            for (;;) {
                let next = null;
                for (const entry of jobs) {
                    if (entry[1].at > end) continue;
                    if (!next || entry[1].at < next[1].at) next = entry;
                }
                if (!next) break;
                const [id, job] = next;
                now = job.at;
                if (job.every) job.at += job.every;
                else jobs.delete(id);
                try {
                    job.fn(...job.args);
                } catch (e) {
                    errors.push(e);
                }
                await flush();
            }
            now = end;
            await flush();
        },
    };
}
