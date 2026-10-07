/*
 *  What "nothing executable" means for a message-display panel, as a list of problems.
 *
 *  Spec 01 "Panel HTML sanitization" (defense in depth in the content script): _renderSafeHtml()
 *  removes `script, img, style, link, iframe, frame, frameset, object, embed, form, meta, base,
 *  svg, math, template, noscript`, every `on*` and `style` attribute, and `javascript:` /
 *  `vbscript:` / `data:` URLs. The checks below are that list, applied to the rendered subtree
 *  with the browser's own reading of a URL: the scheme is what remains once the C0 controls and
 *  spaces a browser strips or ignores are gone, in any case.
 *
 *  Written for the area, from the spec; it imports nothing.
 */

/** Spec 01: the elements the content script removes from a panel payload. */
export const UNSAFE_TAGS = ['script', 'img', 'style', 'link', 'iframe', 'frame', 'frameset', 'object',
    'embed', 'form', 'meta', 'base', 'svg', 'math', 'template', 'noscript'];

/** The attributes a browser reads as a URL to navigate to, load or submit to. */
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'srcdoc',
    'background', 'poster', 'codebase', 'cite', 'longdesc', 'lowsrc', 'dynsrc', 'ping']);

const UNSAFE_SCHEME = /^(javascript|vbscript|data):/i;

/** A URL attribute value the way a browser reads its scheme. */
const scheme = v => String(v).replace(/[\u0000- \u007f-\u009f]/g, '');

/** Every problem with `root`'s subtree, as strings; [] when nothing executable is left. */
export function executableProblems(root) {
    const problems = [];
    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) {
        const tag = el.localName.toLowerCase();
        if (el !== root && UNSAFE_TAGS.includes(tag)) problems.push(`<${tag}> element`);
        if (el === root) continue;
        for (const attr of el.attributes) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on')) problems.push(`${name} on <${tag}>`);
            // The panel's own style, set after the sanitizing (every <p> gets margin-block-start: 0).
            const own = tag === 'p' && /^\s*margin-block-start:\s*0(px)?;?\s*$/i.test(attr.value);
            if (name === 'style' && !own) problems.push(`style="${attr.value}" on <${tag}>`);
            if (URL_ATTRS.has(name) && UNSAFE_SCHEME.test(scheme(attr.value))) {
                problems.push(`${name}="${attr.value}" on <${tag}>`);
            }
        }
    }
    return problems;
}
