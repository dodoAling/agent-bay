// This file is also loaded standalone in tests, so it reads the language
// runtime through the globals i18n.js installs instead of importing it.
const t = msgid => globalThis.agentBayT ? globalThis.agentBayT(msgid) : msgid;

const tsControllers = new WeakMap();
const tsInstances = new Set();
const tsRoots = new WeakMap();
let tsSerial = 0, tsOpen = null;

const tsEligible = option => Boolean(option) && !option.disabled && !option.hidden && !(option.parentElement?.tagName === 'OPTGROUP' && (option.parentElement.disabled || option.parentElement.hidden));
const tsNormalize = text => String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function tsLabel(select) {
  if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
  const labels = [...(select.labels || [])].map(label => {
    const clone = label.cloneNode(true);
    clone.querySelectorAll('select,button,input,textarea,svg,.themed-select').forEach(node => node.remove());
    return clone.textContent.trim();
  }).filter(Boolean);
  return labels.join(' ') || select.title || t('Select an option');
}

class ThemedSelect {
  constructor(select) {
    this.select = select; this.doc = select.ownerDocument; this.view = this.doc.defaultView;
    this.id = `agent-bay-select-${++tsSerial}`; this.active = -1; this.opened = false;
    this.oldTabIndex = select.getAttribute('tabindex'); this.oldAriaHidden = select.getAttribute('aria-hidden');
    this.wrapper = this.doc.createElement('span'); this.wrapper.className = 'themed-select';
    this.wrapper.dataset.selectId = select.id || this.id;
    this.button = this.doc.createElement('button'); this.button.type = 'button'; this.button.className = 'themed-select-trigger';
    this.button.setAttribute('role', 'combobox'); this.button.setAttribute('aria-haspopup', 'listbox');
    this.button.setAttribute('aria-expanded', 'false'); this.button.setAttribute('aria-controls', `${this.id}-list`);
    this.value = this.doc.createElement('span'); this.value.className = 'themed-select-value';
    this.arrow = this.doc.createElement('span'); this.arrow.className = 'themed-select-arrow'; this.arrow.textContent = '⌄'; this.arrow.setAttribute('aria-hidden', 'true');
    this.button.append(this.value, this.arrow);
    this.note = this.doc.createElement('span'); this.note.className = 'themed-select-error'; this.note.id = `${this.id}-error`; this.note.hidden = true; this.note.setAttribute('role', 'alert');
    this.popup = this.doc.createElement('div'); this.popup.className = 'themed-select-popover'; this.popup.id = `${this.id}-list`;
    this.popup.setAttribute('role', 'listbox'); this.popup.setAttribute('popover', 'manual'); this.popup.hidden = true;
    select.before(this.wrapper); this.wrapper.append(select, this.button, this.note);
    select.classList.add('themed-select-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    this.popup.addEventListener('click', event => {
      const item = event.target.closest('[data-option-index]');
      if (item && this.popup.contains(item)) this.choose(Number(item.dataset.optionIndex));
    });
    this.popup.addEventListener('pointermove', event => {
      const item = event.target.closest('[data-option-index]');
      if (item && tsEligible(this.select.options[Number(item.dataset.optionIndex)])) this.highlight(Number(item.dataset.optionIndex), false);
    });
    this.button.addEventListener('click', () => this.opened ? this.close() : this.open());
    this.keyHandler = event => this.keydown(event);
    this.button.addEventListener('keydown', this.keyHandler); this.popup.addEventListener('keydown', this.keyHandler);
    this.changeHandler = () => this.refresh();
    this.focusHandler = () => { if (!this.button.disabled) this.button.focus(); };
    this.nativeClickHandler = event => { event.preventDefault(); this.focusHandler(); if (!this.button.disabled) this.open(); };
    this.invalidHandler = event => {
      event.preventDefault(); this.invalid = true; this.note.textContent = this.select.validationMessage || t('Choose an option.'); this.note.hidden = false;
      this.button.setAttribute('aria-invalid', 'true'); this.button.setAttribute('aria-describedby', [this.select.getAttribute('aria-describedby'), this.note.id].filter(Boolean).join(' ')); this.focusHandler();
    };
    select.addEventListener('change', this.changeHandler); select.addEventListener('focus', this.focusHandler);
    select.addEventListener('click', this.nativeClickHandler); select.addEventListener('invalid', this.invalidHandler);
    this.observer = new this.view.MutationObserver(() => this.refresh(true));
    this.observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['disabled', 'hidden', 'required', 'selected', 'label', 'value', 'aria-label', 'aria-labelledby', 'title', 'multiple', 'size'] });
    tsControllers.set(select, this); tsInstances.add(this); this.refresh();
  }

  refresh(optionsChanged = false) {
    if (!this.select.isConnected) { this.destroy(); return; }
    const disabled = this.select.matches(':disabled'), hidden = this.select.hidden;
    if (this.button.disabled !== disabled) this.button.disabled = disabled;
    if (this.wrapper.hidden !== hidden) this.wrapper.hidden = hidden;
    const selected = this.select.selectedOptions[0], value = selected?.label || selected?.textContent || t('No options available');
    if (this.value.textContent !== value) this.value.textContent = value;
    this.button.title = this.select.title || value;
    this.button.setAttribute('aria-label', tsLabel(this.select));
    this.popup.setAttribute('aria-label', tsLabel(this.select));
    const labelledBy = this.select.getAttribute('aria-labelledby');
    if (labelledBy) this.button.setAttribute('aria-labelledby', labelledBy); else this.button.removeAttribute('aria-labelledby');
    this.button.setAttribute('aria-required', String(this.select.required));
    if (!this.invalid) {
      const description = this.select.getAttribute('aria-describedby');
      if (description) this.button.setAttribute('aria-describedby', description); else this.button.removeAttribute('aria-describedby');
    }
    if (this.invalid && this.select.validity.valid) {
      this.invalid = false; this.note.hidden = true; this.button.removeAttribute('aria-invalid');
      const description = this.select.getAttribute('aria-describedby');
      if (description) this.button.setAttribute('aria-describedby', description); else this.button.removeAttribute('aria-describedby');
    }
    if (this.opened) {
      if (disabled || hidden || !this.button.getClientRects().length) this.close(false);
      else {
        if (optionsChanged) this.renderOptions();
        else for (const item of this.popup.querySelectorAll('[data-option-index]')) item.setAttribute('aria-selected', String(Boolean(this.select.options[Number(item.dataset.optionIndex)]?.selected)));
        this.position();
      }
    }
  }

  renderOptions() {
    const fragment = this.doc.createDocumentFragment(); let group = null;
    [...this.select.options].forEach((option, index) => {
      if (option.hidden || (option.parentElement?.tagName === 'OPTGROUP' && option.parentElement.hidden)) return;
      const parent = option.parentElement;
      if (parent?.tagName === 'OPTGROUP' && parent !== group) {
        const heading = this.doc.createElement('div'); heading.className = 'themed-select-group'; heading.textContent = parent.label; heading.setAttribute('role', 'presentation'); fragment.append(heading); group = parent;
      }
      const item = this.doc.createElement('div'); item.className = 'themed-select-option'; item.id = `${this.id}-option-${index}`;
      item.dataset.optionIndex = String(index); item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected)); item.setAttribute('aria-disabled', String(!tsEligible(option)));
      item.textContent = option.label || option.textContent; item.setAttribute('aria-label', item.textContent); fragment.append(item);
    });
    if (!fragment.childNodes.length) {
      const empty = this.doc.createElement('div'); empty.className = 'themed-select-empty'; empty.textContent = t('No options available'); fragment.append(empty);
    }
    this.popup.replaceChildren(fragment);
    if (!tsEligible(this.select.options[this.active] || { disabled: true })) this.active = [...this.select.options].findIndex(tsEligible);
    this.highlight(this.active, false);
  }

  open() {
    this.refresh();
    if (this.button.disabled || this.wrapper.hidden || !this.button.getClientRects().length || !this.select.isConnected) return;
    if (tsOpen && tsOpen !== this) tsOpen.close(false);
    const host = this.select.closest('dialog') || this.doc.body;
    if (this.popup.parentElement !== host) host.append(this.popup);
    this.dialog = this.select.closest('dialog');
    this.active = tsEligible(this.select.options[this.select.selectedIndex] || { disabled: true }) ? this.select.selectedIndex : [...this.select.options].findIndex(tsEligible);
    this.renderOptions(); this.popup.hidden = false; this.opened = true; tsOpen = this;
    this.button.setAttribute('aria-expanded', 'true'); this.position();
    if (typeof this.popup.showPopover === 'function') { try { this.popup.showPopover(); } catch {} }
    this.position(); this.highlight(this.active);
    this.outsideHandler = event => { if (!this.wrapper.contains(event.target) && !this.popup.contains(event.target)) this.close(false); };
    this.positionHandler = () => this.position(); this.dialogCloseHandler = () => this.close(false);
    this.doc.addEventListener('pointerdown', this.outsideHandler, true);
    this.doc.addEventListener('scroll', this.positionHandler, true); this.view.addEventListener('resize', this.positionHandler);
    this.dialog?.addEventListener('close', this.dialogCloseHandler);
  }

  position() {
    if (!this.opened) return;
    const rect = this.button.getBoundingClientRect(), margin = 8, gap = 5;
    const width = this.doc.documentElement.clientWidth || this.view.innerWidth, height = this.view.innerHeight;
    const menuWidth = Math.min(Math.max(rect.width, 210), width - margin * 2);
    const below = height - rect.bottom - margin - gap, above = rect.top - margin - gap;
    const upward = below < 200 && above > below, space = upward ? above : below;
    this.popup.style.width = `${menuWidth}px`; this.popup.style.maxHeight = `${Math.max(40, Math.min(320, space))}px`;
    this.popup.style.left = `${Math.max(margin, Math.min(rect.left, width - menuWidth - margin))}px`;
    const popupHeight = this.popup.getBoundingClientRect().height;
    this.popup.style.top = `${upward ? Math.max(margin, rect.top - popupHeight - gap) : Math.min(height - popupHeight - margin, rect.bottom + gap)}px`;
    this.popup.dataset.direction = upward ? 'up' : 'down';
  }

  close(restoreFocus = true) {
    if (!this.opened) return;
    this.opened = false; if (tsOpen === this) tsOpen = null;
    if (typeof this.popup.hidePopover === 'function') { try { this.popup.hidePopover(); } catch {} }
    this.popup.hidden = true; this.button.setAttribute('aria-expanded', 'false'); this.button.removeAttribute('aria-activedescendant');
    this.doc.removeEventListener('pointerdown', this.outsideHandler, true); this.doc.removeEventListener('scroll', this.positionHandler, true);
    this.view.removeEventListener('resize', this.positionHandler); this.dialog?.removeEventListener('close', this.dialogCloseHandler);
    if (restoreFocus && this.button.isConnected && !this.button.disabled && this.button.getClientRects().length) this.button.focus();
  }

  highlight(index, scroll = true) {
    this.active = index;
    for (const item of this.popup.querySelectorAll('[data-option-index]')) item.classList.toggle('is-active', Number(item.dataset.optionIndex) === index);
    const item = this.popup.querySelector(`[data-option-index="${index}"]`);
    if (item) { this.button.setAttribute('aria-activedescendant', item.id); if (scroll && this.opened) item.scrollIntoView({ block: 'nearest' }); }
    else this.button.removeAttribute('aria-activedescendant');
  }

  choose(index) {
    const option = this.select.options[index];
    if (!option || !tsEligible(option) || this.button.disabled) return;
    const previous = this.select.selectedIndex; this.select.selectedIndex = index; this.close(); this.refresh();
    if (previous !== index) {
      this.select.dispatchEvent(new this.view.Event('input', { bubbles: true }));
      this.select.dispatchEvent(new this.view.Event('change', { bubbles: true }));
    }
  }

  keydown(event) {
    if (this.button.disabled) return;
    const key = event.key, choices = [...this.select.options].map((option, index) => tsEligible(option) ? index : -1).filter(index => index >= 0);
    if (key === 'Tab') { this.close(false); return; }
    if (key === 'Escape') { if (this.opened) { event.preventDefault(); event.stopPropagation(); this.close(); } return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) {
      event.preventDefault(); event.stopPropagation();
      if (key === 'Enter' || key === ' ') { if (this.opened) this.choose(this.active); else this.open(); return; }
      if (!this.opened) this.open();
      let position = choices.indexOf(this.active);
      if (key === 'Home') position = 0;
      else if (key === 'End') position = choices.length - 1;
      else position = Math.max(0, Math.min(choices.length - 1, position + (key === 'ArrowDown' ? 1 : -1)));
      if (choices[position] !== undefined) this.highlight(choices[position]);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); event.stopPropagation(); if (!this.opened) this.open();
      const now = Date.now(), character = tsNormalize(key);
      this.search = now - (this.searchAt || 0) > 700 ? character : (this.search || '') + character; this.searchAt = now;
      const query = [...this.search].every(c => c === character) ? character : this.search;
      const start = Math.max(0, choices.indexOf(this.active)), ordered = choices.slice(start + 1).concat(choices.slice(0, start + 1));
      const found = ordered.find(index => tsNormalize(this.select.options[index].label).startsWith(query));
      if (found !== undefined) this.highlight(found);
    }
  }

  destroy() {
    this.close(false); this.observer.disconnect(); this.popup.remove();
    this.select.removeEventListener('change', this.changeHandler); this.select.removeEventListener('focus', this.focusHandler);
    this.select.removeEventListener('click', this.nativeClickHandler); this.select.removeEventListener('invalid', this.invalidHandler);
    this.select.classList.remove('themed-select-native');
    for (const [name, value] of [['tabindex', this.oldTabIndex], ['aria-hidden', this.oldAriaHidden]]) if (value === null) this.select.removeAttribute(name); else this.select.setAttribute(name, value);
    if (this.select.isConnected) this.wrapper.replaceWith(this.select); else this.wrapper.remove();
    tsControllers.delete(this.select); tsInstances.delete(this);
  }
}

export function installThemedSelects(root = document) {
  const selects = [...(root.querySelectorAll?.('select') || [])];
  if (root.tagName === 'SELECT') selects.unshift(root);
  for (const select of selects) if (!select.multiple && select.size <= 1 && select.dataset.themedSelect !== 'off' && !tsControllers.has(select)) new ThemedSelect(select);
  if (tsRoots.has(root)) return;
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  let queued = false;
  const schedule = () => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; installThemedSelects(root); refreshThemedSelects(root); }); } };
  const observer = new doc.defaultView.MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes' && [...tsInstances].some(instance => record.target.contains(instance.select))) { schedule(); return; }
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.tagName === 'SELECT' || node.querySelector('select')))) { schedule(); return; }
    }
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
  doc.addEventListener('reset', event => {
    doc.defaultView.setTimeout(() => {
      if (!event.defaultPrevented) for (const instance of tsInstances) if (instance.select.form === event.target) instance.refresh(true);
    }, 0);
  });
  tsRoots.set(root, observer);
}

export function refreshThemedSelects(root = document) {
  for (const instance of [...tsInstances]) if (!instance.select.isConnected || root === instance.doc || root === instance.select || root.contains?.(instance.select)) instance.refresh();
}
