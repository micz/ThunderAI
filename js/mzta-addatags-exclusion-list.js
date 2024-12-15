

export async function addTags_getExclusionList() {
    let prefs_excluded_tags = await browser.storage.local.get({add_tags_exclusions: []});
    return prefs_excluded_tags.add_tags_exclusions;
}

export function addTags_setExclusionList(add_tags_exclusions) {
    browser.storage.local.set({add_tags_exclusions: add_tags_exclusions});
}