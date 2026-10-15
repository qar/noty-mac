const test = require('node:test');
const assert = require('node:assert/strict');
const { readPlaneAttachment, MAX_PLANE_ATTACHMENT_BYTES } = require('../dist/main/plane-attachment');

test('authenticated JSON attachments keep complete Unicode content and refuse redirects', async () => {
  const body = JSON.stringify({ data: { comment_html: '<p>完整评论</p>' } });
  const bytes = new TextEncoder().encode(body);
  let request;
  const result = await readPlaneAttachment('https://ntfy.example/topic', { url: 'https://ntfy.example/file/body.json' }, {
    token: 'test-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(new ReadableStream({ start(controller) {
        for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5));
        controller.close();
      } }));
    },
  });
  assert.equal(result, body);
  assert.equal(request.options.headers.Authorization, 'Bearer test-token');
  assert.equal(request.options.redirect, 'error');
});

test('attachment reads reject foreign origins before exposing credentials', async () => {
  let fetched = false;
  for (const url of ['https://other.example/file', 'file:///tmp/data', 'https://user:pass@ntfy.example/file']) {
    await assert.rejects(readPlaneAttachment('https://ntfy.example/topic', { url }, {
      token: 'test-token', fetchImpl: async () => { fetched = true; return new Response('{}'); },
    }), /不匹配/);
  }
  assert.equal(fetched, false);
});

test('attachment reads bound both reported and actual byte sizes and reject non-JSON', async () => {
  const url = 'https://ntfy.example/file/data';
  await assert.rejects(readPlaneAttachment('https://ntfy.example/topic', { url, size: MAX_PLANE_ATTACHMENT_BYTES + 1 }), /16 MB/);
  await assert.rejects(readPlaneAttachment('https://ntfy.example/topic', { url }, {
    fetchImpl: async () => new Response(new Uint8Array(MAX_PLANE_ATTACHMENT_BYTES + 1)),
  }), /16 MB/);
  await assert.rejects(readPlaneAttachment('https://ntfy.example/topic', { url }, {
    fetchImpl: async () => new Response('<html>not JSON</html>'),
  }), /有效 JSON/);
});
