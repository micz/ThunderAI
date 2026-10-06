/*
 *  Querying through the chat window's open shadow roots.
 *
 *  The window is built from custom elements, each with an open shadow root (<messages-area>,
 *  <message-input>, <split-button>, <diff-picker>). A selector cannot cross a shadow boundary, so
 *  a path of selectors is used instead: the first is looked up in `root`, each next one in the
 *  previous match's shadow root.
 *
 *      sq(document, 'messages-area', '#messages')            the transcript
 *      sqa(turn, 'split-button', '.dropdown-menu button')    inside a split button of a turn
 *
 *  Only `shadowRoot` (the public, open-mode property) is read: nothing private of the components.
 *  Nothing here imports jsdom.
 */

/** The element at the end of a selector path, or null. A step whose element has no open shadow
 *  root throws: the path itself is wrong. */
export function sq(root, ...path) {
    let scope = root;
    let el = null;
    for (const [i, sel] of path.entries()) {
        if (i > 0) {
            scope = el.shadowRoot;
            if (!scope) throw new Error('sq: <' + el.localName + '> (from "' + path[i - 1] + '") has no open shadow root');
        }
        el = scope.querySelector(sel);
        if (el === null) return null;
    }
    return el;
}

/** Every element matching the last selector, inside the element the rest of the path leads to. */
export function sqa(root, ...path) {
    const last = path.pop();
    let scope = root;
    if (path.length > 0) {
        const host = sq(root, ...path);
        if (host === null) return [];
        scope = host.shadowRoot;
        if (!scope) throw new Error('sqa: <' + host.localName + '> has no open shadow root');
    }
    return [...scope.querySelectorAll(last)];
}

/** Every element under `root`, descending into open shadow roots and <template> contents. */
export function* deepElements(root) {
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        const kids = node.content && node.localName === 'template'
            ? [...node.children, ...node.content.children]
            : [...(node.children || [])];
        if (node.shadowRoot) kids.push(...node.shadowRoot.children);
        for (let i = kids.length - 1; i >= 0; i--) {
            yield kids[i];
            stack.push(kids[i]);
        }
    }
}
