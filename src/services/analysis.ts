import Constants from 'expo-constants';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { isAnalysisResult, isRecord } from '../domain/analysis';
import type { AnalysisResult, EncodedPhoto } from '../domain/analysis';
import type { Photo } from '../domain/session';

const errors: Record<string, string> = {
  NOT_CONFIGURED: 'AI 연결 설정이 아직 완료되지 않았어요. 개발자에게 연결을 요청해 주세요.',
  UNAUTHORIZED: '앱과 분석 서버의 연결 설정을 다시 확인해야 해요.',
  PROVIDER_AUTH: 'AI 서비스의 키 또는 이용 권한을 확인해야 해요.',
  PROVIDER_REQUEST_INVALID: 'Gemini가 분석 요청 형식을 받아들이지 못했어요. 앱의 연결 코드를 확인해야 해요.',
  PROVIDER_UNAVAILABLE: 'Gemini 서비스가 현재 응답하지 못하고 있어요. 잠시 기다린 뒤 다시 시도해 주세요.',
  PROVIDER_UNREACHABLE: '맥에서 Gemini에 연결하지 못했어요. 맥의 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.',
  PROVIDER_QUOTA: 'Gemini의 무료 이용 한도에 도달했어요. AI Studio에서 한도와 초기화 시점을 확인해 주세요.',
  QUOTA_UNAVAILABLE: '현재 Gemini 모델에 사용할 수 있는 이용 한도가 없어요. AI Studio에서 이 모델의 한도를 확인해 주세요.',
  PROVIDER_ERROR: 'Gemini 서비스가 분석 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
  ANALYSIS_FAILED: '분석 서버가 요청을 처리하지 못했어요. 연결 상태를 다시 확인해 주세요.',
  MODEL_UNAVAILABLE: '설정한 Gemini 모델을 사용할 수 없어요. 서버의 모델 설정을 확인해야 해요.',
  PROVIDER_BUSY: 'AI 서비스가 혼잡하거나 이용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.',
  RATE_LIMITED: '잠시 분석 횟수 제한에 도달했어요. 나중에 다시 시도해 주세요.',
  IN_PROGRESS: '다른 사진을 분석 중이에요. 잠시 후 다시 눌러 주세요.',
  TOO_LARGE: '사진 용량이 너무 커요. 사진 수를 줄여 다시 시도해 주세요.',
  INVALID_PHOTOS: '사진을 처리하지 못했어요. 사진을 다시 선택해 주세요.',
  INVALID_RESULT: 'AI 응답을 완성하지 못했어요. 다시 시도해 주세요.',
  TIMEOUT: '제한 시간 안에 Gemini의 분석 응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.',
};
export function connection() {
  const configured = process.env.EXPO_PUBLIC_ANALYSIS_URL;
  const host = Constants.expoConfig?.hostUri;
  const base = configured || (host ? `http://${new URL(`http://${host}`).hostname}:8787` : '');
  const token = process.env.EXPO_PUBLIC_ANALYSIS_TOKEN;
  if (!base || !token) throw new Error('분석 서버 연결을 준비 중이에요. 앱을 다시 열어 주세요.');
  return { base: base.replace(/\/$/, ''), headers: { Authorization: `Bearer ${token}` } };
}
export async function checkAnalysisServer(signal: AbortSignal): Promise<boolean> {
  const { base, headers } = connection();
  const response = await fetch(`${base}/health`, { headers, signal });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(isRecord(data) ? errors[String(data.code)] ?? '분석 서버에 연결하지 못했어요.' : '분석 서버에 연결하지 못했어요.');
  return isRecord(data) && data.ready === true;
}

export async function encode(photo: Photo, signal: AbortSignal, maxSide = 1280): Promise<EncodedPhoto> {
  signal.throwIfAborted();
  const context = ImageManipulator.manipulate(photo.uri);
  if (Math.max(photo.width, photo.height) > maxSide) context.resize(photo.width >= photo.height ? { width: maxSide } : { height: maxSide });
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  let uri: string | undefined;
  try {
    rendered = await context.renderAsync();
    const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
    uri = result.uri;
    signal.throwIfAborted();
    if (!result.base64) throw new Error('사진을 변환하지 못했어요. 사진을 다시 선택해 주세요.');
    if (result.base64.length > 1_000_000) throw new Error(errors.TOO_LARGE);
    return { mediaType: 'image/jpeg', data: result.base64 };
  } finally {
    // Delete only this newly generated JPEG, never the original reference/capture.
    if (uri && uri !== photo.uri && uri.startsWith('file://')) { try { new File(uri).delete(); } catch { /* OS cache cleanup remains a fallback. */ } }
    rendered?.release(); context.release();
  }
}

export async function requestLiveAnalysis(references: EncodedPhoto[], scene: Photo, signal: AbortSignal): Promise<AnalysisResult> {
  const { base, headers } = connection();
  const encoded = await encode(scene, signal);
  signal.throwIfAborted();
  const response = await fetch(`${base}/analyze`, { method: 'POST', signal,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ references, scene: encoded, mode: 'live' }) });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(isRecord(data) ? errors[String(data.code)] ?? 'AI 피드백을 받지 못했어요.' : 'AI 피드백을 받지 못했어요.');
  if (!isRecord(data) || !isAnalysisResult(data.result, references.length) || data.result.nextAction.length > 80) throw new Error(errors.INVALID_RESULT);
  return data.result;
}

export async function requestAnalysis(references: Photo[], scene: Photo, signal: AbortSignal, progress: (message: string) => void): Promise<AnalysisResult> {
  const { base, headers } = connection();
  const prepared: EncodedPhoto[] = [];
  const all = [...references, scene];
  for (const [i, photo] of all.entries()) {
    progress(`사진 준비 중 · ${i + 1}/${all.length}`);
    prepared.push(await encode(photo, signal));
  }
  signal.throwIfAborted();
  progress('레퍼런스와 현재 장소를 함께 분석하고 있어요.');
  const response = await fetch(`${base}/analyze`, { method: 'POST', signal,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ references: prepared.slice(0, -1), scene: prepared[prepared.length - 1] }) });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(isRecord(data) ? errors[String(data.code)] ?? 'AI 분석을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.' : 'AI 분석을 완료하지 못했어요.');
  if (!isRecord(data) || !isAnalysisResult(data.result, references.length)) throw new Error(errors.INVALID_RESULT);
  return data.result;
}
