/*
 *  Known issues of the static area: what the repository as source contradicts in spec 05, spec 06
 *  or CLAUDE.md rule 7 today. How they run (TODO while failing, "stale" once passing) is the core
 *  mechanism, ../core/known-issues.mjs; this file holds the entries, their shape, and the way a
 *  static check turns into tests (declareCheck()).
 *
 *  A static check finds violations, each about one SUBJECT: a message key ("menu_title"), a
 *  locale ("sk"), a key of a locale ("it:menu_title"), a preference key, a validation table entry
 *  ("PREF_ENUMS.reply_type"). So the shape is
 *
 *      KNOWN = { <check>: [ { reason, subjects: [<subject>, ...] }, ... ] }
 *
 *  one group per reason, every subject spelled out:
 *   - a check is one of CHECKS;
 *   - a reason is a non-empty string naming what it contradicts ("spec 06 ...", "CLAUDE.md rule
 *     7 ...") and what the code does instead;
 *   - a subject is a non-empty string, never '*' nor a pattern: a catch-all would hide every
 *     later violation of the check at once, which is exactly what a static check is for;
 *   - a subject appears once per check.
 *  validateKnown() enforces this; tests/static/99-harness-known-issues runs it.
 *
 *  What declareCheck() makes of a check, see there: a violation outside KNOWN fails the run at
 *  once; a group of KNOWN runs as one TODO (one line per reason, not one per key); a listed
 *  subject that no longer violates fails the run ("stale"), so the list only ever shrinks.
 *
 *  No jsdom here, so level 1 can import it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownTest } from '../core/known-issues.mjs';

const FILE = 'tests/helpers/known-issues/static.mjs';

/** Every check of the area, by the name its test file passes to declareCheck(). */
export const CHECKS = [
    // 01-locales-files (spec 06)
    'locale-shape', 'en-description', 'placeholders', 'stale-key', 'lang-md',
    // 02-locales-references (spec 06)
    'missing-key', 'dead-key',
    // 03-prefs-references (spec 05, CLAUDE.md rule 7)
    'undeclared-pref',
    // 04-prefs-defaults (spec 05, spec 08, CLAUDE.md rule 7)
    'derivation', 'duplicate', 'orphan-rule', 'type-coherence', 'secret-name', 'secret-treatment',
];

export const REASONS = {
    enNoDescription: 'spec 06 "Message File Format" and "Adding a New String" (step 3): every entry ' +
        'of _locales/en/messages.json has a "description" giving the Weblate translators the context. ' +
        'These entries have none.',
    keyWithSpace: 'spec 06 "Message File Format" (the standard WebExtension i18n format, whose message ' +
        'names use only A-Z, a-z, 0-9, _ and @): the key "prefs_reasoning_api_default " ends with a ' +
        'space, in en and in every translation Weblate copied it to. pages/_lib/connection-ui.js ' +
        'references it with the same space (__MSG_prefs_reasoning_api_default __), so the two agree ' +
        'with each other, but not with the format.',
    deadKey: 'spec 06 "Adding a New String" (step 4: a string is added to be used from the code): these ' +
        'en keys are referenced nowhere in the scanned code - no getMessage(), no __MSG_, no static ' +
        'string equal to them, no prefix or suffix the code builds keys from - yet Weblate still asks ' +
        'for their translation. Spec 06 does not say outright that an unused key must go: remove ' +
        'them from en, or rule them kept and say so in the spec.',
};

export const KNOWN = {
    'locale-shape': [
        { reason: REASONS.keyWithSpace, subjects: [
            'de:prefs_reasoning_api_default ', 'en:prefs_reasoning_api_default ',
            'fr:prefs_reasoning_api_default ', 'id:prefs_reasoning_api_default ',
            'it:prefs_reasoning_api_default ', 'ja:prefs_reasoning_api_default ',
            'pl:prefs_reasoning_api_default ', 'pt-br:prefs_reasoning_api_default ',
            'sv:prefs_reasoning_api_default ',
        ] },
    ],
    'en-description': [
        { reason: REASONS.enNoDescription, subjects: [
            'menu_title', 'prompt_lang', 'prompt_reply', 'prompt_reply_advanced',
            'prompt_reply_custom_command', 'prompt_rewrite_polite', 'prompt_rewrite_formal',
            'prompt_classify', 'prompt_translate_this', 'prompt_this', 'prompt_selection_needed',
            'customPrompts_managePrompts', 'more_info_string', 'prompt_string',
            'customPrompts_managePrompts_info_default',
            'customPrompts_managePrompts_info_default_2',
            'customPrompts_managePrompts_info_default_3', 'customPrompts_start_saving',
            'customPrompts_reindexing_list', 'customPrompts_import_completed_saved',
            'customPrompts_saved', 'customPrompts_form_label_ID',
            'customPrompts_form_label_ID_rules', 'customPrompts_form_label_Name',
            'customPrompts_form_label_Text', 'customPrompts_form_label_Action',
            'customPrompts_form_label_need_selected', 'customPrompts_form_label_need_signature',
            'customPrompts_form_label_need_custom_text', 'customPrompts_form_label_enabled',
            'customPrompts_form_label_use_diff_viewer',
            'customPrompts_form_label_use_diff_viewer_title', 'customPrompts_form_required_fields',
            'customPrompts_btnEdit', 'customPrompts_btnCancel', 'customPrompts_btnOK',
            'customPrompts_btnDelete', 'customPrompts_btnDelete_confirmText',
            'customPrompts_unsaved_changes', 'btnSaveAll_string', 'btnNew_string',
            'customPrompts_btnAddNewCommit', 'customPrompts_add_to_menu',
            'customPrompts_add_to_menu_always', 'customPrompts_add_to_menu_reading',
            'customPrompts_add_to_menu_composing', 'customPrompts_close_button',
            'customPrompts_do_reply', 'customPrompts_substitute_text', 'chatgpt_win_working',
            'chatgpt_win_job_completed', 'chatgpt_win_job_completed_select',
            'chatgpt_win_get_answer', 'chatgpt_win_close', 'chatgpt_textarea_not_found_error',
            'chatgpt_btn_retry', 'chatgpt_sendbutton_not_found_error', 'chatgpt_user_not_logged_in',
            'chatgpt_win_model_warning', 'chatgpt_win_custom_text', 'chatgpt_win_send',
            'chatgpt_force_completion', 'chatgpt_force_completion_title', 'msg_prompt_too_long',
            'prefs_OptionText_release_notes', 'prefs_status_page',
            'prefs_OptionText_chatgpt_win_text', 'prefs_OptionText_chatgpt_win_height',
            'prefs_OptionText_chatgpt_win_width', 'prefs_OptionText_default_sign_name',
            'prefs_OptionText_default_chatgpt_lang', 'prefs_OptionText_reply_all',
            'prefs_OptionText_reply_sender', 'prefs_OptionText_reply_type',
            'prefs_OptionText_reply_type_Info', 'prefs_OptionText_btnManagePrompts',
            'prefs_OptionText_btnManageCustomDataPH', 'prefsInfoTitle', 'prefsInfoDesc_1',
            'prefsInfoDesc_2', 'prefsInfoDesc_3', 'prefsInfoDesc_4', 'prefsInfoDesc_5',
            'prefsInfoDesc_6', 'prefsInfoDesc_7', 'prefsInfoDesc_8', 'prefsDonation_1',
            'prefsDonation_2', 'backToOptionsText', 'TranslateText', 'TranslateLink',
            'customPrompts_ExportAll', 'customPrompts_Import', 'importPrompts_confirmText',
            'customPrompts_start_import', 'importPrompts_invalidFile',
            'importPrompts_invalidPrompts', 'currently_used_prompt',
            'customprompts_form_label_define_response_lang', 'prefs_Connection_type',
            'prefs_Connection_type_ChatGPT_Web', 'prefs_Connection_type_ChatGPT_API',
            'prefs_ChatGPT_API_Key', 'ChatGPT_Models', 'ChatGPT_Models_Error_fetching', 'Loading',
            'error', 'chatgpt_empty_apikey', 'chatgpt_empty_model', 'chagpt_api_send_button',
            'Debug', 'prefs_OptionText_do_debug_info', 'prefs_Connection_type_Ollama_API',
            'prefs_Connection_type_OpenAI_Comp_API', 'prefs_API_Host', 'Ollama_Models',
            'Ollama_Models_Error_fetching', 'API_Models_Error_NoModels', 'ollama_empty_host',
            'ollama_empty_model', 'error_connection_interrupted', 'ollama_api_request_failed',
            'chatgpt_api_request_failed', 'WaitingServerResponse', 'prefs_API_Host_Info',
            'OpenAIComp_Models', 'OpenAIComp_Models_Error_fetching', 'OpenAIComp_empty_host',
            'OpenAIComp_empty_model', 'OpenAIComp_api_request_failed', 'prefs_OpenAIComp_ChatName',
            'prefs_OpenAIComp_ChatName_Info', 'StorageSpace', 'SearchPrompt',
            'prefs_OptionText_dynamic_menu_force_enter',
            'prefs_OptionText_dynamic_menu_force_enter_info',
            'prefs_OptionText_chatgpt_win_dims_info', 'prefs_OpenAIComp_API_Key', 'Optional',
            'OpenChatGPTTab', 'OpenChatGPTTab_Info', 'OpenChatGPTTab_Info2',
            'placeholder_mail_text_body', 'placeholder_mail_html_body', 'placeholder_mail_subject',
            'placeholder_folder_name', 'placeholder_folder_path', 'placeholder_mail_headers',
            'placeholder_mail_full_headers', 'placeholder_selected_text',
            'placeholder_selected_html', 'placeholder_additional_text', 'placeholder_junk_score',
            'placeholder_recipients', 'placeholder_cc_list', 'placeholder_author',
            'placeholder_account_email_address', 'placeholder_mail_text_body_or_selected',
            'placeholder_mail_html_body_or_selected', 'placeholder_mail_plain_text_part',
            'prefs_OptionText_placeholders_use_default_value',
            'prefs_OptionText_placeholders_use_default_value_info',
            'prefs_OptionText_diff_granularity_info', 'prefs_OptionText_hide_thinking',
            'prefs_OptionText_hide_thinking_info', 'prefs_OptionText_chat_show_usage_data',
            'prefs_OptionText_chat_show_usage_data_info',
            'prefs_OptionText_chat_show_usage_data_openai_comp_note',
            'prefs_OptionText_thinking_summary', 'prefs_OptionText_max_prompt_length',
            'prefs_OptionText_max_prompt_length_Info', 'prefs_OptionText_special_command_timeout',
            'prefs_OptionText_special_command_timeout_Info',
            'prefs_OptionText_batch_max_concurrency_Info', 'prefs_OptionText_chatgpt_web_model',
            'prefs_OptionText_chatgpt_web_model_info', 'prefs_OptionText_chatgpt_web_tempchat',
            'prefs_OptionText_chatgpt_web_tempchat_info',
            'prefs_OptionText_chatgpt_web_load_wait_time',
            'prefs_OptionText_chatgpt_web_load_wait_time_info', 'chatgpt_btn_model',
            'AllowedValues', 'prefs_OptionText_btnManagePrompts_infoline',
            'prefs_extra_body_error_not_object', 'prefs_OptionText_openai_comp_extra_body_info',
            'prefs_OptionText_openai_comp_use_v1', 'prefs_OptionText_openai_comp_use_v1_info',
            'prefs_OptionText_openai_comp_info_remote', 'prefs_OptionText_owl_warning',
            'prompt_reply_full_text', 'prompt_reply_additional_text', 'reply_same_lang',
            'sign_msg_as', 'prompt_reply_advanced_full_text',
            'prompt_reply_custom_command_full_text', 'prompt_rewrite_full_text',
            'prompt_rewrite_formal_full_text', 'prompt_classify_full_text',
            'prompt_translate_this_full_text', 'prompt_this_full_text', 'prefs_OptionText_add_tags',
            'prefs_OptionText_add_tags_Info', 'prompt_add_tags', 'prompt_add_tags_full_text',
            'prompt_proofread_this', 'prompt_proofread_this_full_text',
            'placeholder_tags_current_email', 'placeholder_tags_full_list',
            'prefs_OptionText_add_tags_maxnum', 'prefs_OptionText_add_tags_maxnum_Info',
            'prefs_OptionText_add_tags_max_messages_Info', 'prompt_add_tags_maxnum',
            'prefs_OptionText_add_tags_hide_exclusions',
            'prefs_OptionText_add_tags_hide_exclusions_Info', 'prefs_OptionText_btnManageTagsInfo',
            'AddTags_PageTitle', 'AddTags_info_default', 'AddTags_prompt_text_title',
            'AddTags_excl_list_title', 'AddTags_excl_list_infoline', 'save',
            'addtags_info_additional_statements', 'reset_default', 'reset',
            'addtags_excl_list_infoline2', 'addtags_dialog_title', 'addtags_exclude_tag',
            'addtags_no_tags_received', 'addtags_no_valid_tags', 'thunderai_error_title',
            'thunderai_warning_title', 'prefs_OptionText_add_tags_first_uppercase',
            'prefs_OptionText_add_tags_first_uppercase_Info', 'prefs_SurveyLinkText',
            'prefs_SurveyLinkText2', 'prefs_doc_title', 'prefs_doc_setup_guide',
            'prefs_doc_custom_prompt_tutorial', 'prefs_doc_open_welcome',
            'OpenAIComp_force_model_ask', 'prefs_OptionText_add_tags_force_lang',
            'prefs_OptionText_add_tags_force_lang_Info', 'prompt_add_tags_force_lang',
            'prefs_Connection_type_Google_Gemini_API', 'prefs_GoogleGemini_API_Key',
            'GoogleGemini_Models', 'GoogleGemini_Models_Error_fetching',
            'google_gemini_api_request_failed', 'google_gemini_empty_apikey',
            'google_gemini_empty_model', 'GoogleGemini_SystemInstruction',
            'GoogleGemini_SystemInstruction_Info', 'ChatGPT_Developer_Messages',
            'ChatGPT_Developer_Messages_Info', 'prefs_OptionText_btnManagePrompts_infoline3',
            'placeholder_mail_typed_text', 'placeholder_mail_quoted_text',
            'prompt_get_calendar_event', 'prompt_get_calendar_event_full_text',
            'prompt_get_calendar_event_from_clipboard', 'clipboard_read_error',
            'clipboard_empty_error', 'clipboard_permission_denied', 'clipboard_permission_error',
            'prefs_OptionText_get_calendar_event_from_clipboard',
            'prefs_OptionText_get_calendar_event_from_clipboard_Info', 'prompt_summarize',
            'prompt_summarize_full_text', 'prompt_summarize_email_template',
            'prompt_summarize_email_template_full_text', 'prompt_summarize_email_separator',
            'prompt_summarize_email_separator_full_text', 'prompt_get_task',
            'prompt_get_task_full_text', 'prefs_OptionText_get_calendar_event',
            'prefs_OptionText_get_calendar_event_Info', 'prefs_OptionText_get_task',
            'prefs_OptionText_get_task_Info', 'Select_your_timezone',
            'prefs_OptionText_calendar_enforce_timezone',
            'prefs_OptionText_calendar_enforce_timezone_Info', 'prefs_OptionText_append_email_link',
            'prefs_OptionText_calendar_append_email_link_Info',
            'prefs_OptionText_task_append_email_link_Info', 'prefs_OptionText_reminder_enabled',
            'prefs_OptionText_calendar_reminder_enabled_Info',
            'prefs_OptionText_task_reminder_enabled_Info', 'prefs_OptionText_reminder_rules_title',
            'prefs_OptionText_reminder_rules_Info',
            'prefs_OptionText_calendar_reminder_rules_example',
            'prefs_OptionText_task_reminder_rules_example',
            'prefs_OptionText_btnManageCalendarEventInfo', 'GetCalendarEvent_PageTitle',
            'GetCalendarEvent_info_default', 'GetCalendarEvent_prompt_text_title',
            'prefs_OptionText_AdvancedPromptResponse_infoline2',
            'prefs_OptionText_Summarize_infoline2', 'prefs_OptionText_Summarize_main_prompt',
            'prefs_OptionText_Summarize_email_template',
            'prefs_OptionText_Summarize_email_separator',
            'prefs_OptionText_get_calendar_event_Sparks_not_present',
            'prefs_OptionText_get_calendar_event_Sparks_wrong_version', 'GetTask_PageTitle',
            'GetTask_info_default', 'prefs_OptionText_btnManageTaskInfo',
            'prefs_OptionText_download_now', 'placeholder_mail_datetime',
            'placeholder_current_datetime', 'calendar_getting_data_error',
            'calendar_opening_dialog_error', 'task_getting_data_error', 'task_opening_dialog_error',
            'no_valid_data_received', 'prefs_OptionText_add_tags_auto',
            'prefs_OptionText_add_tags_auto_Info', 'prefs_OptionText_add_tags_auto_Info2',
            'prefs_OptionText_add_tags_auto_force_existing',
            'prefs_OptionText_add_tags_auto_force_existing_Info',
            'prefs_OptionText_add_tags_auto_uselist', 'prefs_OptionText_add_tags_auto_uselist_Info',
            'prefs_OptionText_add_tags_auto_uselist_list_Info', 'prompt_add_tags_use_list',
            'prompt_add_tags_force_existing', 'prefs_OptionText_add_tags_auto_only_inbox',
            'prefs_OptionText_add_tags_auto_only_inbox_Info',
            'prefs_OptionText_add_tags_auto_include_sent',
            'prefs_OptionText_add_tags_auto_include_sent_Info',
            'prefs_OptionText_add_tags_use_specific_integration_Info',
            'prefs_OptionText_get_calendar_event_use_specific_integration_Info',
            'placeholder_thunderai_def_sign', 'placeholder_thunderai_def_lang',
            'placeholder_thunderai_translate_lang', 'placeholder_thunderai_translate_exclude_lang',
            'placeholder_mail_attachments_info', 'placeholder_empty', 'prefs_OptionText_spamfilter',
            'prefs_OptionText_spamfilter_Info', 'prefs_OptionText_btnManageSpamFilterInfo',
            'prefs_OptionText_summarize',
            'prefs_OptionText_summarize_use_specific_integration_Info',
            'prefs_OptionText_summarize_Info', 'prefs_OptionText_btnManageSummarizeInfo',
            'SpamFilter_PageTitle', 'SpamFilter_info_default', 'SpamFilter_prompt_text_title',
            'prompt_spamfilter', 'prompt_spamfilter_full_text', 'Summarize_PageTitle',
            'Summarize_info_default', 'Summarize_prompt_text_title',
            'prefs_OptionText_use_specific_integration',
            'prefs_OptionText_spamfilter_use_specific_integration_Info',
            'prefs_OptionText_spamfilter_threshold', 'prefs_OptionText_spamfilter_threshold_Info',
            'prefs_OptionText_spamfilter_show_msg_panel',
            'prefs_OptionText_spamfilter_show_msg_panel_Info',
            'prefs_OptionText_spamfilter_only_inbox', 'prefs_OptionText_spamfilter_only_inbox_Info',
            'spamfilter_threshold_too_low', 'spamfilter_threshold_zero', 'spamfilter_no_reports',
            'SpamFilter_skip_addresses_title', 'SpamFilter_skip_addresses_infoline',
            'SpamFilter_skip_addresses_infoline2', 'spamfilter_skip_addresses_explanation',
            'SpamFilter_block_addresses_title', 'SpamFilter_block_addresses_infoline',
            'SpamFilter_address_lists_precedence', 'spamfilter_block_addresses_explanation',
            'prefs_OptionText_spamfilter_skip_addressbook',
            'prefs_OptionText_spamfilter_skip_addressbook_Info',
            'spamfilter_skip_addressbook_explanation', 'spamfilter_prompt_missing_explanation',
            'addressbook_permission_denied', 'addressbook_permission_error', 'SpamReport_Title',
            'Date', 'From', 'Subject', 'Spam_Value', 'Spam', 'Valid', 'Moved_to_Spam',
            'Explanation', 'Report_Date', 'yes_string', 'no_string', 'noActiveCalendar',
            'btn_show_differences', 'chatgpt_win_diff_title', 'apiwebchat_picker_accept_all',
            'apiwebchat_picker_reject_all', 'apiwebchat_picker_prev', 'apiwebchat_picker_next',
            'apiwebchat_you', 'apiwebchat_info', 'apiwebchat_error', 'apiwebchat_use_this_answer',
            'apiwebchat_stopping', 'apiwebchat_receiving_data', 'apiwebchat_done',
            'hyprland_warning', 'remember_CORS', 'maybe_CORS_openai_comp', 'CORS_alternative_1',
            'CORS_alternative_2_new', 'CORS_give_host_perm', 'CORS_localhost_warn',
            'Replace_No_Selected_Text', 'prefs_ollama_num_ctx', 'prefs_ollama_num_ctx_Info',
            'ask_chatgptweb_permission_1', 'ask_anthropic_api_permission_1',
            'ask_openai_api_permission_1', 'ask_integration_permission_2_popup',
            'ask_integration_permission_2', 'ask_integration_permission_ok',
            'AccountSelector_AutoTags', 'AccountSelector_AutoTags_infoline',
            'AccountSelector_Spamfilter', 'prefs_OptionText_chatgpt_web_project',
            'prefs_OptionText_chatgpt_web_project_info', 'prefs_OptionText_chatgpt_web_custom_gpt',
            'prefs_OptionText_chatgpt_web_custom_gpt_info',
            'prefs_OptionText_chatgpt_web_custom_data_info',
            'prefs_OptionText_chatgpt_web_custom_data_info2', 'customPrompts_Properties',
            'customPrompts_show_additional_info', 'customPrompts_hide_additional_info',
            'customPrompts_show_additional_info_show', 'prefs_OptionText_CustomGPT_Warn',
            'prefs_OptionText_Project_No_temporary_chat_warn', 'prefs_Anthropic_API_Key',
            'prefs_Connection_type_Anthropic_API', 'Anthropic_Models',
            'Anthropic_Models_Error_fetching', 'Anthropic_Version', 'Anthropic_Version_Info',
            'prefs_OptionText_anthropic_max_tokens', 'prefs_OptionText_anthropic_max_tokens_Info',
            'prefs_OptionText_anthropic_top_p_Info', 'prefs_OptionText_anthropic_top_k_Info',
            'prefs_OptionText_anthropic_stop_sequences',
            'prefs_OptionText_anthropic_stop_sequences_Info',
            'prefs_OptionText_anthropic_extended_thinking_budget',
            'prefs_OptionText_anthropic_extended_thinking_budget_Info', 'anthropic_empty_apikey',
            'anthropic_empty_model', 'anthropic_empty_version', 'anthropic_api_request_failed',
            'prefs_OptionText_anthropic_effort', 'prefs_OptionText_anthropic_effort_Info',
            'anthropic_note_temperature_unsupported', 'anthropic_note_budget_tokens_unsupported',
            'anthropic_note_effort_unsupported', '_api_connecting', '_api_connecting_model',
            '_api_connecting_host', '_api_connecting_version', 'prefs_OpenAIComp_AvailableServices',
            'prefs_OpenAIComp_AvailableServices_Info', 'Custom', 'OpenAIComp_Configs_ConfirmApply',
            'apiwebchat_selection_info', 'ChatGPT_chatgpt_api_store',
            'ChatGPT_chatgpt_api_store_info', 'prefs_chatgpt_api_temperature_Info',
            'prefs_OptionText_chatgpt_reasoning_summary',
            'prefs_OptionText_chatgpt_reasoning_summary_Info',
            'prefs_OptionText_chatgpt_reasoning_effort', 'prefs_OptionText_chatgpt_extra_body_info',
            'prefs_OptionText_chatgpt_reasoning_effort_Info',
            'prefs_OptionText_chatgpt_max_output_tokens_Info', 'prefs_OptionText_chatgpt_verbosity',
            'prefs_OptionText_chatgpt_verbosity_Info', 'prefs_OptionText_chatgpt_text_format',
            'prefs_OptionText_chatgpt_text_format_Info',
            'prefs_OptionText_chatgpt_text_format_schema_name',
            'prefs_OptionText_chatgpt_text_format_schema_name_Info',
            'prefs_OptionText_chatgpt_text_format_schema',
            'prefs_OptionText_chatgpt_text_format_schema_Info',
            'prefs_OptionText_chatgpt_top_p_Info', 'prefs_OptionText_chatgpt_truncation',
            'prefs_OptionText_chatgpt_truncation_Info', 'prefs_OptionText_chatgpt_prompt_cache_key',
            'prefs_OptionText_chatgpt_prompt_cache_key_Info',
            'prefs_OptionText_chatgpt_service_tier', 'prefs_OptionText_chatgpt_service_tier_Info',
            'prefs_OptionText_chatgpt_safety_identifier',
            'prefs_OptionText_chatgpt_safety_identifier_Info',
            'prefs_OptionText_chatgpt_include_encrypted_reasoning',
            'prefs_OptionText_chatgpt_include_encrypted_reasoning_Info',
            'prefs_ollama_temperature_Info', 'prefs_ollama_think', 'prefs_ollama_think_Info',
            'ollama_note_thinking_unsupported', 'prefs_Ollama_API_Key', 'prefs_Ollama_API_Key_Info',
            'prefs_ollama_keep_alive', 'prefs_ollama_keep_alive_Info', 'Ollama_System_Prompt',
            'Ollama_System_Prompt_Info', 'prefs_OptionText_ollama_extra_options',
            'prefs_OptionText_ollama_extra_options_info', 'prefs_ollama_format_json',
            'prefs_ollama_format_json_Info', 'chatgpt_win_change_reply_type',
            'prefs_OptionText_add_tags_exclusions_exact_match',
            'prefs_OptionText_add_tags_exclusions_exact_match_Info', 'customDataPH_manageDataPH',
            'customDataPH_manageDataPH_info_default_3', 'customDataPH_manageDataPH_info_default',
            'customDataPH_manageDataPH_info_default_2', 'customDataPH_ExportAll',
            'customDataPH_Import', 'customDataPH_form_label_Text', 'customDataPH_saving_custom',
            'customDataPH_saved', 'customDataPH_btnAddNewCommit', 'importCustomDataPH_confirmText',
            'importCustomDataPH_start_import', 'importCustomDataPH_import_completed',
            'importCustomDataPH_invalidFile', 'importCustomDataPH_invalidDataPHs',
            'customDataPH_add_to_menu', 'prefs_OptionText_chatgpt_web_br_replace_info',
            'OpenAIComp_ClearModelsList_Confirm', 'prefs_api_temperature',
            'prefs_openai_comp_temperature_Info', 'chatgpt_click_force_completion',
            'warn_API_needed', 'prefs_google_gemini_thinking_budget',
            'prefs_google_gemini_thinking_budget_Info', 'prefs_api_max_output_tokens',
            'prefs_api_top_p', 'prefs_api_top_k', 'prefs_api_extra_body',
            'prefs_google_gemini_max_output_tokens_Info', 'prefs_google_gemini_top_p_Info',
            'prefs_google_gemini_top_k_Info', 'prefs_google_gemini_extra_body_Info',
            'prefs_google_gemini_temperature_Info', 'SelectAll', 'DeselectAll',
            'Anthropic_System_Prompt', 'Anthropic_System_Prompt_Info',
            'prefs_anthropic_temperature_Info', 'Optional_Permission_Denied_Model_Fetching',
            'customPrompts_export_include_api_settings', 'prefs_OptionText_calendar_no_selection',
            'prefs_OptionText_calendar_no_selection_Info',
            'prefs_OptionText_calendar_no_selection_missing_placeholder', 'customPrompts_btnCopy',
            'copy_text', 'spam_check_in_progress', 'prefs_OptionText_summarize_auto',
            'prefs_OptionText_summarize_auto_Info', 'prefs_OptionText_summarize_display_mode',
            'prefs_OptionText_summarize_display_mode_Info',
            'prefs_OptionText_summarize_max_display_length',
            'prefs_OptionText_summarize_max_display_length_Info',
            'prefs_OptionText_summarize_max_messages_Info',
            'prefs_OptionText_summarize_strip_formatting',
            'prefs_OptionText_summarize_strip_formatting_Info',
            'prefs_OptionText_summarize_force_lang', 'prefs_OptionText_summarize_force_lang_Info',
            'prefs_OptionText_summarize_lang_Info', 'prompt_summarize_force_lang',
            'summarize_info_additional_statements', 'Summarize_auto_senders_title',
            'Summarize_auto_senders_infoline', 'Summarize_auto_senders_infoline2',
            'Summarize_auto_senders_api_warning', 'Summarize_auto_senders_notice',
            'Summarize_auto_senders_disabled_note', 'prefs_OptionText_summarize_auto_senders',
            'prefs_OptionText_summarize_auto_senders_Info',
            'prefs_OptionText_summarize_auto_senders_list_Info', 'summarize_see_more',
            'summarize_see_less', 'summarize_title', 'get_ai_summary', 'summarize_collapse',
            'summarize_generating', 'summarize_error', 'summarize_click_to_generate',
            'summarize_chatgpt_web_not_supported', 'summarize_refresh', 'spamfilter_refresh',
            'spamfilter_delete', 'summarize_delete', 'prefs_OptionText_translate',
            'prefs_OptionText_translate_use_specific_integration_Info',
            'prefs_OptionText_translate_Info', 'prefs_OptionText_btnManageTranslateInfo',
            'Translate_PageTitle', 'Translate_info_default', 'Translate_prompt_text_title',
            'prefs_OptionText_translate_auto', 'prefs_OptionText_action_auto_disabled',
            'prefs_OptionText_action_auto_manual', 'prefs_OptionText_action_auto_automatic',
            'prefs_OptionText_translate_auto_Info', 'prefs_OptionText_display_mode_inline',
            'prefs_OptionText_display_mode_webchat',
            'prefs_OptionText_translate_max_display_length',
            'prefs_OptionText_translate_max_display_length_Info', 'translate_see_more',
            'translate_see_less', 'prefs_OptionText_translate_lang',
            'prefs_OptionText_translate_lang_Info', 'prefs_OptionText_translate_exclude_lang',
            'prefs_OptionText_translate_exclude_lang_Info',
            'prefs_OptionText_Translate_main_prompt', 'translate_generating',
            'translate_click_to_generate', 'get_ai_translation',
            'translate_chatgpt_web_not_supported', 'translate_refresh', 'translate_delete',
            'translate_banner_title', 'translate_error', 'translate_no_language_configured',
            'antispam_by', 'summary_by', 'translate_by', 'prefs_THStats_1', 'prefs_THStats_2',
            'prefs_OptionText_chatgpt_win_pos_text', 'prefs_OptionText_chatgpt_win_top',
            'prefs_OptionText_chatgpt_win_left', 'prefs_chatgpt_win_save_position',
            'prefs_chatgpt_win_position_info', 'prefs_OptionText_action_auto_batch',
            'placeholder_string', 'prefs_privacy_more_info',
        ] },
    ],
    'dead-key': [
        { reason: REASONS.deadKey, subjects: [
            'customPrompts_form_label_Text', 'customPrompts_btnAddNewCommit', 'prefsInfoTitle',
            'prefsInfoDesc_5', 'prefsInfoDesc_6', 'prefsDonation_1', 'prefsDonation_2',
            'TranslateText', 'TranslateLink', 'AllowedValues', 'noActiveCalendar',
            'apiwebchat_picker_progress', 'apiwebchat_you',
            'customPrompts_show_additional_info_show', 'prefs_OptionText_auto_summary',
            'auto_summary_title', 'auto_summary_generating', 'auto_summary_failed',
            'customPrompts_btnCopy', 'Summarize_auto_senders_api_warning', 'summarize_collapse',
            'prefs_settings_subtitle', 'prefs_disclaimer',
        ] },
    ],
};

/** The problems with a KNOWN-shaped object, as strings; [] when it is valid. */
export function validateKnown(known) {
    const problems = [];
    if (!known || typeof known !== 'object' || Array.isArray(known)) return ['KNOWN must be an object'];
    for (const [check, groups] of Object.entries(known)) {
        if (!CHECKS.includes(check)) { problems.push(`${check}: unknown check`); continue; }
        if (!Array.isArray(groups)) { problems.push(`${check}: must be an array of groups`); continue; }
        const seen = new Set();
        groups.forEach((group, g) => {
            const at = `${check}[${g}]`;
            if (!group || typeof group !== 'object') { problems.push(at + ': not a group'); return; }
            const { reason, subjects } = group;
            if (typeof reason !== 'string' || reason.trim() === '') problems.push(at + ': no reason');
            else if (!/\bspec \d\d|CLAUDE\.md rule \d/.test(reason)) {
                problems.push(at + ': the reason names no spec section ("spec NN ..." or "CLAUDE.md rule N")');
            }
            if (!Array.isArray(subjects) || subjects.length === 0) { problems.push(at + ': no subjects'); return; }
            for (const s of subjects) {
                if (typeof s !== 'string' || s.trim() === '') problems.push(at + ': an empty subject');
                else if (/[*?]/.test(s)) problems.push(`${at}.${s}: a subject names one key or locale, never a pattern`);
                else if (seen.has(s)) problems.push(`${check}.${s}: listed twice`);
                else seen.add(s);
            }
        });
    }
    return problems;
}

/** {subject: reason} of one check. No fallback: an unlisted subject has no reason. */
export function knownFor(check, known = KNOWN) {
    const out = new Map();
    for (const { reason, subjects } of known[check] || []) for (const s of subjects) out.set(s, reason);
    return out;
}

/**
 * Declare the tests of one check from its violations, a Map {subject: detail} (the detail says
 * where, for the failure message):
 *
 *   "<title>"                          fails on any violation KNOWN does not list;
 *   "<title> [known: <reason>]"        one TODO per group of KNOWN, while a subject still violates;
 *                                      stale (fails) once none does;
 *   "<title>: every known issue still reproduces"   fails on a listed subject that no longer
 *                                      violates, naming it, so it is removed one at a time.
 */
export function declareCheck(check, title, violations, known = KNOWN) {
    if (!CHECKS.includes(check)) throw new Error('declareCheck: unknown check "' + check + '"');
    const listed = knownFor(check, known);
    test(title, () => {
        const unexpected = [...violations].filter(([s]) => !listed.has(s)).map(([s, d]) => d ? `${s}: ${d}` : s);
        assert.deepEqual(unexpected, [], `${unexpected.length} violation(s) of "${check}"`);
    });
    const groups = known[check] || [];
    for (const { reason, subjects } of groups) {
        knownTest(`${title} [known: ${subjects.length} subject(s)]`, reason, () => {
            // A count, not the list: the list is right here, and 600 keys would bury the run.
            const still = subjects.filter(s => violations.has(s));
            assert.ok(still.length === 0, `${still.length} of ${subjects.length} still violate`);
        }, { file: FILE });
    }
    if (groups.length > 0) {
        test(`${title}: every known issue still reproduces`, () => {
            const stale = [...listed.keys()].filter(s => !violations.has(s));
            assert.deepEqual(stale, [], `stale known issue(s) of "${check}", remove them from ${FILE}`);
        });
    }
}
