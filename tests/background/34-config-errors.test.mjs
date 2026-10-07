// A configuration error (a usable connection type whose required field is empty) on the automatic
// paths.
//
// Spec 04 "Configuration Validation": initWorker() throws an Error with isConfigError = true before
// any worker exists; the flag tells the callers in mzta-background.js to display the error in the
// panel WITHOUT saving it to storage - so the user can fix the settings and retry cleanly:
//  - summarize / translate / spamfilter: shown in their dedicated panel, not persisted;
//  - add_tags: no panel of its own, so the generic error panel (showGenericError(errMsg, source),
//    broadcast to all tabs).
// Spec 01 "In-flight jobs": "Config errors are broadcast and not stored (a later attempt runs
// again). Nothing stays in progress".

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import {
    API,
    featureResponder,
    sentPrompts,
    receive,
    record,
    setPrefs,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ctx = await bgContext({
    local: {
        ...API,
        chatgpt_api_key: '',
        spamfilter: true, spamfilter_skip_addressbook: false,
        add_tags: true, add_tags_auto: true,
        summarize: true, summarize_auto: 3,
        translate: true, translate_auto: 3, default_chatgpt_lang: 'Italian',
    },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
        m.addTab({ id: 10, type: 'messageCompose', windowId: 4 });
    },
});
ctx.workers.respond = featureResponder();
const k = caseTests('34-config-errors');
const { taJobRegistry } = await import('../../js/mzta-job-registry.js');
const EMPTY_KEY = ctx.ctl.browser.i18n.getMessage('chatgpt_empty_apikey');

const h = ctx.m.addMessage({ headerMessageId: 'ce@x' });
ctx.m.tab(7).displayed = h.id;
await receive(ctx, [h]);

k.test('no-worker', 'no worker is created, no prompt sent', () => {
    assert.equal(ctx.workers.created.length, 0);
    assert.deepEqual(sentPrompts(ctx), []);
});

k.test('nothing-stored', 'nothing is stored for the message: no summary, no translation, no spam report', () => {
    assert.equal(record(ctx, 'ce@x'), null);
});

k.test('summary-panel', 'the summary panel of the displaying tab shows the configuration error', () => {
    const s = ctx.m.sentTo(7, 'showSummary');
    assert.ok(s.length >= 1);
    assert.equal(s[0].data.error, true);
    assert.equal(s[0].data.message, EMPTY_KEY);
});

k.test('translation-panel', 'the translation panel shows it too', () => {
    const t = ctx.m.sentTo(7, 'showTranslation');
    assert.ok(t.length >= 1);
    assert.equal(t[0].data.error, true);
    assert.equal(t[0].data.message, EMPTY_KEY);
});

k.test('spam-panel', 'the spam panel shows it, and the message stays where it is', () => {
    const r = ctx.m.sentTo(7, 'showSpamReport');
    assert.ok(r.length >= 1);
    assert.equal(r[r.length - 1].data.explanation, EMPTY_KEY);
    assert.equal(ctx.m.byHeaderId('ce@x').folder.id, 'f-inbox');
});

k.test('add-tags-generic', 'add_tags, with no panel of its own, shows it in the generic error panel of every tab', () => {
    for (const tab of [7, 10]) {
        const e = ctx.m.sentTo(tab, 'showGenericError');
        assert.ok(e.some(x => x.data.message === EMPTY_KEY), 'tab ' + tab);
    }
    assert.deepEqual(ctx.m.byHeaderId('ce@x').tags, []);
});

k.test('nothing-in-progress', 'no job stays in progress', () => {
    for (const kind of ['summary', 'translation', 'spam', 'add_tags']) assert.equal(taJobRegistry.isRunning(kind, 'ce@x'), false, kind);
});

k.test('retry-after-fix', 'once the key is set, the same message is processed: the error was never cached', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await setPrefs(t, ctx, { chatgpt_api_key: 'sk-FAKE' });
    await receive(ctx, [ctx.m.byHeaderId('ce@x')]);
    const r = record(ctx, 'ce@x');
    assert.equal(r.summary.error, false);
    assert.equal(r.translation.error, false);
    assert.equal(r.spam.spamValue, 10);
});

k.test('no-leak', 'no worker left alive, no unmodelled API touched, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
