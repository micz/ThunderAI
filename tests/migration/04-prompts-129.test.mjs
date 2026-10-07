// The two #129 migrations (js/mzta-utils.js), from spec 01 "Storage" and spec 05 ("Preference
// access", the two #129 legacy reads): migrateCustomPromptsStorage() and
// migrateDefaultPromptsPropStorage() move _custom_prompt and _default_prompts_properties out of
// storage.sync into storage.local - copy, then remove from sync. A copy already present in
// storage.local is the user's current data and is never overwritten; the stale sync copy is removed
// all the same, so storage.sync always ends drained (the preference migration leaves these keys to
// them: NOT_PREFERENCES, see 01-prefs-to-local "payloads-not-copied", and the sequence files).

import assert from 'node:assert/strict';
import { caseTests } from '../helpers/known-issues/migration.mjs';
import { startup } from './context.mjs';
import {
    profile,
    writesOf
} from './expect.mjs';

const k = caseTests('04-prompts-129');
const OLD = profile('pre-129');

// A payload of a realistic size: a user with many custom prompts.
const MANY = Array.from({ length: 60 }, (_, i) => ({
    id: 'prompt_custom_' + i, name: 'Prompt ' + i, text: 'Text ' + i + ' {%mail_text_body%} ' + 'x'.repeat(200),
    type: String(i % 3), action: '0', is_default: '0', is_special: '0', show_in: i % 2 ? 'popup' : 'none',
    position_display: i, position_compose: 60 - i, position_context: i,
}));

const CASES = {
    custom: { run: 'migrateCustomPromptsStorage', key: '_custom_prompt' },
    dpp: { run: 'migrateDefaultPromptsPropStorage', key: '_default_prompts_properties' },
};

const NEWER = {
    _custom_prompt: [{ id: 'prompt_custom_newer', name: 'Newer', text: 'Changed since', type: '0', action: '0',
        is_default: '0', is_special: '0', show_in: 'both' }],
    _default_prompts_properties: { prompt_reply: { position_display: 7, position_compose: 7, position_context: 7,
        need_custom_text: '0', show_in: 'context' } },
};

const starts = {};
for (const [name, { run, key }] of Object.entries(CASES)) {
    starts[name] = {
        move: startup({ run, sync: { [key]: OLD.sync[key], connection_type: 'ollama_api' }, local: {} }),
        localExists: startup({ run, sync: { [key]: OLD.sync[key] }, local: { [key]: NEWER[key] } }),
        nothing: startup({ run, sync: { connection_type: 'ollama_api' }, local: { connection_type: 'chatgpt_api' } }),
    };
}
const many = startup({ run: 'migrateCustomPromptsStorage', sync: { _custom_prompt: MANY }, local: {} });

for (const [name, { key }] of Object.entries(CASES)) {
    k.test(name + '-copy-then-remove', key + ': copied to storage.local unchanged, then removed from storage.sync', async () => {
        const r = await starts[name].move;
        assert.equal(r.error, null);
        assert.deepEqual(r.local[key], OLD.sync[key]);
        assert.ok(!(key in r.sync), key + ' still in sync');
        assert.equal(r.sync.connection_type, 'ollama_api', 'nothing else is removed from sync');
        const writes = writesOf(r.calls).map(w => w.area + '.' + w.op);
        assert.deepEqual(writes, ['local.set', 'sync.remove'], 'copy first, remove after');
    });

    k.test(name + '-local-wins', key + ': a copy already in storage.local is never overwritten', async () => {
        const r = await starts[name].localExists;
        assert.equal(r.error, null);
        assert.deepEqual(r.local[key], NEWER[key]);
        assert.deepEqual(writesOf(r.calls).filter(w => w.area === 'local'), []);
    });

    k.test(name + '-local-wins-drains-sync', key + ': with a copy already in storage.local, the stale sync copy is removed', async () => {
        const r = await starts[name].localExists;
        assert.ok(!(key in r.sync), key + ' still in sync');
    });

    k.test(name + '-nothing', key + ': nothing in sync, nothing written', async () => {
        const r = await starts[name].nothing;
        assert.deepEqual(writesOf(r.calls), []);
        assert.deepEqual(r.local, { connection_type: 'chatgpt_api' });
    });
}

k.test('large-payload', 'a large custom prompt payload moves byte for byte', async () => {
    const r = await many;
    assert.deepEqual(r.local._custom_prompt, MANY);
    assert.ok(!('_custom_prompt' in r.sync));
});

k.coverage();
