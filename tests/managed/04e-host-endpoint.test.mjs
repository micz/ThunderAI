// Spec 08b "Validation" and spec 04 "Custom endpoint policy" [#1000], for the hosts a policy sets:
//  - a *_host with a user name or password in it is refused ("must not contain a user name or
//    password"), as a global preference and as a _special_prompts_connection field, and the
//    warning never repeats the credentials;
//  - a policy host on plain http: to another machine is accepted, and counts as approved: the
//    administrator chose it, so getApprovedInsecureOrigins() includes its origin and the user is
//    never asked about it. The user's own approvals are not touched.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startBackground } from '../helpers/load.mjs';
import { restart } from '../helpers/restart.mjs';

const SECRET = 's3cr3t';
let ctx;
let approvals;

before(async () => {
    ctx = await startBackground({ policy: {
        ollama_host: 'http://ollama.example.org:11434',
        _special_prompts_connection: {
            summarize: { api_type: 'openai_comp_api', openai_comp_host: 'http://gateway.example.org:8080/v1' },
        },
    } });
    approvals = await import('../../js/mzta-endpoint-approvals.js');
});

test('a policy host with credentials is refused, and the warning hides them', async () => {
    const r = await restart({ policy: {
        openai_comp_host: 'https://user:' + SECRET + '@gateway.example.org',
        _special_prompts_connection: {
            translate: { api_type: 'ollama_api', ollama_host: 'http://admin:' + SECRET + '@ollama.example.org' },
        },
    } }, 'managedKeys', ['openai_comp_host']);
    assert.equal(r.result.openai_comp_host.managed, false, 'applied');
    assert.ok(r.warnings.some(w => w.includes('"openai_comp_host" must not contain a user name or password')));
    assert.ok(r.warnings.some(w => /\["ollama_host"\] must not contain a user name or password/.test(w)));
    assert.equal(r.warnings.some(w => w.includes(SECRET)), false, 'the password reached the console');
});

test('a policy http: host on another machine is accepted, and approved without asking', async () => {
    assert.equal(ctx.mztaManaged.getManagedValue('ollama_host'), 'http://ollama.example.org:11434');
    const origins = await approvals.getApprovedInsecureOrigins();
    assert.ok(origins.includes('http://ollama.example.org:11434'), 'the global host');
    assert.ok(origins.includes('http://gateway.example.org:8080'), 'the per-feature connection host');
    assert.deepEqual(await approvals.getUserApprovedInsecureOrigins(), [], 'nothing stored as the user\'s');
    const access = await approvals.resolveEndpointAccess('http://ollama.example.org:11434/');
    assert.equal(access.ok, true);
});

test('a host the policy does not set is still refused until the user allows it', async () => {
    const access = await approvals.resolveEndpointAccess('http://other.example.org:11434');
    assert.equal(access.ok, false);
    assert.equal(access.message, browser.i18n.getMessage('endpoint_insecure_not_confirmed', ['http://other.example.org:11434']));
    await approvals.approveInsecureOrigin('http://other.example.org:11434');
    assert.equal((await approvals.resolveEndpointAccess('http://other.example.org:11434')).ok, true);
    await approvals.revokeInsecureOrigin('http://other.example.org:11434');
    assert.equal((await approvals.resolveEndpointAccess('http://other.example.org:11434')).ok, false);
});
