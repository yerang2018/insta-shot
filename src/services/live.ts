import { connection } from './analysis';
import { isRecord } from '../domain/analysis';
import type { EncodedPhoto } from '../domain/analysis';

const messages: Record<string, string> = {
  UNAUTHORIZED: '앱과 서버의 연결 설정을 다시 확인해야 해요.',
  NOT_CONFIGURED: 'Gemini 키 설정이 필요해요.', LIVE_IN_USE: '다른 Live 연결이 사용 중이에요.',
  LIVE_LIMIT: '이번 시간의 Live 시험 횟수를 모두 사용했어요. 나중에 다시 시작해 주세요.',
  LIVE_ACCESS_DENIED: 'Gemini Live 접근이 거절됐어요. 키의 Live 이용 권한을 확인해야 해요.',
  LIVE_CONNECT_TIMEOUT: 'Live 연결 준비가 지연됐어요. 잠시 후 다시 시작해 주세요.',
  LIVE_RESPONSE_TIMEOUT: 'Live에서 촬영 안내를 받지 못해 중지했어요.',
  LIVE_TIME_LIMIT: '1분 시험을 마쳤어요. 필요하면 다시 시작해 주세요.',
  LIVE_PROVIDER_CLOSED: 'Gemini 쪽에서 Live 연결을 닫았어요. (LIVE_PROVIDER_CLOSED)',
  LIVE_PROVIDER_ERROR: 'Gemini에서 Live 요청 오류를 반환했어요. (LIVE_PROVIDER_ERROR)',
  LIVE_CONNECTION_ERROR: '맥과 Gemini 사이의 연결이 끊겼어요. (LIVE_CONNECTION_ERROR)',
  LIVE_PROTOCOL_ERROR: 'Gemini Live 응답을 처리하지 못했어요. (LIVE_PROTOCOL_ERROR)',
  LIVE_SESSION_ENDED: 'Gemini Live 세션이 종료됐어요. (LIVE_SESSION_ENDED)',
  INVALID_MESSAGE: 'Live 사진 전송 형식을 확인해야 해요. (INVALID_MESSAGE)',
  AUTH_TIMEOUT: '앱과 Live 서버의 연결 확인 시간이 초과됐어요. (AUTH_TIMEOUT)',
  STOPPED: 'Live 코치를 중지했어요.',
};
export type LiveSession = { sendFrame: (photo: EncodedPhoto, seq: number) => boolean; close: () => void };
export function openLiveSession(references: EncodedPhoto[], signal: AbortSignal, callbacks: {
  feedback: (text: string, seq: number) => void; ended: (message: string) => void;
}): Promise<LiveSession> {
  const { base, headers } = connection();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/live`);
    let ready = false; let closed = false;
    const timeout = setTimeout(() => finish('Live 연결 준비가 지연됐어요.'), 25_000);
    const abort = () => { closed = true; clearTimeout(timeout); socket.close(); reject(new Error('연결을 중지했어요.')); };
    const finish = (message: string) => {
      if (closed) return;
      closed = true; clearTimeout(timeout); signal.removeEventListener('abort', abort); socket.close();
      if (!ready) reject(new Error(message)); else callbacks.ended(message);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    socket.onopen = () => {
      if (closed || signal.aborted) { socket.close(); return; }
      socket.send(JSON.stringify({ type: 'start', token: headers.Authorization.slice(7), references }));
    };
    socket.onmessage = event => {
      if (closed || signal.aborted) return;
      try {
        const msg: unknown = JSON.parse(String(event.data));
        if (!isRecord(msg)) return;
        if (msg.type === 'ready' && !ready) {
          ready = true; clearTimeout(timeout);
          resolve({
            sendFrame: (photo, seq) => {
              if (closed || signal.aborted || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 1_000_000) return false;
              socket.send(JSON.stringify({ type: 'frame', photo, seq })); return true;
            },
            close: () => { if (!closed && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' })); abort(); },
          });
        }
        // Keep the previous instruction visible while the next sentence is streaming.
        if (msg.type === 'feedback' && msg.final === true && typeof msg.text === 'string' && msg.text.length <= 240 && Number.isSafeInteger(msg.frameSeq)) callbacks.feedback(msg.text, Number(msg.frameSeq));
        if (msg.type === 'ended') finish(messages[String(msg.code)] || 'Gemini Live 연결이 종료됐어요. 잠시 후 다시 시작해 주세요.');
      } catch { finish('Live 응답 형식을 확인하지 못했어요.'); }
    };
    socket.onerror = () => finish('Live 서버에 연결하지 못했어요. 맥과 아이폰 연결을 확인해 주세요.');
    socket.onclose = event => finish(`앱과 맥의 Live 연결이 ${ready ? '사용 중' : '준비 중'} 끊겼어요. (WS_${event.code})`);
  });
}
