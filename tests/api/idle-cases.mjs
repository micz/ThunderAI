/*
 *  The stream idle timeout cases (spec 04 "Stream idle timeout"), the same for the five workers:
 *  each -errors file declares them on its own worker instance, before its history-after-errors
 *  (which then checks that the stalled question and its partial answer left the history). The
 *  Stop during a stall keeps its partial answer in the history, as any Stop does: its case is
 *  declared apart, after history-after-errors, and checks the history itself.
 *
 *  The worker was initialised without api_stream_idle_timeout, so it applies the default,
 *  120 s (spec 05). Time runs on the mock timers (fakeTime()): no real waiting.
 *
 *      idleTimeoutCases(k, { w, net, match, failed, open, first, rest, keepAlive });
 *      idleStopCase(k, { w, net, match, open, first, rest, history });
 *
 *  - history(call): the history a request sent, as [role, text] pairs, the answer's role
 *               given as 'assistant' whatever the provider calls it;
 *  - match:     the matcher of the streaming request (as for net.expect());
 *  - failed:    the provider's "<provider>_api_request_failed" text the worker was given;
 *  - open():    a fresh manualStream() with the provider's content type;
 *  - first:     the wire text of the start of an answer (at least one token);
 *  - rest:      the wire text that completes it;
 *  - keepAlive: what the provider sends to keep a silent stream open (a ping event, an SSE
 *               comment, an empty line): data that carries no token.
 */

import assert from 'node:assert/strict';
import { fakeTime } from './harness.mjs';
import {
    flush,
    startTurn,
    until
} from './worker-realm.mjs';

/** The en text of error_stream_idle_timeout, as the window hands it over (the literal $SECONDS$). */
export const IDLE = 'The server stopped responding: no data received for $SECONDS$ seconds';

const DEFAULT_MS = 120000;   // spec 05: api_stream_idle_timeout defaults to 120000 ms

const errorOf = t => t.posted().filter(m => m.type === 'error');
const started = turn => until(() => turn.posted().some(m => m.type === 'newToken' || m.type === 'newThinkingToken'), 'the first token');
const tokensOf = (turn, type) => turn.posted().filter(m => m.type === type).map(m => m.payload.token).join('');

export function idleTimeoutCases(k, { w, net, match, failed, open, first, rest, keepAlive }) {
    const idleText = failed + ': ' + IDLE.replace('$SECONDS$', '120');

    k.test('idle-timeout', 'no data for 120 s once streaming: one error naming the stall, no tokensDone, the request aborted with its own reason', async (t) => {
        const timers = fakeTime(t);
        const s = open();
        net.expect(match, () => s.response);
        const turn = startTurn(w, 'q');
        s.push(first);
        await started(turn);
        timers.tick(DEFAULT_MS - 1);
        await flush();
        assert.equal(turn.settled(), false, 'not before 120 s of silence');
        assert.deepEqual(errorOf(turn), []);
        timers.tick(1);
        await turn.done;
        const errs = errorOf(turn);
        assert.equal(errs.length, 1);
        assert.equal(errs[0].payload, idleText);
        assert.notEqual(errs[0].rateLimited, true);
        const types = turn.posted().map(m => m.type);
        assert.equal(types.includes('tokensDone'), false);
        assert.equal(types.includes('requestAborted'), false, 'not reported as a Stop');
        assert.equal(types.includes('newRetryAttempt'), false, 'a stall once streaming is never retried');
        assert.equal(net.calls.length, 1, 'no second request');
        assert.equal(net.calls[0].signal.aborted, true, 'the request was aborted');
        assert.equal(net.calls[0].signal.reason.name, 'IdleTimeoutError');
        assert.equal(s.cancelled, true, 'the stream was cancelled');
    });

    k.test('idle-keepalive', 'keep-alives count as data: 400 s of keep-alives only (one every 100 s) do not end the turn, which then completes', async (t) => {
        const timers = fakeTime(t);
        const s = open();
        net.expect(match, () => s.response);
        const turn = startTurn(w, 'Keep me alive');
        s.push(first);
        await started(turn);
        for (let i = 0; i < 3; i++) {
            timers.tick(100000);
            s.push(keepAlive);
            await flush();
        }
        timers.tick(100000);   // 100 s after the last keep-alive, 400 s after the first token
        await flush();
        assert.equal(turn.settled(), false);
        assert.deepEqual(errorOf(turn), []);
        s.push(rest);
        s.close();
        await turn.done;
        assert.deepEqual(errorOf(turn), []);
        assert.equal(turn.posted().at(-1).type, 'tokensDone');
    });

    k.test('idle-cleared', 'a turn that ends normally leaves no idle timer behind', async (t) => {
        const timers = fakeTime(t);
        const s = open();
        net.expect(match, () => s.response);
        const turn = startTurn(w, 'Short answer');
        s.push(first + rest);
        s.close();
        await turn.done;
        const posted = w.posted.length;
        timers.tick(DEFAULT_MS * 2);
        await flush();
        assert.equal(w.posted.length, posted, 'nothing posted after the turn');
        assert.equal(net.calls[0].signal.aborted, false, 'no stray timer aborted the finished request');
    });
}

export function idleStopCase(k, { w, net, match, open, first, rest, history }) {
    k.test('idle-stop-during-stall', 'Stop during a stall ends the turn at once, as a Stop between two chunks: tokensDone, no error, the partial answer kept in the history, the next turn not stopped', async (t) => {
        const timers = fakeTime(t);
        const s = open();
        net.expect(match, () => s.response);
        const turn = startTurn(w, 'Stop me');
        s.push(first);
        await started(turn);
        timers.tick(DEFAULT_MS / 2);   // stalled for 60 s, well before the idle timeout
        await flush();
        await w.send({ type: 'stop' });
        await flush();
        assert.equal(turn.settled(), true, 'the Stop alone ended the turn, with no timer and no further data');
        await turn.done;
        assert.deepEqual(errorOf(turn), []);
        const types = turn.posted().map(m => m.type);
        assert.equal(types.filter(x => x === 'tokensDone').length, 1);
        assert.equal(types.at(-1), 'tokensDone');
        assert.equal(types.includes('requestAborted'), false, 'stopped once streaming, not before the answer');
        assert.equal(turn.posted().at(-1).payload.thinking, tokensOf(turn, 'newThinkingToken'), 'tokensDone carries the thinking received so far');
        assert.equal(net.calls[0].signal.reason.name, 'StopError', 'the request was aborted with the Stop reason');
        assert.equal(s.cancelled, true, 'the stream was cancelled');
        const partial = tokensOf(turn, 'newToken');

        const posted = w.posted.length;
        timers.tick(DEFAULT_MS * 2);
        await flush();
        assert.equal(w.posted.length, posted, 'no stray idle timer posts anything after the Stop');

        const s2 = open();
        net.expect(match, () => s2.response);
        const next = startTurn(w, 'After the stop');
        s2.push(first + rest);
        s2.close();
        await next.done;
        assert.deepEqual(errorOf(next), []);
        assert.equal(next.posted().at(-1).type, 'tokensDone', 'the next turn completes');
        assert.equal(s2.cancelled, false, 'the next turn was not stopped');
        assert.deepEqual(history(net.calls[1]).slice(-3), [
            ['user', 'Stop me'],
            ['assistant', partial],
            ['user', 'After the stop'],
        ], 'the stopped question and its partial answer stay in the history');
    });
}
