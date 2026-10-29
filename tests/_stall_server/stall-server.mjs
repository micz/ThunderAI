// Manual test server for the stream idle timeout (#999) and the redirects of the custom
// endpoints (#1000): see README.md next to it.
// A tool for testing by hand in Thunderbird: npm test never runs it (its name is not
// *.test.mjs) and, like the whole tests/ folder, it is never packaged. No dependency.
//
//   node stall-server.mjs [--port 8787] [--chunks 3] [--ping 0] [--resume 0]
//                         [--redirect 0] [--redirect-to URL]
//
//   --chunks N        tokens sent before the stream stalls (default 3)
//   --ping S          while stalled, send a keep-alive every S seconds (0 = none, a real stall)
//   --resume S        after S seconds of stall, send the rest of the answer and end (0 = never)
//   --redirect CODE   answer every request with this 3xx status (301, 302, 303, 307, 308; 0 = none)
//   --redirect-to URL the origin the redirect points to (default: this server, a redirect of the
//                     path only). The target is the same path under /_redirected, which this
//                     server answers normally, never redirecting it again (#1000)
//
// Speaks two protocols, so it can stand in for two ThunderAI connections:
//   OpenAI-compatible: POST /v1/chat/completions (SSE; keep-alive = ": OPENROUTER PROCESSING")
//                      GET  /v1/models
//   Ollama:            POST /api/chat (NDJSON; keep-alive = an empty line)
//                      GET  /api/tags, GET /api/version
import http from 'node:http';

const arg = (name, def) => {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const PORT = arg('port', 8787);
const CHUNKS = arg('chunks', 3);
const PING_S = arg('ping', 0);
const RESUME_S = arg('resume', 0);
const REDIRECT = arg('redirect', 0);
const REDIRECT_TO = (() => {
    const i = process.argv.indexOf('--redirect-to');
    return i >= 0 ? process.argv[i + 1].replace(/\/+$/, '') : '';
})();
const REDIRECTED = '/_redirected';
const WORDS = ['Hello', ' from', ' the', ' stall', ' server', '.', ' The', ' stream', ' resumed', ' and', ' ended', '.'];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function stream(req, res, { contentType, token, keepAlive, end }) {
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    let i = 0;
    const timers = [];
    const stop = () => timers.forEach(t => { clearInterval(t); clearTimeout(t); });
    res.on('close', () => { stop(); if (!res.writableEnded) log('client closed the connection (aborted after ' + i + ' tokens)'); });
    const tick = setInterval(() => {
        if (i < CHUNKS) {
            res.write(token(WORDS[i++ % WORDS.length]));
            log('sent token ' + i);
            return;
        }
        clearInterval(tick);
        log('stalling' + (PING_S ? ', keep-alive every ' + PING_S + ' s' : ', no keep-alive') + (RESUME_S ? ', resuming in ' + RESUME_S + ' s' : ''));
        if (PING_S) timers.push(setInterval(() => { res.write(keepAlive); log('keep-alive'); }, PING_S * 1000));
        if (RESUME_S) timers.push(setTimeout(() => {
            stop();
            while (i < WORDS.length) res.write(token(WORDS[i++]));
            res.end(end);
            log('resumed and ended');
        }, RESUME_S * 1000));
    }, 300);
    timers.push(tick);
}

http.createServer((req, res) => {
    log(req.method, req.url);
    req.resume();
    if (req.url.startsWith(REDIRECTED + '/')) {
        req.url = req.url.slice(REDIRECTED.length);
    } else if (REDIRECT) {
        const location = REDIRECT_TO + REDIRECTED + req.url;
        log('redirect ' + REDIRECT + ' -> ' + location);
        res.writeHead(REDIRECT, { Location: location });
        return res.end();
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ object: 'list', data: [{ id: 'stall-model', object: 'model' }] }));
    }
    if (req.method === 'GET' && req.url.startsWith('/api/tags')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ models: [{ name: 'stall-model', model: 'stall-model' }] }));
    }
    if (req.method === 'GET' && req.url.startsWith('/api/version')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ version: '0.0.0-stall' }));
    }
    if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
        return stream(req, res, {
            contentType: 'text/event-stream',
            token: t => 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: t } }] }) + '\n\n',
            keepAlive: ': OPENROUTER PROCESSING\n\n',
            end: 'data: [DONE]\n\n',
        });
    }
    if (req.method === 'POST' && req.url.startsWith('/api/chat')) {
        return stream(req, res, {
            contentType: 'application/x-ndjson',
            token: t => JSON.stringify({ model: 'stall-model', message: { role: 'assistant', content: t }, done: false }) + '\n',
            keepAlive: '\n',
            end: JSON.stringify({ model: 'stall-model', message: { role: 'assistant', content: '' }, done: true }) + '\n',
        });
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found: ' + req.url } }));
}).listen(PORT, () => log('stall server on http://localhost:' + PORT + ' (chunks=' + CHUNKS + ', ping=' + PING_S + ' s, resume=' + RESUME_S + ' s' + (REDIRECT ? ', redirect=' + REDIRECT + ' to ' + (REDIRECT_TO || 'this server') : '') + ')'));
