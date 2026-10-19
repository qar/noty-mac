const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');

test('relay verifies exact raw bytes before parsing and rejects missing or incorrect signatures', async () => {
  const { verifyPlaneSignature } = await import('../scripts/plane-ntfy-relay.mjs');
  const body = Buffer.from('{ "event": "issue", "data": {} }');
  const secret = 'test-only-secret';
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(await verifyPlaneSignature(secret, body, signature), true);
  assert.equal(await verifyPlaneSignature(secret, body, signature.toUpperCase()), true);
  assert.equal(await verifyPlaneSignature(secret, Buffer.from(JSON.stringify(JSON.parse(body))), signature), false);
  assert.equal(await verifyPlaneSignature(secret, body, ''), false);
  assert.equal(await verifyPlaneSignature('wrong', body, signature), false);
});

test('relay forwards signed raw bytes intact for small and oversized comment payloads', async t => {
  const { default: worker } = await import('../scripts/plane-ntfy-relay.mjs');
  const fixture = require('./fixtures/plane-comment.json');
  const env = { PLANE_WEBHOOK_SECRET: 'test-secret', TARGET_WEBHOOK_URL: 'https://ntfy.example/topic', TARGET_BEARER_TOKEN: 'test-token' };
  let sent;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { sent = Buffer.from(options.body); return new Response('{}'); });
  for (const body of [JSON.stringify(fixture, null, 2), JSON.stringify({ ...fixture, data: { ...fixture.data, comment_html: '<p>' + '内容'.repeat(5000) + '</p>' } })]) {
    const signature = createHmac('sha256', env.PLANE_WEBHOOK_SECRET).update(body).digest('hex');
    const result = await worker.fetch(new Request('https://worker.example', { method: 'POST', body, headers: { 'X-Plane-Signature': signature } }), env);
    assert.equal(result.status, 200);
    assert.equal(sent.toString(), body);
  }
});

test('relay returns upstream failure status and never forwards an invalid signature', async t => {
  const { default: worker } = await import('../scripts/plane-ntfy-relay.mjs');
  const env = { PLANE_WEBHOOK_SECRET: 'test-secret', TARGET_WEBHOOK_URL: 'https://ntfy.example/topic', TARGET_BEARER_TOKEN: 'test-token' };
  const body = JSON.stringify({ event: 'issue', data: { id: 'i', project: 'p' } });
  const signature = createHmac('sha256', env.PLANE_WEBHOOK_SECRET).update(body).digest('hex');
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, options) => { sent = { url, options }; return new Response('retry', { status: 503 }); });
  const response = await worker.fetch(new Request('https://worker.example', { method: 'POST', body, headers: { 'X-Plane-Signature': signature } }), env);
  assert.equal(response.status, 503);
  assert.equal(sent.url, env.TARGET_WEBHOOK_URL);
  assert.equal(sent.options.headers.Authorization, 'Bearer test-token');
  sent = null;
  const rejected = await worker.fetch(new Request('https://worker.example', { method: 'POST', body }), env);
  assert.equal(rejected.status, 401);
  assert.equal(sent, null);
});
