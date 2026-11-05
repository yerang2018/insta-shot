import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { analyzePhotos, AnalysisError, MAX_BODY_BYTES, parseRequest } from './analysis.ts';
import { attachLiveServer } from './live.ts';

export function createAnalysisServer(config: { token: string; apiKey: string; model: string; fetcher?: typeof fetch }) {
  let active = false;
  const attempts: number[] = [];
  // Only allowlisted codes/statuses are retained. No request payload, provider message, or key.
  let lastFailure: { code: string; providerStatus?: number; at: string } | undefined;
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = req.headers.origin;
    if (origin) {
      // Local web preview only; native requests do not carry an Origin header.
      if (!/^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin)) return reply(res, 403, { code: 'ORIGIN_DENIED' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const expected = Buffer.from(`Bearer ${config.token}`);
    const actual = Buffer.from(req.headers.authorization ?? '');
    if (!config.token || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply(res, 401, { code: 'UNAUTHORIZED' });
    if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ready: Boolean(config.apiKey), provider: 'Google Gemini', lastFailure });
    if (req.method !== 'POST' || req.url !== '/analyze') return reply(res, 404, { code: 'NOT_FOUND' });
    if (!config.apiKey) return reply(res, 503, { code: 'NOT_CONFIGURED' });
    if (active) return reply(res, 429, { code: 'IN_PROGRESS' });
    const now = Date.now();
    while (attempts.length && attempts[0] < now - 60 * 60_000) attempts.shift();
    if (attempts.length >= 20) return reply(res, 429, { code: 'RATE_LIMITED' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    active = true;
    try {
      if (!req.headers['content-type']?.startsWith('application/json')) throw new AnalysisError(415, 'INVALID_PHOTOS');
      const input = parseRequest(await readJson(req));
      if (controller.signal.aborted) throw new AnalysisError(408, 'TIMEOUT');
      attempts.push(now);
      const result = await analyzePhotos(input, { ...config, signal: controller.signal });
      lastFailure = undefined;
      if (!res.destroyed) reply(res, 200, { result });
    } catch (error) {
      if (!res.destroyed) {
        const known = error instanceof AnalysisError ? error : new AnalysisError(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? 'TIMEOUT' : 'ANALYSIS_FAILED');
        lastFailure = { code: known.code, providerStatus: known.providerStatus, at: new Date().toISOString() };
        console.warn(JSON.stringify({ event: 'analysis_failed', ...lastFailure }));
        reply(res, known.status, { code: known.code });
      }
    } finally { clearTimeout(timeout); active = false; }
  });
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body));
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) { req.resume(); throw new AnalysisError(413, 'TOO_LARGE'); }
  const timeout = setTimeout(() => req.destroy(), 30_000);
  let bytes = 0;
  const chunks: Buffer[] = [];
  try {
    for await (const part of req) {
      bytes += part.length;
      if (bytes > MAX_BODY_BYTES) throw new AnalysisError(413, 'TOO_LARGE');
      chunks.push(part);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new AnalysisError(400, 'INVALID_PHOTOS'); }
  } finally { clearTimeout(timeout); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.EXPO_PUBLIC_ANALYSIS_TOKEN ?? '';
  if (!token) { console.error('Run npm run setup:analysis first.'); process.exitCode = 1; }
  else {
    const apiKey = process.env.GEMINI_API_KEY?.trim() ?? '';
    const port = Number(process.env.ANALYSIS_PORT ?? 8787);
    const server = createAnalysisServer({ token, apiKey, model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite' });
    attachLiveServer(server, { token, apiKey, liveModel: process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live' });
    server.listen(port, '0.0.0.0', () => console.log(`Analysis + Live server on port ${port}; provider configured: ${Boolean(apiKey)}. Local development only.`));
  }
}
