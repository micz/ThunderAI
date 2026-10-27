// Spec 04 "Custom endpoint policy", the pure rules of js/mzta-endpoint-policy.js [#1000]:
//  - only http: and https: URLs; anything else, an empty value or garbage cannot be used;
//  - no user name or password in the URL (URL.username / URL.password non-empty);
//  - http: needs no confirmation only for a loopback host: localhost (any case, trailing dot),
//    127.0.0.0/8, [::1]. 0.0.0.0, the private LAN ranges and *.local are not loopback;
//  - checkEndpoint(): an http: origin on another host is usable once approved (by URL.origin);
//  - maskUrlCredentials(): the user name and password never reach a log line.
// Worker-safe: no browser here.

import assert from 'node:assert/strict';
import { areaFile } from './harness.mjs';
import { assertNoBrowser } from './worker-realm.mjs';

assertNoBrowser();
const { k } = areaFile('08-endpoint-policy');
const {
    ENDPOINT_PROBLEM,
    parseEndpoint,
    isLoopbackHost,
    needsInsecureConfirmation,
    endpointOrigin,
    checkEndpoint,
    maskUrlCredentials,
    endpointProblemText,
} = await import('../../js/mzta-endpoint-policy.js');

const NO_CONFIRMATION = ['http://localhost:11434', 'http://LOCALHOST.:11434', 'http://127.0.0.1',
    'http://127.5.6.7', 'http://[::1]:8080', 'https://api.example.com/v1'];
const NEEDS_CONFIRMATION = ['http://192.168.1.10:11434', 'http://0.0.0.0', 'http://myserver.local',
    'http://10.0.0.5:1234', 'http://localhost.example.com', 'http://128.0.0.1'];
const CREDENTIALS = ['https://user:pass@host/', 'https://user@host/', 'http://:pass@localhost/'];
const BAD_SCHEME = ['ftp://host', 'file:///x', 'javascript:alert(1)', 'localhost:11434'];
const INVALID = ['', '   ', 'not a url', 'http//missing-colon', '://x', null, undefined];

k.test('allowed', 'loopback over http and any https URL are usable with no confirmation', () => {
    for (const url of NO_CONFIRMATION) {
        assert.equal(parseEndpoint(url).ok, true, url);
        assert.equal(needsInsecureConfirmation(url), false, url);
        assert.equal(checkEndpoint(url, []).ok, true, url);
    }
});

k.test('needs-confirmation', 'http to any other host needs the confirmation, and is refused without it', () => {
    for (const url of NEEDS_CONFIRMATION) {
        assert.equal(parseEndpoint(url).ok, true, url);
        assert.equal(needsInsecureConfirmation(url), true, url);
        const check = checkEndpoint(url, []);
        assert.equal(check.ok, false, url);
        assert.equal(check.problem, ENDPOINT_PROBLEM.INSECURE, url);
        assert.equal(check.origin, new URL(url).origin, url);
    }
});

k.test('credentials', 'a user name or a password in the URL is refused, loopback or not', () => {
    for (const url of CREDENTIALS) {
        assert.deepEqual(parseEndpoint(url), { ok: false, problem: ENDPOINT_PROBLEM.CREDENTIALS }, url);
        assert.equal(checkEndpoint(url, [new URL(url).origin]).problem, ENDPOINT_PROBLEM.CREDENTIALS, url);
        assert.equal(needsInsecureConfirmation(url), false, url + ': refused, not asked about');
    }
});

k.test('bad-scheme', 'a scheme other than http: and https: is refused', () => {
    for (const url of BAD_SCHEME) {
        assert.deepEqual(parseEndpoint(url), { ok: false, problem: ENDPOINT_PROBLEM.SCHEME }, url);
        assert.equal(needsInsecureConfirmation(url), false, url);
    }
});

k.test('invalid', 'an empty value or a string that is not a URL is refused', () => {
    for (const value of INVALID) {
        assert.deepEqual(parseEndpoint(value), { ok: false, problem: ENDPOINT_PROBLEM.INVALID }, String(value));
        assert.equal(checkEndpoint(value).ok, false, String(value));
        assert.equal(endpointOrigin(value), '', String(value));
    }
});

k.test('loopback-hosts', 'isLoopbackHost() on URL.hostname values and bare names', () => {
    for (const h of ['localhost', 'LOCALHOST', 'localhost.', '127.0.0.1', '127.255.255.254', '[::1]', '::1']) {
        assert.equal(isLoopbackHost(h), true, h);
    }
    for (const h of ['0.0.0.0', '192.168.1.10', '10.0.0.1', '172.16.0.1', 'myserver.local', 'sub.localhost',
        'localhost.example.com', '127.0.0.256', '127.0.0', '[::]', '::ffff:127.0.0.1', '', null]) {
        assert.equal(isLoopbackHost(h), false, String(h));
    }
});

k.test('approved-origin', 'an approval is per origin: the same server on another port or scheme is asked again', () => {
    const approved = ['http://192.168.1.10:11434'];
    assert.equal(checkEndpoint('http://192.168.1.10:11434', approved).ok, true);
    assert.equal(checkEndpoint('http://192.168.1.10:11434/some/path/', approved).ok, true, 'the path does not matter');
    assert.equal(checkEndpoint('http://192.168.1.10:8080', approved).problem, ENDPOINT_PROBLEM.INSECURE);
    assert.equal(checkEndpoint('http://192.168.1.11:11434', approved).problem, ENDPOINT_PROBLEM.INSECURE);
    assert.equal(checkEndpoint('http://192.168.1.10:11434', 'not an array').problem, ENDPOINT_PROBLEM.INSECURE);
});

k.test('origin', 'endpointOrigin() is URL.origin of a usable address, trimmed', () => {
    assert.equal(endpointOrigin('  http://MyServer.local:11434/v1/  '), 'http://myserver.local:11434');
    assert.equal(endpointOrigin('http://192.168.1.10:80/'), 'http://192.168.1.10', 'the default port is dropped');
    assert.equal(endpointOrigin('https://user:pass@host/'), '', 'never the origin of an address with credentials');
});

k.test('mask', 'maskUrlCredentials() hides the user name and password, and nothing else', () => {
    assert.equal(maskUrlCredentials('https://user:s3cret@host/v1'), 'https://****@host/v1');
    assert.equal(maskUrlCredentials('"http://:s3cret@localhost/"'), '"http://****@localhost/"');
    assert.equal(maskUrlCredentials('http://localhost:11434'), 'http://localhost:11434');
    assert.equal(maskUrlCredentials('a https://u@h/ and http://x:y@z/'), 'a https://****@h/ and http://****@z/');
});

k.test('problem-text', 'every problem has its own English text for the classes', () => {
    const texts = Object.values(ENDPOINT_PROBLEM).map(endpointProblemText);
    assert.equal(new Set(texts).size, texts.length);
    for (const t of texts) assert.ok(t.length > 0, t);
});

k.coverage();
