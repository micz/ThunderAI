// Calendar metadata/placeholder contract in specs 02 and 03. No DOM or native UI.
import { before } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, startBackground } from '../helpers/core/load.mjs';
import { caseTests } from '../helpers/known-issues/prompts.mjs';

const k = caseTests('25-calendar-metadata');
const CATEGORIES = ['Séminaire', 'Name, "quoted"', '研究'];
const CAPS = {calendarEventFields:['categories','links'],calendarCategories:CATEGORIES};
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
        {calendarEventFields:Array(1),calendarCategories:[]},
        {calendarEventFields:['links'],calendarCategories:Array(1)},
        {calendarEventFields:['links'],calendarCategories:['ok',7]},
    ]) {
        assert.deepEqual(await ctx.utils.getSparksCapabilities(),{calendarEventFields:[],calendarCategories:[]});
        const text='{%calendar_categories%}';
        const replacements=await ph.getPlaceholdersValues({prompt_text:text});
        assert.equal(await ph.replacePlaceholders({text,replacements,use_default_value:false}),'[]');
    }
});

k.test('empty-category', 'an empty category name is skipped, not a reason to lose the others', async () => {
    response={calendarEventFields:['categories','',null].slice(0,1),calendarCategories:['','Séminaire','']};
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
    assert.deepEqual(await pending,{calendarEventFields:[],calendarCategories:[]});
    assert.ok(ctx.con.warnings().at(-1).includes('timeout'));
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

k.test('description-dedup', 'punctuation around a URL in the description is not a new link; a URL of its own still is', () => {
    const link='https://example.org/p.pdf';
    for (const description of ['See '+link+'.','See ['+link+']('+link+')','('+link+'), thanks','**'+link+'**','"'+link+'"',link]) {
        assert.equal(ctx.utils.normalizeCalendarMetadata({description,links:[link]},CAPS).description,description);
    }
    const wiki='https://example.org/wiki/Foo_(bar)';
    assert.equal(ctx.utils.normalizeCalendarMetadata({description:'('+wiki+')',links:[wiki]},CAPS).description,'('+wiki+')');
    assert.equal(ctx.utils.normalizeCalendarMetadata({description:'https://example.org/wiki/Foo_',links:[wiki]},CAPS).description,
        'https://example.org/wiki/Foo_\n'+wiki);
});

k.test('authority-at', '"@" is refused in the authority only', () => {
    const accepted=['https://meet.example.org?email=a@b.org','https://example.org#a@b','https://example.org/path?email=a@b.org',
        'https://teams.example.org/l/19:meeting_x@thread.v2/0?context=%7b%7d'];
    const {links}=ctx.utils.normalizeCalendarMetadata({links:[...accepted,'https://@example.org/','https://:@example.org/',
        'https://user@example.org/','https://a@b@example.org/']},CAPS);
    assert.deepEqual(links.map(link => new URL(link).hostname),['meet.example.org','example.org','example.org','teams.example.org']);
});

k.test('unavailable-logged', 'an unavailable reply is reported by reason, without any reply content', async () => {
    const warnings=() => ctx.con.warnings().filter(message => message.includes('Sparks calendar capabilities unavailable'));
    for (const [value,reason] of [[new Error('private detail'),'no reply'],[{calendarEventFields:['links'],calendarCategories:['Private name',7]},'invalid reply']]) {
        const before=warnings().length;
        response=value;
        await ctx.utils.getSparksCapabilities();
        assert.equal(warnings().length,before+1);
        assert.ok(warnings().at(-1).includes(reason));
        assert.equal(warnings().at(-1).includes('private'),false);
        assert.equal(warnings().at(-1).includes('Private'),false);
    }
    const before=warnings().length;
    response=CAPS;
    await ctx.utils.getSparksCapabilities();
    assert.equal(warnings().length,before);
});

k.test('mail-links-registered', 'the mail links are offered in autocomplete, and default to an empty JSON array', async () => {
    const entry=(await suggestions.getPlaceholders(true)).find(p => p.id==='mail_links');
    assert.equal(entry.type,0);
    assert.equal(entry.default_value,'[]');
});

k.test('mail-links-clipboard', 'clipboard text has no link targets: the mail on screen is not its source', async () => {
    const text='{%mail_links%}';
    const html='<a href="https://example.org/unrelated">Unrelated</a>';
    for (const args of [{msg_text:{html,from_clipboard:true}},{msg_text:{html,from_clipboard:true},selection_html:html},{msg_text:{}},{}]) {
        const replacements=await ph.getPlaceholdersValues({prompt_text:text,...args});
        assert.equal(await ph.replacePlaceholders({text,replacements,use_default_value:false}),'[]');
    }
});

k.test('statement-switch', 'the instruction is added with the option on, unless the prompt already asks', () => {
    const statement=ctx.ctl.browser.i18n.getMessage('prompt_calendar_metadata_format');
    assert.ok(statement.includes('{%calendar_categories%}') && statement.includes('{%mail_links%}'));
    assert.equal(promptUtils.getCalendarMetadataStatement('A saved prompt',false),'');
    assert.equal(promptUtils.getCalendarMetadataStatement('A saved prompt',true),statement);
    for (const asked of ['Mine: {%calendar_categories%}','Mine: {% calendar_categories %}']) {
        assert.equal(promptUtils.getCalendarMetadataStatement(asked,true),'');
    }
});

k.test('prompt-asks', 'a prompt asking in its own words is recognized by either token, spaced forms too', () => {
    for (const asks of ['Mine: {%calendar_categories%}','Mine: {% mail_links %}']) {
        assert.equal(promptUtils.promptAsksCalendarMetadata(asks),true);
    }
    for (const plain of ['A saved prompt','categories and links',undefined]) {
        assert.equal(promptUtils.promptAsksCalendarMetadata(plain),false);
    }
});

k.test('statement-resolved', 'the added instruction is resolved like a prompt, and leaves no token', async () => {
    response=CAPS;
    assert.equal(await promptUtils.appendCalendarMetadataStatement('Base','Base',false,{}),'Base');
    const full=await promptUtils.appendCalendarMetadataStatement('Base','Base',true,{msg_text:{}});
    assert.ok(full.startsWith('Base \n'));
    assert.ok(full.includes(JSON.stringify(CATEGORIES)));
    assert.equal(full.includes('{%'),false);
    assert.equal(await promptUtils.appendCalendarMetadataStatement('{%calendar_categories%}','{%calendar_categories%}',true,{msg_text:{}}),'{%calendar_categories%}');
});

k.test('shipped-prompt', 'the shipped event prompt does not ask for categories or links: the option does', () => {
    const text=ctx.ctl.browser.i18n.getMessage('prompt_get_calendar_event_full_text');
    assert.equal(text.includes('calendar_categories'),false);
    assert.equal(text.includes('mail_links'),false);
    assert.equal(text.includes('"links"'),false);
});

k.test('links-as-objects', 'a model copying the {text, url} shape of {%mail_links%} still gives its links', () => {
    const {links}=ctx.utils.normalizeCalendarMetadata({links:[{text:'Join',url:'https://example.org/visio?id=1'},{url:'ftp://example.org/x'},{text:'No target'},
        {text:'Programme',url:'https://example.org/p.pdf'},'https://example.org/string']},CAPS);
    assert.deepEqual(links,['https://example.org/visio?id=1','https://example.org/p.pdf','https://example.org/string']);
});

k.test('links-from-description', 'a model giving no usable link falls back on the links it wrote in the description, in order', () => {
    const description='Join https://example.org/visio?id=1, then (https://example.org/p.pdf).\n[https://example.org/m](https://example.org/m) **https://example.org/b** https://example.org/wiki/Foo_(bar).';
    const expected=['https://example.org/visio?id=1','https://example.org/p.pdf','https://example.org/m','https://example.org/b','https://example.org/wiki/Foo_(bar)'];
    for (const links of [[],['not a URL',null],[{text:'No target'}]]) {
        const data=ctx.utils.normalizeCalendarMetadata({description,links},CAPS);
        assert.deepEqual(data.links,expected);
        assert.equal(data.description,description);
    }
});

k.test('links-no-fallback', 'the description is not read when the prompt does not ask for links, or Sparks cannot take them', () => {
    const description='See https://example.org/a';
    assert.deepEqual(ctx.utils.normalizeCalendarMetadata({description},CAPS),{description});
    assert.deepEqual(ctx.utils.normalizeCalendarMetadata({description,links:4},CAPS),{description});
    assert.deepEqual(ctx.utils.normalizeCalendarMetadata({description,links:[]},{calendarEventFields:[],calendarCategories:[]}),{description});
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
