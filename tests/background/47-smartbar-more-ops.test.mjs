// The SmartBar operations that act through another feature's own pipeline with no panel of their
// own (claude-spec/10-smartbar.md "Operation registry"), through the real runtime.onMessage
// listener, from the tab that displays the message:
//  - delete_summary / delete_translation: the stored summary (translation) removed, the panel taken
//    out of every tab displaying the message (removeSummaryPanel / removeTranslationPanel), no model
//    call; done with removed false when there was nothing to delete; asked with a new summary in the
//    same instruction, the deletion runs first and the new summary is generated, not the cached one;
//  - spam_check: the spam filter's analysis (its prompt, the report stored), never moving the
//    message; the line's result holds the score and the verdict against the threshold;
//  - calendar_event / task: ThunderAI Sparks checked first: missing or outdated, the line ends in
//    error (errorType sparks) saying so, with no model call; present, the feature's special prompt
//    reads the email and Sparks receives the object the context menu would send (dates normalized,
//    the link to the email with *_append_email_link), the line done once Sparks opened its dialog;
//    a dialog Sparks could not open is an error; an answer with no JSON object is an error and
//    nothing reaches Sparks.

import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import { answering } from './fake-worker.mjs';
import {
    API,
    featureOf,
    messageOf,
    fromTab,
    record,
    assertClean
} from './flows.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const ROUTER_MARK = 'Reply with one JSON object and nothing else';
const CALENDAR_MARK = 'required to generate a calendar event';
const TASK_MARK = 'required to generate a task';
const routes = {};          // instruction -> the router's raw answer
const answers = { calendar: null, task: null, spam: null };
// What ThunderAI Sparks answers: its version, and each dialog request it receives.
const sparks = { version: '3.1.0', requests: [], dialogAnswer: 'ok' };

const instructionOf = prompt => (/Instruction:\n([^\n]*)/.exec(prompt) || [])[1];

const ctx = await bgContext({
    local: {
        ...API,
        smartbar_enabled: true,
        summarize: true,
        summarize_auto: 0,
        summarize_display_mode: 'inline',
        translate: true,
        translate_auto: 0,
        translate_lang: 'Italian',
        spamfilter: true,
        spamfilter_threshold: 70,
        get_calendar_event: true,
        get_task: true,
        calendar_append_email_link: true,
    },
    external: (id, message) => {
        if (id !== 'thunderai-sparks@micz.it') throw new Error('no add-on ' + id);
        if (message.action === 'checkPresence') return sparks.version;
        sparks.requests.push(message);
        return sparks.dialogAnswer;
    },
    mail: {
        // An identity: the calendar prompt's placeholders read the account's.
        accounts: [{ id: 'acc1', name: 'Account 1', identities: [{ id: 'id1', email: 'me@example.test' }] }],
    },
    setup(m) {
        m.addTab({ id: 7, type: 'mail', active: true });
    },
});
const k = caseTests('47-smartbar-more-ops');

ctx.workers.respond = answering(prompt => {
    const p = String(prompt);
    if (p.includes(ROUTER_MARK)) {
        return routes[instructionOf(p)] ?? '{"operations": [], "context": [], "unrecognized": ""}';
    }
    if (p.includes(CALENDAR_MARK)) return answers.calendar ?? '{"startDate": "2026-11-20 10:00:00", "endDate": "20261120T110000", "summary": "Meeting", "description": "Project review"}';
    if (p.includes(TASK_MARK)) return answers.task ?? '{"dueDate": "2026-11-25T18:00:00", "initialDate": "", "summary": "Pay the invoice", "description": "Invoice 42"}';
    const f = featureOf(p);
    if (f === 'summary') return 'Summary of **' + messageOf(p) + '**';
    if (f === 'translation') return JSON.stringify({ subject: 'Oggetto', body: 'Corpo', status: '1' });
    if (f === 'spam') return answers.spam ?? '{"spamValue": 85, "explanation": "Phishing"}';
    throw new Error('47-smartbar-more-ops: unexpected prompt ' + p.slice(0, 80));
});

const show = (tabId, hid) => {
    const h = ctx.m.byHeaderId(hid) || ctx.m.addMessage({ headerMessageId: hid, folderId: 'f-inbox', subject: 'Subject of ' + hid,
        author: 'Alice Smith <alice@example.com>' });
    ctx.m.tab(tabId).displayed = h.id;
    return h;
};
const run = (hid, instruction) => fromTab(ctx, 7, { command: 'smartbar_run', headerMessageId: hid, instruction }, { turns: 300 });
const json = o => JSON.stringify(o);
const route = (instruction, ...ids) => {
    routes[instruction] = json({ operations: ids.map(id => ({ id, params: {} })), context: [], unrecognized: '' });
};
const msg = key => ctx.ctl.browser.i18n.getMessage(key);
const { taSmartbarStore } = await import('../../js/mzta-smartbar-store.js');
const lines = async hid => (await taSmartbarStore.latest(hid)).operations;
const promptsOf = mark => ctx.workers.prompts().filter(p => String(p).includes(mark));

k.test('delete-summary', 'delete_summary: the stored summary removed and its panel taken out, no model call', async () => {
    route('riassumi', 'summarize');
    route('cancella il riassunto', 'delete_summary');
    show(7, 'ds1@x');
    await run('ds1@x', 'riassumi');
    assert.ok((await record(ctx, 'ds1@x'))?.summary, 'a summary stored first');
    const calls = ctx.workers.prompts().length;
    ctx.m.tabSends.length = 0;
    await run('ds1@x', 'cancella il riassunto');
    assert.equal((await record(ctx, 'ds1@x'))?.summary, undefined);
    assert.equal(ctx.workers.prompts().length - calls, 1, 'the router only');
    assert.ok(ctx.m.sentTo(7, 'removeSummaryPanel').some(s => s.headerMessageId === 'ds1@x'));
    assert.deepEqual((await lines('ds1@x')).map(o => [o.id, o.state, o.result]), [['delete_summary', 'done', { removed: true }]]);
    // Nothing left: done all the same, removed false.
    await run('ds1@x', 'cancella il riassunto');
    assert.deepEqual((await lines('ds1@x')).map(o => [o.state, o.result]), [['done', { removed: false }]]);
});

k.test('delete-translation', 'delete_translation: the stored translation removed and its panel taken out', async () => {
    route('traduci', 'translate');
    route('delete the translation', 'delete_translation');
    show(7, 'dt1@x');
    await run('dt1@x', 'traduci');
    assert.ok((await record(ctx, 'dt1@x'))?.translation, 'a translation stored first');
    ctx.m.tabSends.length = 0;
    await run('dt1@x', 'delete the translation');
    assert.equal((await record(ctx, 'dt1@x'))?.translation, undefined);
    assert.ok(ctx.m.sentTo(7, 'removeTranslationPanel').some(s => s.headerMessageId === 'dt1@x'));
    assert.deepEqual((await lines('dt1@x')).map(o => [o.id, o.state, o.result]), [['delete_translation', 'done', { removed: true }]]);
});

k.test('delete-then-summarize', 'delete the summary and summarize again: the deletion first, then a new summary, not the cached one', async () => {
    route('riassumi', 'summarize');
    // The user's order puts the summary first: the plan runs the deletion first anyway.
    route('riassumi di nuovo dopo aver cancellato il riassunto', 'summarize', 'delete_summary');
    show(7, 'ds2@x');
    await run('ds2@x', 'riassumi');
    const count = () => ctx.workers.prompts().filter(p => featureOf(p) === 'summary' && messageOf(p) === 'ds2@x').length;
    assert.equal(count(), 1);
    await run('ds2@x', 'riassumi di nuovo dopo aver cancellato il riassunto');
    assert.equal(count(), 2, 'a new summary');
    assert.ok((await record(ctx, 'ds2@x'))?.summary, 'the new summary stored');
    assert.deepEqual((await lines('ds2@x')).map(o => [o.id, o.state, o.dependsOn]), [['delete_summary', 'done', []], ['summarize', 'done', [0]]]);
});

k.test('spam-check', 'spam_check: the spam filter\'s analysis, the report stored, the message never moved', async () => {
    route('è spam?', 'spam_check');
    const h = show(7, 'sp1@x');
    const folder = h.folderId;
    await run('sp1@x', 'è spam?');
    assert.equal(ctx.workers.prompts().filter(p => featureOf(p) === 'spam' && messageOf(p) === 'sp1@x').length, 1);
    assert.equal((await record(ctx, 'sp1@x'))?.spam?.spamValue, 85);
    assert.equal(ctx.m.byHeaderId('sp1@x').folderId, folder, 'not moved');
    assert.deepEqual((await lines('sp1@x')).map(o => [o.id, o.state, o.result]), [['spam_check', 'done', { spamValue: 85, threshold: 70, spam: true }]]);
    answers.spam = '{"spamValue": 5, "explanation": "Fine"}';
    try {
        await run('sp1@x', 'è spam?');
        assert.deepEqual((await lines('sp1@x'))[0].result, { spamValue: 5, threshold: 70, spam: false });
    } finally {
        answers.spam = null;
    }
});

k.test('sparks-missing', 'calendar_event / task without Sparks, or with an outdated one: an error that says so, no model call', async () => {
    route('aggiungi al calendario', 'calendar_event');
    route('crea un task', 'task');
    show(7, 'sk1@x');
    try {
        sparks.version = null;
        await run('sk1@x', 'aggiungi al calendario');
        assert.deepEqual((await lines('sk1@x')).map(o => [o.id, o.state, o.errorType, o.error]),
            [['calendar_event', 'error', 'sparks', msg('smartbar_error_sparks_missing')]]);
        sparks.version = '3.0.0';
        await run('sk1@x', 'crea un task');
        assert.deepEqual((await lines('sk1@x')).map(o => [o.id, o.state, o.errorType, o.error]),
            [['task', 'error', 'sparks', msg('smartbar_error_sparks_old')]]);
        assert.equal(promptsOf(CALENDAR_MARK).length + promptsOf(TASK_MARK).length, 0, 'no model call');
        assert.equal(sparks.requests.length, 0);
    } finally {
        sparks.version = '3.1.0';
    }
});

k.test('calendar-event', 'calendar_event: the event read from the email reaches Sparks as the context menu sends it', async () => {
    route('aggiungi al calendario', 'calendar_event');
    show(7, 'ce1@x');
    sparks.requests.length = 0;
    await run('ce1@x', 'aggiungi al calendario');
    assert.equal(promptsOf(CALENDAR_MARK).length, 1);
    assert.equal(messageOf(promptsOf(CALENDAR_MARK)[0]), 'ce1@x', 'the email\'s body reaches the prompt');
    assert.equal(sparks.requests.length, 1);
    assert.equal(sparks.requests[0].action, 'openCalendarEventDialog');
    const data = JSON.parse(sparks.requests[0].calendar_event_data);
    assert.equal(data.startDate, '20261120T100000');
    assert.equal(data.endDate, '20261120T110000');
    assert.equal(data.use_timezone, false);
    assert.ok(data.description.startsWith('Project review'));
    assert.ok(data.description.endsWith('mid:ce1@x'), 'the link to the email, added after the answer');
    assert.ok(!('reminderMinutes' in data), 'the reminder option is off');
    assert.deepEqual((await lines('ce1@x')).map(o => [o.id, o.state]), [['calendar_event', 'done']]);
});

k.test('task', 'task: the task read from the email reaches Sparks, an empty date removed', async () => {
    route('create a task', 'task');
    show(7, 'tk1@x');
    sparks.requests.length = 0;
    await run('tk1@x', 'create a task');
    assert.equal(promptsOf(TASK_MARK).length, 1);
    assert.equal(sparks.requests.length, 1);
    assert.equal(sparks.requests[0].action, 'openTaskDialog');
    const data = JSON.parse(sparks.requests[0].task_data);
    assert.equal(data.dueDate, '20261125T180000');
    assert.ok(!('initialDate' in data));
    assert.equal(data.description, 'Invoice 42', 'task_append_email_link is off');
    assert.deepEqual((await lines('tk1@x')).map(o => [o.id, o.state]), [['task', 'done']]);
});

k.test('sparks-errors', 'a dialog Sparks could not open, and an answer with no JSON object, end the line in error', async () => {
    route('aggiungi al calendario', 'calendar_event');
    show(7, 'se1@x');
    try {
        sparks.dialogAnswer = { error: 'no calendar' };
        await run('se1@x', 'aggiungi al calendario');
        let line = (await lines('se1@x'))[0];
        assert.deepEqual([line.state, line.errorType], ['error', 'sparks']);
        assert.equal(line.error, msg('calendar_opening_dialog_error') + ': no calendar');
        sparks.dialogAnswer = 'ok';
        sparks.requests.length = 0;
        answers.calendar = 'Sorry, I found no event.';
        await run('se1@x', 'aggiungi al calendario');
        line = (await lines('se1@x'))[0];
        assert.equal(line.state, 'error');
        assert.ok(line.error.startsWith(msg('calendar_getting_data_error') + ': '), line.error);
        assert.equal(sparks.requests.length, 0, 'nothing reaches Sparks');
    } finally {
        sparks.dialogAnswer = 'ok';
        answers.calendar = null;
    }
});

k.test('clean', 'no worker left alive, no unmodelled API, no unhandled rejection', () => {
    assertClean(ctx);
});

k.coverage();
