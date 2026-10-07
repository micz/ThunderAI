/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { mzta_script } from './js/mzta-chatgpt.js';
import {
    prefs_default,
    getDynamicSettingsDefaults,
    special_prompts_with_integration
} from './options/mzta-options-default.js';
import { mzta_Menus } from './js/mzta-menus.js';
import { taLogger } from './js/mzta-logger.js';
import {
    getCurrentIdentity,
    getOriginalBody,
    replaceBody,
    setBody,
    i18nConditionalGet,
    generateCallID,
    migrateCustomPromptsStorage,
    migrateDefaultPromptsPropStorage,
    getGPTWebModelString,
    getTagsList,
    createTag,
    assignTagsToMessage,
    checkIfTagLabelExists,
    getActiveSpecialPromptsIDs,
    checkSparksPresence,
    getMessages,
    getMailInlineTextParts,
    extractJsonObject,
    sanitizeChatGPTModelData,
    sanitizeChatGPTWebCustomData,
    stripHtmlKeepLines,
    isPlainTextCompose,
    htmlBodyToPlainText,
    cleanupNewlines,
    convertNewlinesToParagraphs,
    getConnectionType,
    applyPromptConnection,
    hasNoConnectionSelected,
    matchAddressList,
    matchAddressListType,
    hasAddressListEntries,
    resolveEnabledAccounts,
    extractEmail,
    messageFolderHasSpecialUse,
    isMessageInAutoSkippedFolder,
    isApiUsableConnection,
    hasSpecificIntegration,
    sendTabMessageSafe,
    formatDuration,
    getSavedWindowPosition,
     } from './js/mzta-utils.js';
import { taPromptUtils } from './js/mzta-utils-prompt.js';
import { mzta_specialCommand } from './js/mzta-special-commands.js';
import {
    getSpamFilterPrompt,
    getAddTagsPrompt,
    getSummarizePrompt,
    getSpecialPromptPrefix,
    getTranslatePrompt,
    migrateMenuOrderAlphabetic,
    migrateEnabledToShowIn,
    migrateCalendarNoSelection,
    getSpecialPrompts,
    getIgnoredProviderOverrides,
    getReplacedProviderOverrides,
    getEnforcedTextPlaceholderProblems
} from './js/mzta-prompts.js';
import { taSpamReport } from './js/mzta-spamreport.js';
import { taSummaryStore } from './js/mzta-summarystore.js';
import { taTranslationStore } from './js/mzta-translationstore.js';
import { taWorkingStatus } from './js/mzta-working-status.js';
import { taBatchController } from './js/mzta-batch-controller.js';
import { taJobRegistry } from './js/mzta-job-registry.js';
import {
    addTags_getExclusionList,
    addTags_setExclusionList,
    checkExcludedTag
} from './js/mzta-addtags-exclusion-list.js';
import { mztaPrefs } from './js/mzta-prefs.js';
import { sanitizeBlockHtml } from './js/mzta-richtext.js';
import {
    migratePrefsToLocal,
    isSyncDrained,
    migrateOllamaThinkLevel
} from './js/mzta-prefs-migration.js';
import { mztaManaged, MANAGED_SECRET_MARKER } from './js/mzta-managed.js';

browser.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
    // console.log(">>>>>>>>>>> onInstalled: " + JSON.stringify(reason) + ", previousVersion: " + previousVersion);
    if (reason === "install" 
       || (reason === "update" && (previousVersion.startsWith("2.") || previousVersion.startsWith("1.")))
       || (reason === "update" && ((previousVersion.startsWith("3.") && parseInt(previousVersion.split(".")[1]) <= 2)))
       //|| (reason === "update") // only for testing
       ) {
        browser.tabs.create({ url: "/pages/onboarding/onboarding.html" });
    }
});

// The enterprise policy for every other extension context (see managedReady() in
// js/mzta-managed.js): the one channel a page gets it through - values and locks, enforced
// texts and connections, organization prompts, restrictions, banner state. Registered here,
// before the first startup await, rather than in the main onMessage listener further down:
// that one only exists after every startup await, and a page opened during startup would
// otherwise hydrate empty and run unmanaged. It answers only once loadManaged() (below, after
// the migrations) has settled: whenLoaded() waits for it without starting it. The main
// listener's default branch returns false for this command, so the two never compete.
browser.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.command !== 'get_managed_values') return false;
    const empty = {
        values: {}, lockedKeys: [], specialPromptsText: {}, specialPromptsConnection: {},
        orgPrompts: [], orgName: '', active: false,
        disablePromptManagement: false, disableDefaultPrompts: false, disableSetupWizard: false,
    };
    // Extension pages only. Content scripts (compose and message display) share this
    // channel but never import js/mzta-prefs.js, so they have no use for the values.
    const ext_root = browser.runtime.getURL('');
    if (!sender || typeof sender.url !== 'string' || !sender.url.startsWith(ext_root)) {
        return Promise.resolve(empty);
    }
    return mztaManaged.whenLoaded().then(() => {
        // A policy-supplied API key goes ONLY to the API chat window, which needs it to call
        // the provider. Every settings page gets MANAGED_SECRET_MARKER instead, so the key can
        // neither be revealed with the password eye toggle nor copied into a prompt.
        // Matched on the page, not the folder: index.html is the only page in api_webchat/, and
        // the webext linter reads a getURL() folder argument as a missing packaged file.
        const is_webchat = sender.url.startsWith(browser.runtime.getURL('api_webchat/index.html'));
        const values = {};
        for (const key of Object.keys(prefs_default)) {
            if (!mztaManaged.hasManagedValue(key)) continue;
            // A key strict mode locked at its default ('') carries no secret, and the marker
            // would make an empty key look configured (isConnectionConfigured() in the popup).
            values[key] = (key.endsWith('_api_key') && !is_webchat && !mztaManaged.isLockedByDefault(key))
                ? MANAGED_SECRET_MARKER
                : mztaManaged.getManagedValue(key);
        }
        // The per-feature connections are overlaid by getSpecialPrompts() in every context too.
        // Their API keys follow the same rule as the global ones: the real key for the API chat
        // window (it runs a feature's connection itself, via loadPrompt()), the marker elsewhere.
        const connections = mztaManaged.getSpecialPromptsConnection();
        if (!is_webchat) {
            for (const entry of Object.values(connections)) {
                for (const [name, field] of Object.entries(entry.fields)) {
                    if (name.endsWith('_api_key')) field.value = MANAGED_SECRET_MARKER;
                }
            }
        }
        // The enforced special prompt texts: getSpecialPrompts() overlays them in every context,
        // and the feature pages show them read-only. No secret in them, nor in the org prompts.
        return {
            values: values,
            lockedKeys: mztaManaged.getLockedKeys(),
            specialPromptsText: mztaManaged.getSpecialPromptsText(),
            specialPromptsConnection: connections,
            orgPrompts: mztaManaged.getOrgPrompts(),
            orgName: mztaManaged.getOrgName(),
            active: mztaManaged.isManagedActive(),
            disablePromptManagement: mztaManaged.isPromptManagementDisabled(),
            disableDefaultPrompts: mztaManaged.areDefaultPromptsDisabled(),
            disableSetupWizard: mztaManaged.isSetupWizardDisabled(),
        };
    });
});

// Must run FIRST, before anything reads a preference. It also carries the one-shot
// migration flags into storage.local — migrateEnabledToShowIn() below reads one of them,
// and migrateMenuOrderAlphabetic() (called further down) reads the other, which would
// otherwise find its "not yet run" default and overwrite the user's custom menu ordering.
// Hence _prefs_migration_ok: if the copy failed, those flags are not in storage.local yet
// and the two migrations guarded by them must be skipped rather than re-run destructively.
const _prefs_migration_ok = await migratePrefsToLocal();

// A failed migration must never stop the add-on from starting: this is the top level, where a
// rejection would abort everything below it (menus, listeners), at every start. So each
// migration that can reject is awaited with a .catch() that only logs. Its one-shot flag is
// written only on success, so it simply runs again at the next start. migratePrefsToLocal(),
// isSyncDrained() and migrateOllamaThinkLevel() catch their own failures.
//
// Once storage.sync is drained these two have nothing left to find, and each would otherwise
// pay a storage.sync.get() at every startup forever. The other two migrations below are NOT
// skipped this way: they work on storage.local data and own their own flags, so they must be
// allowed to decide for themselves.
if (!await isSyncDrained()) {
    await migrateCustomPromptsStorage().catch(e => console.error("[ThunderAI] migrateCustomPromptsStorage error: " + e));
    await migrateDefaultPromptsPropStorage().catch(e => console.error("[ThunderAI] migrateDefaultPromptsPropStorage error: " + e));
}
if (_prefs_migration_ok) await migrateEnabledToShowIn().catch(e => console.error("[ThunderAI] migrateEnabledToShowIn error: " + e));
// Reads the user's stored calendar_no_selection, so it needs the sync copy to be in place
// for the same reason as the migration above.
if (_prefs_migration_ok) await migrateCalendarNoSelection().catch(e => console.error("[ThunderAI] migrateCalendarNoSelection error: " + e));
// Converts the global ollama_think from the old boolean checkbox to the level format.
// Guarded by _prefs_migration_ok for the same reason as the line above: its own one-shot
// flag lives in storage.local, and reading it before the copy succeeded would find the
// "not yet run" default and rewrite a value that is not there yet.
if (_prefs_migration_ok) await migrateOllamaThinkLevel();

var original_html = '';
var modified_html = '';

let _process_incoming = false;
let _sparks_presence = false;

// Every key held by the prefs_init snapshot. Hoisted so the storage.onChanged gate
// below is derived from the same list reload_pref_init() actually reads, and cannot
// drift out of sync with it.
const PREFS_INIT_KEYS = {
    do_debug: prefs_default.do_debug,
    add_tags: prefs_default.add_tags,
    get_calendar_event: prefs_default.get_calendar_event,
    get_calendar_event_from_clipboard: prefs_default.get_calendar_event_from_clipboard,
    get_task: prefs_default.get_task,
    connection_type: prefs_default.connection_type,
    add_tags_auto: prefs_default.add_tags_auto,
    add_tags_auto_force_existing: prefs_default.add_tags_auto_force_existing,
    add_tags_auto_only_inbox: prefs_default.add_tags_auto_only_inbox,
    add_tags_auto_include_sent: prefs_default.add_tags_auto_include_sent,
    spamfilter: prefs_default.spamfilter,
    summarize: prefs_default.summarize,
    summarize_auto: prefs_default.summarize_auto,
    summarize_auto_senders: prefs_default.summarize_auto_senders,
    summarize_auto_senders_list: prefs_default.summarize_auto_senders_list,
    translate: prefs_default.translate,
    translate_auto: prefs_default.translate_auto,
    spamfilter_threshold: prefs_default.spamfilter_threshold,
    spamfilter_show_msg_panel: prefs_default.spamfilter_show_msg_panel,
    dynamic_menu_force_enter: prefs_default.dynamic_menu_force_enter,
    chatgpt_win_save_position: prefs_default.chatgpt_win_save_position,
    ...getDynamicSettingsDefaults(['use_specific_integration', 'connection_type'])
};

// Keys that affect which special prompts are advertised in the menus. The per-feature
// integration keys are pulled from the generated defaults rather than listed by hand:
// only add_tags' pair used to be here, so a change to any other feature's specific
// integration never triggered a menu rebuild.
const MENU_RELEVANT_KEYS = [
    'add_tags', 'get_calendar_event', 'get_calendar_event_from_clipboard', 'get_task',
    'spamfilter', 'summarize', 'translate', 'connection_type',
    // Not a gating key, but the menus hold the prompt objects taken at the last rebuild, and
    // need_selected of the calendar prompt is derived from this preference on read
    // (applyCalendarNoSelection() in js/mzta-prompts.js): without a rebuild a change would
    // only take effect at the next restart.
    'calendar_no_selection',
    // Same reason: a menu action expands the custom placeholders into the prompt text it holds
    // (js/mzta-menus.js), so a changed placeholder text needs a rebuild to take effect.
    '_custom_placeholder',
    ...Object.keys(getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']))
];

let prefs_init = {};

// The enterprise policy must be in place before the FIRST preference read, because
// js/mzta-prefs.js resolves every read against it. This is the only place it is loaded:
// browser.storage.managed is read in the background page and nowhere else, and every
// other context hydrates it over runtime.sendMessage ("get_managed_values", above).
//
// It runs after the migration block above, which is documented as having to come first,
// and before _reconcileFeatureFlags() below, which is the first thing to read a
// preference. With no policy installed this resolves silently and changes nothing.
await mztaManaged.loadManaged();

// Repair any feature flag left enabled on an unusable connection before anything derives
// from it: this is where a wizard run or a prefs import from a previous session gets
// healed, since no options page needs to be opened for it to happen.
await _reconcileFeatureFlags(await _readFeatureConnPrefs());
await reload_pref_init();

let taLog = new taLogger("mzta-background",prefs_init.do_debug);

// calendar_no_selection sends the whole message body instead of a selection, which only
// works if the calendar prompt reads the body. The settings page refuses to enable it
// otherwise, but a policy can set it without passing through that page - so say so here,
// with warn() because it is not gated on do_debug and an administrator must see it.
await (async () => {
    try {
        if (await mztaPrefs.getPref('calendar_no_selection') !== true) return;
        const calendar_prompt = (await getSpecialPrompts()).find(p => p.id === 'prompt_get_calendar_event');
        const text = (calendar_prompt && typeof calendar_prompt.text === 'string') ? calendar_prompt.text : '';
        if (!text.includes('{%mail_text_body_or_selected%}') && !text.includes('{%mail_html_body_or_selected%}')) {
            taLog.warn('calendar_no_selection is enabled' +
                (mztaManaged.hasManagedValue('calendar_no_selection') ? ' by the managed configuration' : '') +
                ', but the calendar event prompt contains neither {%mail_text_body_or_selected%} nor ' +
                '{%mail_html_body_or_selected%}: the message body will not be sent to the AI.');
        }
    } catch (e) {
        taLog.error('Could not check the calendar prompt placeholders: ' + e);
    }
})();

// A policy account list ({feature}_enabled_accounts_match) that matches no account in this
// profile turns the automatic feature off here, which is easy to miss - resolve it once now
// so resolveEnabledAccounts() warns at startup rather than only at the first new mail. It
// warns once, and again only after the list has matched something in between.
await (async () => {
    try {
        for (const feature of ['spamfilter', 'add_tags']) {
            if (mztaManaged.hasManagedValue(feature + '_enabled_accounts_match')) {
                await resolveEnabledAccounts(feature, []);
            }
        }
    } catch (e) {
        taLog.error('Could not resolve the policy account lists: ' + e);
    }
})();

// A per-feature provider override stored in a special prompt is hidden on read while the
// policy locks {prefix}_use_specific_integration to false (applyLockedOffIntegrations() in
// js/mzta-prompts.js). Nothing on the settings page shows it any more, so tell the
// administrator it exists and is being ignored - warn(), not gated on do_debug.
await (async () => {
    try {
        for (const prefix of await getIgnoredProviderOverrides()) {
            taLog.warn(`${prefix}_use_specific_integration is locked to false by the managed ` +
                `configuration: the provider override stored in the ${prefix} special prompt is ` +
                'ignored, and the feature uses the global connection. It is kept, and applies ' +
                'again if the policy stops locking the preference.');
        }
    } catch (e) {
        taLog.error('Could not check the per-feature provider overrides: ' + e);
    }
})();

// The reverse case: a connection enforced by the policy (_special_prompts_connection) replaces
// a provider override the user stored for that feature. The stored one is kept and comes back
// when the policy is removed, but it no longer runs - say so, naming the feature and the field
// and never the value.
await (async () => {
    try {
        for (const { prefix, field } of await getReplacedProviderOverrides()) {
            taLog.warn(`The ${prefix} connection is enforced by the managed configuration: its ` +
                `${field} replaces the one stored in the ${prefix} special prompt, which is kept ` +
                'and applies again if the policy stops enforcing it.');
        }
    } catch (e) {
        taLog.error('Could not check the per-feature connections enforced by policy: ' + e);
    }
})();

// A special prompt text enforced by the policy cannot be fixed by the user, and the feature
// pages' placeholder checks never see it. Its response format was checked when the policy
// was read (a text failing that is not enforced at all); here the placeholders are - warn(),
// not gated on do_debug, so the administrator sees it.
await (async () => {
    try {
        for (const { id, problem } of await getEnforcedTextPlaceholderProblems()) {
            taLog.warn(`The text of the ${id} special prompt is enforced by the managed ` +
                `configuration, but ${problem}.`);
        }
    } catch (e) {
        taLog.error('Could not check the placeholders of the enforced special prompt texts: ' + e);
    }
})();
taWorkingStatus.taLog = taLog;
taBatchController.taLog = taLog;
taJobRegistry.taLog = taLog;
let spamReport = new taSpamReport(prefs_init.do_debug);
let summaryStore = new taSummaryStore(prefs_init.do_debug);
let translationStore = new taTranslationStore(prefs_init.do_debug);

browser.composeScripts.register({
    // mzta-html-lines.js FIRST: it is a classic script defining the globals
    // mzta-compose-script.js calls (mztaHtmlNodeToLines). Order is load order.
    js: [{file: "/js/lib/mzta-html-lines.js"}, {file: "/js/mzta-compose-script.js"}]
});

// Register the message display script for all newly opened message tabs.
messenger.messageDisplayScripts.register({
    js: [{ file: "js/lib/mzta-html-lines.js" }, { file: "js/mzta-compose-script.js" }]
});

browser.contentScripts.register({
    matches: ["https://*.chatgpt.com/*"],
    js: [{file: "js/mzta-chatgpt-loader.js"}],
    // the loader waits for the composer itself, ChatGPT can keep the document loading for ~20 s (issue #924)
    runAt: "document_start"
  });

// Listen for shortcut command
messenger.commands.onCommand.addListener((command, tab) => {
    if (command === "_thunderai__do_action") {
        handleShortcut(tab);
    }
});
    
async function handleShortcut(tab) {
    taLog.log("Shortcut triggered!");
    if(!["mail", "messageCompose","messageDisplay"].includes(tab.type)){
        return;
    }
    switch (tab.type) {
        case "mail":
        case "messageDisplay":
            browser.messageDisplayAction.openPopup();
            break;
        case "messageCompose":
            browser.composeAction.openPopup();
            break;
        default:
            break;
    }    
}

export function preparePopupMenu(tab) {
    const safeTab = (tab && typeof tab === 'object') ? tab : { id: null, type: "mail" };
    const tabType = safeTab.type || "mail";
    let output = {};
    output.lastShortcutTabId = safeTab.id ?? null;
    output.lastShortcutTabType = tabType;
    output.lastShortcutPromptsData = (typeof menus !== 'undefined' && menus?.shortcutMenu) ? menus.shortcutMenu : [];
    output.lastShortcutFiltering = 0;
    switch (tabType) {
        case "mail":
        case "messageDisplay":
            output.lastShortcutFiltering = 1;
            break;
        case "messageCompose":
            output.lastShortcutFiltering = 2;
            break;
        default:
            output.lastShortcutFiltering = 0;
            break;
    }
    // Snapshot of the batch processing state, so the popup can offer a "Stop processing"
    // button when a batch (auto add-tags / spamfilter / summarize / translate) is running.
    output.batchStatus = (typeof taBatchController !== 'undefined' && taBatchController?.getStatus)
        ? taBatchController.getStatus()
        : { working: false, processed: 0 };
    return output;
}

// The exact key set needed to resolve every feature's effective connection. Extracted
// so the reconciliation and the menu computation read the same keys and cannot drift
// apart.
// Everything is read fresh from storage on purpose: mixing a fresh changed value with
// values taken from the prefs_init snapshot used to make the per-feature integration
// flags lag behind the rest by one or more storage change events, hiding a command
// until restart.
async function _readFeatureConnPrefs() {
    return await mztaPrefs.getPrefs([
        'add_tags',
        'get_calendar_event',
        'get_calendar_event_from_clipboard',
        'get_task',
        'connection_type',
        'spamfilter',
        'summarize',
        'translate',
        // Needed by getConnectionType() to resolve the per-feature override: without these
        // keys use_specific_integration reads as undefined and every feature silently falls
        // back to the global connection.
        ...Object.keys(getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']))
    ]);
}

// Self-healing for the feature flags. A flag can survive in storage pointing at a
// connection that cannot drive it: the setup wizard writes connection_type without ever
// looking at the flags, and a prefs import or a sync from another profile can land any
// combination at once. Until now the only repair was disable_ApiFeature() in the options
// page, which runs only while that page is open — so auto add-tags or the spam filter
// could keep firing on incoming mail against an unusable connection. Doing it here
// covers every writer, once.
// Only true -> false, never the reverse: restoring a flag when a usable connection comes
// back would silently re-enable a feature the user may have turned off on purpose,
// exactly as disable_ApiFeature() already declines to do.
// Mutates and returns the prefs object, so the caller can keep using the healed values
// without waiting for the write to round-trip.
async function _reconcileFeatureFlags(prefs) {
    let to_disable = {};
    for (const prefix of special_prompts_with_integration) {
        if (!prefs[prefix]) continue;
        // A flag the enterprise policy enforces is the administrator's decision, not a
        // stale value to heal. Skipping it here is not merely cosmetic: this repair works
        // by WRITING false to storage.local, and the write guard in js/mzta-prefs.js would
        // refuse it anyway — so without this the only effect would be a warning logged on
        // every startup and on every preference change, forever. If the policy enables a
        // feature whose connection cannot drive it, the feature stays on and does nothing:
        // that is a misconfiguration for the administrator to fix, and silently overriding
        // it would hide the mistake rather than surface it.
        if (mztaManaged.isManagedLocked(prefix)) continue;
        // A feature that has opted into its own integration is left alone even when that
        // integration is not usable yet. Its connection does not depend on the global one,
        // so an unusable value there means "still being configured", not "cannot run" —
        // and since this repair never turns a flag back on, disabling it would strand the
        // user: they would finish setting up the integration, see the menus come back, and
        // still have the feature off. The mandatory-integration flow in
        // pages/_lib/connection-ui.js drives users straight into exactly that state
        // whenever the global connection is ChatGPT Web or empty.
        if (hasSpecificIntegration(prefs[`${prefix}_use_specific_integration`], prefs[`${prefix}_connection_type`])) continue;
        // ChatGPT Web is left alone for the same reason the options page no longer forces
        // the toggle off (see getFeatureConnState): the per-feature API is configured from
        // a page reachable only while the feature is on, so switching it off here would
        // make the setup impossible. Only a genuinely absent connection is repaired — that
        // one is not a step on the way to anything, and the options toggle is disabled for
        // it anyway, so the two agree.
        // Sparks presence is deliberately NOT considered here: it is transient (the add-on
        // may just be restarting) and doGetSparkFeature() already gates every read site.
        // Persisting false on a boot race would be irreversible.
        if (hasNoConnectionSelected(getConnectionType(prefs, null, prefix))) {
            to_disable[prefix] = false;
            prefs[prefix] = false;
        }
    }
    if (Object.keys(to_disable).length > 0) {
        // console.log and not taLog: this also runs at startup, before taLog is built.
        console.log("[ThunderAI] Disabling features with an unusable connection: " + Object.keys(to_disable).join(', '));
        await mztaPrefs.setPrefs(to_disable);
    }
    return prefs;
}

// Single source of truth for special-prompt gating.
async function _computeActiveSpecialIds() {
    let prefs_reload = await _readFeatureConnPrefs();
    // Repair before judging: a flag left true on an unusable connection is turned off
    // here, so the menus and everything downstream see the same value the user will find
    // in the options page.
    prefs_reload = await _reconcileFeatureFlags(prefs_reload);
    // Effective connection per feature, exactly as the options page computes it for its
    // feature rows: the global connection is only the fallback.
    let effective_conn = {};
    for (const prefix of special_prompts_with_integration) {
        effective_conn[prefix] = getConnectionType(prefs_reload, null, prefix);
    }
    return getActiveSpecialPromptsIDs({
        addtags: prefs_reload.add_tags,
        get_calendar_event: doGetSparkFeature(prefs_reload.get_calendar_event),
        get_calendar_event_from_clipboard: doGetSparkFeature(prefs_reload.get_calendar_event_from_clipboard),
        get_task: doGetSparkFeature(prefs_reload.get_task),
        spamfilter: prefs_reload.spamfilter,
        summarize: prefs_reload.summarize,
        translate: prefs_reload.translate,
        effective_conn: effective_conn
    });
}

async function _reload_menus() {
    await menus.reload(await _computeActiveSpecialIds());
    taLog.log("Reloading menus");
    return true;
}

async function _getActiveSpecialIds() {
    return _computeActiveSpecialIds();
}

// Tail of the tag-assignment queue: every _assign_tags() chains on it, so only one runs at a
// time. createTag() gives each new tag a random key, so two assignments running together
// that both find "Invoice" missing would create two tags with the same label; serialized,
// the second one re-reads the tag list and finds the tag the first one created. Errors are
// swallowed on the chain itself (the caller gets them from its own promise).
let _tagAssignChain = Promise.resolve();
function _enqueueTagAssign(fn) {
    const run = _tagAssignChain.then(fn);
    _tagAssignChain = run.catch(() => {});
    return run;
}

// Serialized through _enqueueTagAssign(): processEmails() tags several
// messages at once, and the context menu path can overlap with an automatic batch.
function _assign_tags(_data, create_new_tags = true, exclusions_exact_match = false) {
    return _enqueueTagAssign(() => _assign_tags_now(_data, create_new_tags, exclusions_exact_match));
}

async function _assign_tags_now(_data, create_new_tags, exclusions_exact_match) {
    let all_tags_list = await getTagsList();
    all_tags_list = all_tags_list[1];
    // console.log(">>>>>>>>>>>>>>> all_tags_list: " + JSON.stringify(all_tags_list));
    taLog.log("assign_tags data: " + JSON.stringify(_data));
    let new_tags = [];
    let add_tags_exclusions_list = await addTags_getExclusionList();
    taLog.log("add_tags_exclusions_list: " + JSON.stringify(add_tags_exclusions_list));
    const tags_final = _data.tags.filter(tag =>
        !add_tags_exclusions_list.some(exclusion =>
            checkExcludedTag(tag, exclusion, exclusions_exact_match)
        )
    );
    if(!create_new_tags){
        taLog.log("Not creating new tags, only assigning existing ones...");
    }
    for (const tag of tags_final) {
        // console.log(">>>>>>>>>>>>>>> tag: " + JSON.stringify(tag));
        if (!checkIfTagLabelExists(tag, all_tags_list)) {
            if (create_new_tags) {
                taLog.log("Creating tag: " + tag);
                await createTag(tag);
            } else {
                taLog.log("Skipping non-existing tag: " + tag);
                continue;
            }
        }
        new_tags.push(tag);
    }
    let added_tags = await assignTagsToMessage(_data.messageId, new_tags);
    taLog.log("Assigned tags: " + JSON.stringify(added_tags));
}

messenger.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Check what type of message we have received and invoke the appropriate
    // handler function.
    if (message && message.hasOwnProperty("command")){
        switch (message.command) {
            case 'initSummary':
                async function _initSummary() {
                    try {
                        let tabId = sender.tab.id;

                        let prefs = await mztaPrefs.getPrefs([
                            'summarize',
                            'summarize_auto',
                            'summarize_display_mode',
                            'summarize_max_display_length',
                            'summarize_strip_formatting',
                            'summarize_auto_senders',
                            'summarize_auto_senders_list',
                            'connection_type',
                            ...Object.keys(getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']))
                        ]);

                        if (!prefs.summarize) return;

                        let message = await browser.messageDisplay.getDisplayedMessage(tabId);
                        if (!message) return;

                        // A summary job already running on this message (the batch, another
                        // tab, a context-menu action): join it, so this panel shows its
                        // spinner and then its result. Joining never calls the API.
                        // Checked before the cache: a job landing between the cache read and
                        // this check would otherwise leave its result AND the manual button.
                        // A job starting after it replaces the button with its own broadcast.
                        if (taJobRegistry.isRunning('summary', message.headerMessageId)) {
                            _generateSummaryForMessage(message.headerMessageId, tabId, { resolvedMessage: message })
                                .catch(e => _handleTaskError('initSummary (join)', e, tabId, message.headerMessageId, 'summary'));
                            return;
                        }

                        // Always show cached summary if available, regardless of summarize_auto
                        let cachedSummary = await summaryStore.loadSummary(message.headerMessageId);
                        if (cachedSummary && !cachedSummary.error) {
                            await _sendIfCurrent(tabId, message.headerMessageId, { command: "showSummary", data: { ...cachedSummary, maxDisplayLength: prefs.summarize_max_display_length, stripFormatting: prefs.summarize_strip_formatting } });
                            return;
                        }

                        // Auto-summarize the senders in summarize_auto_senders_list. This is the
                        // second trigger of the feature: it catches the messages the
                        // onNewMailReceived listener never saw (subscribed IMAP folders that are
                        // not checked for new mail, or messages moved by a server-side filter).
                        // It runs after the running-job and cache checks above, so a message
                        // caught on reception too is never summarized twice, and before the
                        // summarize_auto check below, because the sender list must work even
                        // when auto-summarize is disabled in general.
                        if (prefs.summarize_auto_senders && matchAddressList(message.author, prefs.summarize_auto_senders_list)) {
                            if (isMessageInAutoSkippedFolder(message)) {
                                taLog.log("Message in a folder excluded from the automatic processing, skipping the auto-summarize sender list...");
                            } else if (await _summarizeConnectionMissing()) {
                                taLog.log("[ThunderAI] No AI connection able to reach an API, skipping the auto-summarize sender list for: " + message.headerMessageId);
                            } else {
                                taLog.log("[ThunderAI] Sender in the auto-summarize list, generating summary for: " + message.headerMessageId);
                                _generateSummaryForMessage(message.headerMessageId, tabId, { resolvedMessage: message })
                                    .catch(e => _handleTaskError('initSummary (sender list)', e, tabId, message.headerMessageId, 'summary'));
                                return;
                            }
                        }
                        // storage.get() only substitutes the default for *missing* keys, so a
                        // null previously written by an empty select (NaN, serialized as null)
                        // would survive and match none of the === comparisons below.
                        let summarize_auto = Number.isInteger(prefs.summarize_auto) ? prefs.summarize_auto : prefs_default.summarize_auto;

                        // If summarize_auto is disabled, don't show button or auto-generate
                        if (summarize_auto === 0) return;

                        // Everything below needs to actually reach the API, so apply the same
                        // judgement the menus make: without it the button is drawn on an unusable
                        // connection and only fails once clicked. Checked here and not earlier
                        // because a cached summary stays readable regardless of the connection.
                        // The flag alone is not enough — it stays true whenever the feature
                        // carries its own (not yet configured) integration, which
                        // _reconcileFeatureFlags() deliberately leaves alone.
                        if (!isApiUsableConnection(getConnectionType(prefs, null, 'summarize'))) return;

                        // Auto mode (summarize_auto === 2) always generates inline, but never on a
                        // message the user wrote (a draft opened while being composed) or already
                        // discarded. The manual button below stays available on those folders.
                        if (summarize_auto === 2) {
                            if (isMessageInAutoSkippedFolder(message)) {
                                taLog.log("Message in a folder excluded from the automatic processing, skipping the automatic summarize...");
                                return;
                            }
                            _generateSummaryForMessage(message.headerMessageId, tabId, { resolvedMessage: message })
                                .catch(e => _handleTaskError('initSummary (auto)', e, tabId, message.headerMessageId, 'summary'));
                            return;
                        }

                        // Manual button mode (summarize_auto === 1)
                        if (prefs.summarize_display_mode === 'inline') {
                            await _sendIfCurrent(tabId, message.headerMessageId, { command: "showSummaryButton", headerMessageId: message.headerMessageId });
                        } else {
                            await _sendIfCurrent(tabId, message.headerMessageId, { command: "showSummaryButton", headerMessageId: message.headerMessageId, webchat: true });
                        }
                    } catch (e) {
                        taLog.error("Error in initSummary: " + e);
                    }
                }
                // Not awaited (the listener contract stays synchronous); the .catch() is a
                // safety net on top of the internal try/catch. No headerMessageId is known here.
                _initSummary().catch(e => _handleTaskError('initSummary', e, sender.tab?.id, null, 'summary'));
                break;
            case 'triggerSummaryGeneration':
                async function _triggerSummaryGeneration(message) {
                    let tabId = sender.tab.id;
                    // Fire the inline loading indicator immediately, before any await.
                    // Sent directly, not through _sendGeneratingIfCurrent(): the id comes from
                    // this very tab's content script, which also re-checks it against its own
                    // document before drawing the panel.
                    sendTabMessageSafe(tabId, { command: "showSummaryGenerating", headerMessageId: message.headerMessageId });
                    // No resolve hint: the content script sends only headerMessageId, so
                    // _resolveMessage lands on the tabId route (c) — the message the user
                    // just clicked on is the one this tab displays. manual: joins (and
                    // revives) a running job instead of starting a second one.
                    await _generateSummaryForMessage(message.headerMessageId, tabId, { manual: true });
                }
                _triggerSummaryGeneration(message).catch(e => _handleTaskError('triggerSummaryGeneration', e, sender.tab?.id, message.headerMessageId, 'summary'));
                break;
            case 'triggerSummaryWebchat':
                async function _triggerSummaryWebchat(message) {
                    let tabId = sender.tab.id;
                    // Same as triggerSummaryGeneration: resolves via the tabId route (c).
                    await _openSummaryWebchat(message.headerMessageId, tabId);
                }
                _triggerSummaryWebchat(message).catch(e => _handleTaskError('triggerSummaryWebchat', e, sender.tab?.id, message.headerMessageId, 'summary'));
                break;
            case 'generate_summary':
                async function _generate_summary(message) {
                    // Manual trigger: the content script supplies only headerMessageId
                    // (and message.tabId), so _resolveMessage uses the tabId route (c).
                    await _generateSummaryForMessage(message.headerMessageId, message.tabId, { manual: true });
                }
                _generate_summary(message).catch(e => _handleTaskError('generate_summary', e, message.tabId, message.headerMessageId, 'summary'));
                break;
            case 'refreshSummary':
                async function _refreshSummary(message) {
                    let tabId = sender.tab.id;
                    let prefs_refresh = await mztaPrefs.getPrefs(['summarize_display_mode']);
                    if (prefs_refresh.summarize_display_mode === 'webchat') {
                        await summaryStore.removeSummary(message.headerMessageId);
                        // Resolves via the tabId route (c) — see triggerSummaryWebchat.
                        await _openSummaryWebchat(message.headerMessageId, tabId);
                    } else {
                        // Fire the inline loading indicator immediately, before any await
                        // (direct send — see triggerSummaryGeneration).
                        sendTabMessageSafe(tabId, { command: "showSummaryGenerating", headerMessageId: message.headerMessageId });
                        // Resolves via the tabId route (c) — see triggerSummaryGeneration.
                        // refresh: the job drops the old summary itself. Not done here: with a
                        // job already running, refresh joins it instead of starting a second
                        // generation next to it.
                        await _generateSummaryForMessage(message.headerMessageId, tabId, { manual: true, refresh: true });
                    }
                }
                _refreshSummary(message).catch(e => _handleTaskError('refreshSummary', e, sender.tab?.id, message.headerMessageId, 'summary'));
                break;
            case 'removeSummary':
                async function _removeSummary(message) {
                    // First, synchronously: a job still running for this message must not
                    // save or show its result when it lands, or the deleted summary would
                    // come back.
                    taJobRegistry.invalidate('summary', message.headerMessageId);
                    await summaryStore.removeSummary(message.headerMessageId);
                    await _restoreSummaryButton(sender.tab.id, message.headerMessageId);
                }
                _removeSummary(message).catch(e => _handleTaskError('removeSummary', e, sender.tab?.id, message.headerMessageId, 'summary'));
                break;
            case 'chatgpt_saveSummary':
                async function _saveSummaryFromWebchat(msg) {
                    try {
                        let summaryHtml = msg.text.trim();
                        let cleanedSummary = cleanSummaryText(msg.text);
                        const summaryData = {
                            summary: cleanedSummary,
                            summary_html: summaryHtml,
                            summary_date: new Date(),
                            headerMessageId: msg.headerMessageId
                        };
                        await summaryStore.saveSummary(summaryData, msg.headerMessageId);
                        let prefs_summary = await mztaPrefs.getPrefs([
                            'summarize_max_display_length',
                            'summarize_strip_formatting'
                        ]);
                        await _sendIfCurrent(msg.tabId, msg.headerMessageId, {
                            command: "showSummary",
                            data: { ...summaryData, maxDisplayLength: prefs_summary.summarize_max_display_length, stripFormatting: prefs_summary.summarize_strip_formatting }
                        });
                    } catch (error) {
                        console.error("[ThunderAI] Error saving summary from webchat:", error);
                    }
                }
                _saveSummaryFromWebchat(message);
                break;
            // case 'chatgpt_open':
            //         openChatGPT(message.prompt,message.action,message.tabId);
            //         return true;
            case 'initTranslation':
                async function _initTranslation() {
                    try {
                        let tabId = sender.tab.id;
                        let prefs = await mztaPrefs.getPrefs([
                            'translate',
                            'translate_auto',
                            'translate_max_display_length',
                            'connection_type',
                            ...Object.keys(getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']))
                        ]);

                        if (!prefs.translate) return;

                        let message = await browser.messageDisplay.getDisplayedMessage(tabId);
                        if (!message) return;

                        // A translation job already running: join it (see initSummary).
                        if (taJobRegistry.isRunning('translation', message.headerMessageId)) {
                            _generateTranslationForMessage(message.headerMessageId, tabId, { resolvedMessage: message })
                                .catch(e => _handleTaskError('initTranslation (join)', e, tabId, message.headerMessageId, 'translation'));
                            return;
                        }

                        // Always show cached translation if available, regardless of translate_auto
                        let cachedTranslation = await translationStore.loadTranslation(message.headerMessageId);
                        if (cachedTranslation && !cachedTranslation.error) {
                            await _sendIfCurrent(tabId, message.headerMessageId, { command: "showTranslation", data: { ...cachedTranslation, maxDisplayLength: prefs.translate_max_display_length } });
                            return;
                        }

                        // storage.get() only substitutes the default for *missing* keys, so a
                        // null previously written by an empty select (NaN, serialized as null)
                        // would survive and match none of the === comparisons below.
                        let translate_auto = Number.isInteger(prefs.translate_auto) ? prefs.translate_auto : prefs_default.translate_auto;

                        // If translate_auto is disabled, don't show button or auto-generate
                        if (translate_auto === 0) return;

                        // Everything below needs to actually reach the API, so apply the same
                        // judgement the menus make: without it the button is drawn on an unusable
                        // connection and only fails once clicked. Checked here and not earlier
                        // because a cached translation stays readable regardless of the
                        // connection. The flag alone is not enough — it stays true whenever the
                        // feature carries its own (not yet configured) integration, which
                        // _reconcileFeatureFlags() deliberately leaves alone.
                        if (!isApiUsableConnection(getConnectionType(prefs, null, 'translate'))) return;

                        // Auto mode (translate_auto === 2) always generates inline, but never on a
                        // message the user wrote (a draft opened while being composed) or already
                        // discarded. The manual button below stays available on those folders.
                        if (translate_auto === 2) {
                            if (isMessageInAutoSkippedFolder(message)) {
                                taLog.log("Message in a folder excluded from the automatic processing, skipping the automatic translation...");
                                return;
                            }
                            _generateTranslationForMessage(message.headerMessageId, tabId, { resolvedMessage: message })
                                .catch(e => _handleTaskError('initTranslation (auto)', e, tabId, message.headerMessageId, 'translation'));
                            return;
                        }

                        // Manual button mode (translate_auto === 1)
                        await _sendIfCurrent(tabId, message.headerMessageId, { command: "showTranslationButton", headerMessageId: message.headerMessageId });
                    } catch (e) {
                        taLog.error("Error in initTranslation: " + e);
                    }
                }
                // Safety net on top of the internal try/catch — see initSummary.
                _initTranslation().catch(e => _handleTaskError('initTranslation', e, sender.tab?.id, null, 'translation'));
                break;
            case 'triggerTranslationGeneration':
                async function _triggerTranslationGeneration(message) {
                    let tabId = sender.tab.id;
                    // Fire the inline loading indicator immediately, before any await
                    // (direct send — see triggerSummaryGeneration).
                    sendTabMessageSafe(tabId, { command: "showTranslationGenerating", headerMessageId: message.headerMessageId });
                    let prefs_tl = await mztaPrefs.getPrefs([
                        'translate_lang',
                        'default_chatgpt_lang'
                    ]);
                    const lang_tl = prefs_tl.translate_lang || prefs_tl.default_chatgpt_lang || '';
                    if (!lang_tl) {
                        let tabs = await browser.tabs.query({ active: true, currentWindow: true });
                        browser.tabs.sendMessage(tabId, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage('translate_no_language_configured') });
                        await _sendIfCurrent(tabId, message.headerMessageId, { command: "showTranslationButton", headerMessageId: message.headerMessageId });
                        return;
                    }
                    await _generateTranslationForMessage(message.headerMessageId, tabId, { manual: true });
                }
                _triggerTranslationGeneration(message).catch(e => _handleTaskError('triggerTranslationGeneration', e, sender.tab?.id, message.headerMessageId, 'translation'));
                break;
            case 'refreshTranslation':
                async function _refreshTranslation(message) {
                    let tabId = sender.tab.id;
                    // Fire the inline loading indicator immediately, before any await
                    // (direct send — see triggerSummaryGeneration).
                    sendTabMessageSafe(tabId, { command: "showTranslationGenerating", headerMessageId: message.headerMessageId });
                    // refresh: the job drops the old translation itself (see refreshSummary).
                    await _generateTranslationForMessage(message.headerMessageId, tabId, { manual: true, refresh: true });
                }
                _refreshTranslation(message).catch(e => _handleTaskError('refreshTranslation', e, sender.tab?.id, message.headerMessageId, 'translation'));
                break;
            case 'getDisplayedMessageId':
                // Asked once by the message display script at load, so it knows which
                // message its document shows and can ignore generating panels / hide
                // commands meant for another one. null when unknown.
                return browser.messageDisplay.getDisplayedMessage(sender.tab.id)
                    .then(m => m?.headerMessageId ?? null)
                    .catch(() => null);
            case 'removeTranslation':
                async function _removeTranslation(message) {
                    // First, synchronously — see removeSummary.
                    taJobRegistry.invalidate('translation', message.headerMessageId);
                    await translationStore.removeTranslation(message.headerMessageId);
                    await _restoreTranslationButton(sender.tab.id, message.headerMessageId);
                }
                _removeTranslation(message).catch(e => _handleTaskError('removeTranslation', e, sender.tab?.id, message.headerMessageId, 'translation'));
                break;
            case 'chatgpt_close':
                    async function _closeChatGptWindow(window_id) {
                        let prefs_close = await mztaPrefs.getPrefs(['chatgpt_win_save_position']);
                        if(prefs_close.chatgpt_win_save_position){
                            try {
                                let winInfo = await browser.windows.get(window_id);
                                await mztaPrefs.setPrefs({chatgpt_win_top: winInfo.top, chatgpt_win_left: winInfo.left});
                                taLog.log("Window position saved: top=" + winInfo.top + ", left=" + winInfo.left);
                            } catch(e) {
                                taLog.error("Error saving window position: " + e);
                            }
                        }
                        return browser.windows.remove(window_id).then(() => {
                            taLog.log("AI chat window closed successfully.");
                        }).catch((error) => {
                            taLog.error("Error closing AI chat window:", error);
                        });
                    }
                    return _closeChatGptWindow(message.window_id);
            case 'chatgpt_replaceSelectedText':
                async function _replaceSelectedText(tabId, text) {
                    //console.log('chatgpt_replaceSelectedText: [' + tabId +'] ' + text)
                    taLog.log("chatgpt_replaceSelectedText text: " + text);
                    original_html = await getOriginalBody(tabId);
                    // The compose format is read from the window itself, not from a
                    // preference: it is a per-message property, so a global setting
                    // could never be right for a user who writes in both formats.
                    let isPlainText = await isPlainTextCompose(tabId);
                    if(isPlainText){
                        text = stripHtmlKeepLines(text);
                    }
                    await browser.tabs.sendMessage(tabId, { command: "replaceSelectedText", text: text, tabId: tabId, isPlainText: isPlainText });
                    return true;
                }
                return _replaceSelectedText(message.tabId, message.text);
            case 'chatgpt_replyMessage':
                async function _replyMessage(message) {
                    let paragraphsHtmlString = message.text;
                    //console.log(">>>>>>>>>>>> paragraphsHtmlString: " + paragraphsHtmlString);
                    taLog.log("paragraphsHtmlString: " + paragraphsHtmlString);
                    let prefs_reply = await mztaPrefs.getPrefs(['reply_type']);
                    // No plain-text conversion here: the reply window does not exist
                    // yet, so its format is not knowable. replaceBody() reads it from
                    // the created tab and converts there.
                    //console.log('reply_type: ' + prefs_reply.reply_type);
                    let replyType = 'replyToAll';
                    // console.log(">>>>>>>>>>> chatgpt_replyMessage replyType: " + message.replyType);
                    if (typeof message.replyType === "undefined" || message.replyType === null || message.replyType === "") {
                        message.replyType = prefs_reply.reply_type;
                    }
                    if(message.replyType === 'reply_sender'){
                        replyType = 'replyToSender';
                    }
                    taLog.log("Reply type: " + replyType);
                    //console.log('replyType: ' + replyType);
                    // browser.messageDisplay.getDisplayedMessage(message.tabId).then(async (mailMessage) => {
                    //     let reply_tab = await browser.compose.beginReply(mailMessage.id, replyType, {
                    //         type: "reply",
                    //         //body:  paragraphsHtmlString,
                    //         isPlainText: false,
                    //         identityId: await getCurrentIdentity(mailMessage),
                    //     })
                    //console.log(">>>>>>>>>>>> message.mailMessageId: " + message.mailMessageId);
                    let _mailMessage = await browser.messages.get(message.mailMessageId);
                    let curr_idn = await getCurrentIdentity(_mailMessage)
                    // isPlainText is deliberately NOT forced here: omitting it lets the
                    // reply follow the identity's own compose format, so a user who
                    // writes in plain text gets a plain text reply. replaceBody() then
                    // reads the resulting format back off the tab. [#855]
                    let reply_tab = await browser.compose.beginReply(_mailMessage.id, replyType, {
                        type: "reply",
                        //body:  paragraphsHtmlString,
                        identityId: curr_idn,
                    })
                        // Wait for tab loaded.
                        await new Promise(resolve => {
                            const tabIsLoaded = tab => {
                                return tab.status == "complete" && tab.url != "about:blank";
                            };
                            const listener = (tabId, changeInfo, updatedTab) => {
                                if (tabIsLoaded(updatedTab)) {
                                    browser.tabs.onUpdated.removeListener(listener);
                                    //console.log(">>>>>>>>>>>> reply_tab: " + tabId);
                                    resolve();
                                }
                            }
                            // Early exit if loaded already
                            if (tabIsLoaded(reply_tab)) {
                                resolve();
                            } else {
                                browser.tabs.onUpdated.addListener(listener);
                            }
                        });
                        // we need to wait for the compose windows to load the content script
                        //setTimeout(() => browser.tabs.sendMessage(reply_tab.id, { command: "insertText", text: paragraphsHtmlString, tabId: reply_tab.id }), 500);
                        setTimeout(async () => await replaceBody(reply_tab.id, paragraphsHtmlString), 500);
                        return true;
                }
                return _replyMessage(message);
                break;
            case 'compose_reloadBody':
                async function _reloadBody(tabId) {
                    // getOriginalBody/setBody must agree on which field they use, or
                    // this round-trip would push the freshly inserted plain text
                    // through the HTML body field and collapse its line breaks.
                    let isPlainText = await isPlainTextCompose(tabId);
                    modified_html = await getOriginalBody(tabId);
                    await setBody(tabId, original_html, isPlainText);
                    await setBody(tabId, modified_html, isPlainText);
                    return true;
                }
                return _reloadBody(message.tabId);
                break;
            case 'reload_menus':
                return _reload_menus();
                break;
            case 'get_active_special_ids':
                return _getActiveSpecialIds();
                break;
            case 'shortcut_do_prompt':
                taLog.log("Executing shortcut, promptId: " + message.promptId);
                if (message.promptId !== 'prompt_add_tags' && specialContextMenuActions[message.promptId]) {    //TODO Add an option here if you want the user to decide to use the autotagging also in the popup menu
                    async function _shortcut_special() {
                        let tabId = message.tabId;
                        if (!tabId) {
                            let tabs = await browser.tabs.query({ active: true, currentWindow: true });
                            if (tabs.length === 0) return false;
                            tabId = tabs[0].id;
                        }
                        let displayedMessage = await browser.messageDisplay.getDisplayedMessage(tabId);
                        if (!displayedMessage) return false;
                        taLog.log("Displayed message found.");
                        // Pass tabId on: the UI tab must be the one the message came from.
                        return specialContextMenuActions[message.promptId]([displayedMessage], tabId);
                    }
                    return _shortcut_special();
                }
                return menus.executeMenuAction(message.promptId);
                break;
            case 'popup_menu_ready':
                async function _popup_menu_ready() {
                    let tabs = [];
                    try {
                        tabs = await browser.tabs.query({ active: true, currentWindow: true });
                        if (!tabs || tabs.length === 0) {
                            tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
                        }
                    } catch (e) {
                        taLog.error("Error querying tabs for popup_menu_ready: " + e);
                    }
                    if (!tabs || tabs.length === 0) {
                        return false;
                    }
                    return preparePopupMenu(tabs[0]);
                }
                return _popup_menu_ready();
                break;
            case 'assign_tags':
                async function _do_assign_tags(message) {
                    let prefs_assign_tags = await mztaPrefs.getPrefs(['add_tags_exclusions_exact_match']);
                    return _assign_tags(message,true, prefs_assign_tags.add_tags_exclusions_exact_match);
                }
                return _do_assign_tags(message);
                break;
            // The tag dialog in js/mzta-compose-script.js, a classic content script, cannot
            // import js/mzta-prefs.js. These two give it the tag exclusion preferences
            // resolved against the enterprise policy, and a write that goes through the
            // write guard.
            case 'addtags_get_exclusion_prefs':
                async function _addtags_get_exclusion_prefs() {
                    let prefs_excl = await mztaPrefs.getPrefs([
                        'add_tags_exclusions',
                        'add_tags_hide_exclusions',
                        'add_tags_exclusions_exact_match'
                    ]);
                    prefs_excl.exclusions_locked = mztaManaged.isManagedLocked('add_tags_exclusions');
                    return prefs_excl;
                }
                return _addtags_get_exclusion_prefs();
                break;
            case 'addtags_set_exclusions':
                if (!Array.isArray(message.list) || !message.list.every(el => typeof el === 'string')) {
                    taLog.warn('addtags_set_exclusions: the list must be an array of strings, ignored.');
                    return Promise.resolve(false);
                }
                return addTags_setExclusionList(message.list).then(() => true);
                break;
            case 'api_send_custom_text':
                sendTabMessageSafe(message.tabId, { command: "api_send_custom_text", custom_text: message.custom_text });
                break;
            case 'checkSpamReport':
                if(!prefs_init.spamfilter_show_msg_panel){
                    return;
                }

                async function _checkSpamReport(tabId) {
                    try {
                        if (sender.tab.type !== 'messageDisplay' && sender.tab.type !== 'mail') return;
                        let message = await browser.messageDisplay.getDisplayedMessage(tabId);
                        if (!message) return;
                        // A running analysis first, synchronously: join it, so this panel
                        // shows the in-progress badge and then the report (a stored report
                        // would be the one the job is about to replace).
                        if (taJobRegistry.isRunning('spam', message.headerMessageId)) {
                            await _generateSpamReportForMessage(message.headerMessageId, { tabId: tabId });
                            return;
                        }
                        let report = await spamReport.loadReportData(message.headerMessageId);
                        if (report) {
                            await _sendIfCurrent(tabId, message.headerMessageId, { command: "showSpamReport", data: report });
                        }
                    } catch (e) {
                        taLog.error("Error in checkSpamReport: " + e);
                    }
                }
                _checkSpamReport(sender.tab.id);
                break;
            case 'removeSpamReport':
                spamReport.removeReportData(message.headerMessageId);
                break;
            case 'refreshSpamReport':
                // The panel this comes from lives in the message display, so the sender tab is
                // showing the very message to re-check: enough to resolve it without a query.
                // A running analysis is joined, not repeated (see _generateSpamReportForMessage()).
                _generateSpamReportForMessage(message.headerMessageId, { tabId: sender.tab.id })
                    .catch(e => taLog.error("Error in refreshSpamReport: " + (e?.message || e)));
                break;
            case 'batch_status':
                return Promise.resolve(taBatchController.getStatus());
            case 'cancel_batch':
                taBatchController.requestCancel();
                return Promise.resolve({ ok: true });
            default:
                break;
        }
    }
    return false;
});

// Clean summary text by stripping HTML, markdown, and formatting artifacts.
// Used by both inline summary generation and webchat summary save.
function cleanSummaryText(text) {
    let cleaned = text.replace(/<\/?[^>]+(>|$)/g, '');  // strip HTML tags
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
    cleaned = cleaned.replace(/[\*#_~`]/g, '');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    cleaned = cleaned.replace(/^Summary:\s*/i, '');
    return cleaned;
}

// Send a "show result" message to a tab only if it still displays the expected message.
// Prevents a slow, stale AI result (summary/translation/button) from rendering on a
// different email after the user has rapidly clicked through several messages.
// Mirrors the displayed-message guard already used by updateSpamPanel().
// After the user deletes a summary / translation from its banner, draw the manual
// trigger button again: without it the only way back to the result is the menu.
// Offered whenever initSummary / initTranslation would have shown the button or
// auto-generated (auto mode 1 or 2). Auto mode is deliberately not re-run here:
// regenerating what the user has just deleted would defeat the delete.
// tabId = null: every tab displaying the message (_sendToTabsDisplaying) - used when a
// running job was invalidated by the delete and lands with nothing to show.
async function _restoreSummaryButton(tabId, headerMessageId) {
    try {
        let prefs = await mztaPrefs.getPrefs([
            'summarize',
            'summarize_auto',
            'summarize_display_mode',
            'connection_type',
            ...Object.keys(getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']))
        ]);
        if (!prefs.summarize) return;
        let summarize_auto = Number.isInteger(prefs.summarize_auto) ? prefs.summarize_auto : prefs_default.summarize_auto;
        if (summarize_auto === 0) return;
        if (!isApiUsableConnection(getConnectionType(prefs, null, 'summarize'))) return;
        const payload = { command: "showSummaryButton", headerMessageId: headerMessageId, webchat: prefs.summarize_display_mode !== 'inline' };
        if (tabId) {
            await _sendIfCurrent(tabId, headerMessageId, payload);
        } else {
            await _sendToTabsDisplaying(headerMessageId, payload);
        }
    } catch (e) {
        taLog.error("Error in _restoreSummaryButton: " + e);
    }
}

async function _restoreTranslationButton(tabId, headerMessageId) {
    try {
        let prefs = await mztaPrefs.getPrefs([
            'translate',
            'translate_auto',
            'connection_type',
            ...Object.keys(getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']))
        ]);
        if (!prefs.translate) return;
        let translate_auto = Number.isInteger(prefs.translate_auto) ? prefs.translate_auto : prefs_default.translate_auto;
        if (translate_auto === 0) return;
        if (!isApiUsableConnection(getConnectionType(prefs, null, 'translate'))) return;
        const payload = { command: "showTranslationButton", headerMessageId: headerMessageId };
        if (tabId) {
            await _sendIfCurrent(tabId, headerMessageId, payload);
        } else {
            await _sendToTabsDisplaying(headerMessageId, payload);
        }
    } catch (e) {
        taLog.error("Error in _restoreTranslationButton: " + e);
    }
}

// Same test as _isHtml() in js/mzta-compose-script.js, which picks the HTML or the
// plain-text rendering of the translation: the two must agree.
const _PANEL_HTML_RE = /<[a-z][^>]*>/i;

// The summary / translation panels insert model HTML into the message pane, and that
// output is untrusted: a translation or summary of a crafted email can carry <style>
// or other markup that restyles the message or hides ThunderAI's own panels. So every
// panel payload crosses the ONE sanitizer (js/mzta-richtext.js) here, on its way out
// of both send helpers: _sendIfCurrent() (one tab) and _sendToTabsDisplaying() (the
// broadcast of the fresh job results). That covers the fresh results and the cached
// ones alike, including entries stored by older versions. The stored object is never
// modified: the payload is copied.
function _sanitizePanelPayload(payload) {
    const data = payload?.data;
    if (!data || data.error) return payload;
    if (payload.command === 'showSummary' && data.summary_html) {
        return { ...payload, data: { ...data, summary_html: sanitizeBlockHtml(data.summary_html) } };
    }
    if (payload.command === 'showTranslation' && typeof data.translated_text === 'string' && _PANEL_HTML_RE.test(data.translated_text)) {
        // Plain text is left alone: a DOMParser round trip would encode "a < b" as
        // "a &lt; b", which the panel then shows literally through textContent. For
        // the same reason, HTML left with no tag at all after sanitizing is handed on
        // as its text, so it takes the plain-text branch without stray entities.
        let clean = sanitizeBlockHtml(data.translated_text);
        if (!_PANEL_HTML_RE.test(clean)) {
            clean = new DOMParser().parseFromString(clean, 'text/html').body.textContent;
        }
        return { ...payload, data: { ...data, translated_text: clean } };
    }
    return payload;
}

async function _sendIfCurrent(tabId, headerMessageId, payload) {
    try {
        if (!tabId) return;
        const current = await browser.messageDisplay.getDisplayedMessage(tabId);
        if (!current || current.headerMessageId !== headerMessageId) return; // stale — drop
        // [#901] The tab may also have no reachable message browser (hidden message
        // pane, multi-message view): the displayed-message check above cannot tell,
        // because getDisplayedMessage() still reports the selected message with the
        // pane hidden. sendTabMessageSafe() drops the send quietly - the result stays
        // cached and renders the next time the pane is reachable.
        sendTabMessageSafe(tabId, _sanitizePanelPayload(payload));
    } catch (e) {
        taLog.error("Error in _sendIfCurrent: " + e);
    }
}

// Loading-indicator counterpart of _sendIfCurrent(). The generating panels used to be sent
// unguarded, on the theory that they are transient and quickly replaced by the result. They
// are not when the result is dropped: if the panel lands on a tab that displays message X
// while message Y is being generated, the final showSummary / showTranslation for Y is
// (correctly) discarded by _sendIfCurrent(), and nothing ever removes X's spinner.
// So the panel is sent only when the tab displays headerMessageId; otherwise it is skipped
// and the caller keeps generating — the result lands in the cache, and the terminal
// _sendIfCurrent() still renders it if the user comes back to the message in time.
// Returns { current, delivered }: current=false → the tab shows another message (or there is
// no tab) and nothing was sent; delivered mirrors sendTabMessageSafe(), the #901 probe.
async function _sendGeneratingIfCurrent(tabId, headerMessageId, payload) {
    try {
        if (!tabId || !headerMessageId) return { current: false, delivered: false };
        const current = await browser.messageDisplay.getDisplayedMessage(tabId);
        if (!current || current.headerMessageId !== headerMessageId) {
            taLog.log("_sendGeneratingIfCurrent: tab " + tabId + " displays " + (current?.headerMessageId || "nothing") + ", not " + headerMessageId + " - generating panel skipped.");
            return { current: false, delivered: false };
        }
        const delivered = await sendTabMessageSafe(tabId, payload);
        return { current: true, delivered: delivered };
    } catch (e) {
        taLog.error("Error in _sendGeneratingIfCurrent: " + e);
        return { current: false, delivered: false };
    }
}

// Broadcast a panel command to EVERY tab that displays headerMessageId: mail tabs and
// message windows alike, several at once when the message is open in more than one place.
// This is how a job updates the panels, whoever started it: the batch has no tab of its
// own, and a caller that joined a running job may be gone by the time it lands. Before
// this, the result went only to the starter's tab, so a panel that found the job running
// kept its spinner forever, and a message opened while the batch worked on it never
// showed the batch's progress.
// Each tab is checked with getDisplayedMessage() right before the send (the same staleness
// rule as _sendIfCurrent) and the send goes through sendTabMessageSafe() [#901]. Awaited
// by the jobs, so a tab always receives the generating panel before the result; the
// content script's own guards (_mztaDisplayedMsgId, _mztaPanelSeq) still apply.
// The payload is sanitized once through _sanitizePanelPayload(), like _sendIfCurrent().
async function _sendToTabsDisplaying(headerMessageId, payload) {
    if (!headerMessageId) return;
    const safePayload = _sanitizePanelPayload(payload);
    let tabs = [];
    try {
        tabs = (await browser.tabs.query({})).filter(tab => tab.type === 'mail' || tab.type === 'messageDisplay');
    } catch (e) {
        taLog.error("Error in _sendToTabsDisplaying (tabs.query): " + e);
        return;
    }
    await Promise.all(tabs.map(async (tab) => {
        try {
            const current = await browser.messageDisplay.getDisplayedMessage(tab.id);
            if (!current || current.headerMessageId !== headerMessageId) return;
            await sendTabMessageSafe(tab.id, safePayload);
        } catch (e) {
            // A tab closing mid-query, a tab type without a message display: skip it.
        }
    }));
}

// Remove a generating panel that a failed task may have left behind. Message-aware like
// the show commands: the content script ignores it when headerMessageId is given and its
// document displays another message. kind: 'summary' | 'translation' | 'both'.
function _clearGeneratingPanels(tabId, headerMessageId = null, kind = 'both') {
    if (!tabId) return;
    if (kind !== 'translation') sendTabMessageSafe(tabId, { command: "hideSummaryGenerating", headerMessageId: headerMessageId });
    if (kind !== 'summary') sendTabMessageSafe(tabId, { command: "hideTranslationGenerating", headerMessageId: headerMessageId });
}

// .catch() handler for the fire-and-forget runtime.onMessage tasks: log the rejection
// instead of leaving it unhandled, and clear any generating panel it left spinning.
function _handleTaskError(label, error, tabId, headerMessageId = null, kind = 'both') {
    taLog.error("Error in " + label + ": " + (error?.message || error));
    _clearGeneratingPanels(tabId, headerMessageId, kind);
}

// Resolve a message from its headerMessageId, avoiding browser.messages.query()
// whenever anything faster is known.
//
// query() searches every folder of every account, and the background page runs in
// Thunderbird's parent process: on a large mail store that search freezes the whole
// application UI for minutes before the AI request is even sent. The docs say as much
// ("could need a long time to complete, if the user has a lot of messages"), so the
// query is the LAST resort here, never the first.
//
// Order, first hit wins:
//   a) resolvedMessage -> the message object the caller already holds (e.g. from
//      getDisplayedMessage); accepted only when its headerMessageId matches, for the
//      same reason (b) and (c) verify;
//   b) messageId  -> browser.messages.get(), a direct lookup;
//   c) tabId      -> the message the tab currently displays;
//   d) query      -> browser.messages.query(), the LAST resort (see above).
//
// (a), (b) and (c) are accepted ONLY when the resolved message really is the one asked
// for. For (c) that is the staleness check _sendIfCurrent() already makes — the user can
// have clicked through to another email while the work sat queued. For (b) it guards
// against a numeric id that no longer denotes the same message: ids are per-folder and
// can be reused once a message is deleted and the folder compacted. (a) re-checks for the
// same reason: a caller that resolved the message earlier may now hold a stale reference.
//
// Returns the message object, or null when it cannot be resolved — callers keep their
// own "Message not found" bookkeeping.
//
// A falsy headerMessageId returns null immediately. Passed to (d) it is worse than slow:
// the schema drops an undefined / empty property, so query() runs with NO filter, matches
// every message of every account, and messages[0] is an arbitrary message from an
// arbitrary folder — which would then be summarized/translated in place of the real one.
// The guard comes before (a) too, so an empty id can never "match" an empty id.
async function _resolveMessage(headerMessageId, messageId = null, tabId = null, resolvedMessage = null) {
    if (!headerMessageId) {
        taLog.error("_resolveMessage: empty headerMessageId (" + JSON.stringify(headerMessageId) + "), refusing to resolve.");
        return null;
    }

    if (resolvedMessage && resolvedMessage.headerMessageId === headerMessageId) {
        return resolvedMessage;
    }

    if (messageId) {
        try {
            const msg = await browser.messages.get(messageId);
            if (msg && msg.headerMessageId === headerMessageId) return msg;
        } catch (e) {
            // Deleted or moved out from under us: fall through to the slower paths.
            taLog.log("_resolveMessage: messages.get(" + messageId + ") failed, falling back: " + e);
        }
    }

    if (tabId) {
        try {
            const current = await browser.messageDisplay.getDisplayedMessage(tabId);
            if (current && current.headerMessageId === headerMessageId) return current;
        } catch (e) {
            taLog.log("_resolveMessage: getDisplayedMessage(" + tabId + ") failed, falling back: " + e);
        }
    }

    taLog.warn("_resolveMessage: falling back to messages.query() for " + headerMessageId + " (messageId: " + messageId + ", tabId: " + tabId + ")");
    const messageResult = await browser.messages.query({ headerMessageId: headerMessageId });
    if (!messageResult || messageResult.messages.length === 0) return null;
    return messageResult.messages[0];
}

// True when the summarize feature has no connection able to reach an API, so an automatic
// summary must be skipped silently. The *effective* connection is checked (the same way
// _generateSummaryForMessage() resolves it), so a summarize-specific integration keeps working
// even when the global connection_type is still empty.
// The predicate is isApiUsableConnection(), the same one used by the menus, by
// _generateSummaryForMessage() and by every other feature: chatgpt_web has no API and cannot
// produce a summary, so it must be treated exactly like a missing connection here. Skipping
// early matters because _generateSummaryForMessage() rejects it only inside its job,
// persisting an error into summaryStore — an automatic run would poison the cache for a
// message the user never asked to summarize.
async function _summarizeConnectionMissing() {
    try {
        let prefs = await mztaPrefs.getPrefs([
            'connection_type',
            ...Object.keys(getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']))
        ]);
        const summarize_prompt = await getSummarizePrompt();
        return !isApiUsableConnection(getConnectionType(prefs, summarize_prompt, 'summarize'));
    } catch (e) {
        taLog.error("Error in _summarizeConnectionMissing: " + e);
        return true;   // on doubt, do not start an automatic generation
    }
}

// Summary of one message, shared by every caller: panel button, auto display, context menu,
// refresh and the processEmails() batch.
// tabId is optional: the tab the caller wants the outcome in (null for the batch). It is
//   also used to resolve the message (route c of _resolveMessage()).
// options.messageData: { message, fullMessage } — pass pre-fetched data to avoid re-querying
// options.messageId: numeric message id, when the caller has one — see _resolveMessage()
// options.resolvedMessage: the message object the caller already holds (e.g. from
//   getDisplayedMessage) — the cheapest route, used by the auto-display paths. See _resolveMessage()
// options.manual: an explicit user action; it may revive a job invalidated by a delete.
// options.refresh: regenerate; the job drops the stored summary first and skips the cache.
//
// At most one summary job per message is in flight (taJobRegistry). A caller that finds
// one running JOINS it (_joinSummaryJob) instead of calling the API again or giving up:
// the batch and a manual trigger can reach the same message at any moment. The lookup and
// the registration are synchronous and back to back, before any await, so two callers
// arriving together cannot both start (the storage.session flag this replaces was checked
// and set across several awaits).
//
// The job broadcasts its panels to every tab displaying the message
// (_sendToTabsDisplaying): the generating panel when it starts, the result or the error
// when it ends. So a batch job updates any open panel, and a joiner's tab gets the result.
//
// Returns (never rejects) the job outcome: { status, data, errorMessage, rateLimited, retryAfterMs }.
// rateLimited is read by the processEmails() pipeline, which stops the batch on it.
function _generateSummaryForMessage(headerMessageId, tabId = null, options = {}) {
    // Before any job or store write: an empty id would key the store on undefined.
    if (!headerMessageId) {
        taLog.error("[ThunderAI] Summary: empty headerMessageId (" + JSON.stringify(headerMessageId) + "), nothing to summarize.");
        return Promise.resolve({ status: 'skipped' });
    }
    const running = taJobRegistry.get('summary', headerMessageId);
    if (running) return _joinSummaryJob(running, headerMessageId, tabId, options);
    return taJobRegistry.start('summary', headerMessageId, (entry) => _runSummaryJob(entry, headerMessageId, tabId, options)).promise;
}

// A caller that found a summary job running: no startWorking(), no store write, no API
// call. Its own tab gets the generating panel and then the outcome, even though the job
// broadcasts too: this caller's spinner (or the direct one of the trigger handlers) can
// reach its tab AFTER the job's result broadcast, and this final send is what replaces it.
async function _joinSummaryJob(entry, headerMessageId, tabId, options) {
    taJobRegistry.logJoin(entry);
    // The user deleted the summary while it was being generated, then asked for it again:
    // take the running job's result instead of starting a second call. Automatic callers
    // (auto display, batch) never revive: regenerating what the user deleted would defeat
    // the delete.
    if (options.manual) taJobRegistry.revive(entry);
    await _sendGeneratingIfCurrent(tabId, headerMessageId, { command: "showSummaryGenerating", headerMessageId: headerMessageId });
    const outcome = await entry.promise;
    if (tabId) {
        if (outcome.data) {
            await _sendIfCurrent(tabId, headerMessageId, { command: "showSummary", data: outcome.data });
        } else if (outcome.status === 'cancelled') {
            await _restoreSummaryButton(tabId, headerMessageId);
        } else {
            _clearGeneratingPanels(tabId, headerMessageId, 'summary');
        }
    }
    return outcome;
}

// The end of a summary job that got past its generating panel: store the result (or the
// error) and broadcast it — unless the user deleted the summary meanwhile
// (taJobRegistry.invalidate()): then nothing is saved or shown, and every tab displaying
// the message gets its manual button back instead of the spinner, as after a delete.
// store: the store write to run, or null (config errors are shown but not stored, so the
// next attempt runs again instead of hitting a cached error).
async function _endSummaryJob(entry, headerMessageId, data, store) {
    if (entry.invalidated) {
        taLog.log("[ThunderAI] Summary for " + headerMessageId + " was deleted while being generated, result discarded.");
        await _sendToTabsDisplaying(headerMessageId, { command: "hideSummaryGenerating", headerMessageId: headerMessageId });
        await _restoreSummaryButton(null, headerMessageId);
        return { status: 'cancelled' };
    }
    if (store) {
        try {
            await store();
        } catch (e) {
            taLog.error("[ThunderAI] Summary: could not store the result for " + headerMessageId + ": " + e);
        }
    }
    // The banner's Refresh / Delete buttons send data.headerMessageId back: the error
    // payloads built above do not carry it.
    data = { headerMessageId: headerMessageId, ...data };
    await _sendToTabsDisplaying(headerMessageId, { command: "showSummary", data: data });
    return data.error
        ? { status: 'error', data: data, errorMessage: data.message }
        : { status: 'ok', data: data };
}

async function _runSummaryJob(entry, headerMessageId, tabId, options) {
    // One startWorking()/stopWorking() pair per job that really works (past the cache).
    let working = false;
    try {
        let prefs = await mztaPrefs.getPrefs([
            'connection_type',
            'do_debug',
            'default_chatgpt_lang',
            'summarize_max_display_length',
            'summarize_strip_formatting',
            ...Object.keys(getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']))
        ]);
        const display = { maxDisplayLength: prefs.summarize_max_display_length, stripFormatting: prefs.summarize_strip_formatting };

        if (options.refresh) {
            // Inside the job, not in the refresh handler: the old summary is dropped only by
            // the caller that owns the generation, never while another job is running.
            await summaryStore.removeSummary(headerMessageId);
        } else {
            let cachedSummary = await summaryStore.loadSummary(headerMessageId);
            if (cachedSummary && !cachedSummary.error) {
                // Not broadcast: the other tabs already show it. The outcome carries it for
                // any joiner.
                const data = { ...cachedSummary, ...display };
                await _sendIfCurrent(tabId, headerMessageId, { command: "showSummary", data: data });
                return { status: 'ok', data: data, cached: true };
            }
        }

        working = true;
        taWorkingStatus.startWorking();
        await _sendToTabsDisplaying(headerMessageId, { command: "showSummaryGenerating", headerMessageId: headerMessageId });

        let message, fullMessage;
        if (options.messageData) {
            message = options.messageData.message;
            fullMessage = options.messageData.fullMessage;
            // buildSummaryPrompt() reads message.id to fetch the body, so a caller
            // passing only { fullMessage } would summarize an EMPTY body - subject
            // present, so the result looks plausible - and cache it as valid. Treated
            // exactly like the !message case below: same error panel, same store.
            if (!message?.id) {
                taLog.error('[ThunderAI] Summary: options.messageData has no message.id - callers must pass { message, fullMessage }.');
                const errorMsg = browser.i18n.getMessage('summarize_error_no_message_id');
                return await _endSummaryJob(entry, headerMessageId, { error: true, message: errorMsg }, () => summaryStore.saveError(headerMessageId, errorMsg));
            }
        } else {
            message = await _resolveMessage(headerMessageId, options.messageId, tabId, options.resolvedMessage);
            if (!message) {
                return await _endSummaryJob(entry, headerMessageId, { error: true, message: "Message not found" }, () => summaryStore.saveError(headerMessageId, "Message not found"));
            }
            fullMessage = await browser.messages.getFull(message.id);
        }

        const summarize_prompt = await getSummarizePrompt();
        const connectionType = getConnectionType(prefs, summarize_prompt, 'summarize');

        // Not just chatgpt_web: an empty connection is equally unusable and was falling
        // through into mzta_specialCommand.
        if (!isApiUsableConnection(connectionType)) {
            const errorMsg = browser.i18n.getMessage('summarize_chatgpt_web_not_supported');
            return await _endSummaryJob(entry, headerMessageId, { error: true, message: errorMsg }, () => summaryStore.saveError(headerMessageId, errorMsg));
        }

        taLog.log("[ThunderAI] Summary: building the prompt for " + message.headerMessageId + " (folder: " + message.folder?.path + ")");
        const { promptText } = await taPromptUtils.buildSummaryPrompt([{ message, fullMessage }]);

        const cmd = new mzta_specialCommand({
            prompt: promptText,
            llm: connectionType,
            do_debug: prefs.do_debug,
            config: summarize_prompt
        });

        await cmd.initWorker();
        const aiResponse = await cmd.sendPrompt();
        let cleanedSummary = cleanSummaryText(aiResponse);
        const md = window.markdownit();
        let summaryHtml = md.render(aiResponse);

        const summaryData = {
            summary: cleanedSummary,
            summary_html: summaryHtml,
            summary_date: new Date(),
            headerMessageId: headerMessageId
        };
        return await _endSummaryJob(entry, headerMessageId, { ...summaryData, ...display }, () => summaryStore.saveSummary(summaryData, headerMessageId));

    } catch (error) {
        console.error("[ThunderAI] Error generating summary:", error);
        // A config error (e.g. a missing API key) is shown but not stored: the next attempt
        // must run again once the user fixed the settings. No in-flight flag can be left
        // behind either: the registry drops the entry when this job settles.
        const storedMessage = error.message || String(error);
        const outcome = await _endSummaryJob(entry, headerMessageId,
            { error: true, message: error.message || "Failed to generate summary" },
            error.isConfigError ? null : () => summaryStore.saveError(headerMessageId, storedMessage));
        // The error banner above already replaces the panel where it is delivered; this
        // covers the tabs where it is not, so no spinner outlives the failed generation.
        await _sendToTabsDisplaying(headerMessageId, { command: "hideSummaryGenerating", headerMessageId: headerMessageId });
        return { ...outcome, rateLimited: !!error.rateLimited, retryAfterMs: error.retryAfterMs ?? null };
    } finally {
        if (working) taWorkingStatus.stopWorking();
    }
}

// Translation of one message: same contract as _generateSummaryForMessage() — one job per
// message in taJobRegistry, joiners await it, the job broadcasts its panels.
// options.messageData: { message, fullMessage } — pass pre-fetched data to avoid re-querying.
//   `message` is required: its .id feeds the body read (getMailInlineTextParts).
// options.messageId / options.resolvedMessage: see _resolveMessage()
// options.manual / options.refresh: see _generateSummaryForMessage().
async function _generateTranslationForMessage(headerMessageId, tabId = null, options = {}) {
    // Before any job or store write: an empty id would key the store on undefined.
    if (!headerMessageId) {
        taLog.error("[ThunderAI] Translation: empty headerMessageId (" + JSON.stringify(headerMessageId) + "), nothing to translate.");
        return { status: 'skipped' };
    }
    // No target language: a guard that must neither create a job nor write the store. It
    // needs a prefs read, so it comes first; the synchronous lookup/registration below
    // follows it with no await in between.
    let prefs_lang = await mztaPrefs.getPrefs(['translate_lang', 'default_chatgpt_lang']);
    const lang = prefs_lang.translate_lang || prefs_lang.default_chatgpt_lang || '';
    if (!lang) {
        taLog.warn("Translation skipped: no language configured (translate_lang and default_chatgpt_lang are both empty).");
        return { status: 'skipped' };
    }
    const running = taJobRegistry.get('translation', headerMessageId);
    if (running) return _joinTranslationJob(running, headerMessageId, tabId, options);
    return taJobRegistry.start('translation', headerMessageId, (entry) => _runTranslationJob(entry, headerMessageId, tabId, options, lang)).promise;
}

// See _joinSummaryJob().
async function _joinTranslationJob(entry, headerMessageId, tabId, options) {
    taJobRegistry.logJoin(entry);
    if (options.manual) taJobRegistry.revive(entry);
    await _sendGeneratingIfCurrent(tabId, headerMessageId, { command: "showTranslationGenerating", headerMessageId: headerMessageId });
    const outcome = await entry.promise;
    if (tabId) {
        if (outcome.data) {
            await _sendIfCurrent(tabId, headerMessageId, { command: "showTranslation", data: outcome.data });
        } else if (outcome.status === 'cancelled') {
            await _restoreTranslationButton(tabId, headerMessageId);
        } else {
            _clearGeneratingPanels(tabId, headerMessageId, 'translation');
        }
    }
    return outcome;
}

// See _endSummaryJob().
async function _endTranslationJob(entry, headerMessageId, data, store) {
    if (entry.invalidated) {
        taLog.log("[ThunderAI] Translation for " + headerMessageId + " was deleted while being generated, result discarded.");
        await _sendToTabsDisplaying(headerMessageId, { command: "hideTranslationGenerating", headerMessageId: headerMessageId });
        await _restoreTranslationButton(null, headerMessageId);
        return { status: 'cancelled' };
    }
    if (store) {
        try {
            await store();
        } catch (e) {
            taLog.error("[ThunderAI] Translation: could not store the result for " + headerMessageId + ": " + e);
        }
    }
    // The banner's Refresh / Delete buttons send data.headerMessageId back: the error
    // payloads built above do not carry it.
    data = { headerMessageId: headerMessageId, ...data };
    await _sendToTabsDisplaying(headerMessageId, { command: "showTranslation", data: data });
    return data.error
        ? { status: 'error', data: data, errorMessage: data.message }
        : { status: 'ok', data: data };
}

async function _runTranslationJob(entry, headerMessageId, tabId, options, lang) {
    let working = false;
    try {
        let prefs = await mztaPrefs.getPrefs([
            'connection_type',
            'do_debug',
            'translate_max_display_length',
            ...Object.keys(getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']))
        ]);
        const display = { maxDisplayLength: prefs.translate_max_display_length };

        if (options.refresh) {
            // See _runSummaryJob().
            await translationStore.removeTranslation(headerMessageId);
        } else {
            let cachedTranslation = await translationStore.loadTranslation(headerMessageId);
            if (cachedTranslation && !cachedTranslation.error) {
                const data = { ...cachedTranslation, ...display };
                await _sendIfCurrent(tabId, headerMessageId, { command: "showTranslation", data: data });
                return { status: 'ok', data: data, cached: true };
            }
        }

        working = true;
        taWorkingStatus.startWorking();
        await _sendToTabsDisplaying(headerMessageId, { command: "showTranslationGenerating", headerMessageId: headerMessageId });

        // messageId travels alongside fullMessage on BOTH branches: the body now
        // comes from getMailInlineTextParts(messageId), so buildTranslationPrompt()
        // needs the id, not just the parsed message.
        // usedMessage is only for the diagnostic log before the prompt is built.
        let fullMessage, curr_messageId, usedMessage;
        if (options.messageData) {
            fullMessage = options.messageData.fullMessage;
            usedMessage = options.messageData.message;
            curr_messageId = options.messageData.message?.id;
            // The ?. above is what keeps a caller passing only { fullMessage } from
            // throwing - but an undefined id reaches getMailInlineTextParts() and comes
            // back as an empty body, so the translation would be built from the subject
            // alone and then CACHED as a good result. The optional chaining is there to
            // avoid a crash, not to make a missing message acceptable: bail out exactly
            // like the !message branch below, so the user sees the error panel instead of
            // a translation of the subject line.
            if (!curr_messageId) {
                taLog.error('[ThunderAI] Translation: options.messageData has no message.id - callers must pass { message, fullMessage }.');
                const errorMsg = browser.i18n.getMessage('translate_error_no_message_id');
                return await _endTranslationJob(entry, headerMessageId, { error: true, message: errorMsg }, () => translationStore.saveError(headerMessageId, errorMsg));
            }
        } else {
            const message = await _resolveMessage(headerMessageId, options.messageId, tabId, options.resolvedMessage);
            if (!message) {
                return await _endTranslationJob(entry, headerMessageId, { error: true, message: "Message not found" }, () => translationStore.saveError(headerMessageId, "Message not found"));
            }
            usedMessage = message;
            curr_messageId = message.id;
            fullMessage = await browser.messages.getFull(message.id);
        }

        const translate_prompt = await getTranslatePrompt();
        const connectionType = getConnectionType(prefs, translate_prompt, 'translate');

        // Not just chatgpt_web: an empty connection is equally unusable and was falling
        // through into mzta_specialCommand.
        if (!isApiUsableConnection(connectionType)) {
            const errorMsg = browser.i18n.getMessage('translate_chatgpt_web_not_supported');
            return await _endTranslationJob(entry, headerMessageId, { error: true, message: errorMsg }, () => translationStore.saveError(headerMessageId, errorMsg));
        }
        taLog.log("[ThunderAI] Translation: building the prompt for " + usedMessage?.headerMessageId + " (folder: " + usedMessage?.folder?.path + ")");
        const { promptText } = await taPromptUtils.buildTranslationPrompt(fullMessage, curr_messageId);

        const cmd = new mzta_specialCommand({
            prompt: promptText,
            llm: connectionType,
            do_debug: prefs.do_debug,
            config: translate_prompt
        });

        await cmd.initWorker();
        const aiResponse = await cmd.sendPrompt();

        let translatedBody = '';
        let translatedSubject = '';
        let translationStatus = '';
        try {
            const parsed = extractJsonObject(aiResponse);
            translatedBody = parsed.body || '';
            translatedSubject = parsed.subject || '';
            translationStatus = String(parsed.status ?? '');
        } catch (e) {
            translatedBody = aiResponse;
        }

        const translationData = {
            translated_text: translatedBody,
            translated_subject: translatedSubject,
            translation_status: translationStatus,
            lang: lang,
            headerMessageId: headerMessageId
        };
        return await _endTranslationJob(entry, headerMessageId, { ...translationData, ...display }, () => translationStore.saveTranslation(translationData, headerMessageId));

    } catch (error) {
        console.error("[ThunderAI] Error generating translation:", error);
        // Same as the summary: a config error is shown, not stored.
        const storedMessage = error.message || String(error);
        const outcome = await _endTranslationJob(entry, headerMessageId,
            { error: true, message: error.message || "Failed to generate translation" },
            error.isConfigError ? null : () => translationStore.saveError(headerMessageId, storedMessage));
        // Same as the summary: no spinner outlives the failed generation.
        await _sendToTabsDisplaying(headerMessageId, { command: "hideTranslationGenerating", headerMessageId: headerMessageId });
        return { ...outcome, rateLimited: !!error.rateLimited, retryAfterMs: error.retryAfterMs ?? null };
    } finally {
        if (working) taWorkingStatus.stopWorking();
    }
}

// Build a lightweight metadata snapshot (subject, from, message_date) for spam
// report entries. Prefers the full MIME headers, but falls back to the
// MessageHeader fields (message.subject / message.author / message.date), which
// remain readable even when the message storage is no longer available. This
// keeps the spam log populated when a user filter removes a message while it is
// being analyzed, or when getFull() returns partial headers.
// Thanks to https://github.com/racerm3 for the idea, from https://github.com/racerm3/ThunderAI/commit/5ae5e206a733b44d57ef57dcc46968ea7e686e72#diff-ee0e0f04f23f4913865479164d992ff20124eba596df1453f1cde635359fb634
function _buildReportMetadata(message, curr_fullMessage) {
    const headers = (curr_fullMessage && curr_fullMessage.headers) || {};
    const isEmpty = (v) => v === undefined || v === null || (Array.isArray(v) && v.length === 0);
    return {
        subject: isEmpty(headers.subject) ? (message?.subject ? [message.subject] : undefined) : headers.subject,
        from: isEmpty(headers.from) ? (message?.author ? [message.author] : undefined) : headers.from,
        message_date: message?.date ? new Date(message.date) : undefined
    };
}

// Tail of the junk-move queue: every move to the junk folder chains on it, so only one is
// in flight at a time even when several spam analyses run concurrently. Errors are
// swallowed on the chain itself (the caller gets them from its own promise), so one failed
// move never blocks the following ones.
let _junkMoveChain = Promise.resolve();
function _enqueueJunkMove(fn) {
    const run = _junkMoveChain.then(fn);
    _junkMoveChain = run.catch(() => {});
    return run;
}

// options.messageData: { message, fullMessage, body_text, msg_text } — pass pre-fetched data to avoid re-querying
// options.messageId: numeric message id, when the caller has one — see _resolveMessage()
// options.tabId: used to resolve the message (see _resolveMessage()) and, when this caller
//   joins a running analysis, the tab it delivers the report to
// options.prefs: pass pre-fetched prefs to avoid re-querying
// options.autoMove: if true, move spam messages to junk folder (default: false)
//
// One spam analysis per message is in flight (taJobRegistry, kind 'spam'): the batch, the
// context menu and the panel's Refresh can reach the same message together, and a second
// analysis could also try a second junk move. A caller that finds one running JOINS it.
// Only the job that owns the entry can reach the junk move; a joiner never moves anything.
// Returns (never rejects) { status, success, moved, rateLimited, retryAfterMs, data: { report } }:
// `moved` and `rateLimited` are read by the processEmails() pipeline.
function _generateSpamReportForMessage(headerMessageId, options = {}) {
    // Before any job or store write: an empty id would key the store on undefined.
    if (!headerMessageId) {
        taLog.error("[ThunderAI | SpamFilter] Empty headerMessageId (" + JSON.stringify(headerMessageId) + "), nothing to analyze.");
        return Promise.resolve({ status: 'skipped', success: false, moved: false });
    }
    const running = taJobRegistry.get('spam', headerMessageId);
    if (running) return _joinSpamJob(running, headerMessageId, options);
    return taJobRegistry.start('spam', headerMessageId, (entry) => _runSpamJob(entry, headerMessageId, options)).promise;
}

// A caller that found a spam analysis running. An autoMove caller (the batch) that joins
// a manual check (Refresh, no autoMove) still wants the verdict applied: it asks the job
// through entry.wantsMove, read when the job reaches its verdict, so the message is still
// moved - once, by the job. A joiner arriving after that point gets the outcome as it is.
async function _joinSpamJob(entry, headerMessageId, options) {
    taJobRegistry.logJoin(entry);
    if (options.autoMove) entry.wantsMove = true;
    const tabId = options.tabId;
    const showPanel = tabId && prefs_init.spamfilter_show_msg_panel;
    if (showPanel) await _sendIfCurrent(tabId, headerMessageId, { command: "showSpamCheckInProgress" });
    const outcome = await entry.promise;
    // Same reason as _joinSummaryJob(): the in-progress badge above may have reached the
    // tab after the job's broadcast, so this caller replaces it with the report itself.
    if (showPanel && outcome.data?.report) {
        await _sendIfCurrent(tabId, headerMessageId, { command: "showSpamReport", data: outcome.data.report });
    }
    return outcome;
}

// The outcome of a spam job: report is what the panel shows (the verdict or the error).
function _spamOutcome(success, report, extra = {}) {
    return { status: success ? 'ok' : 'error', success: success, moved: false, data: { report: report }, ...extra };
}

// Marks a message as junk and moves it to its account's junk folder. Returns true on success.
// Serialized through _enqueueJunkMove(): processEmails() analyzes several messages at once,
// and concurrent moves into the junk folder (IMAP especially) were never exercised.
// Never throws: a failed move (no junk folder, a message with no folder, an API error) is
// logged and returns false, so the caller keeps the verdict and saves the report with
// moved = false.
async function _moveMessageToJunk(message, headerMessageId) {
    taLog.log("Marking as spam [" + headerMessageId + "]");
    try {
        await _enqueueJunkMove(async () => {
            const accountId = message.folder?.accountId;
            if (!accountId) {
                throw new Error("the message is not in an account folder");
            }
            await messenger.messages.update(message.id, { junk: true });
            let spamFolder = await messenger.folders.query({ accountId: accountId, specialUse: ['junk'] });
            if (!spamFolder || spamFolder.length === 0 || !spamFolder[0]?.id) {
                throw new Error("no junk folder for account " + accountId);
            }
            await messenger.messages.move([message.id], spamFolder[0].id);
        });
        taLog.log("Marked as spam [" + headerMessageId + "]");
        return true;
    } catch (err) {
        taLog.error("[ThunderAI | SpamFilter] Could not move the message to the junk folder [" + headerMessageId + "]: " + (err?.message || err));
        return false;
    }
}

// Saves and shows a report decided by a rule instead of the AI: the allow list, the block
// list or the address book. verdict: { spamValue, explanation, isSpam }. isSpam is explicit
// rather than derived from the threshold, so an allow-list report (spamValue 0) can never be
// moved, even with a threshold of 0. A spam verdict is moved to junk on the same terms as an
// AI one: autoMove, or an autoMove caller that joined this job (entry.wantsMove).
async function _saveRuleSpamReport(entry, headerMessageId, message, message_metadata, prefs, options, verdict) {
    let report_data = {};
    report_data.report_date = new Date();
    report_data.headerMessageId = headerMessageId;
    report_data.spamValue = verdict.spamValue;
    report_data.explanation = verdict.explanation;
    report_data.subject = message_metadata.subject;
    report_data.from = message_metadata.from;
    report_data.message_date = message_metadata.message_date;
    report_data.moved = false;
    report_data.SpamThreshold = getSpamThreshold(prefs);
    if (verdict.isSpam && (options.autoMove || entry.wantsMove)) {
        report_data.moved = await _moveMessageToJunk(message, headerMessageId);
    }
    spamReport.saveReportData(report_data, headerMessageId);
    await updateSpamPanel(headerMessageId, "showSpamReport", report_data);
    // moved: read by the processEmails() pipeline, a moved message gets no tags, summary or translation.
    return _spamOutcome(true, report_data, { moved: report_data.moved });
}

async function _runSpamJob(entry, headerMessageId, options) {
    // Declared outside the try so the final catch can still attach whatever
    // metadata was captured before the failure.
    let message_metadata = null;
    try {
        let prefs = options.prefs || await mztaPrefs.getPrefs([
            'connection_type',
            'do_debug',
            'default_chatgpt_lang',
            'spamfilter_threshold',
            ...Object.keys(getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']))
        ]);

        await spamReport.removeReportData(headerMessageId);

        await updateSpamPanel(headerMessageId, "showSpamCheckInProgress");

        let message, curr_fullMessage, msg_text, body_text;

        if (options.messageData) {
            message = options.messageData.message;
            curr_fullMessage = options.messageData.fullMessage;
            msg_text = options.messageData.msg_text;
            body_text = options.messageData.body_text;
            message_metadata = _buildReportMetadata(message, curr_fullMessage);
        } else {
            message = await _resolveMessage(headerMessageId, options.messageId, options.tabId);
            if (!message) {
                let err_data = await spamReport.saveError(headerMessageId, "Message not found");
                await updateSpamPanel(headerMessageId, "showSpamReport", err_data);
                return _spamOutcome(false, err_data);
            }
            // Snapshot the MessageHeader fields first: getFull() can fail, or resolve
            // with empty headers, when a user filter removes the message mid-analysis.
            message_metadata = _buildReportMetadata(message, null);
            try {
                curr_fullMessage = await browser.messages.getFull(message.id);
            } catch (err) {
                console.error("[ThunderAI | SpamFilter] Error getting the full message: ", err);
                let err_data = await spamReport.saveError(headerMessageId, err.message || String(err), message_metadata || {});
                await updateSpamPanel(headerMessageId, "showSpamReport", err_data);
                return _spamOutcome(false, err_data);
            }
            message_metadata = _buildReportMetadata(message, curr_fullMessage);
            msg_text = await getMailInlineTextParts(message.id);
            body_text = htmlBodyToPlainText(msg_text.html);
            if (body_text.length == 0) {
                body_text = cleanupNewlines(msg_text.text);
            }
        }

        // Extract sender email for skip checks
        let senderEmail = extractEmail(message.author).toLowerCase();

        // Allow list (spamfilter_skip_addresses) and block list (spamfilter_block_addresses),
        // both checked before the address book. Entries are exact addresses or whole domains
        // ("@domain.com" / "*@domain.com"), see matchAddressListType(). When the sender is in
        // both lists the more specific match wins (an exact address beats a domain entry), and
        // on equal specificity the allow list wins.
        // hasAddressListEntries() is used instead of a plain length check because a list saved
        // by a previous version can still hold a stray '' (an emptied textarea was stored as
        // ['']), which would read as a configured list.
        let skip_addresses = options.skip_addresses || (await mztaPrefs.getPrefs(['spamfilter_skip_addresses'])).spamfilter_skip_addresses;
        let block_addresses = options.block_addresses || (await mztaPrefs.getPrefs(['spamfilter_block_addresses'])).spamfilter_block_addresses;
        let allowMatch = hasAddressListEntries(skip_addresses) ? matchAddressListType(message.author, skip_addresses) : null;
        let blockMatch = hasAddressListEntries(block_addresses) ? matchAddressListType(message.author, block_addresses) : null;
        let blocked = (blockMatch !== null) && ((allowMatch === null) || (blockMatch === 'exact' && allowMatch === 'domain'));
        if (allowMatch !== null && !blocked) {
            taLog.log("Sender " + senderEmail + " is in the skip addresses list (" + allowMatch + " match), skipping spam filter.");
            return await _saveRuleSpamReport(entry, headerMessageId, message, message_metadata, prefs, options,
                { spamValue: 0, explanation: browser.i18n.getMessage('spamfilter_skip_addresses_explanation'), isSpam: false });
        }
        if (blocked) {
            taLog.log("Sender " + senderEmail + " is in the block addresses list (" + blockMatch + " match), reporting as spam without the AI.");
            return await _saveRuleSpamReport(entry, headerMessageId, message, message_metadata, prefs, options,
                { spamValue: 100, explanation: browser.i18n.getMessage('spamfilter_block_addresses_explanation'), isSpam: true });
        }

        // Check if sender is in any address book
        let skip_addressbook = options.skip_addressbook !== undefined
            ? options.skip_addressbook
            : (await mztaPrefs.getPrefs(['spamfilter_skip_addressbook'])).spamfilter_skip_addressbook;
        if (skip_addressbook && senderEmail) {
            try {
                let hasPermission = await browser.permissions.contains({ permissions: ["addressBooks"] });
                if (hasPermission) {
                    let matchingContacts = await browser.contacts.quickSearch({ searchString: senderEmail });
                    let isInAddressBook = matchingContacts.some(contact => {
                        let props = contact.properties;
                        return (props.PrimaryEmail && props.PrimaryEmail.toLowerCase() === senderEmail) ||
                               (props.SecondEmail && props.SecondEmail.toLowerCase() === senderEmail);
                    });
                    if (isInAddressBook) {
                        taLog.log("Sender " + senderEmail + " is in the address book, skipping spam filter.");
                        return await _saveRuleSpamReport(entry, headerMessageId, message, message_metadata, prefs, options,
                            { spamValue: 0, explanation: browser.i18n.getMessage('spamfilter_skip_addressbook_explanation'), isSpam: false });
                    }
                }
            } catch (err) {
                taLog.error("Error checking address book for sender: " + err);
                // Fail open — continue with normal spam check
            }
        }

        let curr_prompt_spamfilter = await getSpamFilterPrompt();
        if (!curr_prompt_spamfilter) {
            taLog.error("Spam filter: the 'prompt_spamfilter' special prompt is missing, skipping. If you modified the special prompts, try restoring the default Spam Filter prompt.");
            let err_data = await spamReport.saveError(headerMessageId, browser.i18n.getMessage('spamfilter_prompt_missing_explanation'), message_metadata || {});
            await updateSpamPanel(headerMessageId, "showSpamReport", err_data);
            return _spamOutcome(false, err_data);
        }
        // The connection can be unusable even with spamfilter still true in storage (a
        // wizard run, a prefs import): without this the resolved type flowed straight into
        // mzta_specialCommand. The in-progress badge is already shown, so report the error
        // through spamReport instead of returning bare, or the panel would sit on it.
        let spam_conntype = getConnectionType(prefs, curr_prompt_spamfilter, 'spamfilter');
        if (!isApiUsableConnection(spam_conntype)) {
            console.error("[ThunderAI | SpamFilter] Invalid connection type: " + spam_conntype);
            let err_data = await spamReport.saveError(headerMessageId, browser.i18n.getMessage('msg_no_connection_selected'), message_metadata || {});
            await updateSpamPanel(headerMessageId, "showSpamReport", err_data);
            return _spamOutcome(false, err_data);
        }
        let chatgpt_lang = await taPromptUtils.getDefaultLang(curr_prompt_spamfilter);
        let specialFullPrompt_spamfilter = await taPromptUtils.preparePrompt({
            curr_prompt: curr_prompt_spamfilter,
            curr_message: message,
            chatgpt_lang: chatgpt_lang,
            body_text: body_text,
            subject_text: curr_fullMessage.headers.subject,
            msg_text: msg_text
        });
        taLog.log("Special prompt: " + specialFullPrompt_spamfilter);

        let cmd_spamfilter = new mzta_specialCommand({
            prompt: specialFullPrompt_spamfilter,
            llm: spam_conntype,
            custom_model: curr_prompt_spamfilter.model ? curr_prompt_spamfilter.model : '',
            do_debug: prefs.do_debug,
            config: curr_prompt_spamfilter
        });
        let spamfilter_result = '';
        // Counted in WorkingLevel like the summary and translation calls (see runAddTags()).
        taWorkingStatus.startWorking();
        try {
            await cmd_spamfilter.initWorker();

            taLog.log("Sending the prompt...");
            try {
                spamfilter_result = (await cmd_spamfilter.sendPrompt()).trim();
            } catch (err) {
                console.error("[ThunderAI | SpamFilter] Error getting spamfilter: ", err);
                let err_data = await spamReport.saveError(headerMessageId, err.message || String(err), message_metadata || {});
                await updateSpamPanel(headerMessageId, "showSpamReport", err_data);
                // rateLimited: the processEmails() pipeline stops the batch on it.
                return _spamOutcome(false, err_data, { rateLimited: !!err.rateLimited, retryAfterMs: err.retryAfterMs ?? null });
            }
        } finally {
            taWorkingStatus.stopWorking();
        }
        taLog.log("spamfilter_result: " + spamfilter_result);

        let jsonObj = {};
        taLog.log("Decoding the AI response...");
        try {
            jsonObj = extractJsonObject(spamfilter_result);
        } catch (e) {
            console.error("[ThunderAI | SpamFilter] Error extracting JSON from AI response: ", e);
            let err_data = await spamReport.saveError(headerMessageId, e.message || String(e), message_metadata || {});
            await updateSpamPanel(headerMessageId, "showSpamReport", err_data);
            return _spamOutcome(false, err_data);
        }
        taLog.log("SpamFilter jsonObj: " + JSON.stringify(jsonObj));

        let report_data = {};
        report_data.report_date = new Date();
        report_data.headerMessageId = headerMessageId;
        report_data.spamValue = jsonObj.spamValue;
        report_data.explanation = jsonObj.explanation;
        report_data.subject = message_metadata.subject;
        report_data.from = message_metadata.from;
        report_data.message_date = message_metadata.message_date;
        report_data.moved = false;
        report_data.SpamThreshold = getSpamThreshold(prefs);

        // entry.wantsMove: an autoMove caller joined this job (see _joinSpamJob()).
        if ((options.autoMove || entry.wantsMove) && jsonObj.spamValue >= report_data.SpamThreshold) {
            report_data.moved = await _moveMessageToJunk(message, headerMessageId);
        }

        spamReport.saveReportData(report_data, headerMessageId);
        await updateSpamPanel(headerMessageId, "showSpamReport", report_data);
        // moved: read by the processEmails() pipeline, a moved message gets no tags, summary or translation.
        return _spamOutcome(true, report_data, { moved: report_data.moved });

    } catch (error) {
        console.error("[ThunderAI] Error generating spam report:", error);
        // A config error is shown but not stored, so a later check runs again once the
        // settings are fixed. Nothing is left "in progress": the registry drops the entry.
        let err_data = { spamValue: -999, explanation: error.message || String(error) };
        if (!error.isConfigError) {
            try {
                err_data = await spamReport.saveError(headerMessageId, error.message || String(error), message_metadata || {});
            } catch (e) {
                taLog.error("[ThunderAI | SpamFilter] Could not store the error for " + headerMessageId + ": " + e);
            }
        }
        await updateSpamPanel(headerMessageId, "showSpamReport", err_data);
        return _spamOutcome(false, err_data);
    }
}

// messageId is optional — a numeric message id, when the caller has one. See _resolveMessage().
async function _openSummaryWebchat(headerMessageId, tabId, messageId = null) {
    try {
        const curr_message = await _resolveMessage(headerMessageId, messageId, tabId);
        if (!curr_message) {
            console.error("[ThunderAI] _openSummaryWebchat: Message not found for headerMessageId:", headerMessageId);
            return;
        }

        const curr_message_full = await browser.messages.getFull(curr_message.id);

        const summarize_prompt = await getSummarizePrompt();
        const connectionType = getConnectionType(await mztaPrefs.getAllPrefs(), summarize_prompt, 'summarize');
        // Not just chatgpt_web: an empty connection is equally unusable.
        if (!isApiUsableConnection(connectionType)) {
            const errorMsg = browser.i18n.getMessage('summarize_chatgpt_web_not_supported');
            await summaryStore.saveError(headerMessageId, errorMsg);
            await _sendIfCurrent(tabId, headerMessageId, { command: "showSummary", data: { error: true, message: errorMsg } });
            return;
        }

        taLog.log("[ThunderAI] Summary webchat: building the prompt for " + curr_message.headerMessageId + " (folder: " + curr_message.folder?.path + ")");
        const { promptText, promptInfo } = await taPromptUtils.buildSummaryPrompt([{ message: curr_message, fullMessage: curr_message_full }]);
        promptInfo.headerMessageId = headerMessageId;
        promptInfo.summaryTabId = tabId;

        openChatGPT(promptText, promptInfo.action, tabId, promptInfo.name, promptInfo.need_custom_text, promptInfo);
    } catch (error) {
        console.error("[ThunderAI] Error opening summary webchat:", error);
    }
}

// Listen for messages from ThunderAI-Sparks
browser.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'reload_menus':
            return _reload_menus();
            break;
    }
});

async function openChatGPT(promptText, action, curr_tabId, prompt_name = '', do_custom_text = 0, prompt_info = {}) {
    let prefs = await mztaPrefs.getAllPrefs();
    taLog.changeDebug(prefs.do_debug);
    prefs = checkScreenDimensions(prefs);
    //console.log(">>>>>>>>>>>>>>>> prefs: " + JSON.stringify(prefs));
    // console.log(">>>>>>>>>>>>>>>> prompt_info: " + JSON.stringify(prompt_info));

    // A special prompt (the summary opened in the chat window) resolves its connection with its
    // feature prefix, exactly as the caller's usability check did: without it the
    // {prefix}_use_specific_integration / {prefix}_connection_type pair is ignored, and the window
    // could open on a connection other than the one checked. null for any other prompt.
    prefs.connection_type = getConnectionType(prefs, prompt_info, getSpecialPromptPrefix(prompt_info.id));
    // The configuration checks below must judge what the window will run: the prompt's own
    // provider override on top of the global values, by the rule api_webchat/controller.js
    // applies. Only those checks read `prefs` for provider fields; the window loads its own.
    prefs = applyPromptConnection(prefs, prompt_info);

    taLog.log("Prompt length: " + promptText.length);
    let _max_prompt_length = prefs.max_prompt_length;
    if(prefs.connection_type == 'chatgpt_web'){
        _max_prompt_length = prefs_default.max_prompt_length;
    }
    if((_max_prompt_length > 0) && (promptText.length > _max_prompt_length)){
        // Prompt too long
        let tabs = await browser.tabs.query({ active: true, currentWindow: true });
        sendTabMessageSafe(curr_tabId, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage('msg_prompt_too_long') });
        return;
    }

    let mailMessage = await browser.messageDisplay.getDisplayedMessage(curr_tabId);

    switch(prefs.connection_type){
        case 'chatgpt_web':
        {
            // We are using the ChatGPT web interface

            let rand_call_id = '_chatgptweb_' + generateCallID();
            let call_opt = '';

            let _wait_time = prefs.chatgpt_web_load_wait_time;
            let _base_url = "https://chatgpt.com";
            let _webproject_set = false;
            let _custom_gpt_set = false;
            let _use_prompt_info_custom_gpt = false;
            prompt_info.chatgpt_web_model = typeof prompt_info.chatgpt_web_model === 'undefined' ? '' : prompt_info.chatgpt_web_model.trim();
            prompt_info.chatgpt_web_project = typeof prompt_info.chatgpt_web_project === 'undefined' ? '' : prompt_info.chatgpt_web_project.trim();
            prompt_info.chatgpt_web_custom_gpt = typeof prompt_info.chatgpt_web_custom_gpt === 'undefined' ? '' : prompt_info.chatgpt_web_custom_gpt.trim();
            let _custom_model = sanitizeChatGPTModelData(prompt_info.chatgpt_web_model != '' ? prompt_info.chatgpt_web_model : prefs.chatgpt_web_model);
            let _web_project = sanitizeChatGPTWebCustomData(prompt_info.chatgpt_web_project != '' ? prompt_info.chatgpt_web_project : prefs.chatgpt_web_project)
            let _custom_gpt = sanitizeChatGPTWebCustomData(prompt_info.chatgpt_web_custom_gpt != '' ? prompt_info.chatgpt_web_custom_gpt : prefs.chatgpt_web_custom_gpt)

            if(prefs.chatgpt_web_tempchat){
                call_opt += '&temporary-chat=true';
            }

            if((prompt_info.chatgpt_web_model != '') || (prefs.chatgpt_web_model != '')){
                call_opt += '&model=' + _custom_model;
            }

            taLog.log("[chatgpt_web] call_opt: " + call_opt);

            // If there is a custom gpt on the prompt, but also a web_project on the prefs, we need to use the custom gpt
            _use_prompt_info_custom_gpt = (prompt_info.chatgpt_web_custom_gpt != '' && prompt_info.chatgpt_web_project == '');

            if(!_use_prompt_info_custom_gpt && ((prompt_info.chatgpt_web_project != '') || (prefs.chatgpt_web_project != ''))){
                _base_url += _web_project;
                _webproject_set = true;
                _wait_time += 1000;
            }
            if(!_webproject_set && ((prompt_info.chatgpt_web_custom_gpt != '') || (prefs.chatgpt_web_custom_gpt != ''))){
                _base_url += _custom_gpt;
                _custom_gpt_set = true;
            }

            let win_options = {
                url: _base_url + "?call_id=" + rand_call_id + call_opt,
                type: "popup",
            }
            
            applyWindowPositionAndSize(win_options, prefs);

            const listener = (message, sender, sendResponse) => {
                async function handleChatGptWeb(createdTab) {
                    taLog.log("ChatGPT web interface script started...");

                    let _gpt_model = getGPTWebModelString(_custom_model);

                    taLog.log("_custom_model: " + _custom_model);
                    taLog.log("_gpt_model: " + _gpt_model);

                    let originalText = prompt_info.selection_text;
                    if((originalText == null) || (originalText == "")) {
                        originalText = prompt_info.body_text;
                    }
                    let reply_type_pref = await mztaPrefs.getPrefs(['reply_type']);
                    //console.log(">>>>>>>>>> prompt_info: " + JSON.stringify(prompt_info));
                    let pre_script = `let mztaWinId = `+ createdTab.windowId +`;
                    let mztaStatusPageDesc="`+ browser.i18n.getMessage("prefs_status_page") +`";
                    let mztaForceCompletionDesc="`+ browser.i18n.getMessage("chatgpt_force_completion") +`";
                    let mztaForceCompletionTitle="`+ browser.i18n.getMessage("chatgpt_force_completion_title") +`";
                    let mztaDoCustomText="`+ do_custom_text +`";
                    let mztaPromptName="[`+ i18nConditionalGet(prompt_name) +`]";
                    let mztaPhDefVal="`+(prefs.placeholders_use_default_value?'1':'0')+`";
                    let mztaGPTModel="`+ (_custom_gpt_set ? '' : _gpt_model) +`";
                    let mztaDoDebug="`+(prefs.do_debug?'1':'0')+`";
                    let mztaUseDiffViewer="`+(prompt_info.use_diff_viewer=='1'?'1':'0')+`";
                    let mztaOriginalText="`+ JSON.stringify(originalText).slice(1, -1) +`";
                    let mztaReplyType="`+ reply_type_pref.reply_type + `";
                    let mztaReadyReason=`+ JSON.stringify(String(message.readyReason)) +`;
                    let mztaReadyStateAtSend=`+ JSON.stringify(String(message.readyStateAtSend)) +`;
                    let mztaLoadWaitMs=`+ JSON.stringify(Number(_wait_time)) +`;
                    `;

                    taLog.log("pre_script: " + pre_script);
                    taLog.log("Waiting " + _wait_time + " millisec (readyReason " + message.readyReason + ")");
                    await new Promise(resolve => setTimeout(resolve, _wait_time));
                    taLog.log("Waiting " + _wait_time + " millisec done");

                    // document_start: the default document_idle would wait for the document to finish loading (issue #924)
                    await browser.tabs.executeScript(createdTab.id, { code: pre_script + mzta_script, matchAboutBlank: false, runAt: "document_start" });
                    // let mailMessage = await browser.messageDisplay.getDisplayedMessage(curr_tabId);
                    let mailMessageId = -1;
                    if(mailMessage) mailMessageId = mailMessage.id;
                    promptText = convertNewlinesToParagraphs(promptText);
                    browser.tabs.sendMessage(createdTab.id, { command: "chatgpt_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId, prompt_info: prompt_info});
                    taLog.log('[ChatGPT Web] Connection succeded!');
                    taLog.log("[ThunderAI] ChatGPT Web script injected successfully");
                    browser.runtime.onMessage.removeListener(listener);
                }
            
                if (message.command === "chatgpt_web_ready_" + rand_call_id) {
                    taLog.log("[chatgpt_web] Page ready: reason " + message.readyReason + ", loaderStartMs " + Math.round(message.loaderStartMs) + ", readySentMs " + Math.round(message.readySentMs) + ", readyStateAtSend " + message.readyStateAtSend);
                    return handleChatGptWeb(sender.tab)
                }
                return false;
            }

            browser.runtime.onMessage.addListener(listener);
            await browser.windows.create(win_options);
        }
        break;  // chatgpt_web - END

        case 'chatgpt_api':
        {
         // We are using the ChatGPT API

            let rand_call_id2 = '_openai_' + generateCallID();

            const listener2 = (message, sender, sendResponse) => {

                function handleChatGptApi(createdTab) {
                    let mailMessageId2 = -1;
                    if(mailMessage) mailMessageId2 = mailMessage.id;

                    // check if the config is present, or give a message error
                    if (prefs.chatgpt_api_key == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('chatgpt_empty_apikey')});
                        return;
                    }
                    if (prefs.chatgpt_model == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('chatgpt_empty_model')});
                        return;
                    }
                    //console.log(">>>>>>>>>> sender: " + JSON.stringify(sender));
                    browser.tabs.sendMessage(createdTab.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId2, do_custom_text: do_custom_text, prompt_info: prompt_info});
                    taLog.log('[OpenAI ChatGPT] Connection succeded!');
                    browser.runtime.onMessage.removeListener(listener2);
                }

                if (message.command === "chatgpt_api_ready_"+rand_call_id2) {
                    return handleChatGptApi(sender.tab);
                }
                return false;
            }

            browser.runtime.onMessage.addListener(listener2);

            let win_options2 = {
                url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id2+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')+'&prompt_id='+encodeURIComponent(prompt_info.id) + '&prompt_name=' + encodeURIComponent(i18nConditionalGet(prompt_info.name))),
                type: "popup",
            }

            applyWindowPositionAndSize(win_options2, prefs);

            await browser.windows.create(win_options2);
        }
        break;  // chatgpt_api - END

        case 'google_gemini_api':
        {
            // We are using the Google Gemini API

            let rand_call_id5 = '_google_gemini_' + generateCallID();

            const listener5 = (message, sender, sendResponse) => {

                function handleChatGptApi(createdTab) {
                    let mailMessageId5 = -1;
                    if(mailMessage) mailMessageId5 = mailMessage.id;

                    // check if the config is present, or give a message error
                    if (prefs.google_gemini_api_key == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('google_gemini_empty_apikey')});
                        return;
                    }
                    if (prefs.google_gemini_model == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('google_gemini_empty_model')});
                        return;
                    }
                    //console.log(">>>>>>>>>> sender: " + JSON.stringify(sender));
                    browser.tabs.sendMessage(createdTab.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId5, do_custom_text: do_custom_text, prompt_info: prompt_info});
                    taLog.log('[Google Gemini] Connection succeded!');
                    browser.runtime.onMessage.removeListener(listener5);
                }

                if (message.command === "google_gemini_api_ready_"+rand_call_id5) {
                    return handleChatGptApi(sender.tab);
                }
                return false;
            }

            browser.runtime.onMessage.addListener(listener5);

            let win_options5 = {
                url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id5+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')+'&prompt_id='+encodeURIComponent(prompt_info.id) + '&prompt_name=' + encodeURIComponent(i18nConditionalGet(prompt_info.name))),
                type: "popup",
            }

            applyWindowPositionAndSize(win_options5, prefs);

            await browser.windows.create(win_options5);
        }
        break;  // google_gemini_api - END

        case 'ollama_api':
        {
             // We are using the Ollama API

            taLog.log("Ollama API window opening...");

            let rand_call_id3 = '_ollama_' + generateCallID();

            const listener3 = (message, sender, sendResponse) => {

                function handleOllamaApi(createdTab3) {
                    taLog.log("Ollama API window ready.");
                    taLog.log("message.window_id: " + message.window_id)
                    taLog.log("createdTab3.id: " + createdTab3.id)
                    // let mailMessage3 = await browser.messageDisplay.getDisplayedMessage(curr_tabId);
                    let mailMessageId3 = -1;
                    if(mailMessage) mailMessageId3 = mailMessage.id;
                    taLog.log("mailMessageId3: " + mailMessageId3)
            
                    // check if the config is present, or give a message error
                    if (prefs.ollama_host == '') {
                        browser.tabs.sendMessage(createdTab3.id, { command: "api_error", error: browser.i18n.getMessage('ollama_empty_host')});
                        return;
                    }
                    if (prefs.ollama_model == '') {
                        browser.tabs.sendMessage(createdTab3.id, { command: "api_error", error: browser.i18n.getMessage('ollama_empty_model')});
                        return;
                    }
                    browser.tabs.sendMessage(createdTab3.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId3, do_custom_text: do_custom_text, prompt_info: prompt_info});
                    taLog.log('[Ollama API] Connection succeded!');
                    browser.runtime.onMessage.removeListener(listener3);
                }

                if (message.command === "ollama_api_ready_"+rand_call_id3) {
                    return handleOllamaApi(sender.tab);
                }else{
                    return false;
                }
            }

            browser.runtime.onMessage.addListener(listener3);

            let win_options3 = {
                url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id3+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')+'&prompt_id='+encodeURIComponent(prompt_info.id) + '&prompt_name=' + encodeURIComponent(i18nConditionalGet(prompt_info.name))),
                type: "popup",
            }

            applyWindowPositionAndSize(win_options3, prefs);

            await browser.windows.create(win_options3);

        }
        break;  // ollama_api - END

        case 'openai_comp_api':
        {
            // We are using the OpenAI Comp API
    
            let rand_call_id4 = '_openai_comp_api_' + generateCallID();

    
            const listener4 = (message, sender, sendResponse) => {

                function handleOpenAICompApi(createdTab) {
                    let mailMessageId4 = -1;
                    if(mailMessage) mailMessageId4 = mailMessage.id;
    
                    // check if the config is present, or give a message error
                    if (prefs.openai_comp_host == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('OpenAIComp_empty_host')});
                        return;
                    }
                    if (prefs.openai_comp_model == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('OpenAIComp_empty_model')});
                        return;
                    }
    
                    browser.tabs.sendMessage(createdTab.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId4, do_custom_text: do_custom_text, prompt_info: prompt_info});
                    taLog.log('[OpenAI Comp API] Connection succeded!');
                    browser.runtime.onMessage.removeListener(listener4);
                }

                if (message.command === "openai_comp_api_ready_"+rand_call_id4) {
                    return handleOpenAICompApi(sender.tab);
                }
                return false;
            }
    
            browser.runtime.onMessage.addListener(listener4);

            let win_options4 = {
                url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id4+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')+'&prompt_id='+encodeURIComponent(prompt_info.id) + '&prompt_name=' + encodeURIComponent(i18nConditionalGet(prompt_info.name))),
                type: "popup",
            }

            applyWindowPositionAndSize(win_options4, prefs);

            await browser.windows.create(win_options4);
        }
        break;  // openai_comp_api - END

        case 'anthropic_api':
        {
            // We are using the Anthropic API

            let rand_call_id6 = '_anthropic_' + generateCallID();

            const listener6 = (message, sender, sendResponse) => {

                function handleAnthropicApi(createdTab) {
                    let mailMessageId6 = -1;
                    if(mailMessage) mailMessageId6 = mailMessage.id;

                    // check if the config is present, or give a message error
                    if (prefs.anthropic_api_key == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('anthropic_empty_apikey')});
                        return;
                    }
                    if (prefs.anthropic_model == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('anthropic_empty_model')});
                        return;
                    }
                    if (prefs.anthropic_version == '') {
                        browser.tabs.sendMessage(createdTab.id, { command: "api_error", error: browser.i18n.getMessage('anthropic_empty_version')});
                        return;
                    }
                    //console.log(">>>>>>>>>> sender: " + JSON.stringify(sender));
                    browser.tabs.sendMessage(createdTab.id, { command: "api_send", prompt: promptText, action: action, tabId: curr_tabId, mailMessageId: mailMessageId6, do_custom_text: do_custom_text, prompt_info: prompt_info});
                    taLog.log('[OpenAI ChatGPT] Connection succeded!');
                    browser.runtime.onMessage.removeListener(listener6);
                }

                if (message.command === "anthropic_api_ready_"+rand_call_id6) {
                    return handleAnthropicApi(sender.tab);
                }
                return false;
            }

            browser.runtime.onMessage.addListener(listener6);

            let win_options6 = {
                url: browser.runtime.getURL('api_webchat/index.html?llm='+prefs.connection_type+'&call_id='+rand_call_id6+'&ph_def_val='+(prefs.placeholders_use_default_value?'1':'0')+'&prompt_id='+encodeURIComponent(prompt_info.id) + '&prompt_name=' + encodeURIComponent(i18nConditionalGet(prompt_info.name))),
                type: "popup",
            }

            applyWindowPositionAndSize(win_options6, prefs);

            await browser.windows.create(win_options6);
        }
        break;  // anthropic_api - END

        default:
            if(hasNoConnectionSelected(prefs.connection_type)){
                // No AI connection chosen yet: tell the user instead of failing silently,
                // and point them at the setup wizard.
                taLog.error("No AI connection selected.");
                let tabs_noconn = await browser.tabs.query({ active: true, currentWindow: true });
                sendTabMessageSafe(curr_tabId, { command: "sendAlert", curr_tab_type: tabs_noconn[0].type, message: browser.i18n.getMessage('msg_no_connection_selected') });
            }else{
                taLog.error("Unknown API connection type: " + prefs.connection_type);
            }
        break;
    }
}

function checkScreenDimensions(prefs){
    let width = window.screen.width - 50;
    let height = window.screen.height - 50;

    if(prefs.chatgpt_win_height > height) prefs.chatgpt_win_height = height - 50;
    if(prefs.chatgpt_win_width > width) prefs.chatgpt_win_width = width - 50;

    return prefs;
}

function applyWindowPositionAndSize(win_options, prefs){
    if((prefs.chatgpt_win_width != '') && (prefs.chatgpt_win_height != '') && (prefs.chatgpt_win_width != 0) && (prefs.chatgpt_win_height != 0)){
        win_options.width = prefs.chatgpt_win_width;
        win_options.height = prefs.chatgpt_win_height;
        taLog.log("Applying saved window dimensions: width=" + prefs.chatgpt_win_width + ", height=" + prefs.chatgpt_win_height);
    }
    // 0 is a position (the screen edge): see getSavedWindowPosition().
    const position = getSavedWindowPosition(prefs);
    if(position){
        win_options.top = position.top;
        win_options.left = position.left;
        taLog.log("Applying saved window position: top=" + position.top + ", left=" + position.left);
    }
    return win_options;
}

// A threshold of 0 ("flag everything") is a legitimate setting, so it must not be treated
// as missing — which is what the previous `prefs.x || prefs_init.x` did, silently
// substituting the default 70. Only a genuinely absent or non-numeric value falls back;
// an empty number input stores NaN as null, hence the isFinite() rather than a null check.
function getSpamThreshold(prefs) {
    return Number.isFinite(prefs.spamfilter_threshold) ? prefs.spamfilter_threshold : prefs_init.spamfilter_threshold;
}

function doGetSparkFeature(spark_feature_active) {
    if(spark_feature_active) {
        return (_sparks_presence == 1);
    } else {
        return false;
    }
}

async function reload_pref_init(){
    prefs_init = await mztaPrefs.getPrefs(Object.keys(PREFS_INIT_KEYS));
    // add_tags must be checked together with add_tags_auto, exactly as newEmailListener
    // does: otherwise every incoming mail wakes the whole pipeline for a no-op. Since the
    // reconciliation turns add_tags off without touching add_tags_auto, that combination
    // is now the common case rather than an edge case.
    _process_incoming = prefs_init.add_tags_auto || prefs_init.spamfilter || (prefs_init.summarize && prefs_init.summarize_auto === 3) || (prefs_init.translate && prefs_init.translate_auto === 3) || (prefs_init.summarize && prefs_init.summarize_auto_senders && hasAddressListEntries(prefs_init.summarize_auto_senders_list));
    _sparks_presence = await checkSparksPresence();
}


// Coalesce bursts of storage changes: a multi-key storage.local.set fires a single
// onChanged carrying several keys, and the options pages write one key per change
// event, so several events can land within a few milliseconds. menus.reload() tears
// down and rebuilds every menu, so overlapping rebuilds could interleave; a single
// trailing rebuild is enough, since rebuilding is idempotent.
// Same debounce idiom as pages/menu_order/mzta-menu-order.js.
let _storageChangeDebounce = null;
// Accumulated across every event in a burst: computing these per event and reading
// them after the debounce would let a later event's flags overwrite an earlier one's,
// silently dropping a needed menu rebuild.
let _prefsInitStale = false;
let _menusStale = false;

// Register the listener for storage changes
function setupStorageChangeListener() {
    browser.storage.onChanged.addListener((changes, areaName) => {
        // Preferences live in storage.local (see js/mzta-prefs.js), so this gate must name
        // that area: left on 'sync' the listener simply stops firing, with no error, and
        // prefs_init goes stale while the menus never rebuild on a settings change.
        if (areaName !== 'local') return;

        // A key the enterprise policy enforces cannot have meaningfully changed: whatever
        // landed in storage.local for it is shadowed on every read by the policy value, so
        // reacting would rebuild the menus and re-read prefs_init to arrive at exactly the
        // values already in use. Filtered rather than ignored downstream so a burst that
        // touches only locked keys costs nothing at all.
        // Note there is nothing to listen for on the managed area itself: Thunderbird
        // fires no change events for it, which is why a policy edit needs a restart.
        const changed_keys = Object.keys(changes).filter(key => !mztaManaged.isManagedLocked(key));
        if (changed_keys.length === 0) return;
        _prefsInitStale = _prefsInitStale || changed_keys.some(key => key in PREFS_INIT_KEYS);
        _menusStale = _menusStale || changed_keys.some(key => MENU_RELEVANT_KEYS.includes(key));
        if (!_prefsInitStale && !_menusStale) return;

        clearTimeout(_storageChangeDebounce);
        _storageChangeDebounce = setTimeout(() => {
            const do_prefs_init = _prefsInitStale;
            const do_menus = _menusStale;
            _prefsInitStale = false;
            _menusStale = false;
            // The snapshot must be refreshed first: the menus read storage directly,
            // but doGetSparkFeature() consults the _sparks_presence that
            // reload_pref_init() sets.
            (async () => {
                // Heal first: reload_pref_init() derives _process_incoming from these
                // flags and the menus are rebuilt from them, so both must see the
                // reconciled values rather than a stale true.
                // _reconcileFeatureFlags() writes back into storage.local, re-firing this
                // very listener. That is bounded, not a loop: it only ever flips flags
                // true -> false, so the follow-up pass finds nothing to disable and writes
                // nothing. The extra pass is useful anyway — it is what refreshes
                // prefs_init with the healed values.
                if (do_prefs_init || do_menus) await _reconcileFeatureFlags(await _readFeatureConnPrefs());
                if (do_prefs_init) await reload_pref_init();
                if (do_menus) await _reload_menus();
            })().catch(error => taLog.error("ERROR handling storage changes: ", error));
        }, 200);
        // storage.onChanged ignores listener return values, so the async work stays
        // inside the timer instead of being returned from here.
    });
}

// Call the function to set up the listener
setupStorageChangeListener();

// Register the listener for removed permissions
function setupPermissionsRemovedListener() {
    browser.permissions.onRemoved.addListener((permissions) => {
        // console.log(">>>>>>>>>>> Permissions onRemoved permissions: " + JSON.stringify(permissions));
        // Process 'tags' permissions removal
        if (["messagesTags", "messagesUpdate"].some(permission => permissions.permissions.includes(permission))) {
            // console.log(">>>>>>>>>>> Permissions onRemoved: tags");
            mztaPrefs.setPref('add_tags', false);
        }
        // Process 'spamfilter' permissions removal
        if (["messagesMove", "messagesUpdate"].some(permission => permissions.permissions.includes(permission))) {
            // console.log(">>>>>>>>>>> Permissions onRemoved: spamfilter");
            mztaPrefs.setPref('spamfilter', false);
        }
    });
}

// Call the function to set up the listener
setupPermissionsRemovedListener();

// Menus handling
// Guarded: see _prefs_migration_ok above. Running this with the flag missing would
// renumber every prompt and discard the user's custom menu ordering.
// Never fatal either, like the migration block above: on failure its flag stays unset and it
// runs again at the next start.
if (_prefs_migration_ok) await migrateMenuOrderAlphabetic().catch(e => console.error("[ThunderAI] migrateMenuOrderAlphabetic error: " + e));
const menus = new mzta_Menus(openChatGPT, prefs_init.do_debug);
await menus.loadMenus(await _computeActiveSpecialIds());

// Context menu click handling
// Context menus are now created dynamically by mzta_Menus.loadContextMenus()
// based on each prompt's show_in property. The menu item IDs use the format 'mzta-ctx-<prompt_id>'.
// Special prompts (add_tags, spamfilter, summarize, translate) are routed to processEmails()
// for batch processing. Regular prompts are executed via menus.executeMenuAction().
//
// The messages AND the UI tab of a special action must come from the same place: the tab
// the menu was opened in. info.selectedMessages is a snapshot of a message-list selection
// that is not bound to that tab (several mail tabs/windows, a right-click that does not
// move the selection, a selection still in transition), while processEmails() used to pick
// its UI tab with tabs.query({active, currentWindow}), i.e. the last focused window. When
// the two disagreed, the generating panel was drawn on the displayed message while another
// message, from another folder, was sent to the AI — and the result, correctly dropped by
// _sendIfCurrent(), never replaced the spinner. So the selection is read from the clicked
// tab (mailTabs.getSelectedMessages(tab.id)) and tab.id is passed down as sourceTabId.
// info.selectedMessages is kept only as a fallback when that call fails.

const specialContextMenuActions = {
    'prompt_add_tags': (messages, sourceTabId = null) => processEmails({ messages, addTagsAuto: true, sourceTabId }),
    'prompt_spamfilter': (messages, sourceTabId = null) => processEmails({ messages, spamFilter: true, sourceTabId }),
    'prompt_summarize': (messages, sourceTabId = null) => processEmails({ messages, summarize: true, sourceTabId }),
    'prompt_translate_this': (messages, sourceTabId = null) => processEmails({ messages, translate: true, sourceTabId }),
};

// Returns the MessageList a context-menu action must work on: the selection of the clicked
// tab, or info.selectedMessages when that cannot be read. Also writes one diagnostic log
// entry comparing the three views of "the message the user means" (only the first page of
// each MessageList is described), marked MISMATCH when they disagree.
async function _getClickSelection(info, tab) {
    const describe = (list) => (list?.messages || []).map(m => ({ id: m.id, headerMessageId: m.headerMessageId, folder: m.folder?.path }));

    let tabSelection = null;
    let displayed = null;
    if (tab?.id) {
        try {
            tabSelection = await browser.mailTabs.getSelectedMessages(tab.id);
        } catch (e) {
            taLog.log("menus.onClicked: mailTabs.getSelectedMessages(" + tab.id + ") failed, falling back to info.selectedMessages: " + e);
        }
        try {
            displayed = await browser.messageDisplay.getDisplayedMessage(tab.id);
        } catch (e) {
            taLog.log("menus.onClicked: messageDisplay.getDisplayedMessage(" + tab.id + ") failed: " + e);
        }
    }

    const infoDesc = describe(info.selectedMessages);
    const tabDesc = tabSelection ? describe(tabSelection) : null;
    const displayedDesc = displayed ? { id: displayed.id, headerMessageId: displayed.headerMessageId, folder: displayed.folder?.path } : null;

    const idsOf = (desc) => desc.map(d => d.headerMessageId).join('\n');
    let mismatch = false;
    if (tabDesc && idsOf(infoDesc) !== idsOf(tabDesc)) mismatch = true;
    const used = tabDesc || infoDesc;
    if (used.length === 1 && displayedDesc && displayedDesc.headerMessageId !== used[0].headerMessageId) mismatch = true;

    taLog.log("[ThunderAI] menus.onClicked " + (mismatch ? "MISMATCH " : "") + JSON.stringify({
        tab: { id: tab?.id, windowId: tab?.windowId, type: tab?.type },
        info_selectedMessages: infoDesc,
        mailTabs_getSelectedMessages: tabDesc,
        messageDisplay_getDisplayedMessage: displayedDesc,
        using: tabSelection ? 'mailTabs.getSelectedMessages' : 'info.selectedMessages'
    }));

    return tabSelection || info.selectedMessages;
}

browser.menus.onClicked.addListener(async (info, tab) => {
    const menuItemId = info.menuItemId;
    if (typeof menuItemId !== 'string' || !menuItemId.startsWith('mzta-ctx-')) {
        return;
    }
    const promptId = menuItemId.replace('mzta-ctx-', '');

    if (specialContextMenuActions[promptId]) {
        let selection = null;
        try {
            selection = await _getClickSelection(info, tab);
            await specialContextMenuActions[promptId](getMessages(selection), tab?.id);
        } catch (e) {
            taLog.error("Error in the context menu action " + promptId + ": " + (e?.message || e));
            // Only a single-message selection can have drawn a generating panel.
            const single = (selection?.messages?.length === 1 && !selection.id) ? selection.messages[0].headerMessageId : null;
            _clearGeneratingPanels(tab?.id, single);
        }
    } else {
        menus.executeMenuAction(promptId);
    }
});


// Listening for new received emails
const newEmailListener = (folder, messagesList) => {

    if(!_process_incoming){
        return;
    }

    taLog.log("New mail received");
    taLog.log(`Folder: ${folder.name}`);

    async function _newEmailListener(){
        let messages = getMessages(messagesList);

        let add_tags_auto_enabled = prefs_init.add_tags && prefs_init.add_tags_auto;

        await processEmails({
            messages: messages,
            addTagsAuto: add_tags_auto_enabled,
            spamFilter: prefs_init.spamfilter,
            summarizeOnReceive: prefs_init.summarize && prefs_init.summarize_auto === 3,
            summarizeSenders: (prefs_init.summarize && prefs_init.summarize_auto_senders) ? prefs_init.summarize_auto_senders_list : [],
            translateOnReceive: prefs_init.translate && prefs_init.translate_auto === 3,
            isAutoMode: true,
        });

        if(prefs_init.spamfilter){
            spamReport.truncReportData();
        }
    }

    return _newEmailListener();
}

// The listener scope is intentionally maximal: monitorAllFolders is always true.
// Several features need messages delivered anywhere and not just in the Inbox — the spam
// filter, summarize on receive, the summarize sender list, translate on receive, and
// add-tags on the sent folder — and subscribed IMAP folders not checked for new mail, or
// messages moved by a server-side filter, only surface with the full scope.
// monitorAllFolders was never a usable filter anyway: with false, Thunderbird still reports
// every *normal* (non-special-use) folder, so it could not keep auto processing inside the
// Inbox while it did hide folders some features need. The scope is therefore left wide and
// each feature narrows it itself, through its own per-message checks in processEmails()
// (add_tags_auto_only_inbox, spamfilter_only_inbox, the auto-skipped folder list, ...).
// _process_incoming in newEmailListener stays the cheap gate that avoids waking the whole
// pipeline when no automatic feature is enabled at all.
browser.messages.onNewMailReceived.addListener(newEmailListener, true);

async function showGenericError(errMsg, source) {
    let tabs = await browser.tabs.query({});
    for (const tab of tabs) {
        browser.tabs.sendMessage(tab.id, {
            command: "showGenericError",
            data: { message: errMsg, source: source }
        }).catch(() => {});
    }
}

// Like showGenericError(), but renders a blue informational panel (not an error).
async function showGenericInfo(infoMsg, source) {
    let tabs = await browser.tabs.query({});
    for (const tab of tabs) {
        browser.tabs.sendMessage(tab.id, {
            command: "showGenericInfo",
            data: { message: infoMsg, source: source }
        }).catch(() => {});
    }
}

// Spam panel update for every tab displaying the message, not just the active tab of the
// current window: the analysis may be running for a message open in another window, or in
// two places at once. _sendToTabsDisplaying() keeps the displayed-message check and the
// #901 quiet drop (the stored report renders the next time the pane is reachable).
async function updateSpamPanel(headerMessageId, command, data = null) {
    if (!prefs_init.spamfilter_show_msg_panel) return;
    let msg = { command: command };
    if (data) {
        msg.data = data;
    }
    await _sendToTabsDisplaying(headerMessageId, msg);
}

// Runs fn(item) over items with at most `limit` calls in flight: `limit` pull-based workers
// share one index, so a slow item never holds back the others. shouldStop() is checked
// before each item is taken, so a cancel keeps queued items from starting (the ones in
// flight finish, bounded by special_command_timeout). A throwing fn is logged and never
// stops the rest.
async function runWithConcurrency(items, limit, fn, shouldStop = () => false) {
    if (!items || items.length === 0) return;
    const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
    let next = 0;
    const worker = async () => {
        while (next < items.length && !shouldStop()) {
            const item = items[next++];
            try {
                await fn(item);
            } catch (err) {
                taLog.error("[ThunderAI] runWithConcurrency: an item failed: " + (err?.message || err));
            }
        }
    };
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);
}

// Reads the inline text parts of a message and converts them to plain text, preferring the
// HTML body. Used by the processEmails() pipeline (spam filter, add_tags).
async function _loadMessageBody(messageId) {
    const msg_text = await getMailInlineTextParts(messageId);
    taLog.log("Starting from the HTML body if present and converting to plain text...");
    let body_text = htmlBodyToPlainText(msg_text.html);
    if (body_text.length == 0) {
        taLog.log("No HTML found in the message body, using plain text...");
        body_text = cleanupNewlines(msg_text.text);
    }
    return { msg_text, body_text };
}

// A concurrency pref as a usable cap: a cleared number field is saved as NaN.
function _concurrencyCap(value, fallback) {
    return (Number.isFinite(value) && value >= 1) ? Math.floor(value) : fallback;
}

async function processEmails(args) {
    const {
        messages,
        addTagsAuto = false,
        spamFilter = false,
        summarize = false,
        summarizeOnReceive = false,
        summarizeSenders = [],
        translateOnReceive = false,
        translate = false,
        isAutoMode = false,
        // The tab the action was started from (context menu, shortcut). Used as the UI tab of
        // the summarize/translate flows; tabs.query({active, currentWindow}) is only the
        // fallback when absent — see the comment above specialContextMenuActions.
        sourceTabId = null,
    } = args;

    // Auto-summarize restricted to a sender list: the decision is per message, so only the
    // presence of a usable list can be checked here.
    const summarizeSendersActive = hasAddressListEntries(summarizeSenders);

    taWorkingStatus.startWorking();
    // This call's own cancel token: a Stop or a rate-limit stop cancels the batches active
    // at that moment, never one started afterwards (e.g. a manual Summarize right after).
    const batch = taBatchController.beginBatch();

    // Wrap the whole body so taWorkingStatus.stopWorking() always runs, even on a throw
    // (OOM, failed getFull, missing active tab, ...). Otherwise WorkingLevel stays > 0
    // and the toolbar icon would be stuck in the loading state forever.
    try {

    // One loop handles addTagsAuto, spamFilter, summarizeOnReceive/summarizeSenders, and
    // translateOnReceive (on email receive).
    // The separate summarize block below handles the context menu flow.

    if (addTagsAuto || spamFilter || summarizeOnReceive || summarizeSendersActive || translateOnReceive || translate) {
        let prefs_aats = await mztaPrefs.getPrefs([
            'add_tags_maxnum',
            'add_tags_max_messages',
            'connection_type',
            'add_tags_force_lang',
            'default_chatgpt_lang',
            'add_tags_auto_force_existing',
            'add_tags_enabled_accounts',
            'add_tags_exclusions_exact_match',
            'add_tags_auto_include_sent',
            'add_tags_auto_only_inbox',
            'add_tags_auto_uselist',
            'add_tags_auto_uselist_list',
            'spamfilter_enabled_accounts',
            'spamfilter_skip_addresses',
            'spamfilter_block_addresses',
            'spamfilter_skip_addressbook',
            'spamfilter_only_inbox',
            'batch_max_concurrency',
            ...Object.keys(getDynamicSettingsDefaults(['use_specific_integration', 'connection_type'])),
            'do_debug'
        ]);
        //  console.log(">>>>>>>>>>>>>>>> prefs_aats: " + JSON.stringify(prefs_aats));
        let spamfilter_skip_addresses = prefs_aats.spamfilter_skip_addresses;
        let spamfilter_block_addresses = prefs_aats.spamfilter_block_addresses;
        let spamfilter_skip_addressbook = prefs_aats.spamfilter_skip_addressbook;

        // The accounts the automatic runs are limited to: the stored selection, or the one a
        // policy resolves from {feature}_enabled_accounts_match, which replaces it. Resolved
        // once per batch, so an account added since the last batch is already covered.
        // `restricted` false means every account; true with an empty list means none.
        let addtags_accounts = (isAutoMode && addTagsAuto)
            ? await resolveEnabledAccounts('add_tags', prefs_aats.add_tags_enabled_accounts)
            : { restricted: false, accountIds: [] };
        let spamfilter_accounts = (isAutoMode && spamFilter)
            ? await resolveEnabledAccounts('spamfilter', prefs_aats.spamfilter_enabled_accounts)
            : { restricted: false, accountIds: [] };

        // Process in small chunks, yielding to the event loop between chunks so the
        // garbage collector can reclaim memory and the UI stays responsive on large selections.
        const CHUNK_SIZE = 5;
        let processedCount = 0;

        // Cap on a manual Add tags run (context menu), like summarize_max_messages: a large
        // selection launched by mistake could never fit in a free-tier daily quota. Automatic
        // tagging of incoming mail is not capped. The selection is collected (headers only)
        // just when a cap is set, since the paged message list can only be read once.
        let batchMessages = messages;
        const add_tags_max_messages = prefs_aats.add_tags_max_messages;
        if (addTagsAuto && !isAutoMode && Number.isFinite(add_tags_max_messages) && add_tags_max_messages > 0) {
            batchMessages = [];
            for await (let msg of messages) {
                batchMessages.push(msg);
            }
            if (batchMessages.length > add_tags_max_messages) {
                taLog.error("[ThunderAI] Add tags aborted: " + batchMessages.length + " messages selected, limit is " + add_tags_max_messages + ".");
                await showGenericError(
                    browser.i18n.getMessage('add_tags_too_many_messages', [String(batchMessages.length), String(add_tags_max_messages)]),
                    browser.i18n.getMessage('prompt_add_tags') || 'Add tags'
                );
                return;
            }
        }

        // Called when a request is refused with a 429 that outlived the per-request retries
        // (rate limit or used-up quota, see err.rateLimited in mzta_specialCommand). Every
        // following message would fail the same way, so the whole batch is stopped (queued
        // messages do not start, in-flight ones stop before their next feature) and the
        // outer finally tells the user why.
        const stopForRateLimit = (feature, retryAfterMs = null) => {
            taLog.error("[ThunderAI] " + feature + ": the AI provider refused the request (rate limit or quota exceeded"
                + (retryAfterMs !== null ? ", retry in " + Math.round(retryAfterMs / 1000) + " s" : "") + "), stopping the batch.");
            taBatchController.requestCancel('rate_limit', retryAfterMs);
        };

        // The AI work runs after the loop, one pipeline per message: the loop only applies the
        // per-message gating and collects one target per message (which features it needs),
        // then up to batch_max_concurrency messages run at once, each going through its
        // features in series - spam, add_tags, summary, translate. So every message is done as
        // soon as possible, and at most batch_max_concurrency AI calls are in flight. The cap
        // is per processEmails() call, so overlapping calls (several accounts receiving at
        // once) can exceed it.
        // Targets hold only the MessageHeader: the full message and body are fetched by the
        // pipeline itself, once for all its features, so memory is bounded by the cap and not
        // by the batch size.
        const batchCap = _concurrencyCap(prefs_aats.batch_max_concurrency, prefs_default.batch_max_concurrency);
        const targets = [];
        // The summary and translation stores are keyed on headerMessageId: one job per id.
        const summarizeTargetIds = new Set();
        const translateTargetIds = new Set();

        // The add_tags prompt and its connection are the same for the whole batch: resolved
        // once, the first time a message passes the add_tags gating, and only then (a batch
        // where no message gets that far never reads the prompt). A missing prompt or an
        // unusable connection skips add_tags for every message, logged once.
        let addTagsSetup = null;
        const resolveAddTagsSetup = () => {
            if (!addTagsSetup) {
                // Never rejects: a rejected memoized promise would throw into the loop's catch
                // for every message, costing the other features too.
                addTagsSetup = (async () => {
                    let prompt = null;
                    try {
                        prompt = await getAddTagsPrompt();
                    } catch (err) {
                        taLog.error("Auto add_tags: could not read the 'prompt_add_tags' special prompt, skipping: " + (err?.message || err));
                        return null;
                    }
                    if (!prompt) {
                        taLog.error("Auto add_tags: the 'prompt_add_tags' special prompt is missing, skipping. If you modified the special prompts, try restoring the default Add Tags prompt.");
                        return null;
                    }
                    // Same guard mzta-menus.js applies on the menu path: the auto/batch path
                    // reaches mzta_specialCommand without passing through it.
                    const conntype = getConnectionType(prefs_aats, prompt, 'add_tags');
                    if (!isApiUsableConnection(conntype)) {
                        console.error("[ThunderAI | Auto add_tags] Invalid connection type: " + conntype);
                        return null;
                    }
                    return { prompt, conntype };
                })();
            }
            return addTagsSetup;
        };

        for await (let message of batchMessages) {
            // Cooperative cancellation: bail out before doing any heavy work (getFull, ...)
            // if the user requested a stop. All break paths fall through to the outer finally.
            if (taBatchController.isCancelled(batch)) {
                taLog.log("[ThunderAI] Batch processing cancelled by user, stopping.");
                break;
            }

            // What this message needs, filled by the gating below.
            const target = { message, spam: false, addTags: false, summarize: false, bySender: false, translate: false };

            // Isolate per-message errors: a single problematic message must not abort the
            // whole batch. The loop only gates and collects targets, and the pipeline catches
            // its own failures; this catch is the last resort.
            try {

            // Auto add_tags, spam filter, summarize and translate must never run on messages
            // sitting in a junk/trash folder or in a folder the user writes into (drafts,
            // templates, outbox, sent). Add_tags gets its own evaluation because it can opt back
            // into the sent folder.
            let message_in_skipped_folder = isMessageInAutoSkippedFolder(message);
            let message_in_skipped_folder_tags = isMessageInAutoSkippedFolder(message, prefs_aats.add_tags_auto_include_sent);

            if (addTagsAuto) {
                let skipAddTags = false;
                if(isAutoMode && message_in_skipped_folder_tags){
                    taLog.log("Message in a folder excluded from the automatic processing, skipping add_tags...");
                    skipAddTags = true;
                }
                if(!skipAddTags && isAutoMode && addtags_accounts.restricted){
                    let accountId = message.folder.accountId;
                    if(!addtags_accounts.accountIds.includes(accountId)){
                        taLog.log("Account " + accountId + " not enabled for add_tags, skipping...");
                        skipAddTags = true;
                    }
                }
                // The listener monitors every folder, so this is the only check keeping the
                // automatic tagging inside the inbox: without it a message dropped in a normal
                // folder by a server-side filter would still be tagged.
                if(!skipAddTags && isAutoMode && prefs_aats.add_tags_auto_only_inbox){
                    const addtags_allowed_special_use = prefs_aats.add_tags_auto_include_sent ? ['inbox', 'sent'] : ['inbox'];
                    if(!messageFolderHasSpecialUse(message, addtags_allowed_special_use)){
                        taLog.log("Message not in " + addtags_allowed_special_use.join('/') + ", skipping add_tags (only-inbox mode)...");
                        skipAddTags = true;
                    }
                }
                if (!skipAddTags && !(await resolveAddTagsSetup())) {
                    skipAddTags = true;
                }
                target.addTags = !skipAddTags;
            }

            if (spamFilter) {
                let skipSpamFilter = false;
                if(isAutoMode && message_in_skipped_folder){
                    taLog.log("Message in a folder excluded from the automatic processing, skipping spamfilter...");
                    skipSpamFilter = true;
                }
                if(!skipSpamFilter && isAutoMode && spamfilter_accounts.restricted){
                    let accountId = message.folder.accountId;
                    if(!spamfilter_accounts.accountIds.includes(accountId)){
                        taLog.log("Account " + accountId + " not enabled for spamfilter, skipping...");
                        skipSpamFilter = true;
                    }
                }
                if(!skipSpamFilter && isAutoMode && prefs_aats.spamfilter_only_inbox){
                    if(!messageFolderHasSpecialUse(message, ['inbox'])){
                        taLog.log("Message not in inbox, skipping spamfilter (only-inbox mode)...");
                        skipSpamFilter = true;
                    }
                }
                target.spam = !skipSpamFilter;
            }

            // Summarize on receive, either for every message (summarize_auto === 3) or only for
            // the senders listed in summarize_auto_senders_list.
            let summarizeSenderMatch = summarizeSendersActive && matchAddressList(message.author, summarizeSenders);
            if (summarizeOnReceive || summarizeSenderMatch) {
                let skipSummarize = false;
                if (isAutoMode && message_in_skipped_folder) {
                    taLog.log("Message in a folder excluded from the automatic processing, skipping summarize...");
                    skipSummarize = true;
                }
                if (!skipSummarize && await _summarizeConnectionMissing()) {
                    taLog.log("[ThunderAI] No AI connection able to reach an API, skipping summarize on receive for: " + message.headerMessageId);
                    skipSummarize = true;
                }
                if (!skipSummarize && message.headerMessageId && !summarizeTargetIds.has(message.headerMessageId)) {
                    summarizeTargetIds.add(message.headerMessageId);
                    target.summarize = true;
                    target.bySender = !summarizeOnReceive;
                }
            }

            if (translateOnReceive || translate) {
                let skipTranslate = false;
                if (isAutoMode && message_in_skipped_folder) {
                    taLog.log("Message in a folder excluded from the automatic processing, skipping translate...");
                    skipTranslate = true;
                }
                if (!skipTranslate && message.headerMessageId && !translateTargetIds.has(message.headerMessageId)) {
                    translateTargetIds.add(message.headerMessageId);
                    target.translate = true;
                }
            }

            } catch (err) {
                taLog.error("Error processing message " + (message?.headerMessageId || message?.id) + ", skipping: " + (err?.message || err));
                continue;
            }

            // A message with work to do is counted as processed (taBatchController.tick()) by
            // its pipeline, so a batch stopped before it starts does not count it.
            if (target.spam || target.addTags || target.summarize || target.translate) {
                targets.push(target);
            } else {
                taBatchController.tick();
            }

            // Give the event loop (and GC) some breathing room every CHUNK_SIZE messages.
            processedCount++;
            if (processedCount % CHUNK_SIZE === 0) {
                await new Promise(r => setTimeout(r, 0));
                if (taBatchController.isCancelled(batch)) {
                    taLog.log("[ThunderAI] Batch processing cancelled by user (between chunks), stopping.");
                    break;
                }
            }
        }

        // Stops the pipelines as soon as the batch is cancelled: by the user, or by
        // stopForRateLimit(), which requests the cancel itself. Checked before each message is
        // taken (runWithConcurrency) and between the features of a message.
        const batchStopped = () => taBatchController.isCancelled(batch);

        // The manual Translate action delivers the result to the tab it was started from
        // (only for the message that tab displays, through _sendIfCurrent()); every tab
        // displaying a message also follows its job through the job's own broadcast
        // (_sendToTabsDisplaying()), so on receive, with a null tab, an open panel still
        // shows the progress and the result.
        let translateTabId = null;
        if (translate && targets.some(t => t.translate)) {
            translateTabId = sourceTabId;
            if (!translateTabId) {
                const tabs = await browser.tabs.query({ active: true, currentWindow: true });
                if (tabs.length > 0) {
                    translateTabId = tabs[0].id;
                }
            }
        }

        // add_tags for one message. Returns true when the batch was stopped by a rate limit.
        // One add_tags job per message (taJobRegistry): the context menu, the popup dialog
        // (js/mzta-menus.js) and this batch can reach the same message together. A job
        // already running is joined, with no second AI call: its tags are assigned by it
        // (auto / context menu) or confirmed by the user (dialog, data.assigned = false), so
        // a joiner never assigns anything. Once it ended, a new run is allowed again.
        const runAddTags = async (msg, fullMessage, body) => {
            const tags_job_id = msg.headerMessageId;
            let outcome;
            const running = tags_job_id ? taJobRegistry.get('add_tags', tags_job_id) : null;
            if (running) {
                taJobRegistry.logJoin(running);
                outcome = await running.promise;
            } else if (tags_job_id) {
                outcome = await taJobRegistry.start('add_tags', tags_job_id, () => runAddTagsJob(msg, fullMessage, body)).promise;
            } else {
                outcome = await runAddTagsJob(msg, fullMessage, body);
            }
            if (outcome.rateLimited) {
                // Tags are not assigned.
                stopForRateLimit('Add tags', outcome.retryAfterMs ?? null);
                return true;
            }
            return false;
        };

        // The add_tags work itself. Resolves to the job outcome.
        const runAddTagsJob = async (msg, fullMessage, body) => {
            const { prompt: curr_prompt_add_tags, conntype: addtags_conntype } = await resolveAddTagsSetup();
            let tags_full_list = await getTagsList();
            let chatgpt_lang = await taPromptUtils.getDefaultLang(curr_prompt_add_tags);
            let specialFullPrompt_add_tags = await taPromptUtils.preparePrompt({
                curr_prompt: curr_prompt_add_tags,
                curr_message: msg,
                chatgpt_lang: chatgpt_lang,
                body_text: body.body_text,
                subject_text: fullMessage.headers.subject,
                msg_text: body.msg_text,
                tags_full_list: tags_full_list
            });
            specialFullPrompt_add_tags = taPromptUtils.finalizePrompt_add_tags(specialFullPrompt_add_tags, prefs_aats.add_tags_maxnum, prefs_aats.add_tags_force_lang, prefs_aats.default_chatgpt_lang, prefs_aats.add_tags_auto_uselist, prefs_aats.add_tags_auto_uselist_list, prefs_aats.add_tags_auto_force_existing, tags_full_list[0], curr_prompt_add_tags.text);
            taLog.log("Special prompt: " + specialFullPrompt_add_tags);
            let cmd_addTags = new mzta_specialCommand({
                prompt: specialFullPrompt_add_tags,
                llm: addtags_conntype,
                custom_model: curr_prompt_add_tags.model ? curr_prompt_add_tags.model : '',
                do_debug: prefs_aats.do_debug,
                config: curr_prompt_add_tags
            });
            let tags_current_email = [];
            // Counted in WorkingLevel like the summary and translation calls, so the toolbar
            // icon reflects every AI call in flight, not just the batch.
            taWorkingStatus.startWorking();
            try {
                try {
                    await cmd_addTags.initWorker();
                } catch (err) {
                    if (err.isConfigError) {
                        await showGenericError(err.message, browser.i18n.getMessage('prompt_add_tags') || 'Add tags');
                    } else {
                        console.error("[ThunderAI | Auto add_tags] initWorker error: ", err);
                    }
                    return { status: 'error', errorMessage: err?.message || String(err) };
                }
                try {
                    tags_current_email = taPromptUtils.getTagsFromResponse(await cmd_addTags.sendPrompt(), prefs_aats.add_tags_auto_uselist, prefs_aats.add_tags_auto_uselist_list);
                } catch (err) {
                    console.error("[ThunderAI | Auto add_tags] Error getting tags: ", err);
                    if (err?.rateLimited) {
                        // Tags are not assigned; runAddTags() stops the batch.
                        return { status: 'error', errorMessage: err.message, rateLimited: true, retryAfterMs: err.retryAfterMs ?? null };
                    }
                }
            } finally {
                taWorkingStatus.stopWorking();
            }
            taLog.log("tags_current_email: " + JSON.stringify(tags_current_email));
            let _data = { messageId: msg.id, tags: tags_current_email };
            // Serialized with every other tag assignment, see _enqueueTagAssign().
            await _assign_tags(_data, !prefs_aats.add_tags_auto_force_existing, prefs_aats.add_tags_exclusions_exact_match);
            return { status: 'ok', data: { tags: tags_current_email, assigned: true } };
        };

        // One message through its features, in series. Spam first: a spam verdict can move
        // the message to the junk folder, which makes its tags, summary and translation
        // pointless. A fetch failure is local to the feature that needed the data (the next
        // feature retries the fetch once), and a thrown error is caught by runWithConcurrency.
        const runPipeline = async (target) => {
            // Read by the finally: declared above the try, valid from the start.
            const message = target.message;
            try {
                // The header the later features use: re-read after the spam step.
                let curr = message;
                let fullMessage = null;
                let body = null;
                const ensureFull = async () => {
                    if (!fullMessage) fullMessage = await browser.messages.getFull(curr.id);
                    return fullMessage;
                };
                const ensureBody = async () => {
                    if (!body) body = await _loadMessageBody(curr.id);
                    return body;
                };

                if (target.spam) {
                    let spamReady = false;
                    try {
                        // _buildReportMetadata() reads fullMessage.headers, so the spam report
                        // needs the full message too, not just the body.
                        await ensureFull();
                        await ensureBody();
                        spamReady = true;
                    } catch (err) {
                        taLog.error("[ThunderAI | SpamFilter] Could not read message " + message.headerMessageId + ", skipping the spam filter: " + (err?.message || err));
                    }
                    if (spamReady) {
                        const spamResult = await _generateSpamReportForMessage(
                            message.headerMessageId,
                            {
                                messageData: { message, fullMessage, body_text: body.body_text, msg_text: body.msg_text },
                                prefs: prefs_aats,
                                autoMove: true,
                                skip_addresses: spamfilter_skip_addresses,
                                block_addresses: spamfilter_block_addresses,
                                skip_addressbook: spamfilter_skip_addressbook
                            });
                        if (spamResult?.rateLimited) {
                            stopForRateLimit('Spam filter', spamResult.retryAfterMs);
                            return;
                        }
                        if (spamResult?.moved) {
                            taLog.log("[ThunderAI] " + message.headerMessageId + " was moved to the junk folder, skipping its other features.");
                            return;
                        }
                    }
                    if (!(target.addTags || target.summarize || target.translate) || batchStopped()) return;
                    // The analysis took a while: a filter or the user may have moved or deleted
                    // the message meanwhile (a moved message gets a new id, so get() fails).
                    try {
                        curr = await browser.messages.get(message.id);
                    } catch (err) {
                        curr = null;
                    }
                    if (!curr) {
                        taLog.log("[ThunderAI] " + message.headerMessageId + " is gone after the spam filter, skipping its other features.");
                        return;
                    }
                }

                if (target.addTags) {
                    if (isAutoMode && isMessageInAutoSkippedFolder(curr, prefs_aats.add_tags_auto_include_sent)) {
                        taLog.log("[ThunderAI] Add tags: " + curr.headerMessageId + " is now in an excluded folder, skipping.");
                    } else {
                        let tagsReady = false;
                        try {
                            await ensureFull();
                            await ensureBody();
                            tagsReady = true;
                        } catch (err) {
                            taLog.error("[ThunderAI | Auto add_tags] Could not read message " + curr.headerMessageId + ", skipping add_tags: " + (err?.message || err));
                        }
                        if (tagsReady) {
                            try {
                                if (await runAddTags(curr, fullMessage, body)) return;
                            } catch (err) {
                                taLog.error("[ThunderAI | Auto add_tags] Could not process message " + curr.headerMessageId + ", skipping add_tags: " + (err?.message || err));
                            }
                        }
                    }
                    if (batchStopped()) return;
                }

                if (target.summarize) {
                    if (isAutoMode && isMessageInAutoSkippedFolder(curr)) {
                        taLog.log("[ThunderAI] Summarize: " + curr.headerMessageId + " is now in an excluded folder, skipping.");
                    } else {
                        let summaryReady = false;
                        try {
                            await ensureFull();
                            summaryReady = true;
                        } catch (err) {
                            taLog.error("[ThunderAI] Summarize: could not read message " + curr.headerMessageId + ", skipping: " + (err?.message || err));
                        }
                        if (summaryReady) {
                            taLog.log("[ThunderAI] Pre-caching summary on receive for: " + curr.headerMessageId + (target.bySender ? " (sender in the auto-summarize list)" : ""));
                            const summaryResult = await _generateSummaryForMessage(curr.headerMessageId, null, {
                                messageData: { message: curr, fullMessage }
                            });
                            if (summaryResult?.rateLimited) {
                                stopForRateLimit('Summarize', summaryResult.retryAfterMs);
                                return;
                            }
                        }
                    }
                    if (batchStopped()) return;
                }

                if (target.translate) {
                    if (isAutoMode && isMessageInAutoSkippedFolder(curr)) {
                        taLog.log("[ThunderAI] Translate: " + curr.headerMessageId + " is now in an excluded folder, skipping.");
                        return;
                    }
                    try {
                        await ensureFull();
                    } catch (err) {
                        taLog.error("[ThunderAI | Translate] Could not read message " + curr.headerMessageId + ", skipping translate: " + (err?.message || err));
                        return;
                    }
                    taLog.log("[ThunderAI] Generating translation for: " + curr.headerMessageId);
                    // Joins a translation already running for this message (e.g. the user
                    // clicked the panel button while the message was queued). manual only for
                    // the context-menu action: the automatic batch never revives a job the
                    // user invalidated by deleting the translation.
                    const translateResult = await _generateTranslationForMessage(curr.headerMessageId, translateTabId, {
                        messageData: { message: curr, fullMessage },
                        manual: !isAutoMode
                    });
                    if (translateResult?.rateLimited) {
                        stopForRateLimit('Translate', translateResult.retryAfterMs);
                    }
                }
            } finally {
                taBatchController.tick();
            }
        };

        if (targets.length > 0 && !batchStopped()) {
            taLog.log("[ThunderAI] Processing " + targets.length + " message(s), up to " + batchCap + " at a time.");
            await runWithConcurrency(targets, batchCap, runPipeline, batchStopped);
        }
    }

    if (summarize && !taBatchController.isCancelled(batch)) {
        let summarize_prefs = await mztaPrefs.getPrefs([
            'summarize_display_mode',
            'summarize_max_messages'
        ]);

        // Collect messages into array to check count
        const messageArray = [];
        for await (let msg of messages) {
            messageArray.push(msg);
        }

        let tabId = sourceTabId;
        if (!tabId) {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            if (tabs.length === 0) {
                taLog.error("[ThunderAI] Summarize aborted: no active tab available.");
                return;
            }
            tabId = tabs[0].id;
        }

        // Inline mode for single message: generate inline summary in the message pane.
        // The pane may be unreachable - hidden via F8, nothing displayed, multi-message
        // view - and a plain tabs.sendMessage() to such a tab crashes inside
        // Thunderbird's ExtensionParent, killing the action with an uncaught rejection
        // and nothing shown to the user [#901]. The indicator send doubles as the
        // probe: when the pane cannot receive it, fall back to the webchat flow so the
        // action still produces something visible.
        // The indicator is message-aware (_sendGeneratingIfCurrent): when the tab displays
        // another message it is not drawn at all, and the summary is still generated
        // inline — silently, into the cache — rather than falling back to the webchat.
        let inline_ready = false;
        if (summarize_prefs.summarize_display_mode === 'inline' && messageArray.length === 1) {
            // Fire the inline loading indicator immediately, before any heavy work
            const gen = await _sendGeneratingIfCurrent(tabId, messageArray[0].headerMessageId, { command: "showSummaryGenerating", headerMessageId: messageArray[0].headerMessageId });
            if (!gen.current) {
                taLog.warn("[ThunderAI] Summarize: tab " + tabId + " does not display " + messageArray[0].headerMessageId + ", generating without the inline panel.");
            }
            inline_ready = gen.delivered || !gen.current;
        }
        if (inline_ready) {
            const msg = messageArray[0];
            const fullMessage = await browser.messages.getFull(msg.id);
            // manual: a summary job already running on this message (the batch) is joined,
            // and its result lands in this tab's panel.
            await _generateSummaryForMessage(msg.headerMessageId, tabId, {
                messageData: { message: msg, fullMessage },
                manual: true
            });
        } else {
            // Webchat mode, or inline with multiple messages / an unreachable message
            // pane (fallback to webchat).
            // Cap the number of messages to avoid building an unbounded prompt (memory / token blow-up).
            let max_messages = summarize_prefs.summarize_max_messages;
            if (Number.isFinite(max_messages) && max_messages > 0 && messageArray.length > max_messages) {
                taLog.error("[ThunderAI] Summarize aborted: " + messageArray.length + " messages selected, limit is " + max_messages + ".");
                await showGenericError(
                    browser.i18n.getMessage('summarize_too_many_messages', [String(messageArray.length), String(max_messages)]),
                    browser.i18n.getMessage('summarize_title')
                );
                return;
            }
            const messageDataArray = [];
            for (let curr_message of messageArray) {
                if (taBatchController.isCancelled(batch)) {
                    taLog.log("[ThunderAI] Summarize cancelled by user, stopping.");
                    return;
                }
                const fullMessage = await browser.messages.getFull(curr_message.id);
                messageDataArray.push({ message: curr_message, fullMessage });
            }
            taLog.log("[ThunderAI] Summarize webchat: building the prompt for " + JSON.stringify(messageDataArray.map(d => ({ headerMessageId: d.message.headerMessageId, folder: d.message.folder?.path }))));
            const { promptText, promptInfo } = await taPromptUtils.buildSummaryPrompt(messageDataArray);

            openChatGPT(promptText, promptInfo.action, tabId, promptInfo.name, promptInfo.need_custom_text, promptInfo);
        }
    }

    } finally {
        taWorkingStatus.stopWorking();
        // endBatch() returns a snapshot taken before the counters are reset. When the last
        // active batch exits because the user requested a cancel, notify how many messages
        // were processed before stopping. A stop caused by a rate limit / used-up quota is an
        // error, not a choice of the user, so it gets the red panel and says why.
        const batchResult = taBatchController.endBatch(batch);
        if (batchResult.lastExit && batchResult.cancelled && batchResult.reason === 'rate_limit') {
            // When the provider said how long to wait, the notice tells the user when to retry.
            await showGenericError(
                Number.isFinite(batchResult.retryAfterMs)
                    ? browser.i18n.getMessage('batch_stopped_retry_after', [String(batchResult.processed), formatDuration(batchResult.retryAfterMs)])
                    : browser.i18n.getMessage('batch_stopped_rate_limit', [String(batchResult.processed)]),
                browser.i18n.getMessage('batch_stop_source')
            );
        } else if (batchResult.lastExit && batchResult.cancelled) {
            await showGenericInfo(
                browser.i18n.getMessage('batch_stopped_notice', [String(batchResult.processed)]),
                browser.i18n.getMessage('batch_stop_source')
            );
        }
    }
}

// Inject script and CSS in all already open message tabs.
let openTabs = await messenger.tabs.query();
let messageTabs = openTabs.filter(
    tab => ["mail", "messageDisplay"].includes(tab.type)
);
for (let messageTab of messageTabs) {
    if((messageTab.url == undefined) || (["start.thunderbird.net","about:blank"].some(blockedUrl => messageTab.url.includes(blockedUrl)))) {
        continue;
    }
    try {
        // Same two files, same order, as the messageDisplayScripts.register above.
        await browser.tabs.executeScript(messageTab.id, {
            file: "js/lib/mzta-html-lines.js"
        })
        await browser.tabs.executeScript(messageTab.id, {
            file: "js/mzta-compose-script.js"
        })
    } catch (error) {
        console.error("[ThunderAI] Error injecting message display script:", error);
        console.error("[ThunderAI] Message tab:", messageTab.url);
    }
}
