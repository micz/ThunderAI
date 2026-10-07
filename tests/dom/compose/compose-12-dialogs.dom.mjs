// Group D, the two dialogs the background opens in the message display: getTags (the tags the AI
// proposes, before they are assigned) and sendAlert. jsdom has no <dialog> showModal() / close():
// compose-doc.mjs models them (README "The documents").
//
// Spec 01 "Unreachable message pane": the getTags dialog "is the user's confirmation step" - tags
// are never applied silently. Spec 05 "Feature Flags": add_tags_exclusions is a substring match
// unless add_tags_exclusions_exact_match; the dialog reads the list and the two flags through
// addtags_get_exclusion_prefs and writes the list through addtags_set_exclusions; entries are
// stored lowercase (the exclude icon lowercases), added and removed case-insensitively;
// add_tags_hide_exclusions hides the excluded tags. Spec 08 "Interaction points": when the list is
// locked the per-tag exclude icon is not rendered at all.

import { after } from 'node:test';
import assert from 'node:assert/strict';
import {
    assertHarnessClean,
    msg,
} from '../../helpers/core/dom-harness.mjs';
import { composeTests } from '../../helpers/known-issues/compose.mjs';
import {
    DISPLAY_URL,
    openMailDocument,
    readCapture,
    send,
    sentCommands,
} from '../../compose/compose-doc.mjs';

const ID = 'msg-A@example.com';
let prefs = {};
const capture = readCapture('mail_html_reading.txt', { encoding: 'latin1' });
const ctx = await openMailDocument({
    url: DISPLAY_URL,
    displayedMessageId: ID,
    html: '<!DOCTYPE html><html><head></head><body><div class="moz-text-html" lang="x-unicode">'
        + capture.body + '</div></body></html>',
    commands: {
        addtags_get_exclusion_prefs: () => {
            if (prefs === 'fail') throw new Error('background unreachable');
            return structuredClone(prefs);
        },
        addtags_set_exclusions: () => true,
        assign_tags: () => true,
    },
});
after(() => ctx.close());
const k = composeTests('12');

const S_CONFIRM = 'spec 01 "Unreachable message pane (`sendTabMessageSafe`, [#901](https://github.com/micz/ThunderAI/issues/901))"';
const S_FLAGS = 'spec 05 "Feature Flags"';
const S_LOCK = 'spec 08 "Interaction points"';

const PREFS = { add_tags_exclusions: ['news'], add_tags_hide_exclusions: false, add_tags_exclusions_exact_match: false, exclusions_locked: false };
const dialog = () => ctx.$('dialog.mzta_dialog');
const labels = () => [...dialog().querySelectorAll('form label')];
const label = tag => labels().find(l => l.querySelector('input').value === tag);
const checked = () => [...dialog().querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);

async function openTags(tags, p = PREFS) {
    prefs = p;
    assert.equal(await send(ctx, { command: 'getTags', tags, messageId: 42 }), true);
    assert.ok(dialog(), 'the dialog is open');
}
async function closeDialog() {
    await ctx.click(ctx.$('#mzta_dialog_close'));
    assert.equal(dialog(), null, 'closed and removed');
}

k.test('tags-listed', S_FLAGS, 'the proposed tags, trimmed, blanks dropped; one matching an exclusion (substring) unchecked', async () => {
    await openTags([' Work ', '', '  ', 'Urgent', 'newsletter']);
    assert.deepEqual(labels().map(l => l.querySelector('input').value), ['Work', 'Urgent', 'newsletter']);
    assert.deepEqual(checked(), ['Work', 'Urgent']);
});

k.test('no-assign-before-submit', S_CONFIRM, 'nothing is assigned while the dialog waits for the user', () => {
    assert.deepEqual(sentCommands(ctx, 'assign_tags'), []);
});

k.test('exclude-adds-lowercase', S_FLAGS, 'the exclude icon adds the tag to the list, lowercased, through addtags_set_exclusions', async () => {
    await ctx.click(label('Urgent').querySelector('img.exclude-tag-icon'));
    assert.deepEqual(sentCommands(ctx, 'addtags_set_exclusions').map(m => m.list), [['news', 'urgent']]);
});

k.test('exclude-removes', S_FLAGS, 'clicking it again removes it, ignoring case', async () => {
    await ctx.click(label('Urgent').querySelector('img.exclude-tag-icon'));
    assert.deepEqual(sentCommands(ctx, 'addtags_set_exclusions').at(-1).list, ['news']);
});

k.test('submit-assigns', S_CONFIRM, 'Submit assigns the checked tags to the message, and closes the dialog', async () => {
    await ctx.click(ctx.$('#mzta_dialog_submit'));
    assert.deepEqual(sentCommands(ctx, 'assign_tags').map(m => ({ tags: m.tags, messageId: m.messageId })),
        [{ tags: ['Work', 'Urgent'], messageId: 42 }]);
    assert.equal(dialog(), null);
});

k.test('exact-match', S_FLAGS, 'with exact match, "news" does not exclude "newsletter"', async () => {
    await openTags(['newsletter', 'news'], { ...PREFS, add_tags_exclusions_exact_match: true });
    assert.deepEqual(checked(), ['newsletter']);
    await closeDialog();
});

k.test('hide-exclusions', S_FLAGS, 'with add_tags_hide_exclusions an excluded tag is not shown', async () => {
    await openTags(['Work', 'newsletter'], { ...PREFS, add_tags_hide_exclusions: true });
    assert.deepEqual(labels().map(l => l.querySelector('input').value), ['Work']);
    await closeDialog();
});

k.test('locked-no-icon', S_LOCK, 'with the list locked by the policy the exclude icon is not rendered', async () => {
    await openTags(['Work', 'Urgent'], { ...PREFS, exclusions_locked: true });
    assert.equal(dialog().querySelector('img.exclude-tag-icon'), null);
    await closeDialog();
});

k.test('close-assigns-nothing', S_CONFIRM, 'closing the dialog assigns nothing', () => {
    assert.equal(sentCommands(ctx, 'assign_tags').length, 1, 'only the submitted one');
});

// sendAlert and the fallback of the tag dialog: spec 01 "The message-display panels and dialogs".
const S_PANELS = 'spec 01 "The message-display panels and dialogs (`js/mzta-compose-script.js`)"';

k.test('alert-in-pane', S_PANELS, 'sendAlert in a mail tab: an in-pane dialog with the warning title and the message as text, removed on Close', async () => {
    assert.equal(await send(ctx, { command: 'sendAlert', curr_tab_type: 'mail', message: '<b>Select</b> some text first.' }), true);
    assert.ok(dialog().textContent.includes('<b>Select</b> some text first.'));
    assert.equal(dialog().querySelector('.mzta_dialog_message b'), null);
    assert.ok(dialog().textContent.includes(msg('thunderai_warning_title')));
    await closeDialog();
});

k.test('alert-error-title', S_PANELS, 'an error alert carries the error title', async () => {
    await send(ctx, { command: 'sendAlert', curr_tab_type: 'mail', is_error: true, message: 'Failed.' });
    assert.ok(dialog().textContent.includes(msg('thunderai_error_title')));
    await closeDialog();
});

k.test('alert-other-tab', S_PANELS, 'sendAlert in another tab: the window\'s alert(), no in-pane dialog', async () => {
    assert.equal(await send(ctx, { command: 'sendAlert', curr_tab_type: 'messageDisplay', message: 'Plain alert.' }), true);
    assert.deepEqual(ctx.dialogs.filter(d => d.kind === 'alert').map(d => d.args[0]), ['Plain alert.']);
    assert.equal(dialog(), null);
});

k.test('prefs-fallback', S_PANELS, 'addtags_get_exclusion_prefs failing: the dialog still opens, with the defaults (no exclusion, not locked)', async () => {
    await openTags(['Work', 'newsletter'], 'fail');
    assert.deepEqual(checked(), ['Work', 'newsletter']);
    assert.ok(dialog().querySelector('img.exclude-tag-icon'), 'not locked: the exclude icon is there');
    assert.ok(ctx.con.entries.some(e => e.level === 'error'), 'the failure is logged');
    await closeDialog();
});

k.test('harness-clean', S_CONFIRM, 'the content script ran on modelled APIs only', () => {
    assertHarnessClean(ctx);
});

k.coverage();
