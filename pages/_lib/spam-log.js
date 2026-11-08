/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/*
 *  The rows of a spam log table, shared by the Spam Filter page (the 20 newest reports) and the
 *  storage management page (the spam entry list). The eight columns, in this order: Message-ID,
 *  message date, sender, subject, score, moved (with the threshold), explanation, report date.
 *  A page may add cells of its own after them (extraCells). The styles are each page's own.
 */

/** Text of a header value that may be an array of MIME headers (subject, from): joined. */
export function headerText(value) {
    return Array.isArray(value) ? value.join(", ") : (value ?? "");
}

/**
 * Fill a tbody with one row per report (taSpamReport.toReport() shape), in order.
 *
 * @param {HTMLElement} tableBody
 * @param {object[]} data
 * @param {object} [opts]
 *   emptyText   what the single row says when there is no report (default: none saved yet)
 *   colSpan     the columns of that row (default 8)
 *   extraCells  (report) => HTMLElement[]: cells appended to the row after the eight
 */
export function renderSpamReportRows(tableBody, data, { emptyText = null, colSpan = 8, extraCells = null } = {}) {
    tableBody.innerHTML = "";

    // With nothing to show, the placeholder goes in a row: replacing the table's
    // content would remove the header row and the tbody itself.
    if (!Array.isArray(data) || data.length === 0) {
        const emptyRow = document.createElement("tr");
        const emptyCell = document.createElement("td");
        emptyCell.colSpan = colSpan;
        emptyCell.textContent = emptyText || browser.i18n.getMessage("spamfilter_no_reports");
        emptyRow.appendChild(emptyCell);
        tableBody.appendChild(emptyRow);
        return;
    }

    data.forEach(report => {
        const row = document.createElement("tr");

        // The cells that CSS truncates (message id, from, subject, explanation)
        // also carry the full value in their title attribute, so nothing is
        // lost: it is echoed user data, never a translatable string.
        const tdHeaderMessageId = document.createElement("td");
        tdHeaderMessageId.textContent = report.headerMessageId;
        tdHeaderMessageId.title = report.headerMessageId ?? "";
        row.appendChild(tdHeaderMessageId);

        const tdMessageDate = document.createElement("td");
        tdMessageDate.textContent = report.message_date ? new Date(report.message_date).toLocaleString() : "";
        row.appendChild(tdMessageDate);

        const tdFrom = document.createElement("td");
        tdFrom.textContent = headerText(report.from);
        tdFrom.title = tdFrom.textContent;
        row.appendChild(tdFrom);

        const tdSubject = document.createElement("td");
        tdSubject.textContent = headerText(report.subject);
        tdSubject.title = tdSubject.textContent;
        row.appendChild(tdSubject);

        const tdSpamValue = document.createElement("td");
        tdSpamValue.textContent = report.spamValue;
        row.appendChild(tdSpamValue);

        const tdMoved = document.createElement("td");
        tdMoved.textContent = (report.moved ? browser.i18n.getMessage("yes_string") : browser.i18n.getMessage("no_string")) + ` (${report.SpamThreshold})`;
        row.appendChild(tdMoved);

        // The explanation goes in an inner block so it can scroll on its own
        // (see .expl_box): overflow on the td itself would be ignored, because
        // a table-cell takes its height from the row.
        const tdExplanation = document.createElement("td");
        tdExplanation.className = "expl_cell";
        const explBox = document.createElement("div");
        explBox.className = "expl_box";
        explBox.textContent = report.explanation ?? "";
        // Title on the text box, not on the cell: on the cell it would also
        // cover the resize strip and pop up a tooltip mid-drag.
        explBox.title = report.explanation ?? "";
        tdExplanation.appendChild(explBox);
        // Grab strip on the bottom border of the cell: dragging it grows just
        // this row (see attachRowResizer).
        const resizer = document.createElement("div");
        resizer.className = "row_resizer";
        tdExplanation.appendChild(resizer);
        row.appendChild(tdExplanation);

        const tdReportDate = document.createElement("td");
        tdReportDate.textContent = new Date(report.report_date).toLocaleString();
        row.appendChild(tdReportDate);

        if (extraCells) extraCells(report).forEach(cell => row.appendChild(cell));

        tableBody.appendChild(row);
    });
}

/**
 * Makes every explanation cell vertically resizable by dragging the thin
 * strip on its bottom border.
 *
 * The handler is attached once, on the table body, rather than per row:
 * renderSpamReportRows() rebuilds every row on each refresh, and per-row
 * listeners would be re-registered each time (and leak the old nodes).
 *
 * The drag sets an inline max-height on the row’s own .expl_box. It cannot
 * set a height on the <tr>, because a table row derives its height from its
 * tallest cell and ignores the value. Heights are deliberately not persisted:
 * they last for the life of the page, so no new preference is needed.
 */
export function attachRowResizer(tableBody) {
    if (!tableBody) return;

    const MIN_HEIGHT = 28;   // roughly one line, so a row cannot be collapsed away
    let box = null;          // .expl_box being resized
    let handle = null;
    let startY = 0;
    let startHeight = 0;

    tableBody.addEventListener("pointerdown", (event) => {
        const target = event.target;
        if (!target.classList.contains("row_resizer")) return;

        box = target.parentElement.querySelector(".expl_box");
        if (!box) return;

        handle = target;
        startY = event.clientY;
        startHeight = box.getBoundingClientRect().height;

        // Capture keeps the events coming even when the pointer outruns the 7px
        // strip, which it always does on a fast drag.
        handle.setPointerCapture(event.pointerId);
        handle.classList.add("dragging");
        document.body.classList.add("mzta_row_resizing");
        event.preventDefault();
    });

    tableBody.addEventListener("pointermove", (event) => {
        if (!box) return;
        const height = Math.max(MIN_HEIGHT, startHeight + (event.clientY - startY));
        box.style.maxHeight = height + "px";
    });

    const endDrag = (event) => {
        if (!box) return;
        if (handle) {
            if (event && handle.hasPointerCapture?.(event.pointerId)) {
                handle.releasePointerCapture(event.pointerId);
            }
            handle.classList.remove("dragging");
        }
        document.body.classList.remove("mzta_row_resizing");
        box = null;
        handle = null;
    };

    tableBody.addEventListener("pointerup", endDrag);
    tableBody.addEventListener("pointercancel", endDrag);
}
