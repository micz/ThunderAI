// Fixture of tests/ci: a cut-down options/mzta-options-default.js, the base revision. Like the real
// one it imports nothing, and part of prefs_default is generated.
export const special_prompts_with_integration = ['summarize'];

export const integration_options_config = {
    openai_comp: {
        host: { default: '', type: 'string' },
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
    reply_type: 'reply_all',
    old_option: true,
    chatgpt_win_width: 700,
};
