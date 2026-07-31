import { Folder } from 'lucide-react';
import type { Project } from '../workspace-ui';

interface ProjectPanelProps {
  projects: readonly Project[];
  selectedId: string;
  onSelect(id: string): void;
}

export function ProjectPanel({
  projects,
  selectedId,
  onSelect,
}: ProjectPanelProps) {
  return (
    <aside className="project-list-panel" aria-labelledby="projectPanelTitle">
      <header className="project-panel-header">
        <div className="project-panel-title" id="projectPanelTitle">
          项目
        </div>
      </header>
      <ul className="project-list" role="listbox" aria-label="项目">
        {projects.map((project) => {
          const isActive = project.id === selectedId;
          return (
            <li key={project.id} role="none">
              <button
                type="button"
                className={`project-list-item${isActive ? ' is-active' : ''}`}
                role="option"
                aria-selected={isActive}
                aria-label={`项目 ${project.name}，目录 ${project.directory}`}
                onClick={() => onSelect(project.id)}
              >
                <Folder className="project-list-item-icon" aria-hidden="true" />
                <span className="project-list-item-copy">
                  <span className="project-list-item-title">{project.name}</span>
                  <code className="project-list-item-path" title={project.directory}>
                    {project.directory}
                  </code>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
