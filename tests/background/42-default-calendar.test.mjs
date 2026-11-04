// The default calendar for events: read for each event and sent to Sparks next to the AI's JSON,
// never inside it, and the calendar list the settings page asks Sparks for. The model, message
// pane and companion are simulated (no network).
import assert from 'node:assert/strict';
import { bgContext } from './context.mjs';
import { API, assertClean } from './flows.mjs';
import { answering } from './fake-worker.mjs';
import { caseTests } from '../helpers/known-issues/background.mjs';

const k=caseTests('42-default-calendar');
const outgoing=[];
let calendars;
const ctx=await bgContext({
    local:{...API,get_calendar_event:true,calendar_preferred_id:'calendar-id'},
    external:async (id,message) => {
        assert.equal(id,'thunderai-sparks@micz.it');
        if (message.action==='checkPresence') return '3.1.1';
        if (message.action==='listWritableCalendars') {
            if (calendars instanceof Error) throw calendars;
            return calendars;
        }
        if (message.action==='openCalendarEventDialog') {
            outgoing.push(structuredClone(message));
            return 'ok';
        }
        throw new Error('Unexpected action '+message.action);
    },
    mail:{accounts:[{id:'acc1',name:'Synthetic account',identities:[{id:'id1',email:'me@example.test'}]}]},
    setup(m) { m.addTab({id:7,type:'messageDisplay',active:true}); },
});
const header=ctx.m.addMessage({headerMessageId:'synthetic-calendar@example.test'});
ctx.m.tab(7).displayed=header.id;
ctx.m.tabAnswer=(_id,message) => {
    if (['getSelectedText','getTextOnly'].includes(message.command)) return 'Synthetic seminar';
    if (message.command==='getOnlyTypedText') return {text:'',html:''};
    if (['getSelectedHtml','getFullHtml','getOnlyQuotedText'].includes(message.command)) return '';
    return true;
};
ctx.workers.respond=answering(() => JSON.stringify({startDate:'2026-11-04T14:00:00',endDate:'2026-11-04T15:00:00',
    summary:'Synthetic seminar',description:'Synthetic agenda',location:'Room',forceAllDay:false,attendees:[]}));

async function run() {
    const result=await ctx.bg.$eval('menus').executeMenuAction('prompt_get_calendar_event');
    assert.ok(outgoing.length, JSON.stringify({result,logs:ctx.con.all()}));
    return {result,message:outgoing.at(-1),data:JSON.parse(outgoing.at(-1).calendar_event_data)};
}

k.test('sent-next-to-json', 'the stored calendar id is sent next to the AI JSON, never inside it', async () => {
    const {result,message,data}=await run();
    assert.deepEqual(result,{ok:'1'});
    assert.equal(message.preferred_calendar_id,'calendar-id');
    assert.equal('preferred_calendar_id' in data,false);
    assert.equal(data.summary,'Synthetic seminar');
});

k.test('unset', 'with no stored choice the id is empty, and Sparks keeps the selected calendar', async t => {
    await ctx.ctl.browser.storage.local.set({calendar_preferred_id:''});
    t.after(() => ctx.ctl.browser.storage.local.set({calendar_preferred_id:'calendar-id'}));
    assert.equal((await run()).message.preferred_calendar_id,'');
});

k.test('calendars', 'the calendar list is kept only when Sparks gives a valid one', async () => {
    calendars=[{id:'one',name:'One',type:'caldav',extra:'dropped'}];
    assert.deepEqual(await ctx.utils.getSparksCalendars(),[{id:'one',name:'One',type:'caldav'}]);
    calendars=[];
    assert.deepEqual(await ctx.utils.getSparksCalendars(),[]);
    for (calendars of [new Error('absent'),true,null,{},[null],[{id:'',name:'x',type:'y'}],[{id:'a',name:3,type:'y'}],[{id:'a',name:'x'}]]) {
        assert.equal(await ctx.utils.getSparksCalendars(),null);
    }
});

k.test('calendars-timeout', 'an older Sparks that never answers leaves no list after two seconds', async t => {
    t.mock.timers.enable({apis:['setTimeout']});
    calendars=new Promise(() => {});
    const pending=ctx.utils.getSparksCalendars();
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(2000);
    assert.equal(await pending,null);
});

k.test('policy-excluded', 'a calendar id exists in one profile only, so no policy can set it', async () => {
    const {isPolicyExcludedKey}=await import('../../js/mzta-managed.js');
    assert.equal(isPolicyExcludedKey('calendar_preferred_id'),true);
});

k.test('no-leak', 'no live worker, unhandled rejection or unmodelled API', () => assertClean(ctx));
k.coverage();
