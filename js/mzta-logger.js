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

export class taLogger {

    do_debug = false;
    prefix = "";

    constructor(prefix, do_debug) {
        this.do_debug = do_debug;
        this.prefix = "[ThunderAI Logger | " + prefix + "] ";
    }

    log(msg, do_debug = -1) {
        if(do_debug !== -1) this.do_debug = do_debug;
        if(this.do_debug === true) console.log(this.prefix + msg);
    }

    error(msg) {
        console.error(this.prefix + msg);
    }

    warn(msg) {
        console.warn(this.prefix + msg);
    }  
};