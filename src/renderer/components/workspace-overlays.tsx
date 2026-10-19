import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import type { FormEvent } from 'react';
import type { WorkspaceWithStatus } from '../../main/types';

export interface ContextMenuState {
  workspace: WorkspaceWithStatus;
  x: number;
  y: number;
}

interface WorkspaceContextMenuProps {
  state: ContextMenuState;
  onClose(): void;
  onJump(workspace: WorkspaceWithStatus): void;
  onOpenFinder(workspace: WorkspaceWithStatus): void;
  onRename(workspace: WorkspaceWithStatus): void;
  onCopySession(workspace: WorkspaceWithStatus): void;
  onDelete(workspace: WorkspaceWithStatus): void;
}

export function WorkspaceContextMenu({
  state,
  onClose,
  onJump,
  onOpenFinder,
  onRename,
  onCopySession,
  onDelete,
}: WorkspaceContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { workspace } = state;

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(state.x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(state.y, window.innerHeight - rect.height - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }, [state.x, state.y]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', onClose, true);
    window.addEventListener('blur', onClose, true);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', onClose, true);
      window.removeEventListener('blur', onClose, true);
    };
  }, [onClose]);

  const run = (action: () => void) => (): void => {
    onClose();
    action();
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: state.x, top: state.y }}
    >
      <MenuItem
        label="跳转到 tmux"
        disabled={!workspace.tmuxSessionName}
        onClick={run(() => onJump(workspace))}
      />
      <MenuItem
        label="在 Finder 中打开工作区目录"
        onClick={run(() => onOpenFinder(workspace))}
      />
      <MenuItem label="重命名…" onClick={run(() => onRename(workspace))} />
      <MenuItem
        label="复制 tmux session 名"
        disabled={!workspace.tmuxSessionName}
        onClick={run(() => onCopySession(workspace))}
      />
      <div className="context-menu-divider" />
      <MenuItem
        label="删除工作区…"
        danger
        onClick={run(() => onDelete(workspace))}
      />
    </div>
  );
}

function MenuItem({
  label,
  danger = false,
  disabled = false,
  onClick,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className={`context-menu-item${danger ? ' is-danger' : ''}`}
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

interface RenameDialogProps {
  workspace: WorkspaceWithStatus;
  onClose(): void;
  onSubmit(name: string): Promise<void>;
}

export function RenameDialog({
  workspace,
  onClose,
  onSubmit,
}: RenameDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(workspace.name);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    inputRef.current?.select();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || nextName === workspace.name) {
      onClose();
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(nextName);
      onClose();
    } catch (error) {
      console.error('[main] rename failed:', error);
      alert('重命名失败：' + (error instanceof Error ? error.message : String(error)));
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form className="app-dialog-form" onSubmit={handleSubmit}>
        <div className="app-dialog-title">重命名工作区</div>
        <label className="form-field">
          <span className="form-field-label">新名称</span>
          <input
            ref={inputRef}
            type="text"
            className="form-input"
            value={name}
            required
            maxLength={80}
            disabled={submitting}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="app-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            <Save aria-hidden="true" />
            保存
          </button>
        </div>
      </form>
    </dialog>
  );
}

interface DeleteDialogProps {
  workspace: WorkspaceWithStatus;
  onClose(): void;
  onSubmit(deleteDirectory: boolean): Promise<void>;
}

export function DeleteDialog({
  workspace,
  onClose,
  onSubmit,
}: DeleteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deleteDirectory, setDeleteDirectory] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(deleteDirectory);
      onClose();
    } catch (error) {
      console.error('[main] remove failed:', error);
      alert('删除失败：' + (error instanceof Error ? error.message : String(error)));
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form className="app-dialog-form" onSubmit={handleSubmit}>
        <div className="app-dialog-title">删除工作区</div>
        <p className="app-dialog-message">
          确定要删除工作区 “{workspace.name}” 吗？
        </p>
        <label className="app-dialog-check">
          <input
            type="checkbox"
            checked={deleteDirectory}
            disabled={submitting}
            onChange={(event) => setDeleteDirectory(event.target.checked)}
          />
          <span>同时删除本地目录（不可撤销）</span>
        </label>
        <p className="app-dialog-hint">
          默认只删除工作区的元数据条目，本地目录会保留在 Application Support 下。
        </p>
        <div className="app-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-danger" disabled={submitting}>
            <Trash2 aria-hidden="true" />
            删除
          </button>
        </div>
      </form>
    </dialog>
  );
}
