// Cloudflare Worker. Configure secrets in the Worker environment, never here.
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    if (!env.PLANE_WEBHOOK_SECRET || !env.TARGET_WEBHOOK_URL || !env.TARGET_BEARER_TOKEN) {
      return new Response('Worker misconfigured', { status: 500 });
    }
    const rawBody = await request.arrayBuffer();
    if (!await verifyPlaneSignature(env.PLANE_WEBHOOK_SECRET, rawBody, request.headers.get('X-Plane-Signature') || '')) {
      return new Response('Invalid signature', { status: 401 });
    }
    let body;
    try {
      const payload = JSON.parse(new TextDecoder().decode(rawBody));
      body = compactPlanePayload(payload, request.headers.get('X-Plane-Delivery') || '');
    } catch {
      return new Response('Invalid Plane payload', { status: 400 });
    }
    try {
      const upstream = await fetch(env.TARGET_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TARGET_BEARER_TOKEN}` },
        body,
        redirect: 'error',
      });
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'text/plain' },
      });
    } catch {
      return new Response('Upstream delivery failed', { status: 502 });
    }
  },
};

export async function verifyPlaneSignature(secret, body, signature) {
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(signature.match(/../g), value => parseInt(value, 16));
  return crypto.subtle.verify('HMAC', key, bytes, body);
}

export function compactPlanePayload(payload, deliveryId = '') {
  if (!payload || typeof payload.event !== 'string') throw new Error('Missing event');
  const data = payload.data || {};
  const activity = payload.activity || {};
  const actor = activity.actor || {};
  const string = (value, limit = 120) => typeof value === 'string' ? value.slice(0, limit) : '';
  const id = value => string(typeof value === 'object' && value ? value.id : value, 64);
  const value = input => input === undefined ? null : string(typeof input === 'string' ? input : JSON.stringify(input), 180);
  const compact = {
    event: string(payload.event, 40),
    action: string(payload.action, 40),
    delivery_id: string(deliveryId, 64),
    workspace_slug: string(payload.workspace_slug),
    workspace_id: id(payload.workspace_id),
    data: {
      id: id(data.id), name: string(data.name || data.issue?.name),
      project: id(data.project || data.project_id || data.issue?.project),
      issue: id(data.issue || data.issue_id),
      sequence_id: typeof data.sequence_id === 'number' ? data.sequence_id : null,
      comment_stripped: string(data.comment_stripped),
    },
    activity: {
      field: string(activity.field, 80), old_value: value(activity.old_value), new_value: value(activity.new_value),
      actor: { id: id(actor.id), display_name: string(actor.display_name || actor.first_name, 80) },
    },
    compacted: true,
  };
  // Never let ntfy turn the event into an expiring attachment, even with escaped
  // control characters or multi-byte text. Task identity survives compaction.
  if (new TextEncoder().encode(JSON.stringify(compact)).length > 4000) {
    compact.data.name = compact.data.name.slice(0, 60);
    compact.data.comment_stripped = '';
    compact.activity.old_value = null;
    compact.activity.new_value = null;
    compact.activity.actor.display_name = '';
  }
  const body = JSON.stringify(compact);
  if (new TextEncoder().encode(body).length > 4096) throw new Error('Payload identity too large');
  return body;
}
