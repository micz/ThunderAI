// migrateOllamaThinkLevel() (js/mzta-prefs-migration.js), from spec 04 (the Ollama `think`
// paragraphs): the global ollama_think was a boolean checkbox and is now a level string. The
// migration applies the same mapping as normalizeThink() - true -> 'true', false -> 'false' (never
// '', which would let a thinking model reason anyway) - to the GLOBAL preference only, once, under
// the one-shot flag _migrated_ollama_think_level. Prompt objects and the per-feature copies are
// deliberately not walked.

import assert from 'node:assert/strict';
import { caseTests } from '../helpers/known-issues/migration.mjs';
import { startup } from './context.mjs';
import { writesOf } from './expect.mjs';

const k = caseTests('03-ollama-think');
const run = 'migrateOllamaThinkLevel';
const FLAG = '_migrated_ollama_think_level';

const PER_FEATURE = { add_tags_ollama_think: true, summarize_ollama_think: false };

const starts = {
    on: startup({ run, local: { ollama_think: true, ...PER_FEATURE } }),
    off: startup({ run, local: { ollama_think: false } }),
    level: startup({ run, local: { ollama_think: 'low' } }),
    stringOn: startup({ run, local: { ollama_think: 'true' } }),
    modelDefault: startup({ run, local: { ollama_think: '' } }),
    unset: startup({ run, local: { connection_type: 'ollama_api' } }),
    flagged: startup({ run, local: { ollama_think: true, [FLAG]: true } }),
    again: (async () => {
        const first = await startup({ run, local: { ollama_think: false } });
        return startup({ run, local: first.local });
    })(),
};
for (const p of Object.values(starts)) p.catch(() => {});

k.test('true-to-level', 'a stored true becomes the string "true"', async () => {
    const r = await starts.on;
    assert.equal(r.error, null);
    assert.equal(r.local.ollama_think, 'true');
});

k.test('false-to-level', 'a stored false becomes the explicit "false", not "" (model default)', async () => {
    const r = await starts.off;
    assert.equal(r.local.ollama_think, 'false');
});

k.test('level-kept', 'a value already in level form is left as it is', async () => {
    assert.equal((await starts.level).local.ollama_think, 'low');
    assert.equal((await starts.stringOn).local.ollama_think, 'true');
    assert.equal((await starts.modelDefault).local.ollama_think, '');
});

k.test('unset-kept', 'an unset preference stays unset (its default keeps reaching the user)', async () => {
    const r = await starts.unset;
    assert.ok(!('ollama_think' in r.local), 'ollama_think was written: ' + JSON.stringify(r.local.ollama_think));
});

k.test('global-only', 'the per-feature copies are not walked: they keep their boolean', async () => {
    const r = await starts.on;
    for (const [key, value] of Object.entries(PER_FEATURE)) assert.equal(r.local[key], value, key);
});

k.test('flag-written', 'the one-shot flag is written', async () => {
    for (const name of ['on', 'off', 'level', 'unset']) {
        assert.equal((await starts[name]).local[FLAG], true, name);
    }
});

k.test('flag-short-circuits', 'with the flag set it changes nothing, even a boolean stored since', async () => {
    const r = await starts.flagged;
    assert.equal(r.local.ollama_think, true);
    assert.deepEqual(writesOf(r.calls), []);
});

k.test('idempotent', 'a second start writes nothing and keeps the level', async () => {
    const r = await starts.again;
    assert.equal(r.local.ollama_think, 'false');
    assert.deepEqual(writesOf(r.calls), []);
});

k.coverage();
