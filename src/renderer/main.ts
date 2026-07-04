// Main window renderer — list + detail two-pane layout.
//
// Preload API (see src/preload.js):
//   window.api.workspace.{list, syncFromTmux, jump, openInFinder,
//                        rename, remove, onUpdated}
//
// Layout rules:
//   - 0 workspaces           → full-window empty state (single sync CTA)
//   - ≥1 workspaces          → list panel (left, one column) + detail
//                              panel (right, shows the currently selected
//                              workspace)
//   - Single-click list item  → select (does NOT jump)
//   - Detail "跳转到 tmux"     → the actual jump
//   - Right-click list item   → in-DOM context menu (quick actions)

import type { Workspace, RemoveOptions } from '../main/types';

// -----------------------------------------------------------------------
// Preload API surface
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
let selectedId: string | null = null;

// -----------------------------------------------------------------------
// DOM refs (set in init)
// -----------------------------------------------------------------------
let appShell: HTMLElement;
let listPanel: HTMLElement;
let workspaceList: HTMLUListElement;
let detailPanel: HTMLElement;

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

function svg(paths: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const s = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg'
  ) as SVGSVGElement;
  s.setAttribute('viewBox', viewBox);
  s.innerHTML = paths;
  return s;
}

const GRID_SVG = `
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

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
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
  // Preserve current selection if the workspace still exists; otherwise pick
  // the first one (or clear if the list is now empty).
  if (selectedId && !workspaces.some((w) => w.id === selectedId)) {
    selectedId = null;
  }
  if (!selectedId && workspaces.length > 0) {
    selectedId = workspaces[0].id;
  }
  render();
}

function currentSelected(): Workspace | null {
  if (!selectedId) return null;
  return workspaces.find((w) => w.id === selectedId) ?? null;
}

// -----------------------------------------------------------------------
// Rendering — top-level dispatcher
// -----------------------------------------------------------------------
function render(): void {
  if (workspaces.length === 0) {
    renderFullEmpty();
    return;
  }
  // Restore two-pane layout.
  appShell.classList.remove('is-empty');
  listPanel.hidden = false;
  detailPanel.hidden = false;
  renderList();
  renderDetail();
}

function renderFullEmpty(): void {
  appShell.classList.add('is-empty');
  // Hide the individual panels; render one full-window empty state.
  listPanel.hidden = true;
  detailPanel.hidden = true;

  // Remove any previous full-empty node.
  document
    .querySelectorAll('.empty-state-full')
    .forEach((n) => n.remove());

  const box = el('div', { class: 'empty-state-full' });
  const iconWrap = el('div', {
    class: 'empty-state-icon',
    'aria-hidden': 'true',
  });
  iconWrap.appendChild(svg(GRID_SVG));
  const msg = el('p', { class: 'empty-state-message' });
  msg.innerHTML =
    '还没有工作区。<br />点击“同步 tmux”，把本地每个 tmux session 映射为一个工作区。';
  const btn = el<HTMLButtonElement>('button', {
    class: 'btn btn-primary',
    type: 'button',
  });
  btn.textContent = '同步 tmux 到工作区';
  btn.addEventListener('click', onSyncClick);
  box.appendChild(iconWrap);
  box.appendChild(msg);
  box.appendChild(btn);
  appShell.appendChild(box);
}

// -----------------------------------------------------------------------
// Rendering — list panel
// -----------------------------------------------------------------------
function renderList(): void {
  workspaceList.innerHTML = '';
  for (const ws of workspaces) {
    workspaceList.appendChild(makeListItem(ws));
  }
}

function makeListItem(ws: Workspace): HTMLLIElement {
  const isActive = ws.id === selectedId;
  const li = el<HTMLLIElement>('li', {
    class: 'workspace-list-item' + (isActive ? ' is-active' : ''),
    role: 'listitem',
    tabindex: '0',
    'data-id': ws.id,
    'aria-selected': isActive ? 'true' : 'false',
    'aria-label': `工作区 ${ws.name}`,
  });

  const row = el('div', { class: 'workspace-list-item-row' });
  row.appendChild(
    el('div', {
      class: 'workspace-list-item-title',
      text: ws.name,
    })
  );
  row.appendChild(
    el('div', {
      class: 'workspace-list-item-meta',
      text: formatRelativeTime(ws.lastActiveAt ?? ws.updatedAt),
    })
  );
  li.appendChild(row);

  li.appendChild(
    el('div', {
      class: 'workspace-list-item-subtitle',
      text: ws.tmuxSessionName
        ? `tmux · ${ws.tmuxSessionName}`
        : '未关联 tmux',
    })
  );

  li.addEventListener('click', () => {
    if (selectedId !== ws.id) {
      selectedId = ws.id;
      render();
    }
  });
  li.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (selectedId !== ws.id) {
        selectedId = ws.id;
        render();
      } else {
        void jumpSelected();
      }
    }
  });
  li.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    // Selecting on right-click gives the detail panel context that matches
    // whatever action the user is about to take from the menu.
    if (selectedId !== ws.id) {
      selectedId = ws.id;
      render();
    }
    showContextMenu(ws, event.clientX, event.clientY);
  });

  return li;
}

// -----------------------------------------------------------------------
// Rendering — detail panel
// -----------------------------------------------------------------------
function renderDetail(): void {
  detailPanel.innerHTML = '';
  const ws = currentSelected();
  if (!ws) {
    // Should be rare (we auto-select) but handle defensively.
    const box = el('div', { class: 'detail-empty' });
    box.appendChild(
      el('p', {
        class: 'empty-state-message',
        text: '选择左侧工作区查看详情。',
      })
    );
    detailPanel.appendChild(box);
    return;
  }

  const inner = el('div', { class: 'detail-inner' });

  // Header
  const header = el('header', { class: 'detail-header' });
  header.appendChild(el('h1', { class: 'detail-title', text: ws.name }));
  header.appendChild(
    el('div', {
      class: 'detail-subtitle',
      text: ws.tmuxSessionName
        ? `tmux · ${ws.tmuxSessionName}`
        : '未关联 tmux',
    })
  );
  inner.appendChild(header);

  // Directory section
  const dirSection = el('section', { class: 'detail-section' });
  dirSection.appendChild(
    el('div', { class: 'detail-section-title', text: '工作区目录' })
  );
  const pathRow = el('div', { class: 'detail-path-row' });
  pathRow.appendChild(
    el('code', { class: 'detail-path', text: ws.directory, title: ws.directory })
  );
  const finderBtn = el<HTMLButtonElement>('button', {
    type: 'button',
    class: 'btn btn-secondary',
  });
  finderBtn.textContent = '在 Finder 中打开';
  finderBtn.addEventListener('click', async () => {
    try {
      const ok = await api.openInFinder(ws.id);
      if (!ok) alert('无法打开该工作区目录（可能已被删除）。');
    } catch (err) {
      console.error('[main] openInFinder failed:', err);
    }
  });
  pathRow.appendChild(finderBtn);
  dirSection.appendChild(pathRow);
  inner.appendChild(dirSection);

  // Meta section
  const metaSection = el('section', { class: 'detail-section' });
  metaSection.appendChild(
    el('div', { class: 'detail-section-title', text: '元信息' })
  );
  const fields = el('div', { class: 'detail-fields' });
  fields.appendChild(makeField('创建时间', formatDate(ws.createdAt)));
  fields.appendChild(
    makeField(
      '最后活跃时间',
      ws.lastActiveAt ? formatRelativeTime(ws.lastActiveAt) : '未使用'
    )
  );
  fields.appendChild(makeField('上次更新', formatRelativeTime(ws.updatedAt)));
  fields.appendChild(
    makeField(
      '来源',
      ws.source === 'tmux-sync' ? 'tmux 同步' : '手动创建'
    )
  );
  metaSection.appendChild(fields);
  inner.appendChild(metaSection);

  // Actions
  const actions = el('div', { class: 'detail-actions' });
  const jumpBtn = el<HTMLButtonElement>('button', {
    type: 'button',
    class: 'btn btn-primary',
  });
  jumpBtn.textContent = '跳转到 tmux';
  if (!ws.tmuxSessionName) {
    jumpBtn.disabled = true;
    jumpBtn.title = '该工作区未关联 tmux session';
  } else {
    jumpBtn.addEventListener('click', jumpSelected);
  }
  actions.appendChild(jumpBtn);

  const renameBtn = el<HTMLButtonElement>('button', {
    type: 'button',
    class: 'btn btn-secondary',
  });
  renameBtn.textContent = '重命名';
  renameBtn.addEventListener('click', () => promptRename(ws));
  actions.appendChild(renameBtn);

  const copyBtn = el<HTMLButtonElement>('button', {
    type: 'button',
    class: 'btn btn-secondary',
  });
  copyBtn.textContent = '复制 session 名';
  copyBtn.disabled = !ws.tmuxSessionName;
  if (ws.tmuxSessionName) {
    copyBtn.addEventListener('click', () =>
      copyToClipboard(ws.tmuxSessionName!)
    );
  }
  actions.appendChild(copyBtn);

  actions.appendChild(el('div', { class: 'detail-actions-spacer' }));

  const deleteBtn = el<HTMLButtonElement>('button', {
    type: 'button',
    class: 'btn btn-danger',
  });
  deleteBtn.textContent = '删除工作区…';
  deleteBtn.addEventListener('click', () => promptDelete(ws));
  actions.appendChild(deleteBtn);

  inner.appendChild(actions);

  detailPanel.appendChild(inner);
}

function makeField(label: string, value: string): HTMLElement {
  const box = el('div', { class: 'detail-field' });
  box.appendChild(el('div', { class: 'detail-field-label', text: label }));
  box.appendChild(el('div', { class: 'detail-field-value', text: value }));
  return box;
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

async function jumpSelected(): Promise<void> {
  const ws = currentSelected();
  if (!ws) return;
  try {
    const result = await api.jump(ws.id);
    if (result.success) return;
    switch (result.reason) {
      case 'session_not_found':
      case 'workspace_offline':
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
// Context menu — rendered in-DOM
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
    { label: '跳转到 tmux', onClick: jumpSelected, disabled: !ws.tmuxSessionName },
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
  const closeAll = (): void => {
    closeContextMenu();
    cleanup();
  };
  const cleanup = (): void => {
    window.removeEventListener('mousedown', onOutside, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeAll, true);
    window.removeEventListener('blur', closeAll, true);
  };
  setTimeout(() => {
    window.addEventListener('mousedown', onOutside, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closeAll, true);
    window.addEventListener('blur', closeAll, true);
  }, 0);
}

// -----------------------------------------------------------------------
// Modal dialogs
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
    text: '默认只删除工作区的元数据条目，本地目录会保留在 Application Support 下。',
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
      // If we just deleted the selected workspace, refresh() will fall back to
      // the first remaining (or the full empty state).
      if (selectedId === ws.id) selectedId = null;
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
  appShell = document.getElementById('appShell') as HTMLElement;
  listPanel = document.getElementById('listPanel') as HTMLElement;
  workspaceList = document.getElementById('workspaceList') as HTMLUListElement;
  detailPanel = document.getElementById('detailPanel') as HTMLElement;

  if (!api) {
    console.error('[main] window.api.workspace unavailable — preload not wired');
    detailPanel.innerHTML =
      '<div class="detail-empty"><p class="empty-state-message">初始化失败：主进程 API 未就绪。</p></div>';
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
