import { safeWebUrl } from './notification-core';

export const MAX_PLANE_ATTACHMENT_BYTES = 16 * 1024 * 1024;

export async function readPlaneAttachment(
  channelUrl: string,
  attachment: { url: string; size?: number },
  options: { token?: string; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const url = safeWebUrl(attachment.url);
  if (!url || new URL(url).origin !== new URL(channelUrl).origin) {
    throw new Error('附件地址与 ntfy 服务不匹配');
  }
  if (attachment.size && attachment.size > MAX_PLANE_ATTACHMENT_BYTES) {
    throw new Error('正文附件超过 16 MB，无法载入');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      if (response.status === 404 || response.status === 410) throw new Error('正文附件已过期或不存在，无法恢复原文');
      throw new Error(`正文附件读取失败 (HTTP ${response.status})`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    let body = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_PLANE_ATTACHMENT_BYTES) throw new Error('正文附件超过 16 MB，无法载入');
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    try { JSON.parse(body); } catch { throw new Error('正文附件不是有效 JSON'); }
    return body;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
