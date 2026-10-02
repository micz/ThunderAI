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

import { mztaPrefs } from './mzta-prefs.js';

// add_tags_exclusions is a declared preference (prefs_default), so it is read and written
// through js/mzta-prefs.js like every other one: that is what applies the enterprise policy
// (locked > stored > unlocked > default) and the write guard. The same storage key as
// before, so existing lists are picked up unchanged.
//
// js/mzta-compose-script.js cannot import this module (it is a classic content script): it
// goes through the "addtags_get_exclusion_prefs" / "addtags_set_exclusions" background
// commands instead, which call these two.
export async function addTags_getExclusionList() {
    return await mztaPrefs.getPref('add_tags_exclusions');
}

export function addTags_setExclusionList(add_tags_exclusions) {
    return mztaPrefs.setPref('add_tags_exclusions', add_tags_exclusions);
}

export function checkExcludedTag(tag, excluded_word, exact_match = false) {
    // Check if the tag is in the exclusion list
    if (excluded_word === '') {
        return false; // No exclusion word, so no exclusion
    }
    if(exact_match) {
        return tag.toLowerCase() === excluded_word.toLowerCase();
    }
    return tag.toLowerCase().includes(excluded_word.toLowerCase());
}