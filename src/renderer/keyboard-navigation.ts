const HINT_KEYS = 'asdfghjklqwertyuiopzxcvbnm';
const CONTROLS = 'button, a[href], input:not([type="hidden"]), textarea, select, summary, [role="button"], [role="option"][tabindex], [role="switch"], [tabindex]:not([tabindex="-1"])';
const ITEMS = '[data-keyboard-item]';

function isInput(element: Element | null): boolean {
  return Boolean(element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"]'));
}

function isAvailable(element: HTMLElement): boolean {
  return element.isConnected && !element.matches(':disabled')
    && !element.closest('[inert], [hidden], [aria-hidden="true"], [aria-disabled="true"]')
    && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
}

function visibleRect(element: HTMLElement): { left: number; top: number; right: number; bottom: number } | null {
  if (!isAvailable(element)) return null;
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right);
  let bottom = Math.min(window.innerHeight, rect.bottom);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
  }
  if (right <= left || bottom <= top) return null;
  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  return hit && element.contains(hit) ? { left, top, right, bottom } : null;
}

function scope(): HTMLElement {
  return document.querySelector<HTMLElement>('dialog:modal')
    ?? Array.from(document.querySelectorAll<HTMLElement>('[role="menu"], [role="dialog"][aria-modal="true"]')).filter(isAvailable).at(-1)
    ?? document.body;
}

function hintLabels(count: number): string[] {
  const width = Math.max(1, Math.ceil(Math.log(Math.max(1, count)) / Math.log(HINT_KEYS.length)));
  return Array.from({ length: count }, (_, index) => {
    let label = '';
    for (let digit = 0; digit < width; digit++) {
      label = HINT_KEYS[index % HINT_KEYS.length] + label;
      index = Math.floor(index / HINT_KEYS.length);
    }
    return label;
  });
}

// Each window owns one controller. Hint targets stay fixed until the mode exits.
export function installKeyboardNavigation(): () => void {
  let hints: { label: string; target: HTMLElement; badge: HTMLElement; left: number; top: number }[] = [];
  let layer: HTMLElement | null = null;
  let hintScope: HTMLElement | null = null;
  let prefix = '';
  let pendingG = 0;
  const observer = new MutationObserver(records => {
    if (records.some(record => !layer?.contains(record.target))) cancel();
  });

  function cancel() {
    observer.disconnect();
    layer?.remove();
    layer = null;
    hintScope = null;
    hints = [];
    prefix = '';
    pendingG = 0;
  }

  function showHints() {
    cancel();
    hintScope = scope();
    const targets = Array.from(hintScope.querySelectorAll<HTMLElement>(CONTROLS))
      .map(target => ({ target, rect: visibleRect(target) }))
      .filter(entry => entry.rect !== null);
    if (!targets.length) return;
    const labels = hintLabels(targets.length);
    layer = document.createElement('div');
    layer.className = 'keyboard-hints';
    layer.setAttribute('aria-hidden', 'true');
    // A native modal lives in the top layer, so its hints must be inside it.
    hintScope.append(layer);
    hints = targets.map(({ target, rect }, index) => {
      const badge = document.createElement('span');
      badge.className = 'keyboard-hint';
      badge.textContent = labels[index].toUpperCase();
      layer!.append(badge);
      badge.style.left = `${Math.max(0, Math.min(rect!.left, window.innerWidth - badge.offsetWidth))}px`;
      badge.style.top = `${Math.max(0, Math.min(rect!.top, window.innerHeight - badge.offsetHeight))}px`;
      return { target, badge, label: labels[index], left: rect!.left, top: rect!.top };
    });
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true, characterData: true,
      attributeFilter: ['disabled', 'hidden', 'open', 'class', 'style', 'aria-hidden', 'aria-disabled', 'inert'],
    });
  }

  function consume(event: KeyboardEvent) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onScroll() {
    // A scroll queued before `f` can arrive after hints already use the new positions.
    if (hints.some(hint => {
      const rect = visibleRect(hint.target);
      return !rect || rect.left !== hint.left || rect.top !== hint.top;
    })) cancel();
  }

  function scrollContainer(root: HTMLElement): HTMLElement {
    const canScroll = (element: HTMLElement) => !isInput(element)
      && /(auto|scroll)/.test(getComputedStyle(element).overflowY)
      && element.scrollHeight > element.clientHeight;
    for (let element = document.activeElement as HTMLElement | null; element && root.contains(element); element = element.parentElement) {
      if (canScroll(element)) return element;
    }
    return Array.from(root.querySelectorAll<HTMLElement>('*'))
      .filter(element => canScroll(element) && isAvailable(element) && element.getBoundingClientRect().height > 0)
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]
      ?? (root === document.body ? document.documentElement : root);
  }

  function navigate(key: string) {
    const root = scope();
    const items = Array.from(root.querySelectorAll<HTMLElement>(ITEMS)).filter(isAvailable);
    if (items.length && ['j', 'k', 'gg', 'G'].includes(key)) {
      const current = document.activeElement?.closest(ITEMS);
      const index = items.findIndex(item => item === current);
      const visible = items.filter(item => {
        const rect = item.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      });
      const next = key === 'gg' ? items[0] : key === 'G' ? items.at(-1)!
        : index < 0 ? (key === 'j' ? visible[0] ?? items[0] : visible.at(-1) ?? items.at(-1)!)
        : items[Math.max(0, Math.min(items.length - 1, index + (key === 'j' ? 1 : -1)))];
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest' });
      return;
    }
    const container = scrollContainer(root);
    if (key === 'gg' || key === 'G') container.scrollTo({ top: key === 'gg' ? 0 : container.scrollHeight });
    else container.scrollBy({ top: (key === 'k' || key === 'u' ? -1 : 1) * (key === 'd' || key === 'u' ? container.clientHeight / 2 : 60) });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229 || event.key === 'Process' || event.ctrlKey || event.metaKey || event.altKey) {
      cancel();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    if (layer) {
      if (event.key === 'Escape') { consume(event); cancel(); return; }
      if (event.key === 'Tab') { cancel(); return; }
      consume(event);
      if (event.repeat) return;
      if (event.key === 'Backspace') prefix = prefix.slice(0, -1);
      else if (event.key.length === 1 && HINT_KEYS.includes(event.key.toLowerCase())) prefix += event.key.toLowerCase();
      else return;
      const matches = hints.filter(hint => hint.label.startsWith(prefix));
      if (!matches.length) { cancel(); return; }
      const match = matches.find(hint => hint.label === prefix);
      if (match) {
        const target = match.target;
        const valid = hintScope === scope() && Boolean(visibleRect(target));
        cancel();
        if (valid) {
          target.focus({ preventScroll: true });
          if (!isInput(target) || target.matches('input[type="checkbox"], input[type="radio"], input[type="button"], input[type="submit"], input[type="reset"]')) target.click();
        }
      } else hints.forEach(hint => { hint.badge.hidden = !hint.label.startsWith(prefix); });
      return;
    }
    if (isInput(active) || isInput(event.target instanceof Element ? event.target : null)) {
      pendingG = 0;
      if (event.key === 'Escape') { consume(event); active?.blur(); }
      return;
    }
    if (event.key === 'Escape') { cancel(); return; }
    if (event.key === 'f') {
      consume(event);
      if (!event.repeat) showHints();
      return;
    }
    if (event.key === 'g') {
      consume(event);
      if (event.repeat) return;
      if (pendingG && Date.now() - pendingG < 1000) { pendingG = 0; navigate('gg'); }
      else pendingG = Date.now();
      return;
    }
    pendingG = 0;
    if (['j', 'k', 'G', 'd', 'u'].includes(event.key)) {
      consume(event);
      navigate(event.key);
    } else if (event.key === 'Enter' && active?.matches(ITEMS) && !active.matches('button, a, [role="option"]')) {
      const action = active.querySelector<HTMLButtonElement>('[data-keyboard-open]');
      if (action && !action.disabled) {
        consume(event);
        if (!event.repeat) action.click();
      }
    }
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', cancel);
  window.addEventListener('resize', cancel);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('pointerdown', cancel, true);
  document.addEventListener('compositionstart', cancel, true);
  document.addEventListener('visibilitychange', cancel);
  return () => {
    cancel();
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('resize', cancel);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('pointerdown', cancel, true);
    document.removeEventListener('compositionstart', cancel, true);
    document.removeEventListener('visibilitychange', cancel);
  };
}
