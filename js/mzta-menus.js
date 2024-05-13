/*
 *  ThunderAI [https://micz.it/thunderdbird-addon-thunderai/]
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

// Some original methods are derived from https://github.com/ali-raheem/Aify/blob/cfadf52f576b7be3720b5b73af7c8d3129c054da/plugin/html/actions.js

import { getPrompts } from './mzta-prompts.js';
import { getLanguageDisplayName, getMenuContextCompose, getMenuContextDisplay } from './mzta-utils.js'

export class mzta_Menus {

    allPrompts = [];
    openChatGPT = null;
    menu_context_compose = null;
    menu_context_display = null;
    menu_listeners = {};

    rootMenu = [
    //{ id: 'ItemC', act: (info, tab) => { console.log('ItemC', info, tab, info.menuItemId); alert('ItemC') } },
    ];

    constructor(openChatGPT) {
        this.menu_context_compose = getMenuContextCompose();
        this.menu_context_display = getMenuContextDisplay();
        this.openChatGPT = openChatGPT;
        this.allPrompts = [];
    }


    async initialize() {
        this.allPrompts = await getPrompts();
        this.allPrompts.forEach((prompt) => {
            this.addAction(prompt)
        });
        //this.addMenu(this.rootMenu);
    }

    async reload(){
        this.rootMenu = [];
        await this.initialize();
        this.loadMenus();
    }

    addAction = (curr_prompt) => {

        let curr_menu_entry = {id: curr_prompt.id };
    
        const getHighlight = async () => {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            return {tabId: tabs[0].id, 
                selection: await browser.tabs.sendMessage(tabs[0].id, { command: "getSelectedText" }),
                text: await browser.tabs.sendMessage(tabs[0].id, { command: "getTextOnly" })
            };
        };
    
        curr_menu_entry.act = async () => {
            const msg_text = await getHighlight();
    
            //check if a selection is needed
            if(curr_prompt.need_selected && (msg_text.selection==='')){
                //A selection is needed, but nothing is selected!
                //alert(browser.i18n.getMessage('prompt_selection_needed'));
                const tabs = await browser.tabs.query({ active: true, currentWindow: true });
                browser.tabs.sendMessage(tabs[0].id, { command: "sendAlert", message : browser.i18n.getMessage('prompt_selection_needed') });
                return;
            }
    
            var body_text = '';
            if (msg_text.selection!=='') {
                body_text = msg_text.selection.replace(/\s+/g, ' ').trim();
            } else {
                body_text = msg_text.text.replace(/\s+/g, ' ').trim();
            }
            //open chatgpt window
            //console.log("Click menu item...");
            let prefs = await browser.storage.sync.get({default_chatgpt_lang: getLanguageDisplayName(browser.i18n.getUILanguage())});
            let chatgpt_lang = prefs.default_chatgpt_lang;
    
            var fullPrompt = curr_prompt.text + (curr_prompt.need_signature ? " " + await this.getDefaultSignature():"") + " " + browser.i18n.getMessage("prompt_lang") + chatgpt_lang + ". \"" + body_text + "\" ";
    
            switch(curr_prompt.id){
                case 'prompt_translate_this':
                    fullPrompt = curr_prompt.text + chatgpt_lang + ". \"" + body_text + "\" ";
                    break;
                case 'prompt_reply':
                    fullPrompt += "Do not add the subject line to the response."
                    break;
                default:
                    break;
            }

            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            // add custom text if needed
            //browser.runtime.sendMessage({command: "chatgpt_open", prompt: fullPrompt, action: curr_prompt.action, tabId: tabs[0].id});
            this.openChatGPT(fullPrompt, curr_prompt.action, tabs[0].id, curr_prompt.need_custom_text);
        };
        this.rootMenu.push(curr_menu_entry);
    };

    async getDefaultSignature(){
        let prefs = await browser.storage.sync.get({default_sign_name: ''});
        if(prefs.default_sign_name===''){
            return '';
        }else{
            return "Sign the message as " + prefs.default_sign_name + ".";
        }
    }

    async loadMenus() {
        await this.initialize();
        this.addMenu(this.rootMenu);
        let listeners = this.menu_listeners;
        browser.menus.onClicked.addListener((info, tab) => {
            listeners[info.menuItemId] && listeners[info.menuItemId] (info, tab);
          });
    }

    addMenu = (menu, root = null) => {
        for (let item of menu) {
          let {id, menu, act} = item;

          browser.menus.create({
            id: id,
            title: this.getCustomTextAttribute(id) + (browser.i18n.getMessage(id) || id),
            contexts: this.getContexts(id),
            parentId: root
          });
      
          if (act) {
            this.menu_listeners[id] = act;
          }
      
          if (menu) {
            this.addMenu(menu, id);
          }
        }
      
    };

    getContexts(id){
        console.log(">>>>>>>>> id: " + id);
        const curr_prompt = this.allPrompts.find(p => p.id === id);
        console.log(">>>>>>>>>> curr_prompt: " + JSON.stringify(curr_prompt));
        if (!curr_prompt) {
          return [];
        }
        switch(curr_prompt.type){
            case "0": console.log(">>>>>>>>>> curr_prompt.type: " + curr_prompt.type);
                return [this.menu_context_compose, this.menu_context_display];
            case "1":
                return [this.menu_context_display];
            case "2":
                return [this.menu_context_compose];
            default:
                return [];
        }

    }

    getCustomTextAttribute(id){
        const curr_prompt = this.allPrompts.find(p => p.id === id);
        if (!curr_prompt) {
          return "";
        }
        if(curr_prompt.need_custom_text === "1"){
            return "*";
        }else{
            return "";
        }
    }

}