// Fixture of tests/ci: a cut-down options/mzta-options-default.js, the head revision. Against the
// base: openai_comp gains a field (a generated key), reply_type changes its default, old_option is
// removed, new_option is added, and two excluded keys are added (chatgpt_win_height by an existing
// rule, api_webchat_font_scale by a new one).
export const special_prompts_with_integration = ['summarize'];

export const integration_options_config = {
    openai_comp: {
        host: { default: '', type: 'string' },
        model: { default: 'gpt', type: 'string' },
    },
};

const generated_prefs = {};
for (const [integration, fields] of Object.entries(integration_options_config)) {
    for (const [key, field] of Object.entries(fields)) {
        generated_prefs[`${integration}_${key}`] = field.default;
    }
}
special_prompts_with_integration.forEach(prefix => {
    generated_prefs[`${prefix}_use_specific_integration`] = false;
});

export const prefs_default = {
    ...generated_prefs,
    do_debug: false,
    reply_type: 'reply_sender',
    new_option: 'x',
    chatgpt_win_width: 700,
    chatgpt_win_height: 500,
    api_webchat_font_scale: 1,
};
