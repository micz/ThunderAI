/*
 *  The Thunderbird APIs the background needs beyond the core mock, modelled for this area only.
 *
 *  The core browser mock (../helpers/core/browser-mock.mjs) models storage, runtime, i18n,
 *  accounts and the tag list. The background also reads and moves mail, talks to tabs and builds
 *  menus. Those APIs are added here, on one context, by the `decorate` step of ./context.mjs -
 *  never by a plugin, which would change what every other area's strict proxy reports.
 *
 *  One model = one mail store and one window:
 *
 *    accounts / folders  {id, accountId, name, path, specialUse: [...]}
 *    messages            {id, headerMessageId, folderId, author, subject, date, text, tags, junk}
 *                        (the text/plain part only: the HTML path of the body reading needs a
 *                        DOM, and belongs to the compose area)
 *    tabs                {id, type, windowId, active, displayed: message id | null, reachable,
 *                        isPlainText: the format of a messageCompose tab}
 *    menus               the items created, by id
 *
 *  Every namespace added is STRICT: reading a property it does not model throws ("unmodelled
 *  API browser.tabs.foo") and is recorded in `unmodelled`, so a background path the model
 *  does not cover fails loudly instead of reading undefined.
 *
 *  What the background sends a tab is recorded in `tabSends` ({tabId, message}); a send to a tab
 *  that is not `reachable` rejects with Thunderbird's #901 TypeError, a send to a missing tab
 *  with "Invalid tab ID". Moves give the message a NEW id, as Thunderbird does, so the old id no
 *  longer resolves.
 *
 *  Not a test file (no .test.mjs suffix). Imports nothing.
 */

const clone = v => (v === undefined ? undefined : structuredClone(v));

function makeEvent() {
    const listeners = [];
    return {
        _listeners: listeners,
        /** The extra arguments of each addListener() call (e.g. monitorAllFolders). */
        _extraArgs: [],
        addListener(fn, ...extra) { if (!listeners.includes(fn)) { listeners.push(fn); this._extraArgs.push(extra); } },
        removeListener(fn) { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); },
        hasListener(fn) { return listeners.includes(fn); },
    };
}

/** A namespace object that throws (and records) on any property it does not define. */
function strict(path, target, unmodelled) {
    return new Proxy(target, {
        get(t, prop, recv) {
            if (typeof prop === 'symbol' || prop in t) return Reflect.get(t, prop, recv);
            // An awaited namespace (or an inspected one) must not throw.
            if (prop === 'then' || prop === 'toJSON') return undefined;
            unmodelled.push(path + '.' + prop);
            throw new Error('unmodelled API ' + path + '.' + prop + ' (tests/background/apis.mjs)');
        },
    });
}

/**
 * A fresh model.
 *
 * @param {object} o
 *   accounts  [{id, name}]                      default one account, 'acc1'
 *   folders   [{id, accountId, name, path, specialUse}]   default, in acc1: f-inbox, f-junk,
 *             f-trash, f-sent, f-drafts, f-templates, f-outbox, f-archives (each with its
 *             specialUse) and f-lists, a plain folder
 *   tags      [{key, tag, color, ordinal}]      the tag list (replaces the core one)
 */
export function mailModel(o = {}) {
    const accounts = clone(o.accounts ?? [{ id: 'acc1', name: 'Account 1' }]);
    const folders = new Map();
    for (const f of clone(o.folders ?? [
        { id: 'f-inbox', accountId: 'acc1', name: 'Inbox', path: '/INBOX', specialUse: ['inbox'] },
        { id: 'f-junk', accountId: 'acc1', name: 'Junk', path: '/Junk', specialUse: ['junk'] },
        { id: 'f-trash', accountId: 'acc1', name: 'Trash', path: '/Trash', specialUse: ['trash'] },
        { id: 'f-sent', accountId: 'acc1', name: 'Sent', path: '/Sent', specialUse: ['sent'] },
        { id: 'f-drafts', accountId: 'acc1', name: 'Drafts', path: '/Drafts', specialUse: ['drafts'] },
        { id: 'f-templates', accountId: 'acc1', name: 'Templates', path: '/Templates', specialUse: ['templates'] },
        { id: 'f-outbox', accountId: 'acc1', name: 'Outbox', path: '/Outbox', specialUse: ['outbox'] },
        { id: 'f-archives', accountId: 'acc1', name: 'Archives', path: '/Archives', specialUse: ['archives'] },
        { id: 'f-lists', accountId: 'acc1', name: 'Lists', path: '/Lists', specialUse: [] },
    ])) folders.set(f.id, f);
    const messages = new Map();
    let nextId = 1;
    const m = {
        accounts,
        folders,
        messages,
        tags: clone(o.tags ?? []),
        tabs: [],
        /** The windows opened ({id, url, type}): the API chat window. */
        windows: [],
        /** The replies opened (compose.beginReply()): {messageId, replyType, details, tabId}. */
        replies: [],
        menus: new Map(),
        /** Every menus.create() of a duplicate id, and every update/remove of a missing one. */
        menuErrors: [],
        /** Every call to the modelled APIs, in order: {api, args}. */
        calls: [],
        tabSends: [],
        icons: [],
        unmodelled: [],
        permissions: new Set(o.permissions ?? []),
        contacts: clone(o.contacts ?? []),
        /** Message ids getFull() fails on (a filter moved the message after the event). */
        failGetFull: new Set(),
        /** The later pages of the MessageLists handed out, by list id (continueList()). */
        listPages: new Map(),
        /** The window tabs.query({currentWindow: true}) answers for. */
        currentWindow: 1,
        nextListId: 1,

        /** Add a message, return its MessageHeader. */
        addMessage(msg) {
            const id = msg.id ?? nextId++;
            if (id >= nextId) nextId = id + 1;
            const hid = msg.headerMessageId ?? ('msg' + id + '@example.test');
            const rec = {
                id,
                headerMessageId: hid,
                folderId: msg.folderId ?? 'f-inbox',
                author: msg.author ?? 'Sender <sender@example.test>',
                subject: msg.subject ?? ('Subject ' + id),
                date: msg.date ?? '2026-01-01T10:00:00.000Z',
                // The body names the message, so a prompt built from it says which one it is for.
                text: msg.text ?? ('Body of <' + hid + '>'),
                tags: clone(msg.tags ?? []),
                junk: false,
            };
            if (!folders.has(rec.folderId)) throw new Error('mailModel: no folder ' + rec.folderId);
            messages.set(id, rec);
            return m.header(id);
        },

        /** The MessageHeader of message `id`, as the API returns it. */
        header(id) {
            const r = messages.get(id);
            if (!r) return null;
            const f = folders.get(r.folderId);
            return {
                id: r.id,
                headerMessageId: r.headerMessageId,
                author: r.author,
                subject: r.subject,
                date: r.date,
                folder: { id: f.id, accountId: f.accountId, name: f.name, path: f.path, specialUse: clone(f.specialUse) },
                tags: clone(r.tags),
                junk: r.junk,
            };
        },

        /** The message with this headerMessageId, or null (after a move its id changed). */
        byHeaderId(hid) {
            for (const r of messages.values()) if (r.headerMessageId === hid) return m.header(r.id);
            return null;
        },

        /** Move message `id` to `folderId` like Thunderbird: it gets a new id. */
        moveTo(id, folderId) {
            const r = messages.get(id);
            if (!r) throw new Error('mailModel: no message ' + id);
            messages.delete(id);
            r.id = nextId++;
            r.folderId = folderId;
            messages.set(r.id, r);
            return r.id;
        },

        /** A MessageList over these headers, paged by `pageSize` (continueList() serves the rest). */
        messageList(headers, pageSize = 100) {
            const pages = [];
            for (let i = 0; i < headers.length; i += pageSize) pages.push(headers.slice(i, i + pageSize));
            if (pages.length === 0) pages.push([]);
            const base = 'list-' + (m.nextListId++);
            const idAt = i => (i < pages.length - 1 ? base + '-' + i : null);
            for (let i = 0; i < pages.length - 1; i++) m.listPages.set(idAt(i), { id: idAt(i + 1), messages: pages[i + 1] });
            return { id: idAt(0), messages: pages[0] };
        },

        /** Open a tab. `displayed` is a message id (or null); returns the tab id. */
        addTab({ id, type = 'mail', windowId = 1, active = false, displayed = null, reachable = true, selected = null, isPlainText = false } = {}) {
            const tab = { id: id ?? (100 + m.tabs.length), type, windowId, active, displayed, reachable, selected, isPlainText };
            m.tabs.push(tab);
            return tab.id;
        },
        tab(id) { return m.tabs.find(t => t.id === id) || null; },
        /** The messages sent to a tab (or to every tab), optionally of one command. */
        sentTo(tabId = null, command = null) {
            return m.tabSends
                .filter(s => (tabId === null || s.tabId === tabId) && (command === null || s.message?.command === command))
                .map(s => s.message);
        },
        /** The commands sent to a tab, in order. */
        commandsTo(tabId) { return m.sentTo(tabId).map(x => x.command); },
    };
    return m;
}

/**
 * Add the modelled namespaces to `browser` (the core mock's). Called by the `decorate` step of
 * ./context.mjs, after the mock is installed and before any background module is imported.
 */
export function installApis(browser, m) {
    const rec = (api, args) => m.calls.push({ api, args: clone(args) });
    const u = m.unmodelled;

    const tabInfo = t => ({ id: t.id, type: t.type, windowId: t.windowId, active: t.active });

    browser.messages = strict('browser.messages', {
        onNewMailReceived: makeEvent(),
        async get(id) {
            rec('messages.get', [id]);
            const h = m.header(id);
            if (!h) throw new Error('Message not found: ' + id);
            return h;
        },
        async getFull(id) {
            rec('messages.getFull', [id]);
            const r = m.messages.get(id);
            if (!r || m.failGetFull.has(id)) throw new Error('Error getting the full message ' + id);
            return {
                contentType: 'message/rfc822',
                headers: { subject: [r.subject], from: [r.author], 'message-id': ['<' + r.headerMessageId + '>'] },
                parts: [{ contentType: 'text/plain', body: r.text, partName: '1' }],
            };
        },
        async listInlineTextParts(id) {
            rec('messages.listInlineTextParts', [id]);
            const r = m.messages.get(id);
            if (!r) throw new Error('Message not found: ' + id);
            return [{ contentType: 'text/plain', content: r.text }];
        },
        async query(q) {
            rec('messages.query', [q]);
            const all = [...m.messages.keys()].map(id => m.header(id));
            const hits = (q && q.headerMessageId) ? all.filter(h => h.headerMessageId === q.headerMessageId) : all;
            return { id: null, messages: hits };
        },
        async continueList(listId) {
            rec('messages.continueList', [listId]);
            const page = m.listPages.get(listId);
            if (!page) throw new Error('Invalid message list id ' + listId);
            return clone(page);
        },
        async update(id, props) {
            rec('messages.update', [id, props]);
            const r = m.messages.get(id);
            if (!r) throw new Error('Message not found: ' + id);
            if ('junk' in props) r.junk = props.junk;
            if ('tags' in props) r.tags = clone(props.tags);
        },
        async move(ids, folderId) {
            rec('messages.move', [ids, folderId]);
            if (!m.folders.has(folderId)) throw new Error('Folder not found: ' + folderId);
            for (const id of ids) m.moveTo(id, folderId);
        },
        tags: strict('browser.messages.tags', {
            async list() {
                rec('messages.tags.list', []);
                return clone(m.tags);
            },
            async create(key, tag, color) {
                rec('messages.tags.create', [key, tag, color]);
                if (m.tags.some(t => t.key === key)) throw new Error('Tag key exists: ' + key);
                m.tags.push({ key, tag, color, ordinal: '' });
            },
        }, u),
    }, u);

    browser.folders = strict('browser.folders', {
        async query(q = {}) {
            rec('folders.query', [q]);
            return [...m.folders.values()].filter(f =>
                (!q.accountId || f.accountId === q.accountId) &&
                (!q.specialUse || q.specialUse.every(s => f.specialUse.includes(s)))).map(clone);
        },
    }, u);

    browser.messageDisplay = strict('browser.messageDisplay', {
        async getDisplayedMessage(tabId) {
            rec('messageDisplay.getDisplayedMessage', [tabId]);
            const t = m.tab(tabId);
            if (!t) throw new Error('Invalid tab ID: ' + tabId);
            return t.displayed == null ? null : m.header(t.displayed);
        },
    }, u);

    browser.mailTabs = strict('browser.mailTabs', {
        async getSelectedMessages(tabId) {
            rec('mailTabs.getSelectedMessages', [tabId]);
            const t = m.tab(tabId);
            if (!t || t.type !== 'mail') throw new Error('Invalid tab ID: ' + tabId);
            return m.messageList((t.selected || []).map(id => m.header(id)).filter(Boolean));
        },
    }, u);

    browser.tabs = strict('browser.tabs', {
        onUpdated: makeEvent(),
        async query(q = {}) {
            rec('tabs.query', [q]);
            return m.tabs.filter(t => (q.active === undefined || t.active === q.active)
                && (!q.currentWindow || t.windowId === m.currentWindow)).map(tabInfo);
        },
        async sendMessage(tabId, message) {
            rec('tabs.sendMessage', [tabId, message]);
            const t = m.tab(tabId);
            if (!t) throw new Error('Invalid tab ID: ' + tabId);
            if (!t.reachable) throw new TypeError('(intermediate value).getAttribute is not a function');
            m.tabSends.push({ tabId, message: clone(message) });
            return true;
        },
    }, u);

    const icon = which => ({
        setIcon(details) { m.icons.push({ which, path: details.path }); return Promise.resolve(); },
        openPopup() { rec(which + '.openPopup', []); return Promise.resolve(); },
    });
    browser.messageDisplayAction = strict('browser.messageDisplayAction', icon('messageDisplayAction'), u);
    browser.composeAction = strict('browser.composeAction', icon('composeAction'), u);

    browser.menus = strict('browser.menus', {
        onClicked: makeEvent(),
        async removeAll() {
            rec('menus.removeAll', []);
            m.menus.clear();
        },
        create(props, cb) {
            rec('menus.create', [props]);
            if (m.menus.has(props.id)) {
                // Thunderbird reports a duplicate id through runtime.lastError in the callback.
                m.menuErrors.push('duplicate id ' + props.id);
            } else {
                m.menus.set(props.id, clone(props));
            }
            if (cb) queueMicrotask(cb);
            return props.id;
        },
    }, u);

    // Only what opening the API chat window takes (openChatGPT()): the window itself is the
    // webchat area's. Each window gets one tab, whose content never answers.
    browser.windows = strict('browser.windows', {
        async create(opts) {
            rec('windows.create', [opts]);
            const id = 900 + m.windows.length;
            m.windows.push({ id, url: opts.url, type: opts.type });
            return { id, tabs: [{ id: id * 10 }] };
        },
    }, u);

    // Only the format of a compose window (isPlainTextCompose()) and the opening of a reply
    // (chatgpt_replyMessage): what the compose script does with what it is sent is the compose
    // area's. A reply opens a reachable messageCompose tab of the given format (`replyPlainText`
    // on the model), already loaded.
    browser.compose = strict('browser.compose', {
        async getComposeDetails(tabId) {
            rec('compose.getComposeDetails', [tabId]);
            const t = m.tab(tabId);
            if (!t || t.type !== 'messageCompose') throw new Error('Invalid compose tab: ' + tabId);
            return { isPlainText: t.isPlainText === true };
        },
        async beginReply(messageId, replyType, details) {
            rec('compose.beginReply', [messageId, replyType, details]);
            if (!m.messages.has(messageId)) throw new Error('Message not found: ' + messageId);
            const tabId = m.addTab({ type: 'messageCompose', windowId: 50 + m.replies.length, isPlainText: m.replyPlainText === true });
            m.replies.push({ messageId, replyType, details: clone(details), tabId });
            return { ...tabInfo(m.tab(tabId)), status: 'complete', url: 'chrome://messenger/content/messengercompose/messengercompose.xhtml' };
        },
    }, u);

    browser.permissions = strict('browser.permissions', {
        onRemoved: makeEvent(),
        async contains(q) {
            rec('permissions.contains', [q]);
            return (q.permissions || []).every(p => m.permissions.has(p));
        },
    }, u);

    browser.contacts = strict('browser.contacts', {
        async quickSearch(q) {
            rec('contacts.quickSearch', [q]);
            const s = String(q.searchString || q).toLowerCase();
            return clone(m.contacts.filter(c => Object.values(c.properties).some(v => String(v).toLowerCase() === s)));
        },
    }, u);
}

/** The menus created, as [{id, title, parentId, icons}] in creation order. */
export function menuItems(m) {
    return [...m.menus.values()].map(p => ({ id: p.id, title: p.title, parentId: p.parentId ?? null, icons: p.icons ?? null, contexts: p.contexts }));
}
