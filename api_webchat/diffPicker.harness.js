// ThunderAI diff-picker invariant harness.
//
// NOT SHIPPED CODE - a developer tool. It is not referenced by index.html or
// any module, so it costs the extension nothing.
//
// RUN IN THE WEBCHAT WINDOW'S DEVTOOLS CONSOLE. It needs DOMParser and the
// `Diff` global from js/lib/diff.js, neither of which exists in Node, and this
// project has no npm - which is why the invariant cannot be checked in CI.
//
//   1. Open a prompt with use_diff_viewer "1" (Proofread / Rewrite formal /
//      Rewrite polite) so the webchat window is up.
//   2. Open devtools on that window, then paste this whole file.
//
// It checks the contract the whole feature rests on:
//   composeResultBlocksHTML(all accepted) === renderBlocks(segmentBlocks(newHtml))
//   composeResultBlocksHTML(all rejected) === renderBlocks(segmentBlocks(oldHtml))
//
// Expected: fail 0, and 0 sliceHtmlByText fallbacks on well-formed input.

(async () => {
const M = await import('./diffPicker.js');
const { buildHunks, composeResultBlocksHTML, segmentBlocks, renderBlocks,
        flatHunks, sanitizeInlineHtml, sliceHtmlByText } = M;

let pass = 0, fail = 0, slices = 0;
const failures = [];

// Count sliceHtmlByText fallbacks: on well-formed input there should be none.
const realWarn = console.warn;
console.warn = (...a) => {
    if (String(a[0]).includes('HTML slice fell back')) { slices++; return; }
    realWarn.apply(console, a);
};

function setAll(blocks, state) {
    for (const h of flatHunks(blocks)) { h.state = state; }
}

function check(oldHtml, newHtml, gran, label) {
    const blocks = buildHunks(oldHtml, newHtml, gran);
    if (blocks === null) { return; }   // aborted diff, not an invariant case

    setAll(blocks, 'accepted');
    const got1 = composeResultBlocksHTML(blocks);
    const want1 = renderBlocks(segmentBlocks(newHtml));

    setAll(blocks, 'rejected');
    const got2 = composeResultBlocksHTML(blocks);
    const want2 = renderBlocks(segmentBlocks(oldHtml));

    for (const [got, want, side] of [[got1, want1, 'accept-all'], [got2, want2, 'reject-all']]) {
        if (got === want) { pass++; }
        else {
            fail++;
            if (failures.length < 12) {
                failures.push({ label, gran, side, oldHtml, newHtml, got, want });
            }
        }
    }
}

// ---- P1: segment -> render is idempotent --------------------------------
function checkP1(html, label) {
    const once = renderBlocks(segmentBlocks(html));
    const twice = renderBlocks(segmentBlocks(once));
    if (once === twice) { pass++; }
    else {
        fail++;
        if (failures.length < 12) { failures.push({ label: 'P1:' + label, once, twice }); }
    }
}

// ---- Hand-picked samples ------------------------------------------------
const SAMPLES = [
    ['<p>Dear Sir,</p><p>I hope you are fine.</p><p>Best</p>',
     '<p>Dear Sir,</p><p>I hope you are <strong>well</strong>.</p><p>Best regards</p>'],
    ['<p>one two</p>', '<p>one    two</p>'],
    ['<p>Hello world</p>', '<p>Hello world</p>'],
    ['<p>a</p>', '<p>a</p><p>b</p>'],
    ['<p>a</p><p>b</p>', '<p>a</p>'],
    ['<ul><li>first</li><li>second</li></ul>',
     '<ul><li>first item</li><li>second</li><li>third</li></ul>'],
    ['<p>Please review the <em>attached</em> file &amp; reply.</p>',
     '<p>Please review the <strong>attached</strong> file &amp; respond.</p>'],
    ['<p>Line one<br>Line two</p>', '<p>Line one<br>Line three</p>'],
    ['', '<p>Brand new text</p>'],
    ['<p>Only original</p>', ''],
    ['<h2>Title</h2><p>Body text here.</p>', '<h2>Title</h2><p>Revised body text here.</p>'],
    ['<blockquote>quoted bit</blockquote>', '<blockquote>quoted bits</blockquote>'],
    ['<p>Sentence one. Sentence two. Sentence three.</p>',
     '<p>Sentence one changed. Sentence two. A third sentence.</p>'],
    ['<div>plain div</div>', '<div>plain div edited</div>'],
    ['bare text with no block at all', 'bare text, now edited, with no block at all'],

    // Markup-only differences: same words, different emphasis. These are the
    // cases that broke the invariant before the comparator included html and
    // before contextSide() existed - reject-all used to hand back the ANSWER'S
    // formatting for text the user had just rejected.
    ['<p>Please review this</p>', '<p>Please <strong>review</strong> this</p>'],
    ['<p>Please <em>review</em> this</p>', '<p>Please <strong>review</strong> this</p>'],
    ['<p>Keep this line</p><p>change that one</p>',
     '<p>Keep <b>this</b> line</p><p>change that one entirely</p>'],
    ['<p><strong>All</strong> of it bold</p>', '<p>All of it bold</p>'],
];

for (const [o, n] of SAMPLES) {
    check(o, n, 'words', 'sample');
    check(o, n, 'sentences', 'sample');
    checkP1(o, 'sample-old');
    checkP1(n, 'sample-new');
}

// ---- Fuzz ---------------------------------------------------------------
// A tiny deterministic PRNG so a failure is reproducible.
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

const WORDS = ['dear', 'sir', 'hope', 'you', 'are', 'well', 'best', 'regards',
               'please', 'review', 'the', 'file', 'and', 'reply', 'soon',
               'a&b', 'x<y', 'café', 'thanks'];

function fuzzInline(text) {
    // Wrap a random middle span in a random inline tag.
    const words = text.split(' ');
    if (words.length < 3 || rnd() < 0.4) { return text; }
    const i = 1 + Math.floor(rnd() * (words.length - 2));
    const tag = pick(['strong', 'em', 'b', 'i', 'code']);
    words[i] = `<${tag}>${words[i]}</${tag}>`;
    return words.join(' ');
}

function fuzzBlock() {
    const n = 2 + Math.floor(rnd() * 8);
    let text = [];
    for (let i = 0; i < n; i++) { text.push(pick(WORDS)); }
    let body = fuzzInline(text.join(' '));
    if (rnd() < 0.15) { body = body.replace(' ', '<br>'); }
    const kind = rnd();
    if (kind < 0.62) { return `<p>${body}</p>`; }
    if (kind < 0.80) { return `<li>${body}</li>`; }
    if (kind < 0.88) { return `<h3>${body}</h3>`; }
    if (kind < 0.95) { return `<blockquote>${body}</blockquote>`; }
    return `<div>${body}</div>`;
}

function fuzzDoc() {
    const n = 1 + Math.floor(rnd() * 5);
    let out = '';
    let inList = false;
    for (let i = 0; i < n; i++) {
        const b = fuzzBlock();
        if (b.startsWith('<li>')) {
            if (!inList) { out += '<ul>'; inList = true; }
            out += b;
        } else {
            if (inList) { out += '</ul>'; inList = false; }
            out += b;
        }
    }
    if (inList) { out += '</ul>'; }
    return out;
}

const ROUNDS = 4000;
for (let i = 0; i < ROUNDS; i++) {
    const o = fuzzDoc();
    const n = fuzzDoc();
    check(o, n, i % 2 ? 'words' : 'sentences', 'fuzz#' + i);
    if (i % 8 === 0) { checkP1(o, 'fuzz#' + i); }
}

console.warn = realWarn;

console.log('=== diff picker invariant ===');
console.log('pass:', pass, ' fail:', fail, ' sliceHtmlByText fallbacks:', slices);
if (failures.length) { console.log('first failures:', failures); }

// ---- Sanitizer spot checks ---------------------------------------------
console.log('=== sanitizer ===');
const SAN = [
    '<script>alert(1)</script>keep',
    '<img src=x onerror="alert(1)">keep',
    '<a href="javascript:alert(1)">link text</a>',
    '<a href="https://example.com" onclick="x()">good link</a>',
    '<a href="mailto:a@b.c">mail</a>',
    '<div style="color:red">styled</div>',
    '<table><tr><td>cell</td></tr></table>',
    '<span><b><i>nested</i></b></span>',
    '<p onmouseover="x()">para</p>',
];
for (const s of SAN) { console.log(JSON.stringify(s), '->', JSON.stringify(sanitizeInlineHtml(s))); }

// ---- sliceHtmlByText spot checks ---------------------------------------
console.log('=== sliceHtmlByText ===');
const blockHtml = 'Hello <strong>brave</strong> new world';
for (const [a, b] of [[0, 5], [6, 11], [6, 15], [12, 21], [0, 21]]) {
    console.log(a, b, '->', JSON.stringify(sliceHtmlByText(blockHtml, a, b, 'FALLBACK')));
}
})();
