/*
 *  Building what a provider sends, with Node's own Response, Headers, ReadableStream and
 *  TextEncoder - nothing installed. And reading the fixtures of tests/fixtures/api/.
 *
 *  The chunking is always explicit: a stream is a list of byte chunks exactly as the test wants
 *  them to arrive, so "an event split across two chunks" or "several events in one chunk" is a
 *  property of the test, never of the helper.
 */

import { readFileSync } from 'node:fs';
import {
    loadFixture,
    repoPath
} from '../helpers/core/load.mjs';

const enc = new TextEncoder();

/** A JSON response (an API answer or an error body). */
export function jsonResponse(body, { status = 200, statusText = '', headers = {} } = {}) {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        statusText,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

/** A plain-text response (a proxy's HTML page, an unparsable body). */
export function textResponse(text, { status = 200, statusText = '', headers = {} } = {}) {
    return new Response(text, { status, statusText, headers: { 'Content-Type': 'text/plain', ...headers } });
}

/**
 * A streamed response from a list of chunks (strings or Uint8Array), delivered in order.
 * `errorAfter: n` errors the stream after the first n chunks (a connection cut mid-stream),
 * with `error` (default: Firefox's TypeError for an interrupted body).
 */
export function streamResponse(chunks, { status = 200, statusText = '', headers = {}, errorAfter = null, error = null,
    contentType = 'text/event-stream' } = {}) {
    let i = 0;
    const stream = new ReadableStream({
        pull(controller) {
            if (errorAfter !== null && i >= errorAfter) {
                controller.error(error || new TypeError('Error in input stream'));
                return;
            }
            if (i >= chunks.length) {
                controller.close();
                return;
            }
            const c = chunks[i++];
            controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
        },
    });
    return new Response(stream, { status, statusText, headers: { 'Content-Type': contentType, ...headers } });
}

/**
 * A streamed response fed by the test: push() a chunk, close() or error() it. The body waits
 * for the test, so the test decides when a reader.read() resolves (a user stop, a slow stream).
 */
export function manualStream({ status = 200, headers = {}, contentType = 'text/event-stream' } = {}) {
    let ctrl;
    let cancelled = false;
    const stream = new ReadableStream({
        start(c) { ctrl = c; },
        cancel() { cancelled = true; },
    });
    return {
        response: new Response(stream, { status, headers: { 'Content-Type': contentType, ...headers } }),
        push(s) { ctrl.enqueue(typeof s === 'string' ? enc.encode(s) : s); },
        close() { ctrl.close(); },
        error(e) { ctrl.error(e || new TypeError('Error in input stream')); },
        get cancelled() { return cancelled; },
    };
}

/** One SSE event: `event: <name>` (optional) and `data: <json>`, terminated by a blank line. */
export function sse(data, event = null, eol = '\n') {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    return (event ? 'event: ' + event + eol : '') + 'data: ' + payload + eol + eol;
}

/** One NDJSON line (Ollama's /api/chat stream). */
export function ndjson(obj) {
    return (typeof obj === 'string' ? obj : JSON.stringify(obj)) + '\n';
}

/** Cut a string into chunks at the given character offsets. */
export function cutAt(text, ...offsets) {
    const out = [];
    let from = 0;
    for (const o of offsets) {
        out.push(text.slice(from, o));
        from = o;
    }
    out.push(text.slice(from));
    return out.filter(c => c !== '');
}

/**
 * Encode a text and cut the bytes INSIDE the first occurrence of a multi-byte character, so the
 * two chunks are each invalid UTF-8 on their own (a network chunk boundary falls anywhere).
 */
export function splitInsideChar(text, char) {
    const bytes = enc.encode(text);
    const at = enc.encode(text.slice(0, text.indexOf(char))).length + 1;
    if (text.indexOf(char) < 0 || enc.encode(char).length < 2) throw new Error('splitInsideChar: needs a multi-byte character of the text');
    return [bytes.slice(0, at), bytes.slice(at)];
}

/** A fixture of tests/fixtures/api/ (a JSON file of named entries, each with its `source`). */
export function apiFixture(name) {
    return loadFixture(name, 'api');
}

/**
 * The stream lines of a captured log (tests/fixtures/api/captured/*.txt): the payloads of the
 * worker's `line: "<json string>"` entries, in order, exactly as the worker received them.
 */
export function capturedLines(file) {
    const text = readFileSync(repoPath('tests/fixtures/api/captured/' + file), 'utf8');
    return [...text.matchAll(/\] line: (".*")$/gm)].map(m => JSON.parse(m[1]));
}

/** The text of one multi-line entry of a captured log, after `<marker>` (e.g. "response body: "). */
export function capturedEntry(file, marker) {
    const text = readFileSync(repoPath('tests/fixtures/api/captured/' + file), 'utf8');
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex(l => l.includes(marker));
    if (start === -1) throw new Error(file + ': no entry with ' + JSON.stringify(marker));
    const out = [lines[start].slice(lines[start].indexOf(marker) + marker.length)];
    for (let i = start + 1; i < lines.length && !/^(\d\d:\d\d:\d\d\.\d{3} |# )/.test(lines[i]); i++) out.push(lines[i]);
    return out.join('\n');
}
