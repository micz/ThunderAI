/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024  Mic (m@micz.it)

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

// These methods are also defined in the file /js/mzta-compose-script.js

export async function addTags_getExclusionList() {
    let prefs_excluded_tags = await browser.storage.local.get({add_tags_exclusions: []});
    return prefs_excluded_tags.add_tags_exclusions;
}

export function addTags_setExclusionList(add_tags_exclusions) {
    browser.storage.local.set({add_tags_exclusions: add_tags_exclusions});
}