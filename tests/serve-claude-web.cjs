// Local-only, allowlisted server for the native-DOM adapter fixture.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const allowed = new Map([
    ['/tests/claude-web-fixture.html', 'text/html'],
    ['/tests/claude-web-fixture.js', 'text/javascript'],
    ['/js/mzta-claude-web.js', 'text/javascript'],
    ['/_locales/en/messages.json', 'application/json']
]);
http.createServer((req, res) => {
    const name = new URL(req.url, 'http://127.0.0.1').pathname;
    if (!allowed.has(name)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', allowed.get(name) + '; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(path.join(root, name)).pipe(res);
}).listen(8123, '127.0.0.1', () => console.log('Fixture: http://127.0.0.1:8123/tests/claude-web-fixture.html'));
