// Spec 02 + spec 03 together: taPromptUtils.preparePrompt(), the text that actually reaches the
// model. Golden tests: one fixture per case in tests/fixtures/prompts/prepare-prompt/, each holding
// the arguments and the expected output, WRITTEN BY HAND from the spec sections it names (never
// produced by running the code). A case whose exact output the spec does not determine (the
// signature wording) asserts only what the spec does say
// (`expect`) and names the rest in `underSpecified`; see tests/prompts/README.md.
//
// Fixture shape:
//   description     what the case shows
//   spec            the spec sections the expected value comes from (each names "spec 0N")
//   storage         optional: storage.local set before the case (preferences, _custom_placeholder),
//                   on top of BASE below, which every case starts from
//   prompt_from     optional: a built-in prompt id, loaded with loadPrompt() as curr_prompt (its
//                   shipped text)
//   args            the preparePrompt() arguments (curr_prompt unless prompt_from)
//   expected        the exact output, or
//   expect          {startsWith, endsWith, includes[], excludes[], occurrences{text: n},
//                    inOrder[] (each found after the previous one),
//                    promptTextIncludes (on the prompt's own text, before the call)}
//   underSpecified  optional: what the spec leaves open, and so is not asserted
//
// The context is a page (the popup and the menus run preparePrompt() there) with messages.getFull
// added through startPage({decorate}) for the dynamic header case, and the background page's
// classic script js/lib/mzta-html-lines.js run for normalizePlainTextPart()'s global.

import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { REPO, repoPath, loadFixture, startPage } from '../helpers/core/load.mjs';
import { SENDERS } from '../helpers/core/browser-mock.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('20-prepare-prompt-golden');

const DIR = 'prompts/prepare-prompt';
const FIXTURES = readdirSync(repoPath('tests/fixtures/' + DIR)).filter(f => f.endsWith('.json')).sort();

// Every case starts from these, so a case never depends on the one run before it.
const BASE = { placeholders_use_default_value: false, default_sign_name: '', default_chatgpt_lang: '', _custom_placeholder: [] };

const HEADERS = { 7: { 'X-Spam-Score': ['4.2'], subject: ['Spam?'] } };

let ctx, taPromptUtils;

before(async () => {
    vm.runInThisContext(readFileSync(repoPath('js/lib/mzta-html-lines.js'), 'utf8'), { filename: 'js/lib/mzta-html-lines.js' });
    ctx = await startPage({
        policy: null,
        sender: SENDERS.popup,
        decorate(ctl) {
            ctl.browser.messages.getFull = async (id) => ({ headers: structuredClone(HEADERS[id] ?? {}), parts: [] });
        },
    });
    taPromptUtils = (await import(new URL('js/mzta-utils-prompt.js', REPO).href)).taPromptUtils;
});

test('the golden fixtures are well formed', () => {
    assert.ok(FIXTURES.length >= 20, FIXTURES.length + ' fixtures');
    for (const file of FIXTURES) {
        const f = loadFixture(file, DIR);
        assert.equal(typeof f.description, 'string', file);
        assert.ok(Array.isArray(f.spec) && f.spec.length > 0 && f.spec.every(s => /\bspec 0\d/.test(s)), file + ': spec');
        assert.ok(('expected' in f) !== ('expect' in f), file + ': exactly one of expected / expect');
        assert.ok(f.prompt_from || f.args?.curr_prompt, file + ': a prompt');
        if (f.expect) {
            const allowed = ['startsWith', 'endsWith', 'includes', 'excludes', 'occurrences', 'inOrder', 'promptTextIncludes'];
            for (const key of Object.keys(f.expect)) assert.ok(allowed.includes(key), `${file}: expect.${key}`);
        }
    }
});

const count = (text, part) => text.split(part).length - 1;

for (const file of FIXTURES) {
    const f = loadFixture(file, DIR);
    k.test(file.replace(/\.json$/, ''), f.description, async () => {
        await ctx.ctl.browser.storage.local.set({ ...BASE, ...(f.storage || {}) });
        const args = structuredClone(f.args || {});
        if (f.prompt_from) {
            args.curr_prompt = structuredClone(await ctx.prompts.loadPrompt(f.prompt_from));
            assert.ok(args.curr_prompt, 'built-in prompt ' + f.prompt_from);
        }
        if (f.expect?.promptTextIncludes) {
            assert.ok(args.curr_prompt.text.includes(f.expect.promptTextIncludes),
                `the prompt text uses ${f.expect.promptTextIncludes}: ${args.curr_prompt.text}`);
        }
        const out = await taPromptUtils.preparePrompt(args);
        if ('expected' in f) {
            assert.equal(out, f.expected);
            return;
        }
        const e = f.expect;
        if (e.startsWith !== undefined) assert.ok(out.startsWith(e.startsWith), `starts with ${JSON.stringify(e.startsWith)}: ${JSON.stringify(out)}`);
        if (e.endsWith !== undefined) assert.ok(out.endsWith(e.endsWith), `ends with ${JSON.stringify(e.endsWith)}: ${JSON.stringify(out)}`);
        for (const part of e.includes || []) assert.ok(out.includes(part), `includes ${JSON.stringify(part)}: ${JSON.stringify(out)}`);
        for (const part of e.excludes || []) assert.ok(!out.includes(part), `excludes ${JSON.stringify(part)}: ${JSON.stringify(out)}`);
        let from = 0;
        for (const part of e.inOrder || []) {
            const at = out.indexOf(part, from);
            assert.ok(at >= 0, `${JSON.stringify(part)} after position ${from}: ${JSON.stringify(out)}`);
            from = at + part.length;
        }
        for (const [part, n] of Object.entries(e.occurrences || {})) {
            assert.equal(count(out, part), n, `${JSON.stringify(part)} occurs ${n} time(s): ${JSON.stringify(out)}`);
        }
    });
}

k.coverage();
