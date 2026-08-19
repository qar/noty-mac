import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, WorkspaceWithStatus } from '../main/types';
import {
  ALL_PROJECTS_ID,
  ProjectPanel,
} from './components/project-panel';
import { SettingsSidebar } from './components/settings/settings-sidebar';
import { SettingsView } from './components/settings/settings-view';
import type { SettingsTab } from './components/settings/settings-navigation';
import { WorkspacePanel } from './components/workspace-panel';
import {
  EmptyWorkspaceState,
  WorkspaceDetail,
} from './components/workspace-detail';
import {
  DeleteDialog,
  RenameDialog,
  WorkspaceContextMenu,
  type ContextMenuState,
} from './components/workspace-overlays';
import { POLL_INTERVAL_MS } from './workspace-ui';
import type { DashboardView } from './renderer-api';
import { WorkflowView } from './components/workflow-view';

type LoadState = 'loading' | 'ready' | 'error';

const workspaceApi = window.api?.workspace;
const projectsApi = window.api?.projects;

export function WorkspaceApp() {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithStatus[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null
  );
  const [selectedProjectId, setSelectedProjectId] = useState(ALL_PROJECTS_ID);
  const [activeView, setActiveView] = useState<DashboardView>('workspace');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [loadState, setLoadState] = useState<LoadState>(
    workspaceApi ? 'loading' : 'error'
  );
  const [projectLoadState, setProjectLoadState] = useState<LoadState>(
    projectsApi ? 'loading' : 'error'
  );
  const [syncing, setSyncing] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<WorkspaceWithStatus | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceWithStatus | null>(null);

  const showDashboardView = useCallback((view: DashboardView): void => {
    setActiveView(view);
    window.api?.dashboard?.setView(view);
    if (view === 'settings' || view === 'workflow') {
      setContextMenu(null);
      setRenaming(null);
      setDeleting(null);
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!workspaceApi) {
      setLoadState('error');
      return;
    }
    try {
      const next = await workspaceApi.list();
      // Keep relative timestamps and stale agent states moving with the poll.
      setWorkspaces(next);
      setLoadState('ready');
    } catch (error) {
      console.error('[main] workspace.list failed:', error);
      setLoadState('error');
    }
  }, []);

  const refreshProjects = useCallback(async (): Promise<void> => {
    if (!projectsApi) {
      setProjectLoadState('error');
      return;
    }
    try {
      const next = await projectsApi.list();
      setProjects(next);
      setSelectedProjectId((current) =>
        current === ALL_PROJECTS_ID || next.some((project) => project.id === current)
          ? current
          : ALL_PROJECTS_ID
      );
      setProjectLoadState('ready');
    } catch (error) {
      console.error('[main] projects.list failed:', error);
      setProjects([]);
      setSelectedProjectId(ALL_PROJECTS_ID);
      setProjectLoadState('error');
    }
  }, []);

  useEffect(() => {
    if (!workspaceApi) return;
    void refresh();
    const unsubscribe = workspaceApi.onUpdated(() => {
      void refresh();
    });
    const poll = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(poll);
      unsubscribe?.();
    };
  }, [refresh]);

  useEffect(() => {
    if (!projectsApi) return;
    void refreshProjects();
    const unsubscribe = projectsApi.onUpdated(() => {
      void refreshProjects();
      void refresh();
    });
    return () => unsubscribe?.();
  }, [refresh, refreshProjects]);

  useEffect(() => {
    const dashboardApi = window.api?.dashboard;
    if (!dashboardApi) return;
    let active = true;
    const navigate = (view: DashboardView): void => {
      if (!active || !['workspace', 'workflow', 'settings'].includes(view)) return;
      setActiveView(view);
      if (view === 'settings' || view === 'workflow') {
        setContextMenu(null);
        setRenaming(null);
        setDeleting(null);
      }
    };

    dashboardApi
      .getInitialView()
      .then(navigate)
      .catch((error) => console.error('[main] dashboard initial view failed:', error));
    const unsubscribe = dashboardApi.onNavigate(navigate);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const filteredWorkspaces = useMemo(
    () =>
      selectedProjectId === ALL_PROJECTS_ID
        ? workspaces
        : workspaces.filter(
            (workspace) => workspace.projectId === selectedProjectId
          ),
    [selectedProjectId, workspaces]
  );

  useEffect(() => {
    if (loadState !== 'ready') return;
    setSelectedWorkspaceId((current) =>
      current && filteredWorkspaces.some((workspace) => workspace.id === current)
        ? current
        : filteredWorkspaces[0]?.id ?? null
    );
  }, [filteredWorkspaces, loadState]);

  const selectedWorkspace = useMemo(
    () =>
      filteredWorkspaces.find(
        (workspace) => workspace.id === selectedWorkspaceId
      ) ?? null,
    [filteredWorkspaces, selectedWorkspaceId]
  );

  const selectProject = useCallback((id: string): void => {
    setSelectedProjectId(id);
    setContextMenu(null);
    setRenaming(null);
    setDeleting(null);
  }, []);

  const syncWorkspaces = useCallback(async (): Promise<void> => {
    if (!workspaceApi || syncing) return;
    setSyncing(true);
    try {
      await workspaceApi.syncFromTmux();
      await refresh();
    } catch (error) {
      console.error('[main] syncFromTmux failed:', error);
    } finally {
      setSyncing(false);
    }
  }, [refresh, syncing]);

  const jumpToWorkspace = useCallback(
    async (workspace: WorkspaceWithStatus): Promise<void> => {
      if (!workspaceApi) return;
      try {
        const result = await workspaceApi.jump(workspace.id);
        if (result.success) {
          await refresh();
          return;
        }
        switch (result.reason) {
          case 'session_not_found':
          case 'workspace_offline':
            alert(
              `tmux 会话 “${workspace.tmuxSessionName ?? workspace.name}” 已不存在。\n\n` +
                '请在终端中重新创建该 session 后再跳转。'
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
      } catch (error) {
        console.error('[main] jump failed:', error);
        alert('跳转失败：' + (error instanceof Error ? error.message : String(error)));
      }
    },
    [refresh]
  );

  const openInFinder = useCallback(async (workspace: WorkspaceWithStatus) => {
    if (!workspaceApi) return;
    try {
      const opened = await workspaceApi.openInFinder(workspace.id);
      if (!opened) alert('无法打开该工作区目录（可能已被删除）。');
    } catch (error) {
      console.error('[main] openInFinder failed:', error);
    }
  }, []);

  const copySession = useCallback(async (workspace: WorkspaceWithStatus) => {
    if (!workspace.tmuxSessionName) return;
    try {
      await navigator.clipboard.writeText(workspace.tmuxSessionName);
    } catch (error) {
      console.warn('[main] clipboard.writeText failed:', error);
    }
  }, []);

  const renameWorkspace = useCallback(
    async (workspace: WorkspaceWithStatus, name: string): Promise<void> => {
      if (!workspaceApi) return;
      await workspaceApi.rename(workspace.id, name);
      await refresh();
    },
    [refresh]
  );

  const deleteWorkspace = useCallback(
    async (
      workspace: WorkspaceWithStatus,
      deleteDirectory: boolean
    ): Promise<void> => {
      if (!workspaceApi) return;
      await workspaceApi.remove(workspace.id, { deleteDir: deleteDirectory });
      await refresh();
    },
    [refresh]
  );

  const hasWorkspaces = loadState === 'ready' && workspaces.length > 0;
  const projectHasNoWorkspaces =
    selectedProjectId !== ALL_PROJECTS_ID && filteredWorkspaces.length === 0;
  const emptyState =
    loadState === 'loading'
      ? 'loading'
      : loadState === 'error'
        ? 'error'
        : 'empty';
  const shellStateClass =
    activeView === 'settings'
      ? ' is-settings'
      : activeView === 'workflow'
        ? ' is-workflow'
      : hasWorkspaces
        ? ''
        : ' is-empty';

  return (
    <>
      <div className={`app-shell${shellStateClass}`}>
        {activeView === 'settings' ? (
          <SettingsSidebar
            activeTab={settingsTab}
            onSelect={setSettingsTab}
            onBack={() => showDashboardView('workspace')}
          />
        ) : (
          <ProjectPanel
            projects={projects}
            selectedId={selectedProjectId}
            loadState={projectLoadState}
            onSelect={selectProject}
            onSettings={() => showDashboardView('settings')}
            onWorkflows={() => showDashboardView('workflow')}
            workflowActive={activeView === 'workflow'}
          />
        )}
        {activeView === 'settings' ? (
          <SettingsView activeTab={settingsTab} />
        ) : activeView === 'workflow' ? (
          <WorkflowView projects={projects} />
        ) : hasWorkspaces ? (
          <>
            <WorkspacePanel
              workspaces={filteredWorkspaces}
              selectedId={selectedWorkspaceId}
              syncing={syncing}
              emptyMessage={
                projectHasNoWorkspaces ? '该项目暂无工作区' : undefined
              }
              onSelect={setSelectedWorkspaceId}
              onJump={(workspace) => void jumpToWorkspace(workspace)}
              onSync={() => void syncWorkspaces()}
              onContextMenu={(workspace, point) =>
                setContextMenu({ workspace, ...point })
              }
            />
            <WorkspaceDetail
              workspace={selectedWorkspace}
              emptyMessage={
                projectHasNoWorkspaces ? '该项目暂无工作区。' : undefined
              }
              onJump={(workspace) => void jumpToWorkspace(workspace)}
              onOpenFinder={(workspace) => void openInFinder(workspace)}
              onRename={setRenaming}
              onCopySession={(workspace) => void copySession(workspace)}
              onDelete={setDeleting}
            />
          </>
        ) : (
          <EmptyWorkspaceState
            state={emptyState}
            syncing={syncing}
            onSync={() => void syncWorkspaces()}
          />
        )}
      </div>

      {activeView === 'workspace' && contextMenu ? (
        <WorkspaceContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onJump={(workspace) => void jumpToWorkspace(workspace)}
          onOpenFinder={(workspace) => void openInFinder(workspace)}
          onRename={setRenaming}
          onCopySession={(workspace) => void copySession(workspace)}
          onDelete={setDeleting}
        />
      ) : null}

      {activeView === 'workspace' && renaming ? (
        <RenameDialog
          key={renaming.id}
          workspace={renaming}
          onClose={() => setRenaming(null)}
          onSubmit={(name) => renameWorkspace(renaming, name)}
        />
      ) : null}

      {activeView === 'workspace' && deleting ? (
        <DeleteDialog
          key={deleting.id}
          workspace={deleting}
          onClose={() => setDeleting(null)}
          onSubmit={(deleteDirectory) =>
            deleteWorkspace(deleting, deleteDirectory)
          }
        />
      ) : null}
    </>
  );
}
