import {
  CheckCircle2,
  CircleAlert,
  Copy,
  Cpu,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  LocalAiDetectionResult,
  LocalAiEnvironmentVariable,
  LocalAiFinishedEvent,
  LocalAiProgram,
  LocalAiProxySettings,
  LocalAiTemplateId,
} from '../../../main/local-ai-types';

const TEMPLATE_OPTIONS: readonly { id: LocalAiTemplateId; label: string }[] = [
  { id: 'blank', label: '空白配置' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex CLI' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'ollama', label: 'Ollama' },
];

export function LocalAiSettings() {
  const [programs, setPrograms] = useState<LocalAiProgram[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LocalAiProgram | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [templateId, setTemplateId] = useState<LocalAiTemplateId>('blank');
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    window.api.localAi
      .list()
      .then((next) => {
        if (!active) return;
        setPrograms(next);
        const first = next[0] ?? null;
        setSelectedId(first?.id ?? null);
        setDraft(first ? cloneProgram(first) : null);
      })
      .catch((error) => {
        console.error('[settings] localAi.list failed:', error);
        if (active) setFeedback('无法载入本地 AI 配置');
      });
    return () => {
      active = false;
    };
  }, []);

  const canDiscardChanges = (): boolean =>
    !dirty || window.confirm('放弃当前未保存的修改？');

  const adoptPrograms = (next: LocalAiProgram[], preferredId?: string): void => {
    const nextId =
      preferredId && next.some((program) => program.id === preferredId)
        ? preferredId
        : next[0]?.id ?? null;
    const selected = next.find((program) => program.id === nextId) ?? null;
    setPrograms(next);
    setSelectedId(nextId);
    setDraft(selected ? cloneProgram(selected) : null);
    setDirty(false);
  };

  const selectProgram = (id: string): void => {
    if (id === selectedId || !programs || !canDiscardChanges()) return;
    const selected = programs.find((program) => program.id === id);
    if (!selected) return;
    setSelectedId(id);
    setDraft(cloneProgram(selected));
    setDirty(false);
    setFeedback(null);
  };

  const createProgram = async (): Promise<void> => {
    if (!canDiscardChanges()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await window.api.localAi.create(templateId);
      adoptPrograms(result.programs, result.createdId);
    } catch (error) {
      console.error('[settings] localAi.create failed:', error);
      setFeedback(readableError(error, '无法创建程序配置'));
    } finally {
      setBusy(false);
    }
  };

  const duplicateProgram = async (): Promise<void> => {
    if (!draft || !canDiscardChanges()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await window.api.localAi.duplicate(draft.id);
      adoptPrograms(result.programs, result.createdId);
    } catch (error) {
      console.error('[settings] localAi.duplicate failed:', error);
      setFeedback(readableError(error, '无法复制程序配置'));
    } finally {
      setBusy(false);
    }
  };

  const saveProgram = async (): Promise<void> => {
    if (!draft) return;
    setBusy(true);
    setFeedback(null);
    try {
      const next = await window.api.localAi.save(draft);
      adoptPrograms(next, draft.id);
      setFeedback('配置已保存');
    } catch (error) {
      console.error('[settings] localAi.save failed:', error);
      setFeedback(readableError(error, '无法保存程序配置'));
    } finally {
      setBusy(false);
    }
  };

  const removeProgram = async (): Promise<void> => {
    if (!draft || !window.confirm(`删除“${draft.name}”配置？`)) return;
    setBusy(true);
    setFeedback(null);
    try {
      adoptPrograms(await window.api.localAi.remove(draft.id));
    } catch (error) {
      console.error('[settings] localAi.remove failed:', error);
      setFeedback(readableError(error, '无法删除程序配置'));
    } finally {
      setBusy(false);
    }
  };

  const resetDraft = (): void => {
    const saved = programs?.find((program) => program.id === selectedId);
    if (!saved) return;
    setDraft(cloneProgram(saved));
    setDirty(false);
    setFeedback(null);
  };

  const updateDraft = (update: (current: LocalAiProgram) => LocalAiProgram): void => {
    setDraft((current) => (current ? update(current) : current));
    setDirty(true);
    setFeedback(null);
  };

  return (
    <section className="settings-section local-ai-settings" aria-labelledby="localAiTitle">
      <div className="settings-section-heading settings-section-heading-actions">
        <h2 id="localAiTitle">本地 AI 程序</h2>
        <div className="local-ai-create-controls">
          <label className="local-ai-compact-field">
            <span className="sr-only">程序模板</span>
            <select
              value={templateId}
              disabled={busy}
              onChange={(event) => setTemplateId(event.target.value as LocalAiTemplateId)}
            >
              {TEMPLATE_OPTIONS.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void createProgram()}
          >
            <Plus aria-hidden="true" />
            添加
          </button>
        </div>
      </div>

      {programs === null ? (
        <div className="settings-loading" role="status">
          <LoaderCircle className="is-spinning" aria-hidden="true" />
          <span>正在载入本地 AI 配置</span>
        </div>
      ) : programs.length === 0 ? (
        <div className="local-ai-empty">
          <Cpu aria-hidden="true" />
          <span>尚未配置本地 AI 程序</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void createProgram()}
          >
            <Plus aria-hidden="true" />
            添加第一个程序
          </button>
        </div>
      ) : draft ? (
        <div className="local-ai-workbench">
          <nav className="local-ai-program-list" aria-label="本地 AI 程序">
            {programs.map((program) => (
              <button
                key={program.id}
                type="button"
                className={`local-ai-program-item${program.id === selectedId ? ' is-active' : ''}`}
                aria-current={program.id === selectedId ? 'page' : undefined}
                onClick={() => selectProgram(program.id)}
              >
                <span className={`local-ai-program-dot${program.enabled ? ' is-enabled' : ''}`} />
                <span className="local-ai-program-copy">
                  <strong>{program.name}</strong>
                  <code>{program.executable}</code>
                </span>
              </button>
            ))}
          </nav>

          <div className="local-ai-editor">
            <div className="local-ai-editor-toolbar">
              <div className="local-ai-enabled-control">
                <span>{draft.enabled ? '已启用' : '已停用'}</span>
                <button
                  type="button"
                  className={`settings-switch${draft.enabled ? ' is-on' : ''}`}
                  role="switch"
                  aria-checked={draft.enabled}
                  aria-label={draft.enabled ? '停用该程序' : '启用该程序'}
                  onClick={() => updateDraft((current) => ({ ...current, enabled: !current.enabled }))}
                >
                  <span className="settings-switch-thumb" />
                </button>
              </div>
              <div className="local-ai-toolbar-actions">
                <button
                  type="button"
                  className="settings-icon-button"
                  title="撤销修改"
                  aria-label="撤销未保存的修改"
                  disabled={!dirty || busy}
                  onClick={resetDraft}
                >
                  <RotateCcw aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="settings-icon-button"
                  title="复制配置"
                  aria-label="复制程序配置"
                  disabled={busy}
                  onClick={() => void duplicateProgram()}
                >
                  <Copy aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="settings-icon-button is-danger"
                  title="删除配置"
                  aria-label="删除程序配置"
                  disabled={busy}
                  onClick={() => void removeProgram()}
                >
                  <Trash2 aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!dirty || busy}
                  onClick={() => void saveProgram()}
                >
                  <Save aria-hidden="true" />
                  {busy ? '保存中' : '保存'}
                </button>
              </div>
            </div>

            <ProgramForm program={draft} onChange={updateDraft} />
            <DetectionPanel key={`detect-${draft.id}`} program={draft} dirty={dirty} />
            <TestPanel key={`test-${draft.id}`} program={draft} dirty={dirty} />
          </div>
        </div>
      ) : null}

      {feedback ? (
        <p
          className={`settings-feedback${feedback === '配置已保存' ? ' is-success' : ' is-error'}`}
          role="status"
        >
          {feedback}
        </p>
      ) : null}
    </section>
  );
}

function ProgramForm({
  program,
  onChange,
}: {
  program: LocalAiProgram;
  onChange(update: (current: LocalAiProgram) => LocalAiProgram): void;
}) {
  const updateField = <Key extends keyof LocalAiProgram>(
    key: Key,
    value: LocalAiProgram[Key]
  ): void => onChange((current) => ({ ...current, [key]: value }));

  return (
    <div className="local-ai-editor-sections">
      <section className="local-ai-editor-section" aria-labelledby="localAiBasicTitle">
        <h3 id="localAiBasicTitle">命令</h3>
        <div className="local-ai-form-grid">
          <label className="settings-form-field">
            <span>显示名称</span>
            <input
              type="text"
              autoComplete="off"
              maxLength={80}
              value={program.name}
              onChange={(event) => updateField('name', event.target.value)}
            />
          </label>
          <label className="settings-form-field local-ai-span-2">
            <span>可执行命令或绝对路径</span>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={program.executable}
              placeholder="例如：claude 或 /opt/homebrew/bin/ollama"
              onChange={(event) => updateField('executable', event.target.value)}
            />
          </label>
          <label className="settings-form-field">
            <span>Prompt 传递方式</span>
            <select
              value={program.promptMode}
              onChange={(event) =>
                updateField('promptMode', event.target.value as LocalAiProgram['promptMode'])
              }
            >
              <option value="argument">命令行参数</option>
              <option value="stdin">标准输入 stdin</option>
              <option value="none">不传入</option>
            </select>
          </label>
          <label className="settings-form-field">
            <span>超时时间（秒）</span>
            <input
              type="number"
              autoComplete="off"
              min={1}
              max={1800}
              step={1}
              value={Math.round(program.timeoutMs / 1000)}
              onChange={(event) =>
                updateField(
                  'timeoutMs',
                  Math.max(1, Math.min(1800, Number(event.target.value) || 1)) * 1000
                )
              }
            />
          </label>
          <label className="settings-form-field local-ai-span-2">
            <span>工作目录（可选）</span>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={program.workingDirectory}
              placeholder="例如：~/Projects/my-app"
              onChange={(event) => updateField('workingDirectory', event.target.value)}
            />
          </label>
        </div>

        <ArgumentEditor
          label="运行参数"
          items={program.args}
          placeholder="参数，可使用 {{prompt}}"
          emptyLabel="未设置运行参数"
          onChange={(args) => updateField('args', args)}
        />
        <ArgumentEditor
          label="可用性检测参数"
          items={program.versionArgs}
          placeholder="例如：--version"
          emptyLabel="不使用检测参数时，仅检查文件是否可执行"
          onChange={(versionArgs) => updateField('versionArgs', versionArgs)}
        />
      </section>

      <EnvironmentEditor
        entries={program.environment}
        onChange={(environment) => updateField('environment', environment)}
      />
      <ProxyEditor
        proxy={program.proxy}
        onChange={(proxy) => updateField('proxy', proxy)}
      />
    </div>
  );
}

function ArgumentEditor({
  label,
  items,
  placeholder,
  emptyLabel,
  onChange,
}: {
  label: string;
  items: string[];
  placeholder: string;
  emptyLabel: string;
  onChange(items: string[]): void;
}) {
  return (
    <div className="local-ai-array-field">
      <div className="local-ai-array-heading">
        <span>{label}</span>
        <button
          type="button"
          className="settings-icon-button"
          title={`添加${label}`}
          aria-label={`添加${label}`}
          disabled={items.length >= 64}
          onClick={() => onChange([...items, ''])}
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
      {items.length ? (
        <div className="local-ai-array-rows">
          {items.map((item, index) => (
            <div className="local-ai-array-row" key={`${label}-${index}`}>
              <span className="local-ai-array-index">{index + 1}</span>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={item}
                placeholder={placeholder}
                aria-label={`${label} ${index + 1}`}
                onChange={(event) =>
                  onChange(items.map((current, itemIndex) =>
                    itemIndex === index ? event.target.value : current
                  ))
                }
              />
              <button
                type="button"
                className="settings-icon-button is-danger"
                title="删除参数"
                aria-label={`删除${label} ${index + 1}`}
                onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="local-ai-inline-empty">{emptyLabel}</div>
      )}
    </div>
  );
}

function EnvironmentEditor({
  entries,
  onChange,
}: {
  entries: LocalAiEnvironmentVariable[];
  onChange(entries: LocalAiEnvironmentVariable[]): void;
}) {
  const updateEntry = (
    index: number,
    update: Partial<LocalAiEnvironmentVariable>
  ): void => onChange(entries.map((entry, itemIndex) =>
    itemIndex === index ? { ...entry, ...update } : entry
  ));

  return (
    <section className="local-ai-editor-section" aria-labelledby="localAiEnvironmentTitle">
      <div className="local-ai-subsection-heading">
        <h3 id="localAiEnvironmentTitle">环境变量</h3>
        <button
          type="button"
          className="settings-icon-button"
          title="添加环境变量"
          aria-label="添加环境变量"
          disabled={entries.length >= 64}
          onClick={() => onChange([...entries, { key: '', value: '', secret: false }])}
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
      {entries.length ? (
        <div className="local-ai-env-rows">
          {entries.map((entry, index) => (
            <div className="local-ai-env-row" key={`env-${index}`}>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={entry.key}
                placeholder="变量名"
                aria-label={`环境变量 ${index + 1} 名称`}
                onChange={(event) => updateEntry(index, { key: event.target.value })}
              />
              <input
                type={entry.secret ? 'password' : 'text'}
                autoComplete={entry.secret ? 'new-password' : 'off'}
                spellCheck={false}
                value={entry.value}
                placeholder="值"
                aria-label={`环境变量 ${index + 1} 值`}
                onChange={(event) => updateEntry(index, { value: event.target.value })}
              />
              <label className="local-ai-secret-toggle">
                <input
                  type="checkbox"
                  checked={entry.secret}
                  onChange={(event) => updateEntry(index, { secret: event.target.checked })}
                />
                <span>敏感</span>
              </label>
              <button
                type="button"
                className="settings-icon-button is-danger"
                title="删除环境变量"
                aria-label={`删除环境变量 ${index + 1}`}
                onClick={() => onChange(entries.filter((_, itemIndex) => itemIndex !== index))}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="local-ai-inline-empty">未设置额外环境变量</div>
      )}
    </section>
  );
}

function ProxyEditor({
  proxy,
  onChange,
}: {
  proxy: LocalAiProxySettings;
  onChange(proxy: LocalAiProxySettings): void;
}) {
  const update = (value: Partial<LocalAiProxySettings>): void =>
    onChange({ ...proxy, ...value });

  return (
    <section className="local-ai-editor-section" aria-labelledby="localAiProxyTitle">
      <h3 id="localAiProxyTitle">代理</h3>
      <div className="local-ai-segmented" role="radiogroup" aria-label="代理模式">
        {([
          ['inherit', '继承系统'],
          ['none', '不使用'],
          ['custom', '自定义'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={proxy.mode === value}
            className={proxy.mode === value ? 'is-active' : ''}
            onClick={() => update({ mode: value })}
          >
            {label}
          </button>
        ))}
      </div>
      {proxy.mode === 'custom' ? (
        <div className="local-ai-form-grid">
          <ProxyField
            label="HTTP_PROXY"
            value={proxy.httpProxy}
            onChange={(httpProxy) => update({ httpProxy })}
          />
          <ProxyField
            label="HTTPS_PROXY"
            value={proxy.httpsProxy}
            onChange={(httpsProxy) => update({ httpsProxy })}
          />
          <ProxyField
            label="ALL_PROXY"
            value={proxy.allProxy}
            onChange={(allProxy) => update({ allProxy })}
          />
          <ProxyField
            label="NO_PROXY"
            value={proxy.noProxy}
            placeholder="localhost,127.0.0.1"
            onChange={(noProxy) => update({ noProxy })}
          />
        </div>
      ) : null}
    </section>
  );
}

function ProxyField({
  label,
  value,
  placeholder = 'http://127.0.0.1:7890',
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange(value: string): void;
}) {
  return (
    <label className="settings-form-field">
      <span>{label}</span>
      <input
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function DetectionPanel({ program, dirty }: { program: LocalAiProgram; dirty: boolean }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LocalAiDetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detect = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setResult(await window.api.localAi.detect(program.id));
    } catch (detectError) {
      console.error('[settings] localAi.detect failed:', detectError);
      setResult(null);
      setError(readableError(detectError, '检测失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="local-ai-editor-section" aria-labelledby="localAiDetectionTitle">
      <div className="local-ai-subsection-heading">
        <h3 id="localAiDetectionTitle">可用性</h3>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={loading || dirty}
          title={dirty ? '请先保存配置' : undefined}
          onClick={() => void detect()}
        >
          <RefreshCw className={loading ? 'is-spinning' : ''} aria-hidden="true" />
          {loading ? '检测中' : '检测'}
        </button>
      </div>
      {result ? <DetectionResult result={result} /> : null}
      {!result && !error ? (
        <div className="local-ai-inline-empty">尚未检测</div>
      ) : null}
      {error ? <p className="settings-feedback is-error">{error}</p> : null}
    </section>
  );
}

function DetectionResult({ result }: { result: LocalAiDetectionResult }) {
  return (
    <div className={`local-ai-detection-result${result.available ? ' is-success' : ' is-error'}`}>
      {result.available ? (
        <CheckCircle2 aria-hidden="true" />
      ) : (
        <CircleAlert aria-hidden="true" />
      )}
      <div>
        <strong>{result.available ? '程序可用' : detectionReason(result)}</strong>
        {result.resolvedPath ? <code>{result.resolvedPath}</code> : null}
        {result.version ? <span>{result.version}</span> : null}
        {result.detail ? <span>{result.detail}</span> : null}
      </div>
    </div>
  );
}

interface TestState {
  runId: string | null;
  phase: 'idle' | 'running' | 'cancelling' | 'finished';
  stdout: string;
  stderr: string;
  result: LocalAiFinishedEvent | null;
  error: string | null;
}

const EMPTY_TEST_STATE: TestState = {
  runId: null,
  phase: 'idle',
  stdout: '',
  stderr: '',
  result: null,
  error: null,
};

function TestPanel({ program, dirty }: { program: LocalAiProgram; dirty: boolean }) {
  const [prompt, setPrompt] = useState('请用一句话介绍你自己。');
  const [test, setTest] = useState<TestState>(EMPTY_TEST_STATE);
  const [outputTab, setOutputTab] = useState<'stdout' | 'stderr'>('stdout');
  const runIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    const unsubscribeOutput = window.api.localAi.onOutput((event) => {
      if (event.runId !== runIdRef.current) return;
      setTest((current) => ({
        ...current,
        [event.stream]: event.output,
      }));
    });
    const unsubscribeFinished = window.api.localAi.onFinished((event) => {
      if (event.runId !== runIdRef.current) return;
      runIdRef.current = null;
      cancelRequestedRef.current = false;
      setTest((current) => ({
        ...current,
        phase: 'finished',
        stdout: event.stdout,
        stderr: event.stderr,
        result: event,
        error: event.error ?? null,
      }));
    });
    const cancelWhenHidden = (): void => {
      const activeRunId = runIdRef.current;
      if (document.hidden && activeRunId) {
        cancelRequestedRef.current = true;
        void window.api.localAi.cancel(activeRunId);
      }
    };
    document.addEventListener('visibilitychange', cancelWhenHidden);
    return () => {
      mountedRef.current = false;
      const activeRunId = runIdRef.current;
      if (activeRunId) {
        cancelRequestedRef.current = true;
        void window.api.localAi.cancel(activeRunId);
      }
      unsubscribeOutput();
      unsubscribeFinished();
      document.removeEventListener('visibilitychange', cancelWhenHidden);
    };
  }, []);

  const run = async (): Promise<void> => {
    const runId = crypto.randomUUID();
    runIdRef.current = runId;
    cancelRequestedRef.current = false;
    setOutputTab('stdout');
    setTest({
      runId,
      phase: 'running',
      stdout: '',
      stderr: '',
      result: null,
      error: null,
    });
    try {
      const result = await window.api.localAi.run(program.id, prompt, runId);
      if (result.started && cancelRequestedRef.current) {
        void window.api.localAi.cancel(runId);
        return;
      }
      if (!mountedRef.current) return;
      if (!result.started && runIdRef.current === runId) {
        runIdRef.current = null;
        cancelRequestedRef.current = false;
        setTest((current) => ({
          ...current,
          phase: 'finished',
          error: result.error ?? '无法启动程序',
        }));
      }
    } catch (error) {
      console.error('[settings] localAi.run failed:', error);
      if (runIdRef.current === runId) runIdRef.current = null;
      cancelRequestedRef.current = false;
      if (!mountedRef.current) return;
      setTest((current) => ({
        ...current,
        phase: 'finished',
        error: readableError(error, '无法启动程序'),
      }));
    }
  };

  const cancel = async (): Promise<void> => {
    const runId = runIdRef.current;
    if (!runId) return;
    cancelRequestedRef.current = true;
    setTest((current) => ({ ...current, phase: 'cancelling' }));
    const cancelled = await window.api.localAi.cancel(runId);
    if (!cancelled && !cancelRequestedRef.current) {
      setTest((current) => ({ ...current, phase: 'running' }));
    }
  };

  const running = test.phase === 'running' || test.phase === 'cancelling';
  const output = outputTab === 'stdout' ? test.stdout : test.stderr;

  return (
    <section className="local-ai-editor-section local-ai-test" aria-labelledby="localAiTestTitle">
      <div className="local-ai-subsection-heading">
        <h3 id="localAiTestTitle">测试</h3>
        {test.result ? <RunSummary result={test.result} /> : null}
      </div>
      <label className="settings-form-field">
        <span>Prompt</span>
        <textarea
          autoComplete="off"
          value={prompt}
          maxLength={1024 * 1024}
          disabled={running}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <div className="local-ai-test-actions">
        {running ? (
          <button
            type="button"
            className="btn btn-danger"
            disabled={test.phase === 'cancelling'}
            onClick={() => void cancel()}
          >
            <Square aria-hidden="true" />
            {test.phase === 'cancelling' ? '正在取消' : '取消'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={dirty || !program.enabled}
            title={dirty ? '请先保存配置' : !program.enabled ? '请先启用该程序' : undefined}
            onClick={() => void run()}
          >
            <Play aria-hidden="true" />
            运行测试
          </button>
        )}
        <button
          type="button"
          className="settings-icon-button"
          title="清空结果"
          aria-label="清空测试结果"
          disabled={running || (!test.stdout && !test.stderr && !test.error)}
          onClick={() => setTest(EMPTY_TEST_STATE)}
        >
          <Trash2 aria-hidden="true" />
        </button>
        {running ? (
          <span className="local-ai-running" role="status">
            <LoaderCircle className="is-spinning" aria-hidden="true" />
            {test.phase === 'cancelling' ? '正在停止进程' : '正在运行'}
          </span>
        ) : null}
      </div>

      {test.phase !== 'idle' || test.error ? (
        <div className="local-ai-output">
          <div className="local-ai-output-tabs" role="tablist" aria-label="测试输出">
            <button
              type="button"
              role="tab"
              aria-selected={outputTab === 'stdout'}
              className={outputTab === 'stdout' ? 'is-active' : ''}
              onClick={() => setOutputTab('stdout')}
            >
              标准输出
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={outputTab === 'stderr'}
              className={outputTab === 'stderr' ? 'is-active' : ''}
              onClick={() => setOutputTab('stderr')}
            >
              标准错误{test.stderr ? ' ·' : ''}
            </button>
          </div>
          <pre role="tabpanel">{output || (running ? '等待输出…' : '无输出')}</pre>
        </div>
      ) : null}
      {test.error ? <p className="settings-feedback is-error">{test.error}</p> : null}
    </section>
  );
}

function RunSummary({ result }: { result: LocalAiFinishedEvent }) {
  return (
    <div className={`local-ai-run-summary is-${result.status}`}>
      <span>{runStatusLabel(result.status)}</span>
      <span>{formatDuration(result.durationMs)}</span>
      <span>退出码 {result.exitCode ?? '--'}</span>
    </div>
  );
}

function cloneProgram(program: LocalAiProgram): LocalAiProgram {
  return {
    ...program,
    args: [...program.args],
    versionArgs: [...program.versionArgs],
    environment: program.environment.map((entry) => ({ ...entry })),
    proxy: { ...program.proxy },
  };
}

function detectionReason(result: LocalAiDetectionResult): string {
  const labels: Record<string, string> = {
    not_found: '未找到可执行命令',
    not_executable: '文件不可执行',
    working_directory_unavailable: '工作目录不可用',
    version_failed: '检测命令执行失败',
    timed_out: '检测超时',
    spawn_failed: '命令无法启动',
  };
  return labels[result.reason ?? ''] ?? '程序不可用';
}

function runStatusLabel(status: LocalAiFinishedEvent['status']): string {
  const labels: Record<LocalAiFinishedEvent['status'], string> = {
    success: '成功',
    failed: '失败',
    cancelled: '已取消',
    timed_out: '已超时',
    spawn_error: '启动失败',
  };
  return labels[status];
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function readableError(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback;
  const segments = error.message.split('Error: ');
  const message = segments[segments.length - 1]?.trim();
  return message || fallback;
}
