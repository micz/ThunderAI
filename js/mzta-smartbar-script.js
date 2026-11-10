/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2026  Mic (m@micz.it)

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

/*
 *  The SmartBar in the message pane (claude-spec/10-smartbar.md "SmartBar UI").
 *
 *  A classic content script, registered after js/mzta-compose-script.js for the message display
 *  only (mzta-background.js). Everything it draws lives in the shadow root of ONE host element,
 *  #mzta-smartbar-host, which the compose script's extraction skips (MZTA_INJECTED_SELECTORS), so
 *  nothing typed here ever reaches a prompt as mail content.
 *
 *  It reads no preference and no storage: the background answers smartbar_get_state at load,
 *  then pushes smartbar_config (the settings changed), smartbar_update (the state of the last
 *  instruction of this message, with a sequence number: an older one is ignored) and
 *  smartbar_thinking (the router's reasoning, at most every 250 ms, never stored).
 *
 *  Static, not sticky: the bar sits in the flow above the mail like the other panels, so it never
 *  covers the text of a long message. Hidden when printing.
 *
 *  Wrapped in a function: the content scripts of a document share one global scope, and the
 *  compose script declares top-level names of its own.
 */
(function () {
  const HOST_ID = 'mzta-smartbar-host';
  const msg = (key, subs) => browser.i18n.getMessage(key, subs) || key;

  // A previous instance (the extension reloaded, the script injected again into an open tab)
  // leaves its host behind: replaced by this one.
  document.getElementById(HOST_ID)?.remove();

  let config = { enabled: false, mode: 'compact', defaultDestination: 'execute', historySize: 0 };
  let ownId = null;          // the headerMessageId this document displays
  let lastSeq = -1;          // the newest update drawn
  let state = null;          // { record, running, available, notice }
  let suggestions = [];      // the history, most recent first
  let expanded = false;      // compact mode only: the bar is open
  let thinking = { recordId: null, text: '' };
  let noticeHidden = false;
  let lastSelection = '';    // the text selected in the mail, kept while the focus is in the bar
  let host = null;
  let ui = null;             // the elements of the shadow root
  const autoRetried = new Set(); // the countdowns that already retried once (key: record|index)
  const countdowns = new Map();  // key -> interval id

  // ── The text selected in the mail ───────────────────────────────────────────────────────────
  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode;
    if (host && anchor && (anchor === host || host.contains(anchor))) return;
    lastSelection = sel.isCollapsed ? '' : sel.toString();
  });

  // What an instruction carries about the selection: whether there is one (the router is told)
  // and its text (the compose operation's selected_text context; the router never gets it).
  function selectionInfo(fields) {
    const hasSelection = lastSelection.trim() !== '';
    return { ...fields, hasSelection: hasSelection, selection: hasSelection ? lastSelection : '' };
  }

  // ── Styles ──────────────────────────────────────────────────────────────────────────────────
  const CSS = `
    :host { all: initial; display: block; font-family: system-ui, -apple-system, sans-serif; font-size: 13px; }
    @media print { :host { display: none !important; } }
    * { box-sizing: border-box; }
    .bar { --bg: #f5f5f5; --fg: #333; --line: #ddd; --field: #fff; --accent: #2c5e9b; --dim: #666;
           --run: #2c5e9b; --pend: #b26a00; --err: #b3261e; --ok: #1b5e20; --think-bg: #f0f0f0;
           color: var(--fg); }
    @media (prefers-color-scheme: dark) {
      .bar { --bg: #1e1e1e; --fg: #ddd; --line: #444; --field: #2a2a2a; --accent: #6db3f2; --dim: #aaa;
             --run: #6db3f2; --pend: #ffb74d; --err: #ff8a80; --ok: #a5d6a7; --think-bg: #2a2a2a; }
    }
    .compact_row { display: flex; justify-content: flex-end; padding: 2px 4px; }
    .icon_btn { position: relative; border: 1px solid var(--line); background: var(--bg); color: var(--fg);
                border-radius: 14px; width: 28px; height: 28px; cursor: pointer; opacity: .65; font-size: 14px; line-height: 1; padding: 0; }
    .icon_btn:hover, .icon_btn:focus-visible { opacity: 1; }
    .dot { position: absolute; top: -2px; right: -2px; width: 9px; height: 9px; border-radius: 50%; display: none; }
    .dot.running { display: block; background: var(--run); }
    .dot.pending_confirmation { display: block; background: var(--pend); }
    .dot.error { display: block; background: var(--err); }
    .panel { background: var(--bg); border-bottom: 1px solid var(--line); padding: 6px 8px; }
    .input_row { display: flex; align-items: flex-start; gap: 6px; position: relative; }
    .input_wrap { flex: 1; position: relative; }
    textarea { width: 100%; resize: none; overflow-y: hidden; font: inherit; color: var(--fg); background: var(--field);
               border: 1px solid var(--line); border-radius: 4px; padding: 4px 6px; line-height: 1.4; min-height: 26px; }
    textarea:focus { outline: none; border-color: var(--accent); }
    button.act { border: 1px solid var(--line); background: var(--field); color: var(--fg); border-radius: 4px;
                 padding: 2px 8px; cursor: pointer; font: inherit; min-height: 26px; }
    button.act:hover { border-color: var(--accent); }
    .suggest, .autocomplete-list { position: absolute; left: 0; right: 0; top: 100%; z-index: 10; margin: 2px 0 0; padding: 0;
               list-style: none; background: var(--field); border: 1px solid var(--line); border-radius: 4px; max-height: 12em; overflow-y: auto; }
    .autocomplete-list { position: fixed; right: auto; min-width: 16em; }
    .suggest li, .autocomplete-list li { padding: 3px 6px; cursor: pointer; white-space: pre-wrap; }
    .suggest li.active, .suggest li:hover, .autocomplete-list li.active, .autocomplete-list li:hover { background: var(--line); }
    .autocomplete-list .ac_desc { display: block; color: var(--dim); font-size: 11px; }
    .hidden { display: none !important; }
    .results { margin-top: 4px; display: flex; flex-direction: column; gap: 2px; }
    .line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .line .st { width: 1.2em; text-align: center; }
    .line .tx { flex: 1; min-width: 10em; }
    .line.error .tx { color: var(--err); }
    .line.done .st { color: var(--ok); }
    .line.running .st { color: var(--run); }
    .line.pending_confirmation .st { color: var(--pend); }
    .line button { border: none; background: none; color: var(--accent); cursor: pointer; font: inherit; padding: 0 4px; text-decoration: underline; }
    .countdown { color: var(--dim); }
    details.thinking-block { margin: 2px 0 2px 1.8em; background: var(--think-bg); border-radius: 4px; padding: 2px 6px; }
    details.thinking-block summary { cursor: pointer; color: var(--dim); font-style: italic; }
    .thinking-content { white-space: pre-wrap; color: var(--dim); font-size: 12px; max-height: 10em; overflow-y: auto; }
    .footer { margin-top: 2px; text-align: right; }
    .footer a { color: var(--accent); font-size: 11px; cursor: pointer; }
  `;

  // ── DOM helpers ─────────────────────────────────────────────────────────────────────────────
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const child of children) if (child) node.appendChild(child);
    return node;
  }

  function send(command, extra = {}) {
    return browser.runtime.sendMessage({ command: command, headerMessageId: ownId, ...extra }).catch(() => null);
  }

  // ── Building the bar ────────────────────────────────────────────────────────────────────────
  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    // Right after ThunderAI's panels, else at the top of the body: above the mail either way.
    const container = document.getElementById('mzta-container');
    if (container && container.parentNode === document.body) container.after(host);
    else document.body.insertBefore(host, document.body.firstChild);
    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(el('style', { text: CSS }));
    buildUi(root);
  }

  function removeHost() {
    for (const id of countdowns.values()) clearInterval(id);
    countdowns.clear();
    host?.remove();
    host = null;
    ui = null;
  }

  function buildUi(root) {
    const bar = el('div', { class: 'bar' });
    const dot = el('span', { class: 'dot' });
    const iconBtn = el('button', { class: 'icon_btn', type: 'button', title: msg('smartbar_open'), 'aria-label': msg('smartbar_open'), text: '✨' }, [dot]);
    iconBtn.addEventListener('click', () => { expanded = true; render(); focusInput(); });
    const compactRow = el('div', { class: 'compact_row' }, [iconBtn]);

    const textarea = el('textarea', { rows: '1', placeholder: msg('smartbar_placeholder'), 'aria-label': msg('smartbar_feature_name') });
    const suggest = el('ul', { class: 'suggest hidden', role: 'listbox' });
    // The {%placeholder%} autocomplete (js/mzta-placeholders-autocomplete.js) needs these two.
    const acList = el('ul', { class: 'autocomplete-list hidden' });
    const inputWrap = el('div', { class: 'input_wrap autocomplete-container' }, [textarea, suggest, acList]);
    const sendBtn = el('button', { class: 'act send', type: 'button' });
    const altBtn = el('button', { class: 'act alt', type: 'button' });
    const stopBtn = el('button', { class: 'act stop hidden', type: 'button', text: msg('smartbar_stop') });
    const collapseBtn = el('button', { class: 'act collapse', type: 'button', title: msg('smartbar_collapse'), 'aria-label': msg('smartbar_collapse'), text: '✕' });
    sendBtn.addEventListener('click', () => submit(config.defaultDestination));
    altBtn.addEventListener('click', () => submit(config.defaultDestination === 'chat' ? 'execute' : 'chat'));
    stopBtn.addEventListener('click', () => send('smartbar_stop'));
    collapseBtn.addEventListener('click', () => { expanded = false; render(); });
    const inputRow = el('div', { class: 'input_row' }, [inputWrap, sendBtn, altBtn, stopBtn, collapseBtn]);

    const results = el('div', { class: 'results', 'aria-live': 'polite' });
    const details = el('a', { class: 'details', text: msg('smartbar_details'), href: '#' });
    details.addEventListener('click', (e) => { e.preventDefault(); browser.runtime.sendMessage({ command: 'smartbar_open_page', tab: 'activity' }).catch(() => {}); });
    const footer = el('div', { class: 'footer' }, [details]);
    const panel = el('div', { class: 'panel' }, [inputRow, results, footer]);

    bar.append(compactRow, panel);
    root.appendChild(bar);
    ui = { bar, compactRow, iconBtn, dot, panel, textarea, suggest, acList, sendBtn, altBtn, stopBtn, collapseBtn, results };
    bindInput();
    loadAutocomplete();
  }

  // ── The input: multiline, the keyboard contract, the history ─────────────────────────────────
  let suggestIndex = -1;
  let suggestItems = [];

  function autoGrow() {
    const t = ui.textarea;
    t.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(t).lineHeight) || 18;
    const max = lineHeight * 4 + 10;
    const h = Math.min(t.scrollHeight, max);
    if (h > 0) t.style.height = h + 'px';
    t.style.overflowY = t.scrollHeight > max ? 'auto' : 'hidden';
  }

  function placeholderListOpen() {
    return ui.textarea.getAttribute('aria-expanded') === 'true';
  }

  function openSuggestions(all = false) {
    const text = ui.textarea.value.trim().toLowerCase();
    suggestItems = suggestions.filter(s => all || text === '' || (s.toLowerCase().includes(text) && s.toLowerCase() !== text));
    ui.suggest.replaceChildren();
    suggestIndex = -1;
    if (suggestItems.length === 0) { closeSuggestions(); return; }
    suggestItems.forEach((s, i) => {
      const li = el('li', { role: 'option', text: s });
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pickSuggestion(i); });
      ui.suggest.appendChild(li);
    });
    ui.suggest.classList.remove('hidden');
  }

  function closeSuggestions() {
    ui.suggest.classList.add('hidden');
    suggestIndex = -1;
  }

  function suggestionsOpen() {
    return !ui.suggest.classList.contains('hidden');
  }

  function moveSuggestion(delta) {
    const items = ui.suggest.querySelectorAll('li');
    if (items.length === 0) return;
    suggestIndex = (suggestIndex + delta + items.length) % items.length;
    items.forEach((li, i) => {
      li.classList.toggle('active', i === suggestIndex);
      li.setAttribute('aria-selected', i === suggestIndex ? 'true' : 'false');
    });
    items[suggestIndex].scrollIntoView?.({ block: 'nearest' });
  }

  function pickSuggestion(i) {
    if (i < 0 || i >= suggestItems.length) return;
    ui.textarea.value = suggestItems[i];
    closeSuggestions();
    autoGrow();
    ui.textarea.focus();
  }

  function bindInput() {
    const t = ui.textarea;
    t.addEventListener('input', () => {
      autoGrow();
      if (t.value.trim() !== '' && suggestions.length > 0 && !placeholderListOpen()) openSuggestions();
      else if (t.value.trim() === '') closeSuggestions();
    });
    t.addEventListener('blur', () => setTimeout(() => { if (ui) closeSuggestions(); }, 150));
    t.addEventListener('keydown', (e) => {
      // Thunderbird's single-key shortcuts (j, k, Delete...) must never see a key typed here.
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return;
      if (placeholderListOpen()) return; // the {%placeholder%} list handles its own keys
      if (suggestionsOpen()) {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggestion(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggestion(-1); return; }
        if (e.key === 'Enter' && suggestIndex >= 0 && !e.shiftKey) { e.preventDefault(); pickSuggestion(suggestIndex); return; }
        if (e.key === 'Escape') { e.preventDefault(); closeSuggestions(); return; }
      }
      if (e.key === 'ArrowUp' && t.value === '' && suggestions.length > 0) {
        e.preventDefault();
        t.value = suggestions[0];
        autoGrow();
        return;
      }
      if (e.key === 'ArrowDown' && suggestions.length > 0 && !suggestionsOpen() && !t.value.includes('\n')) {
        e.preventDefault();
        openSuggestions(t.value.trim() === '');
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit(config.defaultDestination);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (config.mode === 'compact') { expanded = false; render(); }
        else t.blur();
      }
    });
    t.addEventListener('keyup', (e) => e.stopPropagation());
    t.addEventListener('keypress', (e) => e.stopPropagation());
  }

  // The {%placeholder%} autocomplete of the prompt editors, loaded as a module when the engine
  // allows it in a content script; without it the bar works the same, with no list.
  function loadAutocomplete() {
    let url;
    try {
      url = browser.runtime.getURL('js/mzta-placeholders-autocomplete.js');
    } catch (e) {
      return;
    }
    Promise.all([
      import(url),
      browser.runtime.sendMessage({ command: 'smartbar_placeholders' }),
    ]).then(([mod, list]) => {
      if (!ui || !Array.isArray(list) || typeof mod?.textareaAutocomplete !== 'function') return;
      // Type 1: the bar works on a message being read.
      mod.textareaAutocomplete(ui.textarea, list, 1);
    }).catch(() => { /* no autocomplete in this engine */ });
  }

  function focusInput() {
    if (!ui) return;
    setTimeout(() => ui?.textarea.focus(), 0);
  }

  async function submit(destination) {
    const text = ui.textarea.value.trim();
    if (text === '') return;
    closeSuggestions();
    if (destination === 'chat') {
      await send('smartbar_open_chat', { text: text, selection: lastSelection });
      ui.textarea.value = '';
      autoGrow();
      return;
    }
    noticeHidden = false;
    thinking = { recordId: null, text: '' };
    const res = await send('smartbar_run', selectionInfo({ instruction: text }));
    if (res?.ok) {
      if (!suggestions.includes(text)) suggestions = [text, ...suggestions];
      else suggestions = [text, ...suggestions.filter(s => s !== text)];
      ui.textarea.value = '';
      autoGrow();
    }
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────────────────────
  // The texts of the lines are shared with the chat window (js/lib/mzta-smartbar-lines.js,
  // loaded before this script).
  const { STATE_ICON, opLabel, opText } = globalThis.mztaSmartbarLines;

  // The state the icon's dot shows: running, pending confirmation, error (nothing otherwise).
  function dotState() {
    const record = state?.record;
    if (!record) return '';
    if (state.running || record.state === 'running') return 'running';
    if (record.state === 'pending_confirmation') return 'pending_confirmation';
    if (record.errorType && !record.dismissed?.error) return 'error';
    if ((record.operations || []).some(op => op.state === 'error' && !op.dismissed)) return 'error';
    return '';
  }

  function button(label, onClick, cls = '') {
    const b = el('button', { type: 'button', text: label, class: cls });
    b.addEventListener('click', onClick);
    return b;
  }

  // A rate-limited line: the seconds left, then ONE automatic retry, then the manual Retry.
  function countdownNode(record, index, retryAt) {
    const key = record.id + '|' + (index ?? 'router');
    const span = el('span', { class: 'countdown' });
    if (autoRetried.has(key) || !Number.isFinite(retryAt)) return null;
    const tick = () => {
      const left = Math.ceil((retryAt - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(countdowns.get(key));
        countdowns.delete(key);
        autoRetried.add(key);
        send('smartbar_retry', selectionInfo({ recordId: record.id, index: index, auto: true }));
        return;
      }
      span.textContent = msg('smartbar_retry_in', [String(left)]);
    };
    if (countdowns.has(key)) clearInterval(countdowns.get(key));
    tick();
    if (!autoRetried.has(key)) countdowns.set(key, setInterval(tick, 1000));
    return span;
  }

  function errorButtons(record, index, errorType, retryAt) {
    const nodes = [];
    if (errorType === 'rate_limit') {
      const c = countdownNode(record, index, retryAt);
      if (c) nodes.push(c);
    }
    nodes.push(button(msg('smartbar_retry'), () => send('smartbar_retry', selectionInfo({ recordId: record.id, index: index })), 'retry'));
    nodes.push(button(msg('smartbar_remove'), () => send('smartbar_dismiss', { recordId: record.id, what: index ?? 'error' }), 'remove'));
    if (errorType === 'json') {
      // The chat opens with the instruction prefilled, not sent; the background attaches the
      // unreadable answer (which the bar never receives) to the next message as context.
      nodes.push(button(msg('smartbar_open_in_chat'), () => send('smartbar_open_chat', { fromError: { recordId: record.id, index: index } }), 'chat'));
    }
    return nodes;
  }

  function line(cls, icon, text, extra = []) {
    return el('div', { class: 'line ' + cls }, [el('span', { class: 'st', text: icon }), el('span', { class: 'tx', text: text }), ...extra]);
  }

  function thinkingNode() {
    if (!thinking.text || thinking.recordId !== state?.record?.id) return null;
    const details = el('details', { class: 'thinking-block' });
    details.appendChild(el('summary', { text: msg('prefs_OptionText_thinking_summary') }));
    details.appendChild(el('div', { class: 'thinking-content', text: thinking.text }));
    return details;
  }

  function renderResults() {
    const box = ui.results;
    // An open thinking block keeps its state across redraws.
    const wasOpen = box.querySelector('details.thinking-block')?.open === true;
    box.replaceChildren();
    const record = state?.record;
    if (state?.notice === 'replaced_with_errors' && !noticeHidden) {
      box.appendChild(line('notice', 'ℹ', msg('smartbar_notice_replaced_errors'),
        [button('×', () => { noticeHidden = true; renderResults(); }, 'dismiss')]));
    }
    if (!record || record.state === 'replaced') return;
    const ops = record.operations || [];
    const routing = record.state === 'running' && ops.length === 0 && !record.errorType;
    if (routing) {
      box.appendChild(line('running', STATE_ICON.running, msg('smartbar_routing'),
        [button(msg('smartbar_stop'), () => send('smartbar_stop', { recordId: record.id }), 'stop')]));
      const t = thinkingNode();
      if (t) { t.open = wasOpen; box.appendChild(t); }
      return;
    }
    if (record.errorType && !record.dismissed?.error) {
      box.appendChild(line('error', STATE_ICON.error, msg('smartbar_line_router_error', [String(record.error || '')]),
        errorButtons(record, null, record.errorType, record.retryAt)));
    }
    for (const op of ops) {
      if (op.dismissed) continue;
      const extra = [];
      if (op.state === 'running') extra.push(button(msg('smartbar_stop'), () => send('smartbar_stop', { recordId: record.id, index: op.index }), 'stop'));
      else if (op.state === 'done' || op.state === 'cancelled') extra.push(button('×', () => send('smartbar_dismiss', { recordId: record.id, what: op.index }), 'dismiss'));
      else if (op.state === 'pending_confirmation') {
        extra.push(button(msg('smartbar_confirm'), () => send('smartbar_confirm', { recordId: record.id, index: op.index }), 'confirm'));
        extra.push(button(msg('smartbar_cancel'), () => send('smartbar_cancel', { recordId: record.id, index: op.index }), 'cancel'));
      } else if (op.state === 'error') extra.push(...errorButtons(record, op.index, op.errorType, op.retryAt));
      // A draft of the chat: it is delivered from the chat (Create email).
      else if (op.state === 'drafted') extra.push(button(msg('smartbar_open_in_chat'), () => send('smartbar_open_chat', {}), 'chat'));
      box.appendChild(line(op.state, STATE_ICON[op.state] || '', opText(op), extra));
    }
    // A message of the chat answered in free text: the answer is shown in the chat only.
    if (record.hasAnswer && !record.dismissed?.unrecognized) {
      box.appendChild(line('answered', '💬', msg('smartbar_answered_in_chat'), [
        button(msg('smartbar_open_in_chat'), () => send('smartbar_open_chat', {}), 'chat'),
        button('×', () => send('smartbar_dismiss', { recordId: record.id, what: 'unrecognized' }), 'dismiss'),
      ]));
    }
    if (!record.dismissed?.reports) {
      for (const report of record.reports || []) {
        box.appendChild(line('report', 'ℹ', msg('smartbar_report_' + report.kind, [String(report.id || '')]),
          [button('×', () => send('smartbar_dismiss', { recordId: record.id, what: 'reports' }), 'dismiss')]));
      }
    }
    if (record.unrecognized && !record.dismissed?.unrecognized) {
      box.appendChild(line('unrecognized', '?', msg('smartbar_unrecognized', [record.unrecognized]), [
        button(msg('smartbar_open_in_chat'), () => send('smartbar_open_chat', { text: record.unrecognized, selection: lastSelection }), 'chat'),
        button('×', () => send('smartbar_dismiss', { recordId: record.id, what: 'unrecognized' }), 'dismiss'),
      ]));
    }
    const nothing = !record.errorType && ops.length === 0 && !record.unrecognized && !record.hasAnswer &&
      record.state !== 'running' && record.state !== 'interrupted';
    if (nothing && !record.dismissed?.unrecognized) {
      const available = (state.available || []).map(id => opLabel(id));
      const text = msg('smartbar_nothing_matched') + ' ' + (available.length > 0
        ? msg('smartbar_available_operations', [available.join(', ')])
        : msg('smartbar_no_operations_available'));
      box.appendChild(line('nothing', '?', text, [
        button(msg('smartbar_open_in_chat'), () => send('smartbar_open_chat', { text: record.instruction, selection: lastSelection }), 'chat'),
        button('×', () => send('smartbar_dismiss', { recordId: record.id, what: 'unrecognized' }), 'dismiss'),
      ]));
    }
    if (record.state === 'interrupted') {
      box.appendChild(line('interrupted', STATE_ICON.cancelled, msg('smartbar_interrupted')));
    }
  }

  function render() {
    if (!config.enabled || config.mode === 'disabled' || !ownId) {
      removeHost();
      return;
    }
    ensureHost();
    const compact = config.mode === 'compact';
    const open = !compact || expanded;
    ui.compactRow.classList.toggle('hidden', open);
    ui.panel.classList.toggle('hidden', !open);
    ui.collapseBtn.classList.toggle('hidden', !compact);
    const ds = dotState();
    ui.dot.className = 'dot' + (ds ? ' ' + ds : '');
    const execLabel = msg('smartbar_send_execute');
    const chatLabel = msg('smartbar_send_chat');
    const isChat = config.defaultDestination === 'chat';
    ui.sendBtn.textContent = isChat ? '💬' : '➤';
    ui.sendBtn.title = isChat ? chatLabel : execLabel;
    ui.sendBtn.setAttribute('aria-label', ui.sendBtn.title);
    ui.altBtn.textContent = isChat ? '✉️' : '💬';
    ui.altBtn.title = isChat ? execLabel : chatLabel;
    ui.altBtn.setAttribute('aria-label', ui.altBtn.title);
    const running = !!state?.running;
    ui.stopBtn.classList.toggle('hidden', !running);
    // Nothing of the result area in compact mode until the bar is opened.
    if (open) renderResults();
    else ui.results.replaceChildren();
  }

  // ── Messages from the background ─────────────────────────────────────────────────────────────
  browser.runtime.onMessage.addListener((message) => {
    switch (message?.command) {
      case 'smartbar_config':
        config = message.config || config;
        if (!config.enabled || config.mode === 'disabled') { state = null; removeHost(); return false; }
        if (config.mode !== 'compact') expanded = false;
        if (ownId === null) load();
        else render();
        return false;
      case 'smartbar_update':
        if (!ownId || message.headerMessageId !== ownId) return false;
        if (typeof message.seq === 'number' && message.seq <= lastSeq) return false;
        lastSeq = message.seq;
        state = { record: message.record, running: message.running, available: message.available, notice: message.notice ?? state?.notice ?? null };
        if (Array.isArray(message.suggestions)) suggestions = message.suggestions;
        render();
        return false;
      case 'smartbar_thinking':
        if (!ownId || message.headerMessageId !== ownId) return false;
        thinking = { recordId: message.recordId, text: message.text || '' };
        if (ui && (config.mode !== 'compact' || expanded)) renderResults();
        return false;
      case 'smartbar_focus':
        if (!config.enabled || config.mode === 'disabled' || !ownId) return false;
        expanded = true;
        render();
        focusInput();
        return false;
      default:
        return false;
    }
  });

  async function load() {
    const res = await browser.runtime.sendMessage({ command: 'smartbar_get_state' }).catch(() => null);
    if (!res) return;
    config = res.config || config;
    if (!config.enabled || !res.headerMessageId) { removeHost(); return; }
    ownId = res.headerMessageId;
    if (typeof res.seq === 'number' && res.seq > lastSeq) lastSeq = res.seq;
    state = res.state;
    suggestions = Array.isArray(res.suggestions) ? res.suggestions : [];
    render();
  }

  load();
})();
