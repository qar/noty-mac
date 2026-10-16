import { planeIssueDetails, safeWebUrl } from './notification-core';
import type { Channel, PlaneEvent } from './notification-types';

export function migratePlaneCredentials(channels: Channel[], legacy: { baseUrl?: string; workspaceSlug?: string; apiKeyEnc?: string } = {}): Channel[] {
  const base = safeWebUrl(legacy.baseUrl)?.replace(/\/+$/, '');
  return channels.map(channel => channel.type === 'plane' && channel.encryptedPlaneApiKey === undefined
    && base && safeWebUrl(channel.planeBaseUrl)?.replace(/\/+$/, '') === base
    && channel.planeWorkspaceSlug && channel.planeWorkspaceSlug === legacy.workspaceSlug && legacy.apiKeyEnc
    ? { ...channel, encryptedPlaneApiKey: legacy.apiKeyEnc } : channel);
}

export class PlaneDetailsClient {
  private projects = new Map<string, Promise<unknown>>();

  constructor(private fetchImpl: typeof fetch = fetch) {}

  async read(channel: Channel, plane: PlaneEvent, apiKey: string): Promise<{ issueIdentifier?: string; issueName?: string }> {
    const base = safeWebUrl(channel.planeBaseUrl)?.replace(/\/+$/, '');
    const workspace = channel.planeWorkspaceSlug || plane.workspaceSlug;
    if (!base || !workspace || !plane.projectId || !plane.issueId || !apiKey) return {};
    if (channel.planeWorkspaceSlug && channel.planeWorkspaceSlug !== plane.workspaceSlug) return {};
    const projectPath = `${base}/api/v1/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(plane.projectId)}/`;
    const read = async (url: string): Promise<unknown> => {
      const response = await this.fetchImpl(url, {
        headers: { 'X-API-Key': apiKey }, redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Plane HTTP ${response.status}`);
      }
      return response.json();
    };
    const issue = await read(`${projectPath}issues/${encodeURIComponent(plane.issueId)}/`);
    const embedded = planeIssueDetails(issue);
    if (embedded.issueIdentifier) return embedded;
    const key = JSON.stringify([channel.id, projectPath]);
    let project = this.projects.get(key);
    if (!project) {
      project = read(projectPath).catch(error => { this.projects.delete(key); throw error; });
      this.projects.set(key, project);
    }
    // A missing project permission must not discard an available task name.
    return planeIssueDetails(issue, await project.catch(() => undefined));
  }
}
