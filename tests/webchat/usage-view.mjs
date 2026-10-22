/*
 *  Reading an answer's usage chip and its popover, as the user sees them (spec 04 "Rendering in
 *  the chat window"). Shared by the usage files of the area. Nothing here imports jsdom.
 */

/** The chip wrapper (`.mzta-usage`) of a turn, wherever it sits (full bar or compact toolbar). */
export const usageWrap = turn => turn.querySelector('.turn-body .mzta-usage');
/** The chip itself: a <button> when it has a popover, a static <span> otherwise. */
export const usageChip = turn => usageWrap(turn)?.querySelector('.mzta-usage-chip') ?? null;
export const usagePopover = turn => usageWrap(turn)?.querySelector('.mzta-usage-popover') ?? null;

/** The chip's visible text, without the disclosure caret. */
export function chipText(turn) {
    const chip = usageChip(turn);
    if (!chip) return null;
    return [...chip.childNodes].filter(n => !(n.nodeType === 1 && n.classList.contains('caret')))
        .map(n => n.textContent).join('').trim();
}

/**
 * The popover's rows, in order: ['divider'], ['note', text], or [label, value, kind] where kind is
 * '' / 'sub' / 'total' / 'warn' (the row's is-* class).
 */
export function popoverRows(turn) {
    const pop = usagePopover(turn);
    if (!pop) return null;
    return [...pop.children].map(row => {
        if (row.classList.contains('mzta-usage-divider')) return ['divider'];
        if (row.classList.contains('mzta-usage-note')) return ['note', row.textContent];
        const kind = ['sub', 'total', 'warn'].find(k => row.classList.contains('is-' + k)) ?? '';
        return [row.querySelector('.label').textContent, row.querySelector('.value').textContent, kind];
    });
}

/** Spec 04: "Numbers use toLocaleString() with the browser locale". */
export const count = n => Number(n).toLocaleString();
/** Spec 04: the duration, one decimal, in seconds ("3.4 s", in the browser locale). */
export const DURATION_RE = /^\d+[.,]\d s$/;
