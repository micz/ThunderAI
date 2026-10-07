// Spec 01 "In-flight jobs (taJobRegistry)", the registry itself (js/mzta-job-registry.js):
//  - one entry per `${kind}:${headerMessageId}`, kind in summary | translation | spam | add_tags,
//    holding the job's promise; it is the only authority for "in progress";
//  - check and registration are synchronous and back to back: get() then start(), no await in
//    between, so two callers arriving together cannot both start;
//  - the promise never rejects: it resolves to an outcome {status: 'ok' | 'error' | 'skipped' |
//    'cancelled', data, errorMessage, rateLimited, retryAfterMs};
//  - the entry is removed when the job settles, in every path, so a retry in the same session
//    works and nothing stays "in progress";
//  - invalidate(): the entry object is the job's token, flagged; revive() clears the flag;
//  - logs (do_debug): [taJobs] start | join | invalidate | revive | end ... <kind>:<id>.
// How the generators use it (joining, broadcasting) is tested in 26-dedup and 25-inline-display.

import assert from 'node:assert/strict';
import { moduleContext, flush } from './context.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ctx = await moduleContext();
const { taJobRegistry } = await import('../../js/mzta-job-registry.js');
const k = caseTests('01-job-registry');

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

k.test('empty', 'with no job, get() is null and isRunning() false', () => {
    assert.equal(taJobRegistry.get('summary', 'none@x'), null);
    assert.equal(taJobRegistry.isRunning('summary', 'none@x'), false);
});

k.test('sync-registration', 'start() registers synchronously: the entry is there before start() returns', () => {
    const d = deferred();
    const entry = taJobRegistry.start('summary', 'a@x', () => d.promise);
    assert.equal(taJobRegistry.get('summary', 'a@x'), entry, 'get() returns the very entry, with no await in between');
    assert.equal(taJobRegistry.isRunning('summary', 'a@x'), true);
    assert.ok(entry.promise instanceof Promise);
    d.resolve({ status: 'ok' });
    return entry.promise;
});

k.test('job-not-run-synchronously', 'the job body does not run inside start(): even a job that never awaits finds its entry registered', async () => {
    let seenRunning = null;
    let ranInside = true;
    const entry = taJobRegistry.start('spam', 'b@x', () => {
        seenRunning = taJobRegistry.get('spam', 'b@x');
        return { status: 'ok' };
    });
    ranInside = seenRunning !== null;
    assert.equal(ranInside, false, 'the body has not run yet when start() returns');
    const outcome = await entry.promise;
    assert.equal(seenRunning, entry, 'while it ran, the entry was registered');
    assert.equal(outcome.status, 'ok');
});

k.test('keys-independent', 'one entry per kind and message: another kind or another message is a different job', async () => {
    const d = deferred();
    const e1 = taJobRegistry.start('summary', 'c@x', () => d.promise);
    assert.equal(taJobRegistry.get('translation', 'c@x'), null, 'same message, other kind');
    assert.equal(taJobRegistry.get('summary', 'c2@x'), null, 'same kind, other message');
    const e2 = taJobRegistry.start('translation', 'c@x', () => ({ status: 'ok' }));
    assert.notEqual(e1, e2);
    await e2.promise;
    assert.equal(taJobRegistry.get('summary', 'c@x'), e1, 'the translation ending left the summary running');
    d.resolve({ status: 'ok' });
    await e1.promise;
});

for (const kind of ['summary', 'translation', 'spam', 'add_tags']) {
    k.test('kind-' + kind.replace('_', '-'), `kind ${kind}: registered and removed like the others`, async () => {
        const entry = taJobRegistry.start(kind, 'kind@x', () => ({ status: 'ok' }));
        assert.equal(taJobRegistry.isRunning(kind, 'kind@x'), true);
        await entry.promise;
        assert.equal(taJobRegistry.isRunning(kind, 'kind@x'), false);
    });
}

k.test('removed-on-ok', 'the entry is removed when the job resolves', async () => {
    const entry = taJobRegistry.start('summary', 'd@x', async () => ({ status: 'ok', data: { summary: 's' } }));
    const outcome = await entry.promise;
    assert.deepEqual(outcome, { status: 'ok', data: { summary: 's' } });
    assert.equal(taJobRegistry.get('summary', 'd@x'), null);
});

k.test('throw-never-rejects', 'a job that throws: the promise resolves to an error outcome, never rejects, and the entry is removed', async () => {
    const entry = taJobRegistry.start('summary', 'e@x', async () => { throw new Error('kaboom'); });
    const outcome = await entry.promise;
    assert.equal(outcome.status, 'error');
    assert.match(outcome.errorMessage, /kaboom/);
    assert.equal(taJobRegistry.get('summary', 'e@x'), null, 'nothing stays in progress');
});

k.test('throw-rate-limited', 'a job that throws a rate-limited error: the outcome carries rateLimited and retryAfterMs', async () => {
    const err = Object.assign(new Error('429'), { rateLimited: true, retryAfterMs: 3600000 });
    const outcome = await taJobRegistry.start('translation', 'f@x', async () => { throw err; }).promise;
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.rateLimited, true);
    assert.equal(outcome.retryAfterMs, 3600000);
});

k.test('throw-sync', 'a job body that throws synchronously still resolves to an error outcome', async () => {
    const outcome = await taJobRegistry.start('spam', 'g@x', () => { throw new Error('sync'); }).promise;
    assert.equal(outcome.status, 'error');
    assert.equal(taJobRegistry.isRunning('spam', 'g@x'), false);
});

k.test('no-outcome', 'a job that returns nothing resolves to an outcome with one of the four statuses', async () => {
    const outcome = await taJobRegistry.start('add_tags', 'h@x', async () => undefined).promise;
    assert.ok(['ok', 'error', 'skipped', 'cancelled'].includes(outcome.status), JSON.stringify(outcome));
    assert.equal(taJobRegistry.isRunning('add_tags', 'h@x'), false);
});

k.test('retry-same-session', 'once a job settled, a new job for the same message can start (a retry works)', async () => {
    await taJobRegistry.start('summary', 'i@x', async () => { throw new Error('first'); }).promise;
    const second = taJobRegistry.start('summary', 'i@x', async () => ({ status: 'ok' }));
    assert.equal((await second.promise).status, 'ok');
});

k.test('joiners-share', 'every caller that finds the entry awaits the same promise and gets the same outcome', async () => {
    const d = deferred();
    const entry = taJobRegistry.start('summary', 'j@x', () => d.promise);
    const joiners = [taJobRegistry.get('summary', 'j@x').promise, taJobRegistry.get('summary', 'j@x').promise];
    d.resolve({ status: 'ok', data: { n: 1 } });
    const outcomes = await Promise.all([entry.promise, ...joiners]);
    for (const o of outcomes) assert.deepEqual(o, { status: 'ok', data: { n: 1 } });
});

k.test('invalidate', 'invalidate() flags the running entry (the job token) and returns true; false with no job', async () => {
    const d = deferred();
    const entry = taJobRegistry.start('translation', 'k@x', () => d.promise);
    assert.equal(entry.invalidated, false);
    assert.equal(taJobRegistry.invalidate('translation', 'k@x'), true);
    assert.equal(entry.invalidated, true);
    assert.equal(taJobRegistry.get('translation', 'k@x'), entry, 'still registered: the job decides what an invalidated landing does');
    assert.equal(taJobRegistry.invalidate('translation', 'nothing@x'), false);
    d.resolve({ status: 'cancelled' });
    await entry.promise;
});

k.test('revive', 'revive() clears the flag of an invalidated entry, and does nothing to a live one', async () => {
    const d = deferred();
    const entry = taJobRegistry.start('summary', 'l@x', () => d.promise);
    taJobRegistry.revive(entry);
    assert.equal(entry.invalidated, false);
    taJobRegistry.invalidate('summary', 'l@x');
    taJobRegistry.revive(entry);
    assert.equal(entry.invalidated, false);
    taJobRegistry.revive(null);
    d.resolve({ status: 'ok' });
    await entry.promise;
});

k.test('logs', 'the do_debug log lines name the action and <kind>:<id>', async () => {
    ctx.con.clear();
    const d = deferred();
    const entry = taJobRegistry.start('spam', 'log@x', () => d.promise);
    taJobRegistry.logJoin(entry);
    taJobRegistry.invalidate('spam', 'log@x');
    taJobRegistry.revive(entry);
    d.resolve({ status: 'ok' });
    await entry.promise;
    await flush(2);
    const lines = ctx.con.all().filter(l => l.startsWith('[taJobs]'));
    for (const action of ['start', 'join', 'invalidate', 'revive', 'end']) {
        assert.ok(lines.some(l => l.startsWith('[taJobs] ' + action + ' ') && l.includes('spam:log@x')),
            action + ' logged with spam:log@x: ' + JSON.stringify(lines));
    }
    assert.ok(lines.some(l => l.startsWith('[taJobs] end') && /\bok\b/.test(l)), 'the end line carries the status');
});

k.coverage();
