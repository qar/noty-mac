// Main window renderer — workspace list + interactions.
//
// Consumes the preload API exposed in src/preload.js:
//   window.api.workspace.{list, syncFromTmux, jump, openInFinder,
//                        rename, remove, onUpdated}
//
// Flow:
//   1. On load, call list() → render.
//   2. Zero workspaces → empty state; else a `.workspace-grid` of cards.
//   3. Single-click card → jump(). If tmux reports `session_not_found`
//      surface an alert (creating the session is deferred: red-line §11).
//   4. Right-click card → custom context menu (jump / Finder / rename /
//      copy session name / delete).
//   5. Sync button (toolbar or empty state) → syncFromTmux(). Main sends
//      a system notification with the delta; renderer re-fetches via the
//      onUpdated event.

import type { Workspace, RemoveOptions } from '../main/types';

// -----------------------------------------------------------------------
// Preload API surface (mirrors src/preload.js). Declared as a global so
// no runtime import is required.
// -----------------------------------------------------------------------
interface JumpOutcome {
  success: boolean;
  reason?: string;
}

interface WorkspaceApi {
  list(): Promise<Workspace[]>;
  syncFromTmux(): Promise<void>;
  jump(id: string): Promise<JumpOutcome>;
  openInFinder(id: string): Promise<boolean>;
  rename(id: string, name: string): Promise<Workspace | null>;
  remove(id: string, opts?: RemoveOptions): Promise<boolean>;
  onUpdated(callback: () => void): void;
}

declare global {
  interface Window {
    api: {
      workspace: WorkspaceApi;
    };
  }
}

const api = window.api?.workspace;

// -----------------------------------------------------------------------
// State
// -----------------------------------------------------------------------
let workspaces: Workspace[] = [];

// -----------------------------------------------------------------------
// DOM helpers
// -----------------------------------------------------------------------
function el<T extends HTMLElement = HTMLElement>(
  tag: string,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = []
): T {
  const node = document.createElement(tag) as T;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function icon(paths: string): SVGElement {
  const svg = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg'
  ) as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = paths;
  return svg;
}

const gridSvgPaths = `
  <rect x="3" y="4" width="7" height="7" rx="1.5" />
  <rect x="14" y="4" width="7" height="7" rx="1.5" />
  <rect x="3" y="14" width="7" height="7" rx="1.5" />
  <rect x="14" y="14" width="7" height="7" rx="1.5" />
`;

// -----------------------------------------------------------------------
// Time formatting
// -----------------------------------------------------------------------
function formatRelativeTime(ts: number | null): string {
  if (!ts) return '未使用';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

// -----------------------------------------------------------------------
// Data
// -----------------------------------------------------------------------
async function refresh(): Promise<void> {
  try {
    workspaces = await api.list();
  } catch (err) {
    console.error('[main] workspace.list failed:', err);
    workspaces = [];
  }
  render();
}

// -----------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------
const root = document.getElementById('workspaceRoot') as HTMLElement;

function render(): void {
  root.innerHTML = '';
  if (workspaces.length === 0) {
    root.appendChild(makeEmptyState());
  } else {
    root.appendChild(makeGrid(workspaces));
  }
}

function makeEmptyState(): HTMLElement {
  const box = el('div', { class: 'empty-state' });

  const iconWrap = el('div', { class: 'empty-state-icon', 'aria-hidden': 'true' });
  iconWrap.appendChild(icon(gridSvgPaths));

  const msg = el('p', {
    class: 'empty-state-message',
    text: '',
  });
  msg.innerHTML =
    '还没有工作区。<br />点击“同步 tmux”，把本地每个 tmux session 映射为一个工作区。';

  const btn = el<HTMLButtonElement>('button', {
    class: 'btn btn-primary',
    type: 'button',
    'data-action': 'sync',
  });
  btn.textContent = '同步 tmux 到工作区';
  btn.addEventListener('click', onSyncClick);

  box.appendChild(iconWrap);
  box.appendChild(msg);
  box.appendChild(btn);
  return box;
}

function makeGrid(list: Workspace[]): HTMLElement {
  const grid = el('div', { class: 'workspace-grid' });
  for (const ws of list) {
    grid.appendChild(makeCard(ws));
  }
  return grid;
}

function makeCard(ws: Workspace): HTMLElement {
  const card = el('div', {
    class: 'workspace-card',
    role: 'button',
    tabindex: '0',
    'data-id': ws.id,
    'aria-label': `工作区 ${ws.name}`,
  });

  const title = el('div', { class: 'workspace-card-title', text: ws.name });
  const subtitle = el('div', {
    class: 'workspace-card-subtitle',
    text: ws.tmuxSessionName ? `tmux · ${ws.tmuxSessionName}` : '未关联 tmux',
  });
  const meta = el('div', {
    class: 'workspace-card-meta',
    text: formatRelativeTime(ws.lastActiveAt ?? ws.updatedAt),
  });

  card.appendChild(title);
  card.appendChild(subtitle);
  card.appendChild(meta);

  card.addEventListener('click', () => onCardClick(ws));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onCardClick(ws);
    }
  });
  card.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showContextMenu(ws, event.clientX, event.clientY);
  });

  return card;
}

// -----------------------------------------------------------------------
// Interactions
// -----------------------------------------------------------------------
async function onSyncClick(): Promise<void> {
  try {
    await api.syncFromTmux();
    // Main will post a system notification and also send workspace:updated,
    // so we don't need to manually refresh here.
  } catch (err) {
    console.error('[main] syncFromTmux failed:', err);
  }
}

async function onCardClick(ws: Workspace): Promise<void> {
  try {
    const result = await api.jump(ws.id);
    if (result.success) return;
    switch (result.reason) {
      case 'session_not_found':
      case 'workspace_offline':
        // Q9: prompt the user to (re)create the session. Stage-one keeps
        // this to a heads-up alert; actually creating tmux sessions is
        // deferred to a follow-up so we stay away from the red-line
        // discussion until the user explicitly opts in.
        alert(
          `tmux 会话 "${ws.tmuxSessionName ?? ws.name}" 已不存在。\n\n` +
            '（阶段一暂未实现自动创建；请在终端里手动 `tmux new-session -d -s <name>` 后再点击。）'
        );
        break;
      case 'tmux_not_found':
        alert('未检测到 tmux。请先安装 tmux 或将其加入 PATH。');
        break;
      case 'no_attached_client':
        alert('未找到 kitty 终端窗口，请先打开 kitty。');
        break;
      default:
        alert(`跳转失败：${result.reason ?? 'unknown'}`);
    }
  } catch (err) {
    console.error('[main] jump failed:', err);
    alert('跳转失败：' + (err instanceof Error ? err.message : String(err)));
  }
}

// -----------------------------------------------------------------------
// Context menu — rendered in-DOM (avoids introducing a native Menu IPC
// path just for stage one).
// -----------------------------------------------------------------------
let currentContextMenu: HTMLElement | null = null;

function closeContextMenu(): void {
  if (currentContextMenu) {
    currentContextMenu.remove();
    currentContextMenu = null;
  }
}

function showContextMenu(ws: Workspace, x: number, y: number): void {
  closeContextMenu();
  const menu = el('div', {
    class: 'context-menu',
    role: 'menu',
  });

  const items: Array<
    | { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }
    | { divider: true }
  > = [
    { label: '跳转到 tmux', onClick: () => onCardClick(ws) },
    {
      label: '在 Finder 中打开工作区目录',
      onClick: async () => {
        try {
          const ok = await api.openInFinder(ws.id);
          if (!ok) alert('无法打开该工作区目录（可能已被删除）。');
        } catch (err) {
          console.error('[main] openInFinder failed:', err);
        }
      },
    },
    { label: '重命名…', onClick: () => promptRename(ws) },
    {
      label: '复制 tmux session 名',
      disabled: !ws.tmuxSessionName,
      onClick: () => {
        if (!ws.tmuxSessionName) return;
        void copyToClipboard(ws.tmuxSessionName);
      },
    },
    { divider: true },
    {
      label: '删除工作区…',
      danger: true,
      onClick: () => promptDelete(ws),
    },
  ];

  for (const item of items) {
    if ('divider' in item) {
      menu.appendChild(el('div', { class: 'context-menu-divider' }));
      continue;
    }
    const row = el('button', {
      type: 'button',
      class:
        'context-menu-item' +
        (item.danger ? ' is-danger' : '') +
        (item.disabled ? ' is-disabled' : ''),
      role: 'menuitem',
      text: item.label,
    });
    if (item.disabled) {
      (row as HTMLButtonElement).disabled = true;
    } else {
      row.addEventListener('click', () => {
        closeContextMenu();
        item.onClick();
      });
    }
    menu.appendChild(row);
  }

  // Position after mount so we can measure size and clamp to viewport.
  menu.style.left = '0px';
  menu.style.top = '0px';
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const clampedX = Math.min(x, window.innerWidth - rect.width - 8);
  const clampedY = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, clampedX)}px`;
  menu.style.top = `${Math.max(8, clampedY)}px`;

  currentContextMenu = menu;

  // Close on any outside click / scroll / Escape.
  const onOutside = (event: MouseEvent): void => {
    if (!menu.contains(event.target as Node)) {
      closeContextMenu();
      cleanup();
    }
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      closeContextMenu();
      cleanup();
    }
  };
  const cleanup = (): void => {
    window.removeEventListener('mousedown', onOutside, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeAll, true);
    window.removeEventListener('blur', closeAll, true);
  };
  const closeAll = (): void => {
    closeContextMenu();
    cleanup();
  };
  // Defer registration so the same click that opened the menu doesn't close it.
  setTimeout(() => {
    window.addEventListener('mousedown', onOutside, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closeAll, true);
    window.addEventListener('blur', closeAll, true);
  }, 0);
}

// -----------------------------------------------------------------------
// Modal dialogs (rename / delete). Uses the native <dialog> element so we
// get focus trapping + Escape handling for free.
// -----------------------------------------------------------------------
function promptRename(ws: Workspace): void {
  const dialog = el<HTMLDialogElement>('dialog', { class: 'app-dialog' });

  const form = el('form', { method: 'dialog', class: 'app-dialog-form' });
  form.appendChild(
    el('div', { class: 'app-dialog-title', text: '重命名工作区' })
  );

  const label = el('label', { class: 'form-field-label', text: '新名称' });
  const input = el<HTMLInputElement>('input', {
    type: 'text',
    class: 'form-input',
    value: ws.name,
    required: 'required',
    maxlength: '80',
  });

  const field = el('div', { class: 'form-field' }, [label, input]);
  form.appendChild(field);

  const actions = el('div', { class: 'app-dialog-actions' });
  const cancel = el<HTMLButtonElement>('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: '取消',
  });
  const save = el<HTMLButtonElement>('button', {
    type: 'submit',
    class: 'btn btn-primary',
    text: '保存',
  });
  actions.appendChild(cancel);
  actions.appendChild(save);
  form.appendChild(actions);

  dialog.appendChild(form);
  document.body.appendChild(dialog);

  const close = (): void => {
    dialog.close();
    dialog.remove();
  };
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', close);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const next = input.value.trim();
    if (!next || next === ws.name) {
      close();
      return;
    }
    try {
      await api.rename(ws.id, next);
      await refresh();
    } catch (err) {
      console.error('[main] rename failed:', err);
      alert('重命名失败：' + (err instanceof Error ? err.message : String(err)));
    }
    close();
  });

  dialog.showModal();
  input.select();
}

function promptDelete(ws: Workspace): void {
  const dialog = el<HTMLDialogElement>('dialog', { class: 'app-dialog' });
  const form = el('form', { method: 'dialog', class: 'app-dialog-form' });

  form.appendChild(el('div', { class: 'app-dialog-title', text: '删除工作区' }));

  const msg = el('p', { class: 'app-dialog-message' });
  msg.textContent = `确定要删除工作区 "${ws.name}" 吗？`;
  form.appendChild(msg);

  const checkboxWrap = el('label', { class: 'app-dialog-check' });
  const checkbox = el<HTMLInputElement>('input', { type: 'checkbox' });
  checkboxWrap.appendChild(checkbox);
  checkboxWrap.appendChild(
    document.createTextNode(' 同时删除本地目录（不可撤销）')
  );
  form.appendChild(checkboxWrap);

  const hint = el('p', {
    class: 'app-dialog-hint',
    text:
      '默认只删除工作区的元数据条目，本地目录会保留在 Application Support 下。'
  });
  form.appendChild(hint);

  const actions = el('div', { class: 'app-dialog-actions' });
  const cancel = el<HTMLButtonElement>('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: '取消',
  });
  const confirm = el<HTMLButtonElement>('button', {
    type: 'submit',
    class: 'btn btn-danger',
    text: '删除',
  });
  actions.appendChild(cancel);
  actions.appendChild(confirm);
  form.appendChild(actions);

  dialog.appendChild(form);
  document.body.appendChild(dialog);

  const close = (): void => {
    dialog.close();
    dialog.remove();
  };
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', close);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api.remove(ws.id, { deleteDir: checkbox.checked });
      await refresh();
    } catch (err) {
      console.error('[main] remove failed:', err);
      alert('删除失败：' + (err instanceof Error ? err.message : String(err)));
    }
    close();
  });

  dialog.showModal();
}

// -----------------------------------------------------------------------
// Clipboard
// -----------------------------------------------------------------------
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.warn('[main] clipboard.writeText failed:', err);
  }
}

// -----------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------
function init(): void {
  if (!api) {
    console.error(
      '[main] window.api.workspace unavailable — preload not wired'
    );
    root.innerHTML =
      '<div class="empty-state"><p class="empty-state-message">初始化失败：主进程 API 未就绪。</p></div>';
    return;
  }

  const syncBtn = document.getElementById(
    'toolbarSyncBtn'
  ) as HTMLButtonElement | null;
  syncBtn?.addEventListener('click', onSyncClick);

  api.onUpdated(() => {
    void refresh();
  });

  void refresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
