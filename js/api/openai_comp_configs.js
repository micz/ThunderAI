/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2025  Mic (m@micz.it)

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

/* Config properties for OpenAI API Comp 
    id: <unique ID>
    name: <AI services Name>
    chat_name: <AI Name used in the API webchat>
    host: <API endpoint>
    use_v1: <true/false> (keep "v1" path segment)
*/

export const openAICompConfigs = [
    {
        id: 'custom',
        name: browser.i18n.getMessage('Custom'),
        chat_name: 'OpenAI Comp API',
        host: '',
        use_v1: true,
    },
    {
        id: 'grok',
        name: 'Grok AI API',
        chat_name: 'Grok AI',
        host: 'https://api.x.ai',
        use_v1: true,
    },
    {
        id: 'mistral',
        name: 'Mistral AI API',
        chat_name: 'Mistral AI',
        host: 'https://api.mistral.ai',
        use_v1: true,
    },
];