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
// Firefox 115 and, consequently, Thunderbird 115 are not compatible with Intl.Segmenter.
// ChatGPT is using Intl.Segmenter, so we have to do something about it or it won't work...

(function() {
    if (!('Segmenter' in Intl)) {
        class Segmenter {
            constructor(locale = 'en', options = { granularity: 'grapheme' }) {
                this.locale = locale;
                this.granularity = options.granularity || 'grapheme';
            }

            segment(text) {
                switch (this.granularity) {
                    case 'word':
                        return text.split(/\s+/).filter(word => word.length > 0).map(word => ({ segment: word }));
                    case 'grapheme':
                        return Array.from(text).map(char => ({ segment: char }));
                    case 'sentence':
                        return text.split(/(?<=[.!?])\s+/).map(sentence => ({ segment: sentence }));
                    default:
                        return [{ segment: text }];
                }
            }
        }

        Intl.Segmenter = Segmenter;
        // console.log('Intl.Segmenter polyfill correctly loaded.');
    }
    // else {
    //     console.log('Intl.Segmenter is already supported.');
    // }
})();
