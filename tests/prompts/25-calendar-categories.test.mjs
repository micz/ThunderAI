// Calendar categories: placeholder and prompt contract in specs 02 and 03. No DOM or native UI.
import { before } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('25-calendar-categories');
const CATEGORIES = ['Séminaire', 'Name, "quoted"', '研究'];
const CAPS = {calendarEventFields:['categories'],calendarCategories:CATEGORIES};
const NONE = {calendarEventFields:[],calendarCategories:[]};
let ctx, ph, suggestions, promptUtils, response = CAPS, requests = 0;
before(async () => {
    ctx = await startBackground({policy:null,external:async (id,message) => {
        assert.equal(id,'thunderai-sparks@micz.it');
        assert.equal(message.action,'getCapabilities');
        requests++;
        if (response instanceof Error) throw response;
        return response;
    }});
    ({placeholdersUtils:ph,...suggestions} = await import(new URL('js/mzta-placeholders.js',REPO).href));
    ({taPromptUtils:promptUtils} = await import(new URL('js/mzta-utils-prompt.js',REPO).href));
});
const msg = key => ctx.ctl.browser.i18n.getMessage(key);
const resolve = async (text, args = {}) =>
    ph.replacePlaceholders({text,replacements:await ph.getPlaceholdersValues({prompt_text:text,...args}),use_default_value:false});

k.test('registered', 'the JSON category variable is available in autocomplete in every context', async () => {
    const entry = (await suggestions.getPlaceholders(true)).find(p => p.id === 'calendar_categories');
    assert.equal(entry.type,0);
    assert.equal(entry.default_value,'[]');
    assert.ok(JSON.stringify(suggestions.mapPlaceholderToSuggestion(entry)).includes('{%calendar_categories%}'));
});

k.test('expanded', 'the native list is JSON encoded and multiple/spaced occurrences resolve once', async () => {
    response=CAPS;
    const before=requests;
    const output=await resolve('Choose {%calendar_categories%}; again {% calendar_categories %}.');
    assert.equal(requests-before,1);
    assert.equal(output,'Choose '+JSON.stringify(CATEGORIES)+'; again '+JSON.stringify(CATEGORIES)+'.');
});

k.test('lazy', 'no category token means no cross-extension request', async () => {
    const before=requests;
    await ph.getPlaceholdersValues({prompt_text:'Plain prompt.'});
    assert.equal(requests,before);
});

k.test('asked-once', 'capabilities already fetched by the calendar action are reused, with no new request', async () => {
    const before=requests;
    const preset={calendarEventFields:['categories'],calendarCategories:['Fetched once']};
    assert.equal(await resolve('{%calendar_categories%}',{msg_text:{calendar_capabilities:preset}}),'["Fetched once"]');
    assert.equal(requests,before);
});

k.test('unavailable', 'absent Sparks or malformed capabilities resolve to [] and disable the field only', async () => {
    for (response of [new Error('absent'),true,'3.1.1',null,[],{},
        {calendarEventFields:['categories'],calendarCategories:[42]},
        {calendarEventFields:[null],calendarCategories:[]},
        {calendarEventFields:Array(1),calendarCategories:[]},
        {calendarEventFields:['categories'],calendarCategories:Array(1)},
        {calendarEventFields:['categories'],calendarCategories:['ok',7]},
    ]) {
        assert.deepEqual(await ctx.utils.getSparksCapabilities(),NONE);
        assert.equal(await resolve('{%calendar_categories%}'),'[]');
    }
    response=CAPS;
});

k.test('empty-category', 'an empty category name is skipped, not a reason to lose the others', async () => {
    response={calendarEventFields:['categories'],calendarCategories:['','Séminaire','']};
    assert.deepEqual(await ctx.utils.getSparksCapabilities(),{calendarEventFields:['categories'],calendarCategories:['Séminaire']});
    response=CAPS;
});

k.test('timeout', 'an older listener keeping the channel open is bounded to two seconds', async t => {
    t.mock.timers.enable({apis:['setTimeout']});
    response=new Promise(() => {});
    let settled=false;
    const pending=ctx.utils.getSparksCapabilities().then(value => {settled=true;return value;});
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(1999);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled,false);
    t.mock.timers.tick(1);
    assert.deepEqual(await pending,NONE);
    assert.ok(ctx.con.warnings().at(-1).includes('timeout'));
    response=CAPS;
});

k.test('unavailable-logged', 'an unavailable reply is reported by reason, without any reply content', async () => {
    const warnings=() => ctx.con.warnings().filter(message => message.includes('Sparks calendar capabilities unavailable'));
    for (const [value,reason] of [[new Error('private detail'),'no reply'],[{calendarEventFields:['categories'],calendarCategories:['Private name',7]},'invalid reply']]) {
        const before=warnings().length;
        response=value;
        await ctx.utils.getSparksCapabilities();
        assert.equal(warnings().length,before+1);
        assert.ok(warnings().at(-1).includes(reason));
        assert.equal(/private/i.test(warnings().at(-1).replace('Sparks calendar capabilities unavailable','')),false);
    }
    const before=warnings().length;
    response=CAPS;
    await ctx.utils.getSparksCapabilities();
    assert.equal(warnings().length,before);
});

k.test('categories', 'only known categories survive, each once; the other fields remain unchanged', () => {
    const data={startDate:'20261104T140000',endDate:'20261104T150000',summary:'Synthetic',description:'Agenda',location:'Room',
        forceAllDay:false,attendees:[],timezone:'Europe/Paris'};
    const normalized=ctx.utils.normalizeCalendarCategories({...data,
        categories:['Séminaire','unknown','Séminaire','Name, "quoted"',null,'séminaire']},CAPS);
    assert.deepEqual(normalized,{...data,categories:['Séminaire','Name, "quoted"']});
});

k.test('optional', 'an empty list is a valid answer, and no category is invented', () => {
    assert.deepEqual(ctx.utils.normalizeCalendarCategories({summary:'S',categories:[]},CAPS),{summary:'S',categories:[]});
    assert.deepEqual(ctx.utils.normalizeCalendarCategories({summary:'S',categories:['unknown']},CAPS),{summary:'S',categories:[]});
    assert.deepEqual(ctx.utils.normalizeCalendarCategories({summary:'S'},CAPS),{summary:'S'});
});

k.test('invalid-or-old-sparks', 'an invalid field, or a Sparks without the field, drops it and keeps the event', () => {
    for (const invalid of [null,4,'Séminaire',{},false]) {
        assert.deepEqual(ctx.utils.normalizeCalendarCategories({summary:'S',categories:invalid},CAPS),{summary:'S'});
    }
    assert.deepEqual(ctx.utils.normalizeCalendarCategories({summary:'S',categories:['Séminaire']},NONE),{summary:'S'});
});

k.test('prompt-asks', 'the shipped text asks for categories, an edited prompt only by naming them', () => {
    const asked=text => promptUtils.calendarCategoriesAsked(text);
    const shipped=msg('prompt_get_calendar_event_full_text');
    assert.equal(asked(shipped),true);
    assert.equal(asked('  '+shipped+'\n'),true,'a saved copy of the shipped text');
    assert.equal(asked(shipped+' Be brief.'),false,'edited');
    assert.equal(asked('Mine: {%calendar_categories%}'),true);
    assert.equal(asked('Mine: {% calendar_categories %}'),true);
    assert.equal(asked('{"summary": "", "categories": []}'),true);
    for (const plain of ['A saved prompt','categories','',undefined]) assert.equal(asked(plain),false);
});

k.test('statement', 'the rule is added when categories are asked without the list, and says [] is allowed', () => {
    const rule=msg('prompt_calendar_categories_format');
    assert.ok(rule.includes('{%calendar_categories%}') && rule.includes('"categories"'));
    assert.ok(rule.includes('use [] if none fits'));
    const statement=text => promptUtils.getCalendarCategoriesStatement(text);
    assert.equal(statement(msg('prompt_get_calendar_event_full_text')),rule);
    assert.equal(statement('JSON: "categories": []'),rule);
    assert.equal(statement('A saved prompt'),'');
    // A prompt giving the list says in its own words what to do with it.
    assert.equal(statement('Mine: {% calendar_categories %}'),'');
});

k.test('statement-resolved', 'the added instruction is resolved like a prompt, once, and leaves no token', async () => {
    response=CAPS;
    const shipped=msg('prompt_get_calendar_event_full_text');
    assert.equal(await promptUtils.appendCalendarCategoriesStatement('Base','Base',{}),'Base');
    const before=requests;
    const full=await promptUtils.appendCalendarCategoriesStatement('Base',shipped,{msg_text:{calendar_capabilities:CAPS}});
    assert.equal(requests,before,'the capabilities of the extraction are reused');
    assert.ok(full.startsWith('Base \n'));
    assert.ok(full.includes(JSON.stringify(CATEGORIES)));
    assert.equal(full.includes('{%'),false);
});

k.test('shipped-prompt', 'the shipped event prompt text stays as it is: the code asks for categories', () => {
    const text=msg('prompt_get_calendar_event_full_text');
    assert.equal(text.includes('calendar_categories'),false);
    assert.equal(text.includes('"categories"'),false);
});

k.test('stored-prompts', 'saved and custom prompt texts are preserved without automatic replacement', async () => {
    const saved=await ctx.prompts.getSpecialPrompts();
    for (const p of saved) if (p.id.startsWith('prompt_get_calendar_event')) p.text='My existing prompt: attendees: []';
    await ctx.ctl.browser.storage.local.set({_special_prompts:saved,_custom_prompt:[{id:'mine',text:'My custom prompt'}]});
    const texts=(await ctx.prompts.getSpecialPrompts()).filter(p => p.id.startsWith('prompt_get_calendar_event')).map(p => p.text);
    assert.ok(texts.length>=2);
    assert.ok(texts.every(text => text==='My existing prompt: attendees: []'));
    assert.equal(ctx.ctl.localData()._custom_prompt[0].text,'My custom prompt');
});

k.coverage();
