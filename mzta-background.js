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
    getMailBody,
    extractJsonObject,
    sanitizeChatGPTModelData,
    sanitizeChatGPTWebCustomData,
    stripHtmlKeepLines,
    isPlainTextCompose,
    htmlBodyToPlainText,
    cleanupNewlines,
    convertNewlinesToParagraphs,
    getConnectionType,
    hasNoConnectionSelected,
    matchAddressList,
    hasAddressListEntries,
    extractEmail,
    messageFolderHasSpecialUse,
    isMessageInAutoSkippedFolder,
    isApiUsableConnection,
    hasSpecificIntegration,
     } from './js/mzta-utils.js';
import { taPromptUtils } from './js/mzta-utils-prompt.js';
import { mzta_specialCommand } from './js/mzta-special-commands.js';
import {
    getSpamFilterPrompt,
    getAddTagsPrompt,
    getSummarizePrompt,
    getTranslatePrompt,
    migrateMenuOrderAlphabetic,
    migrateEnabledToShowIn
} from './js/mzta-prompts.js';
import { taSpamReport } from './js/mzta-spamreport.js';
import { taSummaryStore } from './js/mzta-summarystore.js';
import { taTranslationStore } from './js/mzta-translationstore.js';
import { taWorkingStatus } from './js/mzta-working-status.js';
import { taBatchController } from './js/mzta-batch-controller.js';
import {
    addTags_getExclusionList,
    checkExcludedTag
} from './js/mzta-addtags-exclusion-list.js';

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

await migrateCustomPromptsStorage();
await migrateDefaultPromptsPropStorage();
await migrateEnabledToShowIn();

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
    ...Object.keys(getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']))
];

let prefs_init = {};
// Repair any feature flag left enabled on an unusable connection before anything derives
// from it: this is where a wizard run or a prefs import from a previous session gets
// healed, since no options page needs to be opened for it to happen.
await _reconcileFeatureFlags(await _readFeatureConnPrefs());
await reload_pref_init();

let taLog = new taLogger("mzta-background",prefs_init.do_debug);
taWorkingStatus.taLog = taLog;
taBatchController.taLog = taLog;
let spamReport = new taSpamReport(prefs_init.do_debug);
let summaryStore = new taSummaryStore(prefs_init.do_debug);
let translationStore = new taTranslationStore(prefs_init.do_debug);

browser.composeScripts.register({
    js: [{file: "/js/mzta-compose-script.js"}]
});

// Register the message display script for all newly opened message tabs.
messenger.messageDisplayScripts.register({
    js: [{ file: "js/mzta-compose-script.js" }]
});

browser.contentScripts.register({
    matches: ["https://*.chatgpt.com/*"],
    js: [{file: "js/mzta-chatgpt-loader.js"}],
    runAt: "document_idle"
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

function preparePopupMenu(tab) {
    let output = {};
    output.lastShortcutTabId = tab.id;
    output.lastShortcutTabType = tab.type;
    output.lastShortcutPromptsData = menus.shortcutMenu;
    output.lastShortcutFiltering = 0;
    switch (tab.type) {
        case "mail":
        case "messageDisplay":
            output.lastShortcutFiltering = 1;
            break;
        case "messageCompose":
            output.lastShortcutFiltering = 2;
            break;
        default:
            break;
    }
    // Snapshot of the batch processing state, so the popup can offer a "Stop processing"
    // button when a batch (auto add-tags / spamfilter / summarize / translate) is running.
    output.batchStatus = taBatchController.getStatus();
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
    return await browser.storage.sync.get({
        add_tags: prefs_default.add_tags,
        get_calendar_event: prefs_default.get_calendar_event,
        get_calendar_event_from_clipboard: prefs_default.get_calendar_event_from_clipboard,
        get_task: prefs_default.get_task,
        connection_type: prefs_default.connection_type,
        spamfilter: prefs_default.spamfilter,
        summarize: prefs_default.summarize,
        translate: prefs_default.translate,
        // Needed by getConnectionType() to resolve the per-feature override: without these
        // keys use_specific_integration reads as undefined and every feature silently falls
        // back to the global connection.
        ...getDynamicSettingsDefaults(['use_specific_integration', 'connection_type'])
    });
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
        await browser.storage.sync.set(to_disable);
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

async function _assign_tags(_data, create_new_tags = true, exclusions_exact_match = false) {
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
        if (create_new_tags && !checkIfTagLabelExists(tag, all_tags_list)) {
            taLog.log("Creating tag: " + tag);
            await createTag(tag);
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

                        let prefs = await browser.storage.sync.get({ summarize: prefs_default.summarize, summarize_auto: prefs_default.summarize_auto, summarize_display_mode: prefs_default.summarize_display_mode, summarize_max_display_length: prefs_default.summarize_max_display_length, summarize_strip_formatting: prefs_default.summarize_strip_formatting, summarize_auto_senders: prefs_default.summarize_auto_senders, summarize_auto_senders_list: prefs_default.summarize_auto_senders_list, connection_type: prefs_default.connection_type, ...getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']) });

                        if (!prefs.summarize) return;

                        let message = await browser.messageDisplay.getDisplayedMessage(tabId);
                        if (!message) return;

                        // Always show cached summary if available, regardless of summarize_auto
                        let cachedSummary = await summaryStore.loadSummary(message.headerMessageId);
                        if (cachedSummary && !cachedSummary.error) {
                            await _sendIfCurrent(tabId, message.headerMessageId, { command: "showSummary", data: { ...cachedSummary, maxDisplayLength: prefs.summarize_max_display_length, stripFormatting: prefs.summarize_strip_formatting } });
                            return;
                        }

                        if (await summaryStore.isProcessing(message.headerMessageId)) {
                            browser.tabs.sendMessage(tabId, { command: "showSummaryGenerating" });
                            return;
                        }

                        // Auto-summarize the senders in summarize_auto_senders_list. This is the
                        // second trigger of the feature: it catches the messages the
                        // onNewMailReceived listener never saw (subscribed IMAP folders that are
                        // not checked for new mail, or messages moved by a server-side filter).
                        // It runs after the cache and isProcessing() checks above, so a message
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
                                _generateSummaryForMessage(message.headerMessageId, tabId, { resolvedMessage: message });
                                return;
                            }
                        }
                        // storage.sync.get() only substitutes the default for *missing* keys, so a
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
                            _generateSummaryForMessage(message.headerMessageId, tabId, { resolvedMessage: message });
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
                _initSummary();
                break;
            case 'triggerSummaryGeneration':
                async function _triggerSummaryGeneration(message) {
                    let tabId = sender.tab.id;
                    // Fire the inline loading indicator immediately, before any await
                    browser.tabs.sendMessage(tabId, { command: "showSummaryGenerating" });
                    // No resolve hint: the content script sends only headerMessageId, so
                    // _resolveMessage lands on the tabId route (c) — the message the user
                    // just clicked on is the one this tab displays.
                    await _generateSummaryForMessage(message.headerMessageId, tabId);
                }
                _triggerSummaryGeneration(message);
                break;
            case 'triggerSummaryWebchat':
                async function _triggerSummaryWebchat(message) {
                    let tabId = sender.tab.id;
                    // Same as triggerSummaryGeneration: resolves via the tabId route (c).
                    await _openSummaryWebchat(message.headerMessageId, tabId);
                }
                _triggerSummaryWebchat(message);
                break;
            case 'generate_summary':
                async function _generate_summary(message) {
                    // Manual trigger: the content script supplies only headerMessageId
                    // (and message.tabId), so _resolveMessage uses the tabId route (c).
                    await _generateSummaryForMessage(message.headerMessageId, message.tabId);
                }
                _generate_summary(message);
                break;
            case 'refreshSummary':
                async function _refreshSummary(message) {
                    let tabId = sender.tab.id;
                    let prefs_refresh = await browser.storage.sync.get({ summarize_display_mode: prefs_default.summarize_display_mode });
                    if (prefs_refresh.summarize_display_mode === 'webchat') {
                        await summaryStore.removeSummary(message.headerMessageId);
                        // Resolves via the tabId route (c) — see triggerSummaryWebchat.
                        await _openSummaryWebchat(message.headerMessageId, tabId);
                    } else {
                        // Fire the inline loading indicator immediately, before any await
                        browser.tabs.sendMessage(tabId, { command: "showSummaryGenerating" });
                        await summaryStore.removeSummary(message.headerMessageId);
                        // Resolves via the tabId route (c) — see triggerSummaryGeneration.
                        await _generateSummaryForMessage(message.headerMessageId, tabId);
                    }
                }
                _refreshSummary(message);
                break;
            case 'removeSummary':
                summaryStore.removeSummary(message.headerMessageId);
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
                        let prefs_summary = await browser.storage.sync.get({
                            summarize_max_display_length: prefs_default.summarize_max_display_length,
                            summarize_strip_formatting: prefs_default.summarize_strip_formatting
                        });
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
                        let prefs = await browser.storage.sync.get({ translate: prefs_default.translate, translate_auto: prefs_default.translate_auto, translate_max_display_length: prefs_default.translate_max_display_length, connection_type: prefs_default.connection_type, ...getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']) });

                        if (!prefs.translate) return;

                        let message = await browser.messageDisplay.getDisplayedMessage(tabId);
                        if (!message) return;

                        // Always show cached translation if available, regardless of translate_auto
                        let cachedTranslation = await translationStore.loadTranslation(message.headerMessageId);
                        if (cachedTranslation && !cachedTranslation.error) {
                            await _sendIfCurrent(tabId, message.headerMessageId, { command: "showTranslation", data: { ...cachedTranslation, maxDisplayLength: prefs.translate_max_display_length } });
                            return;
                        }

                        if (await translationStore.isProcessing(message.headerMessageId)) {
                            browser.tabs.sendMessage(tabId, { command: "showTranslationGenerating" });
                            return;
                        }

                        // storage.sync.get() only substitutes the default for *missing* keys, so a
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
                            _generateTranslationForMessage(message.headerMessageId, tabId, { resolvedMessage: message });
                            return;
                        }

                        // Manual button mode (translate_auto === 1)
                        await _sendIfCurrent(tabId, message.headerMessageId, { command: "showTranslationButton", headerMessageId: message.headerMessageId });
                    } catch (e) {
                        taLog.error("Error in initTranslation: " + e);
                    }
                }
                _initTranslation();
                break;
            case 'triggerTranslationGeneration':
                async function _triggerTranslationGeneration(message) {
                    let tabId = sender.tab.id;
                    // Fire the inline loading indicator immediately, before any await
                    browser.tabs.sendMessage(tabId, { command: "showTranslationGenerating" });
                    let prefs_tl = await browser.storage.sync.get({
                        translate_lang: prefs_default.translate_lang,
                        default_chatgpt_lang: prefs_default.default_chatgpt_lang
                    });
                    const lang_tl = prefs_tl.translate_lang || prefs_tl.default_chatgpt_lang || '';
                    if (!lang_tl) {
                        let tabs = await browser.tabs.query({ active: true, currentWindow: true });
                        browser.tabs.sendMessage(tabId, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage('translate_no_language_configured') });
                        await _sendIfCurrent(tabId, message.headerMessageId, { command: "showTranslationButton", headerMessageId: message.headerMessageId });
                        return;
                    }
                    await _generateTranslationForMessage(message.headerMessageId, tabId);
                }
                _triggerTranslationGeneration(message);
                break;
            case 'refreshTranslation':
                async function _refreshTranslation(message) {
                    let tabId = sender.tab.id;
                    // Fire the inline loading indicator immediately, before any await
                    browser.tabs.sendMessage(tabId, { command: "showTranslationGenerating" });
                    await translationStore.removeTranslation(message.headerMessageId);
                    await _generateTranslationForMessage(message.headerMessageId, tabId);
                }
                _refreshTranslation(message);
                break;
            case 'removeTranslation':
                translationStore.removeTranslation(message.headerMessageId);
                break;
            case 'chatgpt_close':
                    async function _closeChatGptWindow(window_id) {
                        let prefs_close = await browser.storage.sync.get({chatgpt_win_save_position: prefs_default.chatgpt_win_save_position});
                        if(prefs_close.chatgpt_win_save_position){
                            try {
                                let winInfo = await browser.windows.get(window_id);
                                await browser.storage.sync.set({chatgpt_win_top: winInfo.top, chatgpt_win_left: winInfo.left});
                                taLog.log("Window position saved: top=" + winInfo.top + ", left=" + winInfo.left);
                            } catch(e) {
                                taLog.error("Error saving window position: " + e);
                            }
                        }
                        return browser.windows.remove(window_id).then(() => {
                            taLog.log("ChatGPT window closed successfully.");
                        }).catch((error) => {
                            taLog.error("Error closing ChatGPT window:", error);
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
                    let prefs_reply = await browser.storage.sync.get({reply_type: prefs_default.reply_type});
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
                        return specialContextMenuActions[message.promptId]([displayedMessage]);
                    }
                    return _shortcut_special();
                }
                return menus.executeMenuAction(message.promptId);
                break;
            case 'popup_menu_ready':
                async function _popup_menu_ready() {
                    let tabs = await browser.tabs.query({ active: true, currentWindow: true });
                    if(tabs.length == 0){
                        return false;
                    }
                    return preparePopupMenu(tabs[0]);
                    //return true;
                }
                return _popup_menu_ready();
                break;
            case 'assign_tags':
                async function _do_assign_tags(message) {
                    let prefs_assign_tags = await browser.storage.sync.get({add_tags_exclusions_exact_match: prefs_default.add_tags_exclusions_exact_match});
                    return _assign_tags(message,true, prefs_assign_tags.add_tags_exclusions_exact_match);
                }
                return _do_assign_tags(message);
                break;
            case 'api_send_custom_text':
                browser.tabs.sendMessage(message.tabId, { command: "api_send_custom_text", custom_text: message.custom_text });
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
                        let report = await spamReport.loadReportData(message.headerMessageId);
                        if (report) {
                            await _sendIfCurrent(tabId, message.headerMessageId, { command: "showSpamReport", data: report });
                        } else if (await spamReport.isProcessing(message.headerMessageId)) {
                            browser.tabs.sendMessage(tabId, { command: "showSpamCheckInProgress" });
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
                _generateSpamReportForMessage(message.headerMessageId, { tabId: sender.tab.id });
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
async function _sendIfCurrent(tabId, headerMessageId, payload) {
    try {
        if (!tabId) return;
        const current = await browser.messageDisplay.getDisplayedMessage(tabId);
        if (!current || current.headerMessageId !== headerMessageId) return; // stale — drop
        browser.tabs.sendMessage(tabId, payload);
    } catch (e) {
        taLog.error("Error in _sendIfCurrent: " + e);
    }
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
async function _resolveMessage(headerMessageId, messageId = null, tabId = null, resolvedMessage = null) {
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
// early matters because _generateSummaryForMessage() rejects it only after setProcessing(),
// persisting an error into summaryStore — an automatic run would poison the cache for a
// message the user never asked to summarize.
async function _summarizeConnectionMissing() {
    try {
        let prefs = await browser.storage.sync.get({
            connection_type: prefs_default.connection_type,
            ...getDynamicSettingsDefaults(['use_specific_integration', 'connection_type'])
        });
        const summarize_prompt = await getSummarizePrompt();
        return !isApiUsableConnection(getConnectionType(prefs, summarize_prompt, 'summarize'));
    } catch (e) {
        taLog.error("Error in _summarizeConnectionMissing: " + e);
        return true;   // on doubt, do not start an automatic generation
    }
}

// tabId is optional — if null, runs silently (background pre-cache, no UI update)
// options.messageData: { message, fullMessage } — pass pre-fetched data to avoid re-querying
// options.messageId: numeric message id, when the caller has one — see _resolveMessage()
// options.resolvedMessage: the message object the caller already holds (e.g. from
//   getDisplayedMessage) — the cheapest route, used by the auto-display paths. See _resolveMessage()
async function _generateSummaryForMessage(headerMessageId, tabId = null, options = {}) {
    try {
        let prefs = await browser.storage.sync.get({
            connection_type: prefs_default.connection_type,
            do_debug: prefs_default.do_debug,
            default_chatgpt_lang: prefs_default.default_chatgpt_lang,
            summarize_max_display_length: prefs_default.summarize_max_display_length,
            summarize_strip_formatting: prefs_default.summarize_strip_formatting,
            ...getDynamicSettingsDefaults(['use_specific_integration', 'connection_type'])
        });

        let cachedSummary = await summaryStore.loadSummary(headerMessageId);
        if (cachedSummary && !cachedSummary.error) {
            await _sendIfCurrent(tabId, headerMessageId, { command: "showSummary", data: { ...cachedSummary, maxDisplayLength: prefs.summarize_max_display_length, stripFormatting: prefs.summarize_strip_formatting } });
            return;
        }

        if (await summaryStore.isProcessing(headerMessageId)) {
            if (tabId) browser.tabs.sendMessage(tabId, { command: "showSummaryGenerating" });
            return;
        }

        await summaryStore.setProcessing(headerMessageId);
        taWorkingStatus.startWorking();
        if (tabId) browser.tabs.sendMessage(tabId, { command: "showSummaryGenerating" });

        let message, fullMessage;
        if (options.messageData) {
            message = options.messageData.message;
            fullMessage = options.messageData.fullMessage;
        } else {
            message = await _resolveMessage(headerMessageId, options.messageId, tabId, options.resolvedMessage);
            if (!message) {
                await summaryStore.saveError(headerMessageId, "Message not found");
                await _sendIfCurrent(tabId, headerMessageId, { command: "showSummary", data: { error: true, message: "Message not found" } });
                taWorkingStatus.stopWorking();
                return;
            }
            fullMessage = await browser.messages.getFull(message.id);
        }

        const summarize_prompt = await getSummarizePrompt();
        const connectionType = getConnectionType(prefs, summarize_prompt, 'summarize');

        // Not just chatgpt_web: an empty connection is equally unusable and was falling
        // through into mzta_specialCommand.
        if (!isApiUsableConnection(connectionType)) {
            const errorMsg = browser.i18n.getMessage('summarize_chatgpt_web_not_supported');
            await summaryStore.saveError(headerMessageId, errorMsg);
            await _sendIfCurrent(tabId, headerMessageId, { command: "showSummary", data: { error: true, message: errorMsg } });
            taWorkingStatus.stopWorking();
            return;
        }

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
        await summaryStore.saveSummary(summaryData, headerMessageId);
        await _sendIfCurrent(tabId, headerMessageId, { command: "showSummary", data: { ...summaryData, maxDisplayLength: prefs.summarize_max_display_length, stripFormatting: prefs.summarize_strip_formatting } });
        taWorkingStatus.stopWorking();

    } catch (error) {
        console.error("[ThunderAI] Error generating summary:", error);
        if (!error.isConfigError) await summaryStore.saveError(headerMessageId, error.message || String(error));
        await _sendIfCurrent(tabId, headerMessageId, { command: "showSummary", data: { error: true, message: error.message || "Failed to generate summary" } });
        taWorkingStatus.stopWorking();
    }
}

// tabId is optional — if null, runs silently (background pre-cache, no UI update)
// options.messageData: { fullMessage } — pass pre-fetched data to avoid re-querying
// options.messageId: numeric message id, when the caller has one — see _resolveMessage()
// options.resolvedMessage: the message object the caller already holds (e.g. from
//   getDisplayedMessage) — the cheapest route, used by the auto-display paths. See _resolveMessage()
async function _generateTranslationForMessage(headerMessageId, tabId = null, options = {}) {
    try {
        let prefs = await browser.storage.sync.get({
            connection_type: prefs_default.connection_type,
            do_debug: prefs_default.do_debug,
            default_chatgpt_lang: prefs_default.default_chatgpt_lang,
            translate_lang: prefs_default.translate_lang,
            translate_max_display_length: prefs_default.translate_max_display_length,
            ...getDynamicSettingsDefaults(['use_specific_integration', 'connection_type'])
        });

        let cachedTranslation = await translationStore.loadTranslation(headerMessageId);
        if (cachedTranslation && !cachedTranslation.error) {
            await _sendIfCurrent(tabId, headerMessageId, { command: "showTranslation", data: { ...cachedTranslation, maxDisplayLength: prefs.translate_max_display_length } });
            return;
        }

        const lang = prefs.translate_lang || prefs.default_chatgpt_lang || '';
        if (!lang) {
            taLog.warn("Translation skipped: no language configured (translate_lang and default_chatgpt_lang are both empty).");
            return;
        }

        if (await translationStore.isProcessing(headerMessageId)) {
            if (tabId) browser.tabs.sendMessage(tabId, { command: "showTranslationGenerating" });
            return;
        }

        await translationStore.setProcessing(headerMessageId);
        taWorkingStatus.startWorking();
        if (tabId) browser.tabs.sendMessage(tabId, { command: "showTranslationGenerating" });

        let fullMessage;
        if (options.messageData) {
            fullMessage = options.messageData.fullMessage;
        } else {
            const message = await _resolveMessage(headerMessageId, options.messageId, tabId, options.resolvedMessage);
            if (!message) {
                await translationStore.saveError(headerMessageId, "Message not found");
                await _sendIfCurrent(tabId, headerMessageId, { command: "showTranslation", data: { error: true, message: "Message not found" } });
                taWorkingStatus.stopWorking();
                return;
            }
            fullMessage = await browser.messages.getFull(message.id);
        }

        const translate_prompt = await getTranslatePrompt();
        const connectionType = getConnectionType(prefs, translate_prompt, 'translate');

        // Not just chatgpt_web: an empty connection is equally unusable and was falling
        // through into mzta_specialCommand.
        if (!isApiUsableConnection(connectionType)) {
            const errorMsg = browser.i18n.getMessage('translate_chatgpt_web_not_supported');
            await translationStore.saveError(headerMessageId, errorMsg);
            await _sendIfCurrent(tabId, headerMessageId, { command: "showTranslation", data: { error: true, message: errorMsg } });
            taWorkingStatus.stopWorking();
            return;
        }
        const { promptText } = await taPromptUtils.buildTranslationPrompt(fullMessage);

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
        await translationStore.saveTranslation(translationData, headerMessageId);
        await _sendIfCurrent(tabId, headerMessageId, { command: "showTranslation", data: { ...translationData, maxDisplayLength: prefs.translate_max_display_length } });
        taWorkingStatus.stopWorking();

    } catch (error) {
        console.error("[ThunderAI] Error generating translation:", error);
        if (!error.isConfigError) await translationStore.saveError(headerMessageId, error.message || String(error));
        await _sendIfCurrent(tabId, headerMessageId, { command: "showTranslation", data: { error: true, message: error.message || "Failed to generate translation" } });
        taWorkingStatus.stopWorking();
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

// options.messageData: { message, fullMessage, body_text, msg_text } — pass pre-fetched data to avoid re-querying
// options.messageId: numeric message id, when the caller has one — see _resolveMessage()
// options.tabId: only used to resolve the message (the panel finds its own tab) — see _resolveMessage()
// options.prefs: pass pre-fetched prefs to avoid re-querying
// options.autoMove: if true, move spam messages to junk folder (default: false)
async function _generateSpamReportForMessage(headerMessageId, options = {}) {
    // Declared outside the try so the final catch can still attach whatever
    // metadata was captured before the failure.
    let message_metadata = null;
    try {
        let prefs = options.prefs || await browser.storage.sync.get({
            connection_type: prefs_default.connection_type,
            do_debug: prefs_default.do_debug,
            default_chatgpt_lang: prefs_default.default_chatgpt_lang,
            spamfilter_threshold: prefs_default.spamfilter_threshold,
            ...getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']),
        });

        await spamReport.removeReportData(headerMessageId);
        await spamReport.setProcessing(headerMessageId);

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
                return { success: false };
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
                return { success: false };
            }
            message_metadata = _buildReportMetadata(message, curr_fullMessage);
            msg_text = await getMailBody(curr_fullMessage);
            body_text = htmlBodyToPlainText(msg_text.html);
            if (body_text.length == 0) {
                body_text = cleanupNewlines(msg_text.text);
            }
        }

        // Extract sender email for skip checks
        let senderEmail = extractEmail(message.author).toLowerCase();

        // Check if sender is in the skip addresses list.
        // hasAddressListEntries() is used instead of a plain length check because a list saved
        // by a previous version can still hold a stray '' (an emptied textarea was stored as
        // ['']), which would read as a configured list.
        let skip_addresses = options.skip_addresses || (await browser.storage.sync.get({spamfilter_skip_addresses: prefs_default.spamfilter_skip_addresses})).spamfilter_skip_addresses;
        if (hasAddressListEntries(skip_addresses)) {
            if (senderEmail && skip_addresses.includes(senderEmail)) {
                taLog.log("Sender " + senderEmail + " is in the skip addresses list, skipping spam filter.");
                let report_data = {};
                report_data.report_date = new Date();
                report_data.headerMessageId = headerMessageId;
                report_data.spamValue = 0;
                report_data.explanation = browser.i18n.getMessage('spamfilter_skip_addresses_explanation');
                report_data.subject = message_metadata.subject;
                report_data.from = message_metadata.from;
                report_data.message_date = message_metadata.message_date;
                report_data.moved = false;
                report_data.SpamThreshold = getSpamThreshold(prefs);
                spamReport.saveReportData(report_data, headerMessageId);
                await updateSpamPanel(headerMessageId, "showSpamReport", report_data);
                return { success: true };
            }
        }

        // Check if sender is in any address book
        let skip_addressbook = options.skip_addressbook !== undefined
            ? options.skip_addressbook
            : (await browser.storage.sync.get({spamfilter_skip_addressbook: prefs_default.spamfilter_skip_addressbook})).spamfilter_skip_addressbook;
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
                        let report_data = {};
                        report_data.report_date = new Date();
                        report_data.headerMessageId = headerMessageId;
                        report_data.spamValue = 0;
                        report_data.explanation = browser.i18n.getMessage('spamfilter_skip_addressbook_explanation');
                        report_data.subject = message_metadata.subject;
                        report_data.from = message_metadata.from;
                        report_data.message_date = message_metadata.message_date;
                        report_data.moved = false;
                        report_data.SpamThreshold = getSpamThreshold(prefs);
                        spamReport.saveReportData(report_data, headerMessageId);
                        await updateSpamPanel(headerMessageId, "showSpamReport", report_data);
                        return { success: true };
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
            return { success: false };
        }
        // The connection can be unusable even with spamfilter still true in storage (a
        // wizard run, a prefs import): without this the resolved type flowed straight into
        // mzta_specialCommand. setProcessing() already ran, so report the error through
        // spamReport instead of returning bare, or the panel would sit on "in progress".
        let spam_conntype = getConnectionType(prefs, curr_prompt_spamfilter, 'spamfilter');
        if (!isApiUsableConnection(spam_conntype)) {
            console.error("[ThunderAI | SpamFilter] Invalid connection type: " + spam_conntype);
            let err_data = await spamReport.saveError(headerMessageId, browser.i18n.getMessage('msg_no_connection_selected'), message_metadata || {});
            await updateSpamPanel(headerMessageId, "showSpamReport", err_data);
            return { success: false };
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
        await cmd_spamfilter.initWorker();

        let spamfilter_result = '';
        taLog.log("Sending the prompt...");
        try {
            spamfilter_result = (await cmd_spamfilter.sendPrompt()).trim();
        } catch (err) {
            console.error("[ThunderAI | SpamFilter] Error getting spamfilter: ", err);
            let err_data = await spamReport.saveError(headerMessageId, err.message || String(err), message_metadata || {});
            await updateSpamPanel(headerMessageId, "showSpamReport", err_data);
            return { success: false };
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
            return { success: false };
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

        if (options.autoMove && jsonObj.spamValue >= report_data.SpamThreshold) {
            taLog.log("Marking as spam [" + headerMessageId + "]");
            messenger.messages.update(message.id, { junk: true });
            let spamFolder = await messenger.folders.query({ accountId: message.folder.accountId, specialUse: ['junk'] });
            messenger.messages.move([message.id], spamFolder[0].id);
            report_data.moved = true;
            taLog.log("Marked as spam [" + headerMessageId + "]");
        }

        spamReport.saveReportData(report_data, headerMessageId);
        await updateSpamPanel(headerMessageId, "showSpamReport", report_data);
        return { success: true };

    } catch (error) {
        console.error("[ThunderAI] Error generating spam report:", error);
        if (error.isConfigError) {
            await updateSpamPanel(headerMessageId, "showSpamReport", { spamValue: -999, explanation: error.message || String(error) });
        } else {
            let err_data = await spamReport.saveError(headerMessageId, error.message || String(error), message_metadata || {});
            await updateSpamPanel(headerMessageId, "showSpamReport", err_data);
        }
        return { success: false };
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
        const connectionType = getConnectionType(await browser.storage.sync.get(prefs_default), summarize_prompt, 'summarize');
        // Not just chatgpt_web: an empty connection is equally unusable.
        if (!isApiUsableConnection(connectionType)) {
            const errorMsg = browser.i18n.getMessage('summarize_chatgpt_web_not_supported');
            await summaryStore.saveError(headerMessageId, errorMsg);
            await _sendIfCurrent(tabId, headerMessageId, { command: "showSummary", data: { error: true, message: errorMsg } });
            return;
        }

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
    let prefs = await browser.storage.sync.get(prefs_default);
    taLog.changeDebug(prefs.do_debug);
    prefs = checkScreenDimensions(prefs);
    //console.log(">>>>>>>>>>>>>>>> prefs: " + JSON.stringify(prefs));
    // console.log(">>>>>>>>>>>>>>>> prompt_info: " + JSON.stringify(prompt_info));

    prefs.connection_type = getConnectionType(prefs, prompt_info);

    taLog.log("Prompt length: " + promptText.length);
    let _max_prompt_length = prefs.max_prompt_length;
    if(prefs.connection_type == 'chatgpt_web'){
        _max_prompt_length = prefs_default.max_prompt_length;
    }
    if((_max_prompt_length > 0) && (promptText.length > _max_prompt_length)){
        // Prompt too long
        let tabs = await browser.tabs.query({ active: true, currentWindow: true });
        browser.tabs.sendMessage(curr_tabId, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage('msg_prompt_too_long') });
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
                    let reply_type_pref = await browser.storage.sync.get({ reply_type: prefs_default.reply_type });
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
                    `;

                    taLog.log("pre_script: " + pre_script);
                    taLog.log("Waiting " + _wait_time + " millisec");
                    await new Promise(resolve => setTimeout(resolve, _wait_time));
                    taLog.log("Waiting " + _wait_time + " millisec done");
                    
                    await browser.tabs.executeScript(createdTab.id, { code: pre_script + mzta_script, matchAboutBlank: false });
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
                browser.tabs.sendMessage(curr_tabId, { command: "sendAlert", curr_tab_type: tabs_noconn[0].type, message: browser.i18n.getMessage('msg_no_connection_selected') });
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
    if((prefs.chatgpt_win_top != '') && (prefs.chatgpt_win_left != '')){
        win_options.top = prefs.chatgpt_win_top;
        win_options.left = prefs.chatgpt_win_left;
        taLog.log("Applying saved window position: top=" + prefs.chatgpt_win_top + ", left=" + prefs.chatgpt_win_left);
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
    prefs_init = await browser.storage.sync.get(PREFS_INIT_KEYS);
    // add_tags must be checked together with add_tags_auto, exactly as newEmailListener
    // does: otherwise every incoming mail wakes the whole pipeline for a no-op. Since the
    // reconciliation turns add_tags off without touching add_tags_auto, that combination
    // is now the common case rather than an edge case.
    _process_incoming = prefs_init.add_tags_auto || prefs_init.spamfilter || (prefs_init.summarize && prefs_init.summarize_auto === 3) || (prefs_init.translate && prefs_init.translate_auto === 3) || (prefs_init.summarize && prefs_init.summarize_auto_senders && hasAddressListEntries(prefs_init.summarize_auto_senders_list));
    _sparks_presence = await checkSparksPresence();
}


// Coalesce bursts of storage changes: a multi-key storage.sync.set fires a single
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
        // Check if the change happened in the 'sync' storage area
        if (areaName !== 'sync') return;

        const changed_keys = Object.keys(changes);
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
                // _reconcileFeatureFlags() writes back into storage.sync, re-firing this
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
            browser.storage.sync.set({add_tags: false});
        }
        // Process 'spamfilter' permissions removal
        if (["messagesMove", "messagesUpdate"].some(permission => permissions.permissions.includes(permission))) {
            // console.log(">>>>>>>>>>> Permissions onRemoved: spamfilter");
            browser.storage.sync.set({spamfilter: false});
        }
    });
}

// Call the function to set up the listener
setupPermissionsRemovedListener();

// Menus handling
await migrateMenuOrderAlphabetic();
const menus = new mzta_Menus(openChatGPT, prefs_init.do_debug);
await menus.loadMenus(await _computeActiveSpecialIds());

// Context menu click handling
// Context menus are now created dynamically by mzta_Menus.loadContextMenus()
// based on each prompt's show_in property. The menu item IDs use the format 'mzta-ctx-<prompt_id>'.
// Special prompts (add_tags, spamfilter, summarize, translate) are routed to processEmails()
// for batch processing. Regular prompts are executed via menus.executeMenuAction().

const specialContextMenuActions = {
    'prompt_add_tags': (messages) => processEmails({ messages, addTagsAuto: true }),
    'prompt_spamfilter': (messages) => processEmails({ messages, spamFilter: true }),
    'prompt_summarize': (messages) => processEmails({ messages, summarize: true }),
    'prompt_translate_this': (messages) => processEmails({ messages, translate: true }),
};

browser.menus.onClicked.addListener((info, tab) => {
    const menuItemId = info.menuItemId;
    if (typeof menuItemId !== 'string' || !menuItemId.startsWith('mzta-ctx-')) {
        return;
    }
    const promptId = menuItemId.replace('mzta-ctx-', '');

    if (specialContextMenuActions[promptId]) {
        specialContextMenuActions[promptId](getMessages(info.selectedMessages));
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

async function updateSpamPanel(messageId, command, data = null) {
    if (prefs_init.spamfilter_show_msg_panel) {
        let tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
            let activeTab = tabs[0];
            let displayedMessage = await browser.messageDisplay.getDisplayedMessage(activeTab.id);
            if (displayedMessage && displayedMessage.headerMessageId === messageId) {
                let msg = { command: command };
                if (data) {
                    msg.data = data;
                }
                browser.tabs.sendMessage(activeTab.id, msg);
            }
        }
    }
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
    } = args;

    // Auto-summarize restricted to a sender list: the decision is per message, so only the
    // presence of a usable list can be checked here.
    const summarizeSendersActive = hasAddressListEntries(summarizeSenders);

    taWorkingStatus.startWorking();
    taBatchController.beginBatch();

    // Wrap the whole body so taWorkingStatus.stopWorking() always runs, even on a throw
    // (OOM, failed getFull, missing active tab, ...). Otherwise WorkingLevel stays > 0
    // and the toolbar icon would be stuck in the loading state forever.
    try {

    // One loop handles addTagsAuto, spamFilter, summarizeOnReceive/summarizeSenders, and
    // translateOnReceive (on email receive).
    // The separate summarize block below handles the context menu flow.

    if (addTagsAuto || spamFilter || summarizeOnReceive || summarizeSendersActive || translateOnReceive || translate) {
        let prefs_aats = await browser.storage.sync.get({
            add_tags_maxnum: prefs_default.add_tags_maxnum,
            connection_type: prefs_default.connection_type,
            add_tags_force_lang: prefs_default.add_tags_force_lang,
            default_chatgpt_lang: prefs_default.default_chatgpt_lang,
            add_tags_auto_force_existing: prefs_default.add_tags_auto_force_existing,
            add_tags_enabled_accounts: prefs_default.add_tags_enabled_accounts,
            add_tags_exclusions_exact_match: prefs_default.add_tags_exclusions_exact_match,
            add_tags_auto_include_sent: prefs_default.add_tags_auto_include_sent,
            add_tags_auto_only_inbox: prefs_default.add_tags_auto_only_inbox,
            add_tags_auto_uselist: prefs_default.add_tags_auto_uselist,
            add_tags_auto_uselist_list: prefs_default.add_tags_auto_uselist_list,
            spamfilter_enabled_accounts: prefs_default.spamfilter_enabled_accounts,
            spamfilter_skip_addresses: prefs_default.spamfilter_skip_addresses,
            spamfilter_skip_addressbook: prefs_default.spamfilter_skip_addressbook,
            spamfilter_only_inbox: prefs_default.spamfilter_only_inbox,
            ...getDynamicSettingsDefaults(['use_specific_integration', 'connection_type']),
            do_debug: prefs_default.do_debug,
        });
        //  console.log(">>>>>>>>>>>>>>>> prefs_aats: " + JSON.stringify(prefs_aats));
        let spamfilter_skip_addresses = prefs_aats.spamfilter_skip_addresses;
        let spamfilter_skip_addressbook = prefs_aats.spamfilter_skip_addressbook;

        // Process in small chunks, yielding to the event loop between chunks so the
        // garbage collector can reclaim memory and the UI stays responsive on large selections.
        const CHUNK_SIZE = 5;
        let processedCount = 0;

        for await (let message of messages) {
            // Cooperative cancellation: bail out before doing any heavy work (getFull, ...)
            // if the user requested a stop. All break paths fall through to the outer finally.
            if (taBatchController.isCancelled()) {
                taLog.log("[ThunderAI] Batch processing cancelled by user, stopping.");
                break;
            }

            let curr_fullMessage = null;
            let msg_text = null;
            let body_text = '';

            // Fetching the message and converting its body is expensive, so both are done
            // lazily and only once per message: every feature awaits the helper it needs
            // right before it actually uses the data, after all its own skip checks have
            // passed. A message discarded by those checks is never fetched at all.
            async function ensureFullMessage(){
                if (!curr_fullMessage) {
                    curr_fullMessage = await browser.messages.getFull(message.id);
                }
            }

            async function ensureBodyText(){
                await ensureFullMessage();
                if (msg_text) {
                    return;
                }
                msg_text = await getMailBody(curr_fullMessage);
                taLog.log("Starting from the HTML body if present and converting to plain text...");
                body_text = htmlBodyToPlainText(msg_text.html);
                if( body_text.length == 0 ){
                    taLog.log("No HTML found in the message body, using plain text...");
                    body_text = cleanupNewlines(msg_text.text);
                }
            }

            // Isolate per-message errors: a single problematic message must not abort the
            // whole batch. Inner try/catch blocks (add_tags, spamfilter, ...) are kept as-is.
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
                if(!skipAddTags && isAutoMode && prefs_aats.add_tags_enabled_accounts.length > 0){
                    let accountId = message.folder.accountId;
                    if(!prefs_aats.add_tags_enabled_accounts.includes(accountId)){
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
                let curr_prompt_add_tags = null;
                let addtags_conntype = '';
                if (!skipAddTags) {
                    curr_prompt_add_tags = await getAddTagsPrompt();
                    if (!curr_prompt_add_tags) {
                        taLog.error("Auto add_tags: the 'prompt_add_tags' special prompt is missing, skipping. If you modified the special prompts, try restoring the default Add Tags prompt.");
                        skipAddTags = true;
                    }
                }
                if (!skipAddTags) {
                    // Same guard mzta-menus.js applies on the menu path: the auto/batch path
                    // reaches mzta_specialCommand without passing through it. Skipping rather
                    // than returning, so the other features in this iteration still run.
                    addtags_conntype = getConnectionType(prefs_aats, curr_prompt_add_tags, 'add_tags');
                    if (!isApiUsableConnection(addtags_conntype)) {
                        console.error("[ThunderAI | Auto add_tags] Invalid connection type: " + addtags_conntype);
                        skipAddTags = true;
                    }
                }
                if (!skipAddTags) {
                    await ensureBodyText();
                    let specialFullPrompt_add_tags = '';
                    let tags_full_list = await getTagsList();
                    //  console.log(">>>>>>>>>>>>> curr_prompt_add_tags: " + JSON.stringify(curr_prompt_add_tags));
                    let chatgpt_lang = await taPromptUtils.getDefaultLang(curr_prompt_add_tags);
                    specialFullPrompt_add_tags = await taPromptUtils.preparePrompt({
                        curr_prompt: curr_prompt_add_tags,
                        curr_message: message,
                        chatgpt_lang: chatgpt_lang,
                        body_text: body_text,
                        subject_text: curr_fullMessage.headers.subject,
                        msg_text: msg_text,
                        tags_full_list: tags_full_list
                    });
                    specialFullPrompt_add_tags = taPromptUtils.finalizePrompt_add_tags(specialFullPrompt_add_tags, prefs_aats.add_tags_maxnum, prefs_aats.add_tags_force_lang, prefs_aats.default_chatgpt_lang, prefs_aats.add_tags_auto_uselist, prefs_aats.add_tags_auto_uselist_list);
                    taLog.log("Special prompt: " + specialFullPrompt_add_tags);
                    // console.log(">>>>>>>>>> curr_prompt_add_tags.model: " + curr_prompt_add_tags.model);
                    // console.log(">>>>>>>>>>>>>>>>> getConnectionType add_tags:" + addtags_conntype);
                    let cmd_addTags = new mzta_specialCommand({
                        prompt: specialFullPrompt_add_tags,
                        llm: addtags_conntype,
                        custom_model: curr_prompt_add_tags.model ? curr_prompt_add_tags.model : '',
                        do_debug: prefs_aats.do_debug,
                        config: curr_prompt_add_tags
                    });
                    let addTagsInitFailed = false;
                    try {
                        await cmd_addTags.initWorker();
                    } catch (err) {
                        addTagsInitFailed = true;
                        if (err.isConfigError) {
                            await showGenericError(err.message, browser.i18n.getMessage('prompt_add_tags') || 'Add tags');
                        } else {
                            console.error("[ThunderAI | Auto add_tags] initWorker error: ", err);
                        }
                    }
                    if (!addTagsInitFailed) {
                        let tags_current_email = [];
                        try {
                            tags_current_email = taPromptUtils.getTagsFromResponse(await cmd_addTags.sendPrompt(), prefs_aats.add_tags_auto_uselist, prefs_aats.add_tags_auto_uselist_list);
                        } catch (err) {
                            console.error("[ThunderAI | Auto add_tags] Error getting tags: ", err);
                        }
                        taLog.log("tags_current_email: " + JSON.stringify(tags_current_email));
                        let _data = { messageId: message.id, tags: tags_current_email };
                        _assign_tags(_data, !prefs_aats.add_tags_auto_force_existing, prefs_aats.add_tags_exclusions_exact_match);
                    }
                }
            }
    
            if (spamFilter) {
                let skipSpamFilter = false;
                if(isAutoMode && message_in_skipped_folder){
                    taLog.log("Message in a folder excluded from the automatic processing, skipping spamfilter...");
                    skipSpamFilter = true;
                }
                if(!skipSpamFilter && isAutoMode && prefs_aats.spamfilter_enabled_accounts.length > 0){
                    let accountId = message.folder.accountId;
                    if(!prefs_aats.spamfilter_enabled_accounts.includes(accountId)){
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
                if (!skipSpamFilter) {
                    await ensureBodyText();
                    await _generateSpamReportForMessage(
                        message.headerMessageId,
                        {
                            messageData: { message, fullMessage: curr_fullMessage, body_text, msg_text },
                            prefs: prefs_aats,
                            autoMove: true,
                            skip_addresses: spamfilter_skip_addresses,
                            skip_addressbook: spamfilter_skip_addressbook
                        });
                }
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
                if (!skipSummarize) {
                    await ensureFullMessage();
                    taLog.log("[ThunderAI] Pre-caching summary on receive for: " + message.headerMessageId + (summarizeOnReceive ? "" : " (sender in the auto-summarize list)"));
                    await _generateSummaryForMessage(message.headerMessageId, null, {
                        messageData: { message, fullMessage: curr_fullMessage }
                    });
                }
            }

            if (translateOnReceive || translate) {
                let skipTranslate = false;
                if (isAutoMode && message_in_skipped_folder) {
                    taLog.log("Message in a folder excluded from the automatic processing, skipping translate...");
                    skipTranslate = true;
                }
                if (!skipTranslate) {
                    await ensureFullMessage();
                    let translateTabId = null;
                    if (translate) {
                        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
                        if (tabs.length > 0) {
                            translateTabId = tabs[0].id;
                        }
                    }
                    taLog.log("[ThunderAI] Generating translation for: " + message.headerMessageId);
                    await _generateTranslationForMessage(message.headerMessageId, translateTabId, {
                        messageData: { fullMessage: curr_fullMessage }
                    });
                }
            }

            } catch (err) {
                taLog.error("Error processing message " + (message?.headerMessageId || message?.id) + ", skipping: " + (err?.message || err));
                continue;
            } finally {
                // Release heavy per-message references so they can be garbage-collected.
                curr_fullMessage = null;
                msg_text = null;
                body_text = '';
            }

            // Give the event loop (and GC) some breathing room every CHUNK_SIZE messages.
            taBatchController.tick();
            processedCount++;
            if (processedCount % CHUNK_SIZE === 0) {
                await new Promise(r => setTimeout(r, 0));
                if (taBatchController.isCancelled()) {
                    taLog.log("[ThunderAI] Batch processing cancelled by user (between chunks), stopping.");
                    break;
                }
            }
        }
    }

    if (summarize && !taBatchController.isCancelled()) {
        let summarize_prefs = await browser.storage.sync.get({
            summarize_display_mode: prefs_default.summarize_display_mode,
            summarize_max_messages: prefs_default.summarize_max_messages,
        });

        // Collect messages into array to check count
        const messageArray = [];
        for await (let msg of messages) {
            messageArray.push(msg);
        }

        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) {
            taLog.error("[ThunderAI] Summarize aborted: no active tab available.");
            return;
        }
        const tabId = tabs[0].id;

        // Inline mode for single message: generate inline summary in the message pane
        if (summarize_prefs.summarize_display_mode === 'inline' && messageArray.length === 1) {
            // Fire the inline loading indicator immediately, before any heavy work
            browser.tabs.sendMessage(tabId, { command: "showSummaryGenerating" });

            const msg = messageArray[0];
            const fullMessage = await browser.messages.getFull(msg.id);
            await _generateSummaryForMessage(msg.headerMessageId, tabId, {
                messageData: { message: msg, fullMessage }
            });
        } else {
            // Webchat mode, or inline with multiple messages (fallback to webchat).
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
                if (taBatchController.isCancelled()) {
                    taLog.log("[ThunderAI] Summarize cancelled by user, stopping.");
                    return;
                }
                const fullMessage = await browser.messages.getFull(curr_message.id);
                messageDataArray.push({ message: curr_message, fullMessage });
            }
            const { promptText, promptInfo } = await taPromptUtils.buildSummaryPrompt(messageDataArray);

            openChatGPT(promptText, promptInfo.action, tabId, promptInfo.name, promptInfo.need_custom_text, promptInfo);
        }
    }

    } finally {
        taWorkingStatus.stopWorking();
        // endBatch() returns a snapshot taken before the counters are reset. When the last
        // active batch exits because the user requested a cancel, notify how many messages
        // were processed before stopping.
        const batchResult = taBatchController.endBatch();
        if (batchResult.lastExit && batchResult.cancelled) {
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
        await browser.tabs.executeScript(messageTab.id, {
            file: "js/mzta-compose-script.js"
        })
    } catch (error) {
        console.error("[ThunderAI] Error injecting message display script:", error);
        console.error("[ThunderAI] Message tab:", messageTab.url);
    }
}
