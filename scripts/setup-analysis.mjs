import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Client pairing token is NOT an AI-provider key. Provider credentials belong ONLY in server/.env.local.
const root = resolve(import.meta.dirname, '..');
const clientPath = resolve(root, '.env.local');
const existing = existsSync(clientPath) ? readFileSync(clientPath, 'utf8') : '';
if (!/^EXPO_PUBLIC_ANALYSIS_TOKEN=.+$/m.test(existing)) {
  writeFileSync(clientPath, `${existing.trimEnd()}\nEXPO_PUBLIC_ANALYSIS_TOKEN=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
}
const secretPath = resolve(root, 'server/.env.local');
if (!existsSync(secretPath)) writeFileSync(secretPath, '# 서버 전용입니다. 키를 앱 코드나 채팅에 붙여 넣지 마세요.\nGEMINI_API_KEY=\nGEMINI_MODEL=gemini-3.5-flash-lite\n', { mode: 0o600 });
console.log('Local analysis configuration prepared. No provider key was generated or displayed.');
