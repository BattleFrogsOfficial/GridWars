// Small DOM helpers: escaping, toasts, modal sheets and a declarative form dialog.

import { parseMoney, parsePercent, centsToInput } from './money.js';
import { isValidISO } from './dates.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Toasts queue up so a "Victory!" isn't overwritten by a "Level up!" a moment later.
// Plain messages may be replaced straight away; "good"/"bad" ones always get their full time on screen.
const toastQueue = [];
let toastTimerQ = null;
let showingImportant = false;
let held = false;
/** Hold toasts back (e.g. while an attack plays on the battle stage); they show in order once released. */
export function holdToasts(on) {
  held = on;
  if (!on && !showingImportant) nextToast();
}
export function toast(msg, kind = '') {
  for (let i = toastQueue.length - 1; i >= 0; i--) if (!toastQueue[i][1]) toastQueue.splice(i, 1);
  toastQueue.push([msg, kind]);
  if (!showingImportant && !held) {
    clearTimeout(toastTimerQ);
    nextToast();
  }
}

function nextToast() {
  if (held) return void (showingImportant = false);
  const item = toastQueue.shift();
  if (!item) return void (showingImportant = false);
  showingImportant = !!item[1];
  showToast(...item);
  toastTimerQ = setTimeout(nextToast, 2600);
}

let toastTimer;
function showToast(msg, kind) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
  }
  // Open modal dialogs sit in the browser's top layer, so the toast must live inside the top one to be seen.
  const host = [...document.querySelectorAll('dialog[open]')].at(-1) || document.body;
  if (el.parentNode !== host) host.appendChild(el);
  el.className = 'toast show ' + kind;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast " + kind), 2400);
}

/**
 * Open a modal sheet. `html` is the inner content. Clicks on [data-action] inside call onAction(action, el).
 * Returns { el, close }.
 */
export function openSheet(html, { onAction, onClose, prepare, className = '' } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet ' + className;
  dlg.innerHTML = `<button class="sheet-x" data-action="close" aria-label="Close">×</button>${html}`;
  document.body.appendChild(dlg);
  const close = () => {
    if (dlg.open) dlg.close();
  };
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) {
      // The dialog element itself receives clicks on its padding too; only close for taps outside its box (the backdrop).
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) return close();
      return;
    }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'close') return close();
    onAction?.(a.dataset.action, a, { close, el: dlg });
  });
  prepare?.(dlg);
  dlg.showModal();
  return { el: dlg, close };
}

function fieldHtml(f) {
  const id = 'f_' + f.name;
  const v = f.value ?? '';
  const hint = f.hint ? `<small class="hint">${esc(f.hint)}</small>` : '';
  switch (f.type) {
    case 'checkbox':
      return `<label class="check"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> <span>${esc(f.label)}</span></label>${hint}`;
    case 'select':
      return `<label for="${id}">${esc(f.label)}</label><select id="${id}" name="${f.name}">${f.options
        .map((o) => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`)
        .join('')}</select>${hint}`;
    case 'date':
      return `<label for="${id}">${esc(f.label)}</label><input id="${id}" type="date" name="${f.name}" value="${esc(v)}" required>${hint}`;
    case 'money':
      return `<label for="${id}">${esc(f.label)}</label><input id="${id}" name="${f.name}" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(v === '' ? '' : centsToInput(v))}">${hint}`;
    case 'percent':
      return `<label for="${id}">${esc(f.label)}</label><input id="${id}" name="${f.name}" inputmode="decimal" autocomplete="off" placeholder="e.g. 24.99" value="${esc(v)}">${hint}`;
    case 'int':
      return `<label for="${id}">${esc(f.label)}</label><input id="${id}" name="${f.name}" inputmode="numeric" autocomplete="off" value="${esc(v)}">${hint}`;
    case 'pin':
      return `<label for="${id}">${esc(f.label)}</label><input id="${id}" name="${f.name}" type="password" inputmode="numeric" autocomplete="off" maxlength="8">${hint}`;
    default:
      return `<label for="${id}">${esc(f.label)}</label><input id="${id}" name="${f.name}" autocomplete="off" maxlength="${f.max || 40}" value="${esc(v)}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>${hint}`;
  }
}

function readField(form, f) {
  const el = form.elements[f.name];
  if (f.type === 'checkbox') return { value: el.checked };
  const raw = el.value.trim();
  if (!f.required && raw === '' && f.type !== 'select') return { value: null };
  switch (f.type) {
    case 'money': {
      const c = parseMoney(raw);
      if (c == null) return { error: `${f.label}: enter an amount` };
      if (c < 0 || (f.positive && c === 0)) return { error: `${f.label}: must be more than zero` };
      return { value: c };
    }
    case 'percent': {
      const p = parsePercent(raw);
      return p == null ? { error: `${f.label}: enter a percentage like 19.99` } : { value: p };
    }
    case 'int': {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < (f.min ?? -Infinity) || n > (f.maxValue ?? Infinity)) {
        return { error: `${f.label}: enter a whole number${f.min != null ? ` from ${f.min} to ${f.maxValue}` : ''}` };
      }
      return { value: n };
    }
    case 'date':
      return isValidISO(raw) ? { value: raw } : { error: `${f.label}: pick a date` };
    default:
      if (f.required && raw === '') return { error: `${f.label}: required` };
      return { value: raw };
  }
}

/**
 * Declarative form dialog.
 * fields: [{ name, label, type: text|money|percent|int|date|select|checkbox, value, required, positive, options, hint }]
 * onSubmit(values) may return an error string to keep the dialog open.
 * extra: [{ label, action, className }] additional buttons; onExtra(action, close) handles them.
 * lead: HTML above the title (e.g. a picture); className: extra classes for the sheet.
 */
export function openForm({ title, intro = '', fields, submitLabel = 'Save', onSubmit, extra = [], onExtra, lead = '', className = '' }) {
  const html = `
    ${lead}
    <h2>${esc(title)}</h2>
    ${intro ? `<p class="intro">${intro}</p>` : ''}
    <form novalidate>
      ${fields.map((f) => `<div class="field">${fieldHtml(f)}</div>`).join('')}
      <p class="form-error" role="alert"></p>
      <div class="row-buttons">
        ${extra.map((b) => `<button type="button" class="btn ${b.className || ''}" data-action="${b.action}">${esc(b.label)}</button>`).join('')}
        <button type="submit" class="btn primary">${esc(submitLabel)}</button>
      </div>
    </form>`;
  const sheet = openSheet(html, {
    className,
    onAction: (action, _el, { close }) => onExtra?.(action, close),
    // showModal() focuses [autofocus] right away; mark the first text/amount field so typing starts there.
    prepare: (dlg) => dlg.querySelector('form input:not([type=checkbox]):not([type=date]), form select')?.setAttribute('autofocus', ''),
  });
  const form = sheet.el.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = {};
    for (const f of fields) {
      const r = readField(form, f);
      if (r.error) {
        form.querySelector('.form-error').textContent = r.error;
        form.elements[f.name]?.focus?.();
        return;
      }
      values[f.name] = r.value;
    }
    const err = onSubmit(values);
    if (err) {
      form.querySelector('.form-error').textContent = err;
      return;
    }
    sheet.close();
  });
  return sheet;
}

/** In-app confirmation (native confirm() is blocked in some embedded viewers and looks out of place). Resolves true/false. */
export function askConfirm(message, { okLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, title = 'Are you sure?' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet(
      `<h2>${esc(title)}</h2><p>${esc(message)}</p>
       <div class="row-buttons"><button class="btn" data-action="close">${esc(cancelLabel)}</button>
       <button class="btn ${danger ? 'bad' : 'primary'}" data-action="ok">${esc(okLabel)}</button></div>`,
      {
        onAction: (a, _el, { close }) => {
          if (a === 'ok') {
            answered = true;
            close();
          }
        },
        onClose: () => resolve(answered),
      },
    );
  });
}
