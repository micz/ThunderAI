// The real menu action, prompt preparation, model-worker protocol and Sparks transport for
// calendar categories (spec 02 "Calendar event: native categories"). The model, message pane and
// companion are simulated (no network).
import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import { API, assertClean } from './flows.mjs';
import { answering } from './fake-worker.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const k=caseTests('44-calendar-categories');
const categories=['Séminaire','Name, "quoted"'];
const outgoing=[];
let mode='new', modelAnswer, capabilityRequests=0;
const ctx=await bgContext({
    local:{...API,get_calendar_event:true,get_calendar_event_from_clipboard:true,calendar_append_email_link:true,
        calendar_enforce_timezone:true,calendar_timezone:'Europe/Paris',calendar_reminder_enabled:true},
    external:async (id,message) => {
        assert.equal(id,'thunderai-sparks@micz.it');
        if (message.action==='checkPresence') return '3.1.1';
        if (message.action==='getCapabilities') {
            capabilityRequests++;
            if (mode==='error') throw new Error('absent');
            return mode==='old' ? true : {calendarEventFields:['categories'],calendarCategories:categories};
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
    if (message.command==='getSelectedText') return 'Synthetic seminar on Thursday';
    if (message.command==='getTextOnly') return 'Synthetic seminar on Thursday';
    if (message.command==='getOnlyTypedText') return {text:'',html:''};
    if (message.command==='getFullHtml') return '';
    if (['getSelectedText','getSelectedHtml','getOnlyQuotedText'].includes(message.command)) return '';
    return true;
};
ctx.workers.respond=answering(() => JSON.stringify(modelAnswer));
const modelEvent=(fields={}) => ({startDate:'2026-11-04T14:00:00',endDate:'2026-11-04T15:00:00',summary:'Synthetic seminar',
    description:'Synthetic agenda',location:'Room',forceAllDay:false,attendees:[],reminderMinutes:20,
    categories:['Séminaire','unknown'],...fields});
const RULE='a field "categories"';

async function run(id='prompt_get_calendar_event', answer=modelEvent()) {
    modelAnswer=answer;
    const before=capabilityRequests;
    const result=await ctx.bg.$eval('menus').executeMenuAction(id);
    assert.ok(outgoing.length, JSON.stringify({result,logs:ctx.con.all(),alerts:ctx.m.sentTo(7,'sendAlert')}));
    return {result,data:JSON.parse(outgoing.at(-1).calendar_event_data),prompt:ctx.workers.prompts().at(-1),
        requests:capabilityRequests-before};
}

async function savePrompt(t,text) {
    const stored=(await ctx.prompts.getSpecialPrompts()).map(p => p.id.startsWith('prompt_get_calendar_event') ? {...p,text} : p);
    await ctx.ctl.browser.storage.local.set({_special_prompts:stored});
    await ctx.bg._reload_menus();
    t.after(async () => {
        await ctx.ctl.browser.storage.local.remove('_special_prompts');
        await ctx.bg._reload_menus();
    });
}

k.test('email-to-companion', 'the shipped prompt asks Sparks once, sends the list and transmits validated categories', async () => {
    mode='new';
    const {result,data,prompt,requests}=await run();
    assert.deepEqual(result,{ok:'1'});
    assert.equal(requests,1,'one capability request per extraction');
    assert.ok(prompt.includes(RULE) && prompt.includes('use [] if none fits'));
    assert.equal(prompt.split(JSON.stringify(categories)).length,2,'the list is given once');
    assert.equal(prompt.includes('{%calendar_categories%}'),false);
    assert.deepEqual(data.categories,['Séminaire']);
    assert.deepEqual(data.attendees,[]);
    assert.equal(data.startDate,'20261104T140000');
    assert.equal(data.endDate,'20261104T150000');
    assert.equal(data.summary,'Synthetic seminar');
    assert.equal(data.use_timezone,true);
    assert.equal(data.timezone,'Europe/Paris');
    assert.equal(data.reminderMinutes,20);
    assert.ok(data.description.includes('mid:synthetic-calendar@example.test'));
    assert.equal('links' in data,false);
});

k.test('clipboard-to-companion', 'clipboard uses the same path and never adds a source-mail URI', async t => {
    const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{readText:async () => 'Synthetic clipboard seminar'}}});
    t.after(() => { if(old) Object.defineProperty(globalThis,'navigator',old); else delete globalThis.navigator; });
    mode='new';
    const {result,data,prompt,requests}=await run('prompt_get_calendar_event_from_clipboard');
    assert.deepEqual(result,{ok:'1'});
    assert.equal(requests,1);
    assert.ok(prompt.includes('Synthetic clipboard seminar'));
    assert.ok(prompt.includes(JSON.stringify(categories)));
    assert.deepEqual(data.categories,['Séminaire']);
    assert.equal(data.description.includes('mid:'),false);
});

k.test('none-fits', 'an empty list from the model is kept: a category is optional', async () => {
    mode='new';
    const {data}=await run(undefined,modelEvent({categories:[]}));
    assert.deepEqual(data.categories,[]);
});

k.test('old-or-absent-sparks', 'an older or absent Sparks costs one request, drops the field, and the event still opens', async () => {
    for (mode of ['old','error']) {
        const {result,data,prompt,requests}=await run();
        assert.deepEqual(result,{ok:'1'});
        assert.equal(requests,1);
        assert.equal('categories' in data,false);
        assert.equal(data.summary,'Synthetic seminar');
        assert.ok(prompt.includes('[]'));
        assert.equal(prompt.includes('{%calendar_categories%}'),false);
    }
    mode='new';
});

k.test('not-asked', 'an edited prompt that does not name categories behaves as before: no request, no rule, field dropped', async t => {
    await savePrompt(t,'Event JSON. {%mail_text_body_or_selected%}');
    mode='new';
    const {result,data,prompt,requests}=await run();
    assert.deepEqual(result,{ok:'1'});
    assert.equal(requests,0);
    assert.equal(prompt.includes(RULE),false);
    assert.equal(prompt.includes(JSON.stringify(categories)),false);
    assert.equal('categories' in data,false);
});

k.test('own-words', 'a prompt holding the placeholder gets the list once and no added rule', async t => {
    await savePrompt(t,'Always choose one category from {%calendar_categories%}. {%mail_text_body_or_selected%}');
    mode='new';
    const {data,prompt,requests}=await run();
    assert.equal(requests,1);
    assert.ok(prompt.includes('Always choose one category from '+JSON.stringify(categories)));
    assert.equal(prompt.split(JSON.stringify(categories)).length,2);
    assert.equal(prompt.includes(RULE),false);
    assert.deepEqual(data.categories,['Séminaire']);
});

k.test('field-named', 'a prompt naming the JSON field without the placeholder gets the rule with the list', async t => {
    await savePrompt(t,'Answer with {"summary": "", "categories": []}. {%mail_text_body_or_selected%}');
    mode='new';
    const {data,prompt,requests}=await run();
    assert.equal(requests,1);
    assert.ok(prompt.includes(RULE) && prompt.includes(JSON.stringify(categories)));
    assert.deepEqual(data.categories,['Séminaire']);
});

k.test('shipped-copy', 'a saved copy of the shipped text, as any save of a special prompt writes, still asks', async t => {
    await savePrompt(t,ctx.ctl.browser.i18n.getMessage('prompt_get_calendar_event_full_text'));
    mode='new';
    const {data,prompt}=await run();
    assert.ok(prompt.includes(JSON.stringify(categories)));
    assert.deepEqual(data.categories,['Séminaire']);
});

k.test('dialog-error', 'a companion failure is reported without claiming the dialog opened', async () => {
    mode='dialog-error';
    const {result}=await run();
    assert.deepEqual(result,{ok:'0'});
    assert.ok(ctx.m.sentTo(7,'sendAlert').at(-1).message.includes('Synthetic unavailable calendar'));
    mode='new';
});

k.test('no-leak', 'no live worker, unhandled rejection or unmodelled API', () => assertClean(ctx));
k.coverage();
