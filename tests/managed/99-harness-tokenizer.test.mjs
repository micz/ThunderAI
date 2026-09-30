// The harness itself, not the spec: helpers/background-handler.mjs cuts real code out of
// mzta-background.js, and 05e / 10i read its source with the comments blanked out. A tokenizer
// that loses track (a quote or backtick inside a regex literal opening a fake string) would
// keep the comments of the rest of the file, and a test looking for a call could then pass on
// a comment. These pin down the tokenizer on small cases and on the real file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { segments, stripComments, backgroundSource, locateManagedValuesListener }
    from '../helpers/background-handler.mjs';
import { repoPath } from '../helpers/load.mjs';

const types = src => segments(src).filter(s => s.type !== 'code')
    .map(s => [s.type, src.slice(s.start, s.end)]);

test('a regex literal with a quote or a backtick does not open a string', () => {
    const src = "x = s.replace(/[\\*#_~`]/g, '');\n// a comment\ny = /\"/.test(z); // another\n";
    assert.deepEqual(types(src), [
        ['regex', '/[\\*#_~`]/g'], ['string', "''"], ['comment', '// a comment'],
        ['regex', '/"/'], ['comment', '// another'],
    ]);
});

test('a slash after a value is a division, not a regex', () => {
    const src = 'a = b / c; d = (e + f) / 2; g = "x" / h; // end\n';
    assert.deepEqual(types(src), [['string', '"x"'], ['comment', '// end']]);
});

test('a slash inside a character class does not end the regex', () => {
    assert.deepEqual(types('return /[/]+/.test(p);'), [['regex', '/[/]+/']]);
});

test('comments inside strings and template literals are kept', () => {
    const src = "u = 'http://x'; t = `a // b ${c}`; /* real */";
    assert.deepEqual(types(src), [['string', "'http://x'"], ['string', '`a // b ${c}`'], ['comment', '/* real */']]);
});

test('stripComments() preserves offsets', () => {
    const src = 'a(); // x\n/* y\n z */ b();';
    const out = stripComments(src);
    assert.equal(out.length, src.length);
    assert.equal(out.indexOf('b();'), src.indexOf('b();'));
});

test('no comment line survives stripComments() on mzta-background.js', () => {
    const left = stripComments(backgroundSource()).split('\n')
        .map((l, i) => [i + 1, l.trim()]).filter(([, l]) => l.startsWith('//') || l.startsWith('/*'));
    assert.deepEqual(left.slice(0, 5), [], left.length + ' comment line(s) kept');
});

test('the same holds for the other shipped modules 05e reads', () => {
    for (const rel of ['js/mzta-managed.js', 'js/mzta-prefs.js', 'js/mzta-prompts.js', 'js/mzta-utils.js',
                       'pages/_lib/managed-ui.js', 'pages/_lib/connection-ui.js']) {
        const left = stripComments(readFileSync(repoPath(rel), 'utf8')).split('\n')
            .filter(l => l.trim().startsWith('//'));
        assert.equal(left.length, 0, rel + ': ' + left.length + ' comment line(s) kept');
    }
});

test('the get_managed_values listener is still located', () => {
    const { text } = locateManagedValuesListener();
    assert.match(text, /^\(message, sender\) =>/);
});
