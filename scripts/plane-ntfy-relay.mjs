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
    try {
      const payload = JSON.parse(new TextDecoder().decode(rawBody));
      if (!payload || typeof payload.event !== 'string') throw new Error('Missing event');
    } catch {
      return new Response('Invalid Plane payload', { status: 400 });
    }
    try {
      const upstream = await fetch(env.TARGET_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TARGET_BEARER_TOKEN}` },
        body: rawBody,
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
