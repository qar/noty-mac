import type {
  AgentState,
  AgentStatus,
} from '../main/types';

export interface Project {
  id: string;
  name: string;
  directory: string;
}

// Renderer-only placeholders. Real project persistence can replace this list
// without migrating the existing workspace store.
export const MOCK_PROJECTS: readonly Project[] = [
  {
    id: 'noty-mac',
    name: 'Noty Mac',
    directory: '/Users/qiaoanran/projects/noty-mac',
  },
  {
    id: 'water-control',
    name: 'Water Control',
    directory: '/Users/qiaoanran/projects/water-control',
  },
  {
    id: 'sensor-hub',
    name: 'Sensor Hub',
    directory: '/Users/qiaoanran/projects/sensor-hub',
  },
  {
    id: 'mobile-lab',
    name: 'Mobile Lab',
    directory: '/Users/qiaoanran/projects/mobile-lab',
  },
  {
    id: 'release-tools',
    name: 'Release Tools',
    directory: '/Users/qiaoanran/projects/release-tools',
  },
  {
    id: 'agent-workbench',
    name: 'Agent Workbench',
    directory: '/Users/qiaoanran/projects/agent-workbench',
  },
  {
    id: 'weather-station',
    name: 'Weather Station',
    directory: '/Users/qiaoanran/projects/weather-station',
  },
  {
    id: 'infrastructure',
    name: 'Infrastructure',
    directory: '/Users/qiaoanran/projects/infrastructure',
  },
  {
    id: 'playground',
    name: 'Playground',
    directory: '/Users/qiaoanran/projects/playground',
  },
];

export const POLL_INTERVAL_MS = 3_000;
const STALE_THRESHOLD_MS = 5 * 60_000;

export type AgentStatusKind = AgentState | 'stale';

export const STATE_LABELS: Record<AgentStatusKind, string> = {
  idle: '闲置',
  running: '运行中',
  waiting_input: '等待输入',
  completed: '已完成',
  error: '出错',
  stale: '状态已陈旧',
};

export function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return '未使用';
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const date = new Date(timestamp);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

export function effectiveKind(
  status: AgentStatus | null
): AgentStatusKind | null {
  if (!status || status.state === 'idle') return null;
  return Date.now() - status.updatedAt > STALE_THRESHOLD_MS
    ? 'stale'
    : status.state;
}

export function tooltipFor(status: AgentStatus): string {
  const kind = effectiveKind(status);
  if (!kind) return '';
  const parts = [STATE_LABELS[kind]];
  if (status.message) parts.push(status.message);
  parts.push(`${formatRelativeTime(status.updatedAt)}上报`);
  return parts.join(' · ');
}
