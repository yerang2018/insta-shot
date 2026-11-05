/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { attachLiveServer } from './live.ts';

const photo = { mediaType: 'image/jpeg', data: '/9j/2Q==' }; // Synthetic bytes; fake provider only.
async function harness(fn: (url: string, observed: unknown[]) => Promise<void>, sessionMs = 60_000) {
  const provider = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(provider, 'listening');
  const observed: unknown[] = [];
  provider.on('connection', ws => ws.on('message', raw => {
    const msg = JSON.parse(raw.toString()); observed.push(msg);
    if (msg.setup) ws.send(JSON.stringify({ setupComplete: {} }));
    if (msg.clientContent?.turnComplete) ws.send(JSON.stringify({ serverContent: {
      outputTranscription: { text: '촬영자: 카메라를 조금 높여 보세요.' },
      modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'FAKE_AUDIO_DO_NOT_FORWARD' } }] }, turnComplete: true,
    } }));
  }));
  const http = createServer();
  const gateway = attachLiveServer(http, { token: 'pairing', apiKey: 'fake-server-only-key', sessionMs,
    connect: () => new WebSocket(`ws://127.0.0.1:${(provider.address() as AddressInfo).port}`) });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  try { await fn(`ws://127.0.0.1:${(http.address() as AddressInfo).port}/live`, observed); }
  finally {
    for (const ws of gateway.clients) ws.terminate();
    for (const ws of provider.clients) ws.terminate();
    await new Promise<void>(resolve => http.close(() => resolve()));
    await new Promise<void>(resolve => provider.close(() => resolve()));
  }
}
function collect(ws: WebSocket) {
  const packets: Record<string, unknown>[] = [];
  ws.on('message', raw => packets.push(JSON.parse(raw.toString())));
  return async (type: string) => {
    for (let i = 0; i < 100; i++) {
      const packet = packets.find(p => p.type === type);
      if (packet) return packet;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Expected ${type}`);
  };
}

test('Live auth failure never opens provider connection or exposes credentials', async () => {
  await harness(async (url, observed) => {
    const client = new WebSocket(url); const receive = collect(client); await once(client, 'open');
    client.send(JSON.stringify({ type: 'start', token: 'wrong', references: [photo] }));
    assert.equal((await receive('ended')).code, 'UNAUTHORIZED');
    assert.equal(observed.length, 0); client.close();
  });
});

test('native LAN Origin matching the requested server is accepted; unrelated web Origin is rejected', async () => {
  await harness(async (url, observed) => {
    const denied = new WebSocket(url, { origin: 'https://unrelated.example' });
    denied.on('error', () => {});
    await new Promise<void>(resolve => denied.once('close', () => resolve()));
    assert.equal(observed.length, 0);
    const client = new WebSocket(url, { origin: 'http://192.168.45.205:8787', headers: { Host: '192.168.45.205:8787' } });
    const receive = collect(client); client.on('error', () => {});
    await once(client, 'open');
    client.send(JSON.stringify({ type: 'start', token: 'pairing', references: [photo] }));
    await receive('ready');
    client.send(JSON.stringify({ type: 'stop' }));
    await receive('ended'); client.close();
  });
});

test('Live gateway initializes all refs, gates frames, forwards transcript without audio or secrets, stops cleanly', async () => {
  await harness(async (url, observed) => {
    const client = new WebSocket(url); const receive = collect(client); await once(client, 'open');
    client.send(JSON.stringify({ type: 'start', token: 'pairing', references: [photo, photo] }));
    await receive('ready');
    client.send(JSON.stringify({ type: 'frame', seq: 1, photo }));
    client.send(JSON.stringify({ type: 'frame', seq: 2, photo })); // rate-limited: dropped, not queued
    const feedback = await receive('feedback');
    assert.equal(feedback.frameSeq, 1); assert.equal(feedback.final, true);
    assert.equal(feedback.text, '촬영자: 카메라를 조금 높여 보세요.');
    assert.ok(!JSON.stringify(feedback).includes('FAKE_AUDIO'));
    assert.ok(!JSON.stringify(feedback).includes('fake-server-only-key'));
    const messages = observed as Array<Record<string, any>>;
    assert.deepEqual(messages[0].setup.generationConfig.responseModalities, ['AUDIO']);
    assert.deepEqual(messages[0].setup.outputAudioTranscription, {});
    assert.equal(messages[1].clientContent.turns[0].parts.filter((p: Record<string, unknown>) => p.inlineData).length, 2);
    assert.equal(messages.filter(m => m.realtimeInput?.video).length, 1);
    client.send(JSON.stringify({ type: 'stop' }));
    assert.equal((await receive('ended')).code, 'STOPPED'); client.close();
  });
});

test('Live session has a server-enforced duration even if client never stops', async () => {
  await harness(async url => {
    const client = new WebSocket(url); const receive = collect(client); await once(client, 'open');
    client.send(JSON.stringify({ type: 'start', token: 'pairing', references: [photo] }));
    await receive('ready'); assert.equal((await receive('ended')).code, 'LIVE_TIME_LIMIT'); client.close();
  }, 60);
});
