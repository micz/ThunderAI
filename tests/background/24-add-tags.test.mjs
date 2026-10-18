// Automatic tagging (add_tags + add_tags_auto) and the context-menu Add tags, in processEmails().
//
// Spec 01 "Per-message pipelines in processEmails()":
//  - add_tags runs after the spam step, on the same fullMessage / body: prompt -> sendPrompt ->
//    await _assign_tags(); a message the spam filter moved is NOT tagged;
//  - force existing (add_tags_auto_force_existing): non-existing tags are skipped (spec 02 "Add
//    tags: extra prompt statements": _assign_tags_now() skips them when create_new_tags is false);
//  - serialized tag assignment: _assign_tags() goes through one queue and re-reads the tag list
//    inside it, so two parallel pipelines that both found the same label missing do not create two
//    tags with that label;
//  - add_tags setup once per batch: a missing prompt or an unusable connection skips add_tags for
//    the whole batch.
// Spec 01 "Shared guards": in auto mode add_tags skips the auto-skipped folders (sent unless
// add_tags_auto_include_sent), and add_tags_auto_only_inbox keeps it inside the inbox (inbox and
// sent with include_sent); manual / context-menu runs are never filtered by them.
// Spec 01 "Batch cancellation", "Add tags selection cap": on the context-menu path an
// add_tags_max_messages > 0 aborts a larger selection with add_tags_too_many_messages; automatic
// tagging of incoming mail is never capped.
// Spec 05 `add_tags_exclusions` row: excluded tags are never assigned (substring match unless
// add_tags_exclusions_exact_match). Spec 02 "Context Menu": Add Tags in the context menu assigns
// automatically (addTagsAuto: true).
// What the prompt says is the prompts area's business; here which tags land on which message.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import {
    API,
    featureResponder,
    sentPrompts,
    receive,
    setPrefs,
    clickContextMenu,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const answers = {};
const verdicts = {};
const ctx = await bgContext({
    local: {
        ...API,
        add_tags: true,
        add_tags_auto: true,
        add_tags_exclusions: ['newsletter'],
        add_tags_max_messages: 2,
        batch_max_concurrency: 3,
        spamfilter: true,
        spamfilter_skip_addressbook: false,
        translate: false,
    },
    mail: {
        tags: [
            { key: '$label1', tag: 'Important', color: '#ff0000', ordinal: '' },
            { key: 'work', tag: 'Work', color: '#00ff00', ordinal: '' },
        ],
    },
    setup(m) { m.addTab({ id: 7, type: 'mail', active: true }); },
});
ctx.workers.respond = featureResponder({
    add_tags: hid => JSON.stringify({ tags: answers[hid] ?? ['Work'] }),
    spam: hid => JSON.stringify({ spamValue: verdicts[hid] ?? 5, explanation: 'x' }),
});
const k = caseTests('24-add-tags');
const mail = (hid, o = {}) => {
    if (o.tags) answers[hid] = o.tags;
    if (o.spam !== undefined) verdicts[hid] = o.spam;
    return ctx.m.addMessage({ headerMessageId: hid, folderId: o.folderId ?? 'f-inbox', tags: o.existing ?? [] });
};
const labelsOf = hid => (ctx.m.byHeaderId(hid)?.tags || []).map(key => ctx.m.tags.find(t => t.key === key)?.tag ?? key);
const created = () => ctx.m.calls.filter(c => c.api === 'messages.tags.create').map(c => c.args[1]);
const tagPrompted = hid => sentPrompts(ctx).some(p => p.feature === 'add_tags' && p.message === hid);

k.test('assigned', 'the tags of the answer are assigned to the message: an existing tag by its key, a new one created', async () => {
    await receive(ctx, [mail('t1@x', { tags: ['Work', 'Invoice'] })]);
    assert.deepEqual(labelsOf('t1@x').sort(), ['Invoice', 'Work']);
    assert.deepEqual(created(), ['Invoice']);
});

k.test('keeps-existing-tags', 'the tags a message already has are kept', async () => {
    await receive(ctx, [mail('t2@x', { tags: ['Work'], existing: ['$label1'] })]);
    assert.deepEqual(labelsOf('t2@x').sort(), ['Important', 'Work']);
});

k.test('exclusions', 'an excluded tag is never assigned (substring match, case-insensitive)', async () => {
    await receive(ctx, [mail('t3@x', { tags: ['Weekly Newsletter', 'Finance'] })]);
    assert.deepEqual(labelsOf('t3@x'), ['Finance']);
    assert.equal(created().includes('Weekly Newsletter'), false);
});

k.test('spam-moved-not-tagged', 'a message the spam filter moved to junk is not tagged', async () => {
    await receive(ctx, [mail('t4@x', { tags: ['Work'], spam: 99 })]);
    assert.equal(ctx.m.byHeaderId('t4@x').folder.id, 'f-junk');
    assert.equal(tagPrompted('t4@x'), false);
    assert.deepEqual(labelsOf('t4@x'), []);
});

k.test('spam-before-tags', 'spam first: a message is screened before it is tagged', () => {
    const forT1 = sentPrompts(ctx).filter(p => p.message === 't1@x').map(p => p.feature);
    assert.deepEqual(forT1, ['spam', 'add_tags']);
});

k.test('only-inbox', 'auto mode with add_tags_auto_only_inbox (the default): a message in a plain folder is not tagged', async () => {
    await receive(ctx, [mail('t5@x', { folderId: 'f-lists' })]);
    assert.equal(tagPrompted('t5@x'), false);
    assert.deepEqual(labelsOf('t5@x'), []);
});

k.test('sent-skipped', 'auto mode: a message in sent is not tagged', async () => {
    await receive(ctx, [mail('t6@x', { folderId: 'f-sent' })]);
    assert.equal(tagPrompted('t6@x'), false);
});

k.test('parallel-one-new-tag', 'three messages tagged in parallel with the same new label: one tag is created, and all three get it', async () => {
    const hs = [1, 2, 3].map(i => mail('par' + i + '@x', { tags: ['Urgent'] }));
    await receive(ctx, hs);
    assert.deepEqual(created().filter(l => l === 'Urgent'), ['Urgent']);
    const urgentKeys = ctx.m.tags.filter(t => t.tag === 'Urgent').map(t => t.key);
    assert.equal(urgentKeys.length, 1);
    for (const h of hs) assert.deepEqual(labelsOf(h.headerMessageId), ['Urgent'], h.headerMessageId);
});

k.test('right-message', 'with pipelines in parallel, each message gets the tags of its own answer', async () => {
    const hs = [mail('rm1@x', { tags: ['Alpha'] }), mail('rm2@x', { tags: ['Beta'] }), mail('rm3@x', { tags: ['Gamma'] })];
    await receive(ctx, hs);
    assert.deepEqual(labelsOf('rm1@x'), ['Alpha']);
    assert.deepEqual(labelsOf('rm2@x'), ['Beta']);
    assert.deepEqual(labelsOf('rm3@x'), ['Gamma']);
});

k.test('context-menu-cap', 'context menu: a selection larger than add_tags_max_messages is refused with a warning, nothing is tagged', async () => {
    const hs = [1, 2, 3].map(i => mail('cap' + i + '@x', { tags: ['Work'] }));
    const before = ctx.workers.prompts().length;
    ctx.m.tabSends.length = 0;
    await clickContextMenu(ctx, 'mzta-ctx-prompt_add_tags', { id: 7, windowId: 1, type: 'mail' }, hs);
    assert.equal(ctx.workers.prompts().length, before, 'no AI call');
    for (const h of hs) assert.deepEqual(labelsOf(h.headerMessageId), []);
    const err = ctx.m.sentTo(7, 'showGenericError');
    assert.equal(err.length, 1);
    assert.equal(err[0].data.message, ctx.ctl.browser.i18n.getMessage('add_tags_too_many_messages', ['3', '2']));
});

k.test('context-menu-not-filtered', 'context menu within the cap: tagged, also outside the inbox (the auto-mode guards do not apply)', async () => {
    const hs = [mail('cm1@x', { tags: ['Work'], folderId: 'f-lists' })];
    await clickContextMenu(ctx, 'mzta-ctx-prompt_add_tags', { id: 7, windowId: 1, type: 'mail' }, hs);
    assert.deepEqual(labelsOf('cm1@x'), ['Work']);
});

k.test('auto-not-capped', 'automatic tagging of incoming mail is never capped by add_tags_max_messages', async () => {
    const hs = [1, 2, 3].map(i => mail('nc' + i + '@x', { tags: ['Work'] }));
    await receive(ctx, hs);
    for (const h of hs) assert.deepEqual(labelsOf(h.headerMessageId), ['Work']);
});

k.test('force-existing', 'with add_tags_auto_force_existing, a tag that does not exist is skipped, never created', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { add_tags_auto_force_existing: true });
    const before = created().length;
    await receive(ctx, [mail('fe1@x', { tags: ['Work', 'Brandnew'] })]);
    assert.deepEqual(labelsOf('fe1@x'), ['Work']);
    assert.equal(created().length, before);
});

k.test('include-sent', 'with add_tags_auto_include_sent, a message in sent is tagged in auto mode', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { add_tags_auto_include_sent: true, add_tags_auto_force_existing: false });
    await receive(ctx, [mail('is1@x', { folderId: 'f-sent', tags: ['Work'] })]);
    assert.deepEqual(labelsOf('is1@x'), ['Work']);
});

k.test('unusable-connection', 'an unusable add_tags connection skips tagging for the batch; the other features still run', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { add_tags_use_specific_integration: true, add_tags_connection_type: 'chatgpt_web' });
    await receive(ctx, [mail('uc1@x', { tags: ['Work'] }), mail('uc2@x', { tags: ['Work'] })]);
    assert.equal(tagPrompted('uc1@x'), false);
    assert.equal(tagPrompted('uc2@x'), false);
    assert.deepEqual(labelsOf('uc1@x'), []);
    assert.ok(sentPrompts(ctx).some(p => p.feature === 'spam' && p.message === 'uc1@x'), 'the spam filter still ran');
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
