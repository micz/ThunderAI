// Calendar metadata/placeholder contract in specs 02 and 03. No DOM or native UI.
import { before } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('25-calendar-metadata');
const CATEGORIES = ['Séminaire', 'Name, "quoted"', '研究'];
const CAPS = {calendarEventFields:['categories','links'],calendarCategories:CATEGORIES};
let ctx, ph, suggestions, response = CAPS, requests = 0;
before(async () => {
    ctx = await startBackground({policy:null,external:async (id,message) => {
        assert.equal(id,'thunderai-sparks@micz.it');
        assert.equal(message.action,'getCapabilities');
        requests++;
        if (response instanceof Error) throw response;
        return response;
    }});
    ({placeholdersUtils:ph,...suggestions} = await import(new URL('js/mzta-placeholders.js',REPO).href));
});

k.test('registered', 'the JSON category variable is available in autocomplete in every context', async () => {
    const entry = (await suggestions.getPlaceholders(true)).find(p => p.id === 'calendar_categories');
    assert.equal(entry.type,0);
    assert.equal(entry.default_value,'[]');
    assert.ok(JSON.stringify(suggestions.mapPlaceholderToSuggestion(entry)).includes('{%calendar_categories%}'));
});

k.test('expanded', 'the native list is JSON encoded and multiple/spaced occurrences resolve once', async () => {
    response=CAPS;
    const before=requests;
    const text='Choose {%calendar_categories%}; again {% calendar_categories %}.';
    const replacements=await ph.getPlaceholdersValues({prompt_text:text});
    assert.equal(requests-before,1);
    const output=await ph.replacePlaceholders({text,replacements,use_default_value:false});
    assert.equal(output,'Choose '+JSON.stringify(CATEGORIES)+'; again '+JSON.stringify(CATEGORIES)+'.');
    assert.equal(output.includes('{%'),false);
});

k.test('lazy', 'no category token means no cross-extension request', async () => {
    const before=requests;
    await ph.getPlaceholdersValues({prompt_text:'Plain prompt.'});
    assert.equal(requests,before);
});

k.test('unavailable', 'absent Sparks or malformed capabilities resolve to [] and disable native fields only', async () => {
    for (response of [new Error('absent'),true,'3.1.1',null,[],{},
        {calendarEventFields:['links'],calendarCategories:[42]},
        {calendarEventFields:[null],calendarCategories:[]},
    ]) {
        assert.deepEqual(await ctx.utils.getSparksCapabilities(),{calendarEventFields:[],calendarCategories:[]});
        const text='{%calendar_categories%}';
        const replacements=await ph.getPlaceholdersValues({prompt_text:text});
        assert.equal(await ph.replacePlaceholders({text,replacements,use_default_value:false}),'[]');
    }
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
    assert.deepEqual(await pending,{calendarEventFields:[],calendarCategories:[]});
    response=CAPS;
});

k.test('metadata', 'only known categories and normalized HTTP(S) links survive; legacy fields remain unchanged', () => {
    const data={startDate:'20261104T140000',endDate:'20261104T150000',summary:'Synthetic',description:'Agenda\nhttps://example.org/a?x=1#p',location:'Room',forceAllDay:false,attendees:[],timezone:'Europe/Paris',use_timezone:true,reminderMinutes:10};
    const normalized=ctx.utils.normalizeCalendarMetadata({...data,
        categories:['Séminaire','unknown','Séminaire','Name, "quoted"',null],
        links:['HTTPS://EXAMPLE.ORG:443/a?x=1#p','https://example.org/a?x=1#p','http://example.org/',
            'ftp://example.org/','https://user@example.org/','https://@example.org/','https://example.org/a b',
            'https://example.org/a\\b','https://example.org/\nsecret','/relative','https://[',null],
    },CAPS);
    assert.deepEqual(normalized,{...data,description:data.description+'\nhttp://example.org/',
        categories:['Séminaire','Name, "quoted"'],links:['https://example.org/a?x=1#p','http://example.org/']});
});

k.test('legacy-fallback', 'old Sparks gets no new fields but keeps valid URLs in the description', () => {
    const data={summary:'Synthetic',description:'Agenda',attendees:[],categories:['Séminaire'],links:['https://example.org/a']};
    ctx.utils.normalizeCalendarMetadata(data,{calendarEventFields:[],calendarCategories:[]});
    assert.deepEqual(data,{summary:'Synthetic',description:'Agenda\nhttps://example.org/a',attendees:[]});
});

k.test('invalid-optional', 'missing, empty or invalid optional fields never block the core event', () => {
    assert.deepEqual(ctx.utils.normalizeCalendarMetadata({summary:'S'},CAPS),{summary:'S'});
    for (const invalid of [null,4,'wrong',{},false]) {
        assert.deepEqual(ctx.utils.normalizeCalendarMetadata({summary:'S',categories:invalid,links:invalid},CAPS),{summary:'S'});
    }
    assert.deepEqual(ctx.utils.normalizeCalendarMetadata({summary:'S',categories:[],links:[]},CAPS),{summary:'S',categories:[],links:[]});
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
