/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createAnalysisServer } from './index.ts';
import { analyzePhotos, AnalysisError, MAX_BODY_BYTES, parseRequest } from './analysis.ts';
import { isAnalysisResult } from '../src/domain/analysis.ts';
import type { AnalysisRequest, AnalysisResult } from '../src/domain/analysis.ts';

// Synthetic marker bytes and explicitly fake output; never sent to a real AI endpoint.
const image = { mediaType: 'image/jpeg' as const, data: '/9j/2Q==' };
const input = (count = 1): AnalysisRequest => ({ references: Array.from({ length: count }, () => ({ ...image })), scene: { ...image } });
const fixture = (count = 1): AnalysisResult => ({
  summary: '테스트 전용 요약', referenceNotes: Array.from({ length: count }, (_, i) => ({ referenceNumber: i + 1, observation: '테스트 전용 관찰' })),
  shots: [{ title: '테스트 전용 장면', referenceNumbers: [1], composition: '테스트 구도', pose: '테스트 포즈', light: '테스트 빛', adaptation: '테스트 적용' }],
  nextAction: '테스트 전용 행동', uncertainty: '테스트 전용 불확실성',
});
const providerReply = (count = 1) => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(fixture(count)) }] } }] });

test('rejects zero/over-limit references, non-JPEG and oversized image data', () => {
  for (const count of [0, 11]) assert.throws(() => parseRequest(input(count)), AnalysisError);
  assert.throws(() => parseRequest({ ...input(), scene: { mediaType: 'image/jpeg', data: 'a'.repeat(1_000_004) } }), AnalysisError);
  assert.throws(() => parseRequest({ ...input(), scene: { mediaType: 'image/jpeg', data: 'aHR0cDov' } }), AnalysisError);
  assert.equal(parseRequest(input(10)).references.length, 10);
});

test('requires every reference exactly once and rejects fabricated photo numbers in results', () => {
  assert.equal(isAnalysisResult(fixture(1), 1), true);
  assert.equal(isAnalysisResult(fixture(10), 10), true);
  const duplicate = fixture(2); duplicate.referenceNotes[1].referenceNumber = 1;
  assert.equal(isAnalysisResult(duplicate, 2), false);
  const invalid = fixture(1); invalid.shots[0].referenceNumbers = [2];
  assert.equal(isAnalysisResult(invalid, 1), false);
  assert.equal(isAnalysisResult({ ...fixture(), shots: [] }, 1), false);
});

test('live mode requires an explicit supported mode and produces short, observation-based camera instructions', async () => {
  assert.throws(() => parseRequest({ ...input(), mode: 'unknown' }), AnalysisError);
  const live = parseRequest({ ...input(2), mode: 'live' });
  assert.equal(live.mode, 'live');
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.match(body.systemInstruction.parts[0].text, /촬영자:/);
    assert.match(body.systemInstruction.parts[0].text, /0.3EV/);
    assert.match(body.systemInstruction.parts[0].text, /측정값이나 자동 적용이 아닙니다/);
    assert.equal(body.contents[0].parts.filter((p: { inlineData?: unknown }) => p.inlineData).length, 3);
    const result = fixture(2); result.nextAction = '촬영자: 카메라를 조금 높여 보세요.';
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } }] });
  };
  const result = await analyzePhotos(live, { apiKey: 'fake', model: 'fake', signal: new AbortController().signal, fetcher });
  assert.equal(calls, 1); assert.ok(result.nextAction.length <= 80);
  const long = fixture(2); long.nextAction = '가'.repeat(81);
  await assert.rejects(analyzePhotos(live, { apiKey: 'fake', model: 'fake', signal: new AbortController().signal,
    fetcher: async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(long) }] } }] }) }),
  (e: unknown) => e instanceof AnalysisError && e.code === 'INVALID_RESULT');
});

test('provider request labels all references and current scene, uses server credential and structured output', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'fake-server-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.responseJsonSchema.type, 'object');
    const blocks = body.contents[0].parts;
    assert.equal(blocks.filter((b: { inlineData?: unknown }) => b.inlineData).length, 4);
    assert.match(blocks[0].text, /레퍼런스 1/);
    assert.match(blocks[4].text, /레퍼런스 3/);
    assert.match(blocks[6].text, /현재 장소/);
    return Response.json(providerReply(3));
  };
  assert.deepEqual(await analyzePhotos(input(3), { apiKey: 'fake-server-key', model: 'test-model', signal: new AbortController().signal, fetcher }), fixture(3));
  assert.equal(calls, 1);
});

test('provider errors and refusals do not become fabricated analysis or expose provider bodies', async () => {
  for (const response of [
    new Response('sensitive upstream details', { status: 401 }),
    Response.json({ promptFeedback: { blockReason: 'SAFETY' } }),
    Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(fixture()) }] } }] }),
    Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'bad JSON' }] } }] }),
  ]) {
    await assert.rejects(analyzePhotos(input(), { apiKey: 'fake', model: 'fake', signal: new AbortController().signal, fetcher: async () => response }),
      (error: unknown) => error instanceof AnalysisError && !error.message.includes('sensitive'));
  }
});

test('provider status errors distinguish request, capacity, quota, invalid key, and network without exposing raw messages', async () => {
  const cases = [
    [400, { error: { message: 'sensitive field payload', status: 'INVALID_ARGUMENT' } }, 'PROVIDER_REQUEST_INVALID'],
    [400, { error: { message: 'API key not valid. sensitive-key-value', details: [{ reason: 'API_KEY_INVALID' }] } }, 'PROVIDER_AUTH'],
    [503, { error: { message: 'sensitive capacity detail' } }, 'PROVIDER_UNAVAILABLE'],
    [429, { error: { message: 'Quota exceeded: limit: 0, model: private-model' } }, 'QUOTA_UNAVAILABLE'],
    [429, { error: { message: 'Quota exceeded: limit: 10' } }, 'PROVIDER_QUOTA'],
  ] as const;
  for (const [status, body, code] of cases) {
    await assert.rejects(analyzePhotos(input(), { apiKey: 'fake', model: 'fake', signal: new AbortController().signal,
      fetcher: async () => Response.json(body, { status }) }),
    (e: unknown) => e instanceof AnalysisError && e.code === code && e.providerStatus === status && !JSON.stringify(e).includes('sensitive'));
  }
  await assert.rejects(analyzePhotos(input(), { apiKey: 'fake', model: 'fake', signal: new AbortController().signal,
    fetcher: async () => { throw new Error('private-network-details'); } }),
  (e: unknown) => e instanceof AnalysisError && e.code === 'PROVIDER_UNREACHABLE' && !JSON.stringify(e).includes('private'));
});

async function withServer(config: Parameters<typeof createAnalysisServer>[0], fn: (base: string) => Promise<void>) {
  const server = createAnalysisServer(config);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await fn(base); }
  finally { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; }
}
const headers = { Authorization: 'Bearer test-pairing-token', 'Content-Type': 'application/json' };

test('local server requires pairing and reports missing provider without making API calls', async () => {
  let calls = 0;
  await withServer({ token: 'test-pairing-token', apiKey: '', model: 'test', fetcher: async () => { calls++; throw new Error(); } }, async base => {
    assert.equal((await fetch(`${base}/health`)).status, 401);
    const health = await fetch(`${base}/health`, { headers });
    assert.deepEqual(await health.json(), { ready: false, provider: 'Google Gemini' });
    const response = await fetch(`${base}/analyze`, { method: 'POST', headers, body: JSON.stringify(input()) });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'NOT_CONFIGURED' });
  });
  assert.equal(calls, 0);
});

test('local server validates request body and origin before forwarding, returns validated results only', async () => {
  let calls = 0;
  await withServer({ token: 'test-pairing-token', apiKey: 'fake-key', model: 'test', fetcher: async () => {
    calls++; return Response.json(providerReply());
  } }, async base => {
    assert.equal((await fetch(`${base}/analyze`, { method: 'POST', headers: { ...headers, Origin: 'https://unrelated.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${base}/analyze`, { method: 'POST', headers, body: '{}' })).status, 400);
    assert.equal((await fetch(`${base}/analyze`, { method: 'POST', headers, body: '{' })).status, 400);
    const tooLarge = await fetch(`${base}/analyze`, { method: 'POST', headers, body: ' '.repeat(MAX_BODY_BYTES + 1) });
    assert.equal(tooLarge.status, 413);
    const response = await fetch(`${base}/analyze`, { method: 'POST', headers, body: JSON.stringify(input()) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { result: fixture() });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  assert.equal(calls, 1);
});

test('concurrent analyses are rejected and cancellation propagates to the AI request', async () => {
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  let aborted!: () => void;
  const abort = new Promise<void>(resolve => { aborted = resolve; });
  await withServer({ token: 'test-pairing-token', apiKey: 'fake', model: 'fake', fetcher: async (_url, init) => {
    started();
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => { aborted(); reject(new Error('aborted')); }, { once: true }));
  } }, async base => {
    const controller = new AbortController();
    const first = fetch(`${base}/analyze`, { method: 'POST', headers, body: JSON.stringify(input()), signal: controller.signal }).catch(() => undefined);
    await start;
    const second = await fetch(`${base}/analyze`, { method: 'POST', headers, body: JSON.stringify(input()) });
    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), { code: 'IN_PROGRESS' });
    controller.abort(); await first;
    await Promise.race([abort, new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error('abort was not forwarded')), 2000); t.unref(); })]);
  });
});

test('authenticated health exposes only sanitized last failure, never provider body or credentials', async () => {
  await withServer({ token: 'test-pairing-token', apiKey: 'secret-test-key', model: 'test', fetcher: async () =>
    Response.json({ error: { message: 'sensitive-upstream-payload' } }, { status: 503 }) }, async base => {
    const failed = await fetch(`${base}/analyze`, { method: 'POST', headers, body: JSON.stringify(input()) });
    assert.deepEqual(await failed.json(), { code: 'PROVIDER_UNAVAILABLE' });
    const health = await fetch(`${base}/health`, { headers });
    const data = await health.json();
    assert.equal(data.lastFailure.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(data.lastFailure.providerStatus, 503);
    assert.equal(Object.keys(data.lastFailure).sort().join(','), 'at,code,providerStatus');
    assert.ok(!JSON.stringify(data).includes('secret-test-key'));
    assert.ok(!JSON.stringify(data).includes('sensitive-upstream-payload'));
    assert.equal((await fetch(`${base}/health`)).status, 401);
  });
});
