import { Folder, LayoutGrid, Settings, Workflow } from 'lucide-react';
import type { Project } from '../../main/types';

export const ALL_PROJECTS_ID = '__all_projects__';

interface ProjectPanelProps {
  projects: readonly Project[];
  selectedId: string;
  loadState: 'loading' | 'ready' | 'error';
  onSelect(id: string): void;
  onSettings(): void;
  onWorkflows(): void;
  workflowActive: boolean;
}

export function ProjectPanel({
  projects,
  selectedId,
  loadState,
  onSelect,
  onSettings,
  onWorkflows,
  workflowActive,
}: ProjectPanelProps) {
  return (
    <aside className="project-list-panel" aria-labelledby="projectPanelTitle">
      <header className="project-panel-header">
        <div className="project-panel-title" id="projectPanelTitle">
          项目
        </div>
      </header>
      <ul className="project-list" role="listbox" aria-label="项目">
        <ProjectListItem
          id={ALL_PROJECTS_ID}
          name="全部项目"
          subtitle="所有工作区"
          selectedId={selectedId}
          icon={LayoutGrid}
          onSelect={onSelect}
        />
        {projects.map((project) => {
          return (
            <ProjectListItem
              key={project.id}
              id={project.id}
              name={project.name}
              subtitle={project.directory}
              selectedId={selectedId}
              icon={Folder}
              onSelect={onSelect}
            />
          );
        })}
        {loadState !== 'ready' || projects.length === 0 ? (
          <li
            className={`project-list-status${loadState === 'error' ? ' is-error' : ''}`}
            role="none"
          >
            <span role={loadState === 'error' ? 'alert' : 'status'}>
              {loadState === 'loading'
                ? '正在载入项目'
                : loadState === 'error'
                  ? '项目目录不可用'
                  : '暂无项目'}
            </span>
          </li>
        ) : null}
      </ul>
      <footer className="project-panel-footer">
        <button
          type="button"
          className={`project-settings-button${workflowActive ? ' is-active' : ''}`}
          onClick={onWorkflows}
        >
          <Workflow aria-hidden="true" />
          <span>工作流</span>
        </button>
        <button
          type="button"
          className="project-settings-button"
          onClick={onSettings}
        >
          <Settings aria-hidden="true" />
          <span>设置</span>
        </button>
      </footer>
    </aside>
  );
}

function ProjectListItem({
  id,
  name,
  subtitle,
  selectedId,
  icon: Icon,
  onSelect,
}: {
  id: string;
  name: string;
  subtitle: string;
  selectedId: string;
  icon: typeof Folder;
  onSelect(id: string): void;
}) {
  const isActive = id === selectedId;
  return (
    <li role="none">
      <button
        type="button"
        className={`project-list-item${isActive ? ' is-active' : ''}`}
        role="option"
        aria-selected={isActive}
        aria-label={`项目 ${name}，${subtitle}`}
        onClick={() => onSelect(id)}
      >
        <Icon className="project-list-item-icon" aria-hidden="true" />
        <span className="project-list-item-copy">
          <span className="project-list-item-title">{name}</span>
          <code className="project-list-item-path" title={subtitle}>
            {subtitle}
          </code>
        </span>
      </button>
    </li>
  );
}
