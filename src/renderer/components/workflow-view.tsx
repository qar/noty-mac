import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CirclePlay, FolderOpen, Plus, Save, SkipForward, Workflow as WorkflowIcon } from 'lucide-react';
import type { Project } from '../../main/types';
import type { WorkflowDefinition, WorkflowRun, WorkflowStageMode, WorkflowTaskKind } from '../../main/workflow-types';
import type { LocalAiProgram } from '../../main/local-ai-types';

const api = window.api.workflow;

export function WorkflowView({ projects }: { projects: Project[] }) {
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkflowDefinition | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [aiPrograms, setAiPrograms] = useState<LocalAiProgram[]>([]);

  const refresh = useCallback(async () => {
    const snapshot = await api.snapshot();
    setDefinitions(snapshot.definitions);
    setRuns(snapshot.runs);
    setSelectedId((id) => id ?? snapshot.definitions[0]?.id ?? null);
  }, []);
  useEffect(() => { void refresh(); return api.onUpdated(() => void refresh()); }, [refresh]);
  useEffect(() => { void window.api.localAi.list().then(setAiPrograms); }, []);
  const selected = definitions.find((item) => item.id === selectedId) ?? null;
  const selectedRun = runs.find((item) => item.id === selectedRunId) ?? null;

  const newWorkflow = () => {
    const now = Date.now();
    const next: WorkflowDefinition = {
      id: crypto.randomUUID(), name: '新工作流', description: '', version: 0,
      repositories: [], archived: false, createdAt: now, updatedAt: now,
      stages: [{ id: crypto.randomUUID(), name: '准备', mode: 'serial', tasks: [
        { id: crypto.randomUUID(), name: '确认准备完成', kind: 'manual' },
      ] }],
    };
    setSelectedRunId(null); setSelectedId(next.id); setDraft(next);
  };
  const edit = (definition: WorkflowDefinition) => { setSelectedRunId(null); setSelectedId(definition.id); setDraft(structuredClone(definition)); };
  const save = async () => {
    if (!draft) return;
    setBusy('save');
    try { const saved = await api.save(draft); setDraft(null); setSelectedId(saved.id); await refresh(); }
    catch (error) { alert(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };
  const createRun = async (definition: WorkflowDefinition) => {
    const title = prompt('本次执行的名称、版本或工单号');
    if (!title?.trim()) return;
    setBusy('run');
    try { const run = await api.createRun(definition.id, { title }); setSelectedRunId(run.id); await refresh(); }
    catch (error) { alert(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };
  const taskAction = async (run: WorkflowRun, taskId: string, action: 'complete' | 'execute' | 'skip' | 'cancel') => {
    setBusy(taskId);
    try {
      if (action === 'complete') {
        const evidence = prompt('完成凭证（commit、软件包、邮件或工单链接，可留空）');
        if (evidence === null) return;
        await api.completeTask(run.id, taskId, { evidence });
      }
      else if (action === 'execute') await api.executeTask(run.id, taskId);
      else if (action === 'cancel') await api.cancelTask(run.id, taskId);
      else {
        const reason = prompt('填写跳过原因'); if (!reason?.trim()) return;
        await api.skipTask(run.id, taskId, reason);
      }
      await refresh();
    } catch (error) { alert(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };
  const cleanup = async (run: WorkflowRun) => {
    if (!confirm('移除该执行的干净 worktree？分支会保留。')) return;
    setBusy('cleanup');
    try { await api.cleanupRun(run.id); await refresh(); }
    catch (error) { alert(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };

  return <section className="workflow-view">
    <aside className="workflow-browser">
      <header className="workflow-toolbar"><h1>工作流</h1><button className="icon-btn" title="新建工作流" onClick={newWorkflow}><Plus /></button></header>
      <ul className="workflow-definitions">
        {definitions.map((definition) => <li key={definition.id}>
          <button className={`workflow-definition${selectedId === definition.id && !selectedRunId ? ' is-active' : ''}`} onClick={() => { setSelectedId(definition.id); setSelectedRunId(null); setDraft(null); }}>
            <strong>{definition.name}</strong><span>{definition.stages.length} 个阶段 · v{definition.version}</span>
          </button>
          {runs.filter((run) => run.workflowId === definition.id).map((run) => <button key={run.id} className={`workflow-run-link${selectedRunId === run.id ? ' is-active' : ''}`} onClick={() => { setSelectedId(definition.id); setSelectedRunId(run.id); setDraft(null); }}>
            <span>{run.input.title}</span><small>{RUN_LABELS[run.status]}</small>
          </button>)}
        </li>)}
      </ul>
    </aside>
    <main className="workflow-detail">
      {draft ? <WorkflowEditor draft={draft} projects={projects} aiPrograms={aiPrograms} onChange={setDraft} onSave={() => void save()} saving={busy === 'save'} />
        : selectedRun ? <RunDetail run={selectedRun} busy={busy} onAction={taskAction} onCleanup={() => void cleanup(selectedRun)} />
        : selected ? <WorkflowSummary definition={selected} onEdit={() => edit(selected)} onRun={() => void createRun(selected)} busy={busy === 'run'} />
        : <div className="workflow-empty"><WorkflowIcon /><span>暂无工作流</span><button className="btn btn-primary" onClick={newWorkflow}>新建工作流</button></div>}
    </main>
  </section>;
}

function WorkflowEditor({ draft, projects, aiPrograms, onChange, onSave, saving }: { draft: WorkflowDefinition; projects: Project[]; aiPrograms: LocalAiProgram[]; onChange(value: WorkflowDefinition): void; onSave(): void; saving: boolean }) {
  const update = (values: Partial<WorkflowDefinition>) => onChange({ ...draft, ...values });
  const addRepository = () => {
    const project = projects.find((item) => !draft.repositories.some((repository) => repository.projectId === item.id));
    if (!project) return;
    update({ repositories: [...draft.repositories, { alias: `repo${draft.repositories.length + 1}`, projectId: project.id, baseBranch: 'main' }] });
  };
  const updateStage = (index: number, values: Partial<WorkflowDefinition['stages'][number]>) => update({ stages: draft.stages.map((stage, i) => i === index ? { ...stage, ...values } : stage) });
  return <div className="workflow-editor">
    <header className="workflow-detail-header"><div><input className="workflow-title-input" value={draft.name} onChange={(e) => update({ name: e.target.value })} /><textarea value={draft.description} placeholder="职责与目标" onChange={(e) => update({ description: e.target.value })} /></div><button className="btn btn-primary" disabled={saving} onClick={onSave}><Save />保存</button></header>
    <section className="workflow-section"><div className="workflow-section-heading"><h2>仓库</h2><button className="btn btn-secondary" onClick={addRepository} disabled={projects.length === draft.repositories.length}><Plus />添加</button></div>
      {draft.repositories.map((repository, index) => <div className="workflow-repository" key={repository.projectId}>
        <input aria-label="仓库别名" value={repository.alias} onChange={(e) => update({ repositories: draft.repositories.map((item, i) => i === index ? { ...item, alias: e.target.value } : item) })} />
        <select value={repository.projectId} onChange={(e) => update({ repositories: draft.repositories.map((item, i) => i === index ? { ...item, projectId: e.target.value } : item) })}>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select>
        <input aria-label="基线分支" value={repository.baseBranch} onChange={(e) => update({ repositories: draft.repositories.map((item, i) => i === index ? { ...item, baseBranch: e.target.value } : item) })} />
      </div>)}
    </section>
    <section className="workflow-section"><div className="workflow-section-heading"><h2>阶段</h2><button className="btn btn-secondary" onClick={() => update({ stages: [...draft.stages, { id: crypto.randomUUID(), name: '新阶段', mode: 'serial', tasks: [] }] })}><Plus />添加阶段</button></div>
      {draft.stages.map((stage, stageIndex) => <div className="workflow-stage" key={stage.id}>
        <div className="workflow-stage-header"><input value={stage.name} onChange={(e) => updateStage(stageIndex, { name: e.target.value })} /><select value={stage.mode} onChange={(e) => updateStage(stageIndex, { mode: e.target.value as WorkflowStageMode })}><option value="serial">串行</option><option value="parallel">并行</option></select></div>
        {stage.tasks.map((task, taskIndex) => <div className="workflow-task-edit" key={task.id}>
          <input value={task.name} onChange={(e) => updateStage(stageIndex, { tasks: stage.tasks.map((item, i) => i === taskIndex ? { ...item, name: e.target.value } : item) })} />
          <select value={task.kind} onChange={(e) => updateStage(stageIndex, { tasks: stage.tasks.map((item, i) => i === taskIndex ? { ...item, kind: e.target.value as WorkflowTaskKind } : item) })}><option value="manual">人工</option><option value="approval">审批</option><option value="command">命令</option><option value="ai">AI</option></select>
          <select value={task.repositoryAlias ?? ''} onChange={(e) => updateStage(stageIndex, { tasks: stage.tasks.map((item, i) => i === taskIndex ? { ...item, repositoryAlias: e.target.value || undefined } : item) })}><option value="">无仓库</option>{draft.repositories.map((repository) => <option value={repository.alias} key={repository.alias}>{repository.alias}</option>)}</select>
          {task.kind === 'command' ? <><input placeholder="executable" value={task.executable ?? ''} onChange={(e) => updateStage(stageIndex, { tasks: stage.tasks.map((item, i) => i === taskIndex ? { ...item, executable: e.target.value, args: item.args ?? [] } : item) })} /><input placeholder="参数，每行一个" value={(task.args ?? []).join('\n')} onChange={(e) => updateStage(stageIndex, { tasks: stage.tasks.map((item, i) => i === taskIndex ? { ...item, args: e.target.value.split('\n') } : item) })} /></> : null}
          {task.kind === 'ai' ? <><select value={task.aiProgramId ?? ''} onChange={(e) => updateStage(stageIndex, { tasks: stage.tasks.map((item, i) => i === taskIndex ? { ...item, aiProgramId: e.target.value } : item) })}><option value="">选择 AI 程序</option>{aiPrograms.filter((program) => program.enabled).map((program) => <option value={program.id} key={program.id}>{program.name}</option>)}</select><input placeholder="提示词" value={task.prompt ?? ''} onChange={(e) => updateStage(stageIndex, { tasks: stage.tasks.map((item, i) => i === taskIndex ? { ...item, prompt: e.target.value } : item) })} /></> : null}
        </div>)}
        <button className="workflow-add-task" onClick={() => updateStage(stageIndex, { tasks: [...stage.tasks, { id: crypto.randomUUID(), name: '新任务', kind: 'manual' }] })}><Plus />添加任务</button>
      </div>)}
    </section>
  </div>;
}

function WorkflowSummary({ definition, onEdit, onRun, busy }: { definition: WorkflowDefinition; onEdit(): void; onRun(): void; busy: boolean }) {
  return <div className="workflow-summary"><header className="workflow-detail-header"><div><h1>{definition.name}</h1><p>{definition.description || '无说明'}</p></div><div><button className="btn btn-secondary" onClick={onEdit}>编辑</button><button className="btn btn-primary" disabled={busy} onClick={onRun}><CirclePlay />创建执行</button></div></header>{definition.stages.map((stage, index) => <section className="workflow-stage" key={stage.id}><h2>{index + 1}. {stage.name} <small>{stage.mode === 'serial' ? '串行' : '并行'}</small></h2>{stage.tasks.map((task) => <div className="workflow-task-row" key={task.id}><span>{task.name}</span><small>{TASK_KIND_LABELS[task.kind]}</small></div>)}</section>)}</div>;
}

function RunDetail({ run, busy, onAction, onCleanup }: { run: WorkflowRun; busy: string | null; onAction(run: WorkflowRun, taskId: string, action: 'complete' | 'execute' | 'skip' | 'cancel'): Promise<void>; onCleanup(): void }) {
  return <div className="workflow-summary"><header className="workflow-detail-header"><div><h1>{run.input.title}</h1><p>{run.definition.name} · {RUN_LABELS[run.status]}</p></div>{run.status !== 'active' && run.contexts.length ? <button className="btn btn-secondary" disabled={busy === 'cleanup'} onClick={onCleanup}>清理上下文</button> : null}</header>{run.contexts.length ? <section className="workflow-contexts"><h2>执行上下文</h2>{run.contexts.map((context) => <div key={context.repositoryAlias}><FolderOpen /><strong>{context.repositoryAlias}</strong><code title={context.directory}>{context.directory}</code><span>{context.branch}</span></div>)}</section> : null}{run.definition.stages.map((stage) => <section className="workflow-stage" key={stage.id}><h2>{stage.name}</h2>{stage.tasks.map((task) => { const state = run.tasks[task.id]; const automatic = task.kind === 'command' || task.kind === 'ai'; const lastAttempt = state.attempts.at(-1); return <div className="workflow-task-block" key={task.id}><div className="workflow-task-row"><span className={`workflow-status is-${state.status}`} /> <span>{task.name}</span><small>{STATUS_LABELS[state.status]}</small><div className="workflow-task-actions">{['ready', 'failed', 'interrupted'].includes(state.status) ? <button className="icon-btn" title={automatic ? '运行任务' : '完成任务'} disabled={busy === task.id} onClick={() => void onAction(run, task.id, automatic ? 'execute' : 'complete')}>{automatic ? <CirclePlay /> : <Check />}</button> : null}{state.status === 'running' ? <button className="btn btn-secondary" onClick={() => void onAction(run, task.id, 'cancel')}>停止</button> : null}{['ready', 'failed', 'interrupted'].includes(state.status) ? <button className="icon-btn" title="跳过任务" onClick={() => void onAction(run, task.id, 'skip')}><SkipForward /></button> : null}</div></div>{state.evidence ? <code className="workflow-task-meta">凭证：{state.evidence}</code> : null}{state.skipReason ? <span className="workflow-task-meta">跳过：{state.skipReason}</span> : null}{lastAttempt?.error ? <span className="workflow-task-meta is-error">{lastAttempt.error}</span> : null}{lastAttempt?.logFile ? <code className="workflow-task-meta">日志：{lastAttempt.logFile}</code> : null}</div>; })}</section>)}</div>;
}

const TASK_KIND_LABELS = { manual: '人工', approval: '审批', command: '命令', ai: 'AI' } as const;
const RUN_LABELS = { active: '进行中', completed: '已完成', completed_with_skips: '完成（有跳过）', cancelled: '已取消' } as const;
const STATUS_LABELS = { blocked: '等待依赖', ready: '可执行', running: '运行中', succeeded: '已完成', failed: '失败', skipped: '已跳过', interrupted: '已中断' } as const;
