// The Manage Custom Prompts page with six custom data placeholders stored, no policy: the detail
// editor of a new prompt, what customprompts/ui-01 does not already assert about it.
//
// Spec 03 "Placeholder Autocomplete": custom placeholders through the type getter on
// #detail_type (type 0 sees only type-0 ones, the documented quirk; 1 and 2 their own and the
// type-0 ones), an item with no label rendering the command alone, the list closed by blur, by a
// space ending the token, by a scroll and by a resize, and placed at the caret (below it, flipped
// above it near the bottom, clamped into the viewport: jsdom has no layout, so the file gives the
// caret anchor and the list their boxes). Spec 03 "Invalid placeholder feedback": the amber
// "partial" tier of a type-0 prompt in edit mode, custom tokens included, and the tooltip of a
// flagged chip mirrored onto the textarea (on mousemove, off on mouseleave and on a repaint; the
// chip is given its client rect). Spec 03 "Custom Placeholders" (a disabled one is not offered
// and is flagged as missing).
//
// The tests run in order on one page, all in the editor of one new prompt.

import {
    test,
    after,
} from 'node:test';
import assert from 'node:assert/strict';
import { openPage, assertHarnessClean, msg } from '../../helpers/core/dom-harness.mjs';
import { uiTests } from '../../helpers/known-issues/ui.mjs';
import { stubExecCommand } from '../../ui/page-stubs.mjs';

const CUSTOM = [
    { id: 'thunderai_custom_sig', name: 'Signature', text: 'Ann', type: '0', enabled: 1, is_default: '0', is_dynamic: '0' },
    { id: 'thunderai_custom_reader', name: 'Reader note', text: 'r', type: '1', enabled: 1, is_default: '0', is_dynamic: '0' },
    { id: 'thunderai_custom_writer', name: 'Writer note', text: 'w', type: '2', enabled: '1', is_default: '0', is_dynamic: '0' },
    { id: 'thunderai_custom_off', name: 'Switched off', text: 'o', type: '1', enabled: '0', is_default: '0', is_dynamic: '0' },
    { id: 'thunderai_custom_noname', name: '', text: 'n', type: '0', enabled: 1, is_default: '0', is_dynamic: '0' },
    // imported by hand: no type
    { id: 'thunderai_custom_bare', name: 'Bare', text: 'b', enabled: 1, is_default: '0', is_dynamic: '0' },
];

const ctx = await openPage('customprompts', {
    local: { connection_type: 'chatgpt_api', _custom_placeholder: CUSTOM },
});
after(() => ctx.close());
const k = uiTests('customprompts', '03');
const $ = ctx.$;
stubExecCommand(ctx);

const S_AUTO = 'spec 03 "Placeholder Autocomplete"';
const S_INVALID = 'spec 03 "Invalid placeholder feedback"';
const S_CUSTOM = 'spec 03 "Custom Placeholders"';

const ta = () => $('#detail_text');
const acList = () => ta().closest('.autocomplete-container').querySelector('.autocomplete-list');
const isOpen = () => !acList().classList.contains('hidden');
const suggestions = () => isOpen() ? [...acList().querySelectorAll('.ac_cmd')].map(li => li.textContent) : [];
const typeAt = async (text, caret = text.length) => {
    ta().value = text;
    ta().setSelectionRange(caret, caret);
    await ctx.fire(ta(), 'input');
};
const setType = async value => {
    $('#detail_type').value = value;
    await ctx.fire($('#detail_type'), 'change');
};
const customOffered = async () => {
    await typeAt('x {%thunderai_custom');
    return suggestions().map(s => s.slice('{%thunderai_custom_'.length, -2));
};

// ---- the autocomplete ------------------------------------------------------------------------

k.test('new-prompt-editor', S_AUTO, 'a new prompt opens the editor, type "always"', async () => {
    await ctx.click($('#btnNew'));
    assert.equal(ta().disabled, false);
    assert.equal($('#detail_type').value, '0');
});

k.test('ac-custom-type-0', S_CUSTOM, 'a type-0 prompt is offered the enabled type-0 custom placeholders only', async () => {
    const offered = await customOffered();
    assert.ok(offered.includes('sig') && offered.includes('noname'), offered.join());
    for (const id of ['reader', 'writer', 'off']) assert.equal(offered.includes(id), false, id);
});

k.test('ac-custom-type-1', S_CUSTOM, 'reading: its own custom placeholders and the type-0 ones, never a disabled one', async () => {
    await setType('1');
    const offered = await customOffered();
    for (const id of ['sig', 'reader', 'noname']) assert.ok(offered.includes(id), id + ' not in ' + offered.join());
    assert.equal(offered.includes('writer'), false);
    assert.equal(offered.includes('off'), false, 'a disabled custom placeholder offered');
});

k.test('ac-custom-type-2', S_CUSTOM, 'composing: the type read again on the next keystroke', async () => {
    await setType('2');
    const offered = await customOffered();
    for (const id of ['sig', 'writer']) assert.ok(offered.includes(id), id + ' not in ' + offered.join());
    assert.equal(offered.includes('reader'), false);
});

k.test('ac-no-label', S_AUTO, 'an item with no label renders the command alone', async () => {
    await typeAt('x {%thunderai_custom_no');
    const items = [...acList().querySelectorAll('li')];
    assert.equal(items.length, 1);
    assert.equal(items[0].querySelector('.ac_cmd').textContent, '{%thunderai_custom_noname%}');
    assert.equal(items[0].querySelector('.ac_desc'), null);
    await typeAt('x {%thunderai_custom_si');
    assert.equal(acList().querySelector('li .ac_desc')?.textContent, 'Signature');
});

k.test('ac-close-space', S_AUTO, 'a space after the typed token closes the list', async () => {
    await typeAt('x {%subj');
    assert.equal(isOpen(), true);
    await typeAt('x {%subj ');
    assert.equal(isOpen(), false);
    assert.equal(ta().getAttribute('aria-expanded'), 'false');
});

k.test('ac-close-blur', S_AUTO, 'leaving the textarea closes the list', async () => {
    await typeAt('x {%subj');
    assert.equal(isOpen(), true);
    await ctx.fire(ta(), 'blur');
    assert.equal(isOpen(), false);
});

k.test('ac-close-scroll', S_AUTO, 'a scroll anywhere closes the list instead of moving it', async () => {
    await typeAt('x {%subj');
    assert.equal(isOpen(), true);
    ctx.document.querySelector('main, body').dispatchEvent(new ctx.window.Event('scroll'));
    await ctx.settle();
    assert.equal(isOpen(), false);
});

k.test('ac-close-resize', S_AUTO, 'a resize of the window closes the list', async () => {
    await typeAt('x {%subj');
    assert.equal(isOpen(), true);
    ctx.window.dispatchEvent(new ctx.window.Event('resize'));
    await ctx.settle();
    assert.equal(isOpen(), false);
    assert.equal(ta().hasAttribute('aria-activedescendant'), false);
});

// jsdom computes no layout: the caret anchor the mirror plants and the list get their boxes here.
const LIST_BOX = { width: 300, height: 150 };
async function openAt(caret) {
    const proto = ctx.window.Element.prototype;
    const real = proto.getBoundingClientRect;
    const list = acList();
    proto.getBoundingClientRect = function () {
        if (this.classList?.contains('caret-anchor')) return { ...caret, right: caret.left, width: 0, x: caret.left, y: caret.top };
        if (this === list) return { left: 0, top: 0, right: LIST_BOX.width, bottom: LIST_BOX.height, x: 0, y: 0, ...LIST_BOX };
        return real.call(this);
    };
    try {
        await typeAt('x {%subj');
    } finally {
        proto.getBoundingClientRect = real;
    }
    assert.equal(isOpen(), true);
    return { top: parseFloat(list.style.top), left: parseFloat(list.style.left) };
}

k.test('ac-position-below', S_AUTO, 'with room below, the list opens under the caret, at its left edge', async () => {
    const caret = { left: 100, top: 200, bottom: 218, height: 18 };
    const at = await openAt(caret);
    assert.ok(at.top >= caret.bottom, JSON.stringify(at));
    assert.ok(at.top - caret.bottom < 20, 'not next to the caret: ' + JSON.stringify(at));
    assert.equal(at.left, caret.left);
});

k.test('ac-position-flip-clamp', S_AUTO, 'near the bottom right it flips above the caret and stays inside the viewport', async () => {
    const { innerWidth: W, innerHeight: H } = ctx.window;
    const caret = { left: W - 20, top: H - 40, bottom: H - 22, height: 18 };
    const at = await openAt(caret);
    assert.ok(at.top + LIST_BOX.height <= caret.top, 'not above the caret: ' + JSON.stringify(at));
    assert.ok(at.left >= 0 && at.left + LIST_BOX.width <= W, 'outside the viewport: ' + JSON.stringify(at));
    await ctx.fire(ta(), 'keydown', { key: 'Escape' });
});

// ---- the highlight states --------------------------------------------------------------------

const mirrorChips = () => [...ta().closest('.editor-wrap').querySelectorAll('.editor-highlights [class*="ph_chip"]')];
const chipOf = token => mirrorChips().find(c => c.textContent === token);
const stateOf = token => {
    const c = chipOf(token);
    if (!c) return 'unmarked';
    if (c.classList.contains('ph_chip_error')) return 'error:' + c.title;
    if (c.classList.contains('ph_chip_warn')) return 'warn:' + c.title;
    return c.classList.contains('ph_chip_invalid') ? 'invalid?' : 'valid';
};

k.test('mirror-partial', S_INVALID, 'a type-0 prompt: a reading-only or composing-only token is amber "partial", an "always" one valid', async () => {
    await setType('0');
    await typeAt('{%mail_folder_name%} {%mail_typed_text%} {%mail_subject%} {%mail_headers:x%}', 0);
    assert.equal(stateOf('{%mail_folder_name%}'), 'warn:' + msg('editor_placeholder_partial_type'));
    assert.equal(stateOf('{%mail_typed_text%}'), 'warn:' + msg('editor_placeholder_partial_type'));
    assert.equal(stateOf('{%mail_headers:x%}'), 'warn:' + msg('editor_placeholder_partial_type'), 'a reading-only dynamic token');
    assert.equal(stateOf('{%mail_subject%}'), 'valid');
});

k.test('mirror-custom-type-0', S_CUSTOM, 'custom tokens in a type-0 prompt: typed ones by the same matrix, no type valid, disabled red', async () => {
    await typeAt('{%thunderai_custom_sig%} {%thunderai_custom_reader%} {%thunderai_custom_writer%} {%thunderai_custom_bare%} {%thunderai_custom_off%}', 0);
    assert.equal(stateOf('{%thunderai_custom_sig%}'), 'valid');
    assert.equal(stateOf('{%thunderai_custom_reader%}'), 'warn:' + msg('editor_placeholder_partial_type'));
    assert.equal(stateOf('{%thunderai_custom_writer%}'), 'warn:' + msg('editor_placeholder_partial_type'));
    assert.equal(stateOf('{%thunderai_custom_bare%}'), 'valid', 'a placeholder with no type counts as type 0');
    assert.equal(stateOf('{%thunderai_custom_off%}'), 'error:' + msg('editor_placeholder_missing'));
});

// The chips live in the mirror, under the textarea: the page finds the one under the pointer by
// its client rects, which jsdom does not compute. The red chip gets one here. (ctx.fire() builds
// a MouseEvent only for click / mousedown, so the pointer position is passed on one built here.)
const hover = async (x, y) => {
    ta().dispatchEvent(new ctx.window.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
    await ctx.settle();
};

k.test('tooltip-on-textarea', S_INVALID, 'hovering a flagged chip puts its title on the textarea; elsewhere, none', async () => {
    const red = chipOf('{%thunderai_custom_off%}');
    red.getClientRects = () => [{ left: 10, right: 60, top: 10, bottom: 30 }];
    await hover(20, 20);
    assert.equal(ta().getAttribute('title'), msg('editor_placeholder_missing'));
    await hover(200, 200);
    assert.equal(ta().hasAttribute('title'), false);
});

k.test('tooltip-mouseleave', S_INVALID, 'leaving the textarea removes the title', async () => {
    await hover(20, 20);
    assert.equal(ta().getAttribute('title'), msg('editor_placeholder_missing'));
    await ctx.fire(ta(), 'mouseleave');
    assert.equal(ta().hasAttribute('title'), false);
});

k.test('tooltip-repaint', S_INVALID, 'a repaint drops the title: the chip it came from no longer exists', async () => {
    await hover(20, 20);
    assert.equal(ta().getAttribute('title'), msg('editor_placeholder_missing'));
    await typeAt('{%thunderai_custom_sig%} {%mail_subject%}', 0);
    assert.equal(ta().hasAttribute('title'), false);
});

k.coverage();

test('the page ran on modelled APIs only', () => assertHarnessClean(ctx));
