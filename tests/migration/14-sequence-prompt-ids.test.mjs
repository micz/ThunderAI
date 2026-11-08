// The custom prompt id rename as a step of the startup sequence. Spec 02 "Prompt ids" and spec 01
// "Storage": migrateCustomPromptIdCollisions() runs at every start, unguarded and with no flag,
// renames a custom prompt whose id is a shipped prompt's (ignoring case), and writes _custom_prompt
// only when it renames something. It runs before the menu order migration, which on this profile
// still has to run: the renamed prompt reaches it as an ordinary custom prompt.
//
// The rename rule itself is the prompts area's (prompts/17). Here: that the sequence runs it, on the
// 5.0.x profile, that nothing else the user owns changes, and that the next start writes nothing.

import assert from 'node:assert/strict';
import { caseTests } from '../helpers/known-issues/migration.mjs';
import { startup } from './context.mjs';
import {
    MARKER,
    profile
} from './expect.mjs';

const k = caseTests('14-sequence-prompt-ids');
const P = profile('5.0');

// Created by an old version, whose page checked the id only against the prompts it listed.
const CLASH = { id: 'prompt_summarize', name: 'My summary', text: 'Mine {%mail_text_body%}', type: '1', action: '0',
    is_default: '0', is_special: '0', show_in: 'context', api_type: 'ollama_api', ollama_model: 'llama3' };
const prefs = { ...P.sync };
delete prefs.dynamic_menu_order_alphabet;
const local = { ...P.local, ...prefs, [MARKER]: true,
    _custom_prompt: [...P.local._custom_prompt, CLASH] };

const first = startup({ run: 'sequence', local, read: { menuOrderView: true } });
const second = first.then(r => startup({ run: 'sequence', local: r.local, sync: r.sync }));

k.test('renamed', 'the custom prompt_summarize is stored as summarize, a custom prompt, with its fields', async () => {
    const r = await first;
    assert.equal(r.error, null);
    const ids = r.local._custom_prompt.map(p => p.id);
    assert.equal(ids.includes('prompt_summarize'), false);
    const mine = r.local._custom_prompt.find(p => p.id === 'summarize');
    for (const [field, value] of Object.entries(CLASH)) {
        if (field === 'id') continue;
        assert.deepEqual(mine[field], value, field);
    }
    assert.equal((r.local._special_prompts || []).some(p => String(p.is_special) !== '1'), false, 'no custom prompt in _special_prompts');
});

k.test('others-kept', 'every other stored custom prompt keeps its id and its fields, positions aside', async () => {
    const r = await first;
    const byId = new Map(r.local._custom_prompt.map(p => [p.id, p]));
    for (const stored of P.local._custom_prompt) {
        for (const [field, value] of Object.entries(stored)) {
            if (field.startsWith('position_')) continue;
            assert.deepEqual(byId.get(stored.id)?.[field], value, stored.id + '.' + field);
        }
    }
    assert.equal(r.local._custom_prompt.length, P.local._custom_prompt.length + 1);
});

k.test('one-prompt-per-id', 'the view the menus and pages read has no two prompts with one id', async () => {
    const ids = (await first).read.menuOrderView.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length, ids.join(', '));
});

k.test('next-start-quiet', 'the next start writes nothing', async () => {
    const r = await second;
    assert.equal(r.error, null);
    assert.equal(r.writes, 0);
});

k.coverage();
