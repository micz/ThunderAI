// The real menu action, prompt preparation, model-worker protocol and Sparks
// transport. The model, message pane and companion are simulated (no network).
import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import { API, assertClean } from './flows.mjs';
import { answering } from './fake-worker.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const k=caseTests('41-calendar-metadata');
const categories=['Séminaire','Name, "quoted"'];
const outgoing=[];
let mode='new', modelAnswer;
const ctx=await bgContext({
    local:{...API,get_calendar_event:true,get_calendar_event_from_clipboard:true,calendar_append_email_link:true,
        calendar_enforce_timezone:true,calendar_timezone:'Europe/Paris',calendar_reminder_enabled:true},
    external:async (id,message) => {
        assert.equal(id,'thunderai-sparks@micz.it');
        if (message.action==='checkPresence') return '3.1.1';
        if (message.action==='getCapabilities') {
            if (mode==='error') throw new Error('absent');
            return mode==='new' ? {calendarEventFields:['categories','links'],calendarCategories:categories} : true;
        }
        if (message.action==='openCalendarEventDialog') {
            outgoing.push(structuredClone(message));
            return mode==='dialog-error' ? {result:'error',error:'Synthetic unavailable calendar'} : 'ok';
        }
        throw new Error('Unexpected action '+message.action);
    },
    mail:{accounts:[{id:'acc1',name:'Synthetic account',identities:[{id:'id1',email:'me@example.test'}]}]},
    setup(m) { m.addTab({id:7,type:'messageDisplay',active:true}); },
});
const header=ctx.m.addMessage({headerMessageId:'synthetic-calendar@example.test'});
ctx.m.tab(7).displayed=header.id;
ctx.m.tabAnswer=(_id,message) => {
    if (message.command==='getSelectedText') return 'Synthetic seminar, see https://example.org/programme.pdf';
    if (message.command==='getTextOnly') return 'Synthetic seminar, see https://example.org/programme.pdf';
    if (message.command==='getOnlyTypedText') return {text:'',html:''};
    if (['getSelectedText','getSelectedHtml','getFullHtml','getOnlyQuotedText'].includes(message.command)) return '';
    return true;
};
ctx.workers.respond=answering(() => JSON.stringify(modelAnswer));
const modelEvent=() => ({startDate:'2026-11-04T14:00:00',endDate:'2026-11-04T15:00:00',summary:'Synthetic seminar',
    description:'Synthetic agenda',location:'Room',forceAllDay:false,attendees:[],reminderMinutes:20,
    categories:['Séminaire','unknown'],links:['HTTPS://EXAMPLE.ORG:443/programme.pdf','https://example.org/programme.pdf']});

async function run(id='prompt_get_calendar_event') {
    modelAnswer=modelEvent();
    const result=await ctx.bg.$eval('menus').executeMenuAction(id);
    assert.ok(outgoing.length, JSON.stringify({result,logs:ctx.con.all(),alerts:ctx.m.sentTo(7,'sendAlert')}));
    return {result,data:JSON.parse(outgoing.at(-1).calendar_event_data),prompt:ctx.workers.prompts().at(-1)};
}

k.test('email-to-companion', 'email menu expands categories before the worker and transmits validated native fields', async () => {
    mode='new';
    const {result,data,prompt}=await run();
    assert.deepEqual(result,{ok:'1'});
    assert.ok(prompt.includes(JSON.stringify(categories)));
    assert.equal(prompt.includes('{%calendar_categories%}'),false);
    assert.equal(prompt.includes('mid:'),false);
    assert.deepEqual(data.categories,['Séminaire']);
    assert.deepEqual(data.links,['https://example.org/programme.pdf']);
    assert.deepEqual(data.attendees,[]);
    assert.equal(data.startDate,'20261104T140000');
    assert.equal(data.endDate,'20261104T150000');
    assert.equal(data.summary,'Synthetic seminar');
    assert.equal(data.location,'Room');
    assert.equal(data.forceAllDay,false);
    assert.equal(data.use_timezone,true);
    assert.equal(data.timezone,'Europe/Paris');
    assert.equal(data.reminderMinutes,20);
    assert.match(data.description,/Synthetic agenda\nhttps:\/\/example.org\/programme.pdf/);
    assert.ok(data.description.includes('mid:synthetic-calendar@example.test'));
});

k.test('clipboard-to-companion', 'clipboard uses the same metadata path and never adds a source-mail URI', async t => {
    const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{readText:async () => 'Synthetic clipboard seminar'}}});
    t.after(() => { if(old) Object.defineProperty(globalThis,'navigator',old); else delete globalThis.navigator; });
    mode='new';
    const {result,data,prompt}=await run('prompt_get_calendar_event_from_clipboard');
    assert.deepEqual(result,{ok:'1'});
    assert.ok(prompt.includes('Synthetic clipboard seminar'));
    assert.ok(prompt.includes(JSON.stringify(categories)));
    assert.deepEqual(data.categories,['Séminaire']);
    assert.equal(data.description.includes('mid:'),false);
});

k.test('old-or-absent-capabilities', 'older/malformed and rejected capabilities keep links as text and the historical flow works', async () => {
    for (mode of ['old','error']) {
        const {result,data,prompt}=await run();
        assert.deepEqual(result,{ok:'1'});
        assert.equal('categories' in data,false);
        assert.equal('links' in data,false);
        assert.ok(data.description.includes('https://example.org/programme.pdf'));
        assert.equal(prompt.includes('{%calendar_categories%}'),false);
    }
});

k.test('dialog-error', 'a companion failure is reported without claiming the dialog opened', async () => {
    mode='dialog-error';
    const {result}=await run();
    assert.deepEqual(result,{ok:'0'});
    assert.ok(ctx.m.sentTo(7,'sendAlert').at(-1).message.includes('Synthetic unavailable calendar'));
});

k.test('no-leak', 'no live worker, unhandled rejection or unmodelled API', () => assertClean(ctx));
k.coverage();
