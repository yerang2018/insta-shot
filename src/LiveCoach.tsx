import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import { encode } from './services/analysis';
import { openLiveSession } from './services/live';
import type { LiveSession } from './services/live';
import type { Photo } from './domain/session';
import type { EncodedPhoto } from './domain/analysis';

export default function LiveCoach({ references, capture, ready, onRetryCamera }: {
  references: Photo[]; capture: () => Promise<Photo | null>; ready: boolean; onRetryCamera: () => void;
}) {
  const [consent, setConsent] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Live 연결로 촬영 안내를 받아보세요.');
  const [feedback, setFeedback] = useState<{ text: string; at: number; delay: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const active = useRef<AbortController | null>(null);
  const session = useRef<LiveSession | null>(null);
  const mounted = useRef(true);
  const captureRef = useRef(capture); captureRef.current = capture;
  const readyRef = useRef(ready); readyRef.current = ready;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function stop(message: string) {
    active.current?.abort(); active.current = null; session.current?.close(); session.current = null;
    if (timer.current) clearTimeout(timer.current); timer.current = null;
    if (mounted.current) { setRunning(false); setFeedback(null); setStatus(message); }
  }
  useEffect(() => {
    mounted.current = true;
    setRunning(false); setFeedback(null); setStatus('Live 연결로 촬영 안내를 받아보세요.');
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') { setConsent(false); stop('앱을 벗어나 Live를 중지했어요.'); } });
    return () => { mounted.current = false; clearInterval(tick); sub.remove(); stop(''); };
  }, []);
  useEffect(() => { if (!ready && active.current) stop('카메라가 준비되면 다시 시작해 주세요.'); }, [ready]);
  async function start() {
    if (active.current) return;
    if (!readyRef.current || AppState.currentState !== 'active') {
      setConsent(false); setStatus('카메라가 준비되지 않았어요. 카메라 다시 연결을 눌러 주세요.'); return;
    }
    const controller = new AbortController(); active.current = controller;
    setConsent(false); setRunning(true); setFeedback(null); setStatus('레퍼런스를 준비하고 Live에 연결하고 있어요.');
    const prepared: EncodedPhoto[] = [];
    const sentAt = new Map<number, number>();
    const preparation = setTimeout(() => controller.abort(), 35_000);
    try {
      for (const photo of references) prepared.push(await encode(photo, controller.signal, 960));
      const live = await openLiveSession(prepared, controller.signal, {
        feedback: (text, seq) => {
          if (active.current !== controller || !mounted.current) return;
          const at = sentAt.get(seq); if (!at) return;
          setFeedback({ text, at, delay: Date.now() - at }); setNow(Date.now());
          setStatus('새 화면을 계속 전달하고 있어요.');
        },
        ended: message => { if (active.current === controller) stop(message); },
      });
      if (active.current !== controller || controller.signal.aborted) { live.close(); return; }
      session.current = live; setStatus('Live 연결 완료 · 첫 화면을 전달하고 있어요.');
      let seq = 0;
      async function sample() {
        if (active.current !== controller || controller.signal.aborted || !readyRef.current) return;
        const started = Date.now(); let photo: Photo | null = null;
        try {
          photo = await captureRef.current();
          controller.signal.throwIfAborted();
          if (photo) {
            const encoded = await encode(photo, controller.signal, 640);
            if (active.current !== controller) return;
            const id = ++seq;
            if (live.sendFrame(encoded, id)) sentAt.set(id, started);
            for (const [id, at] of sentAt) if (Date.now() - at > 25_000) sentAt.delete(id);
          }
          if (active.current === controller) timer.current = setTimeout(sample, Math.max(0, 1200 - (Date.now() - started)));
        } catch (e) {
          if (active.current === controller) stop(controller.signal.aborted ? 'Live를 중지했어요.' : e instanceof Error ? e.message : '화면을 전달하지 못했어요.');
        } finally {
          if (photo?.uri.startsWith('file://')) { try { new File(photo.uri).delete(); } catch {} }
        }
      }
      void sample();
    } catch (e) {
      if (active.current === controller) stop(controller.signal.aborted ? 'Live 연결 준비 시간이 길어졌어요.' : e instanceof Error ? e.message : 'Live를 연결하지 못했어요.');
    } finally { clearTimeout(preparation); }
  }
  const age = feedback ? Math.max(0, Math.floor((now - feedback.at) / 1000)) : 0;
  return <>
    <View style={s.overlay} pointerEvents="box-none"><View style={s.panel} accessibilityLiveRegion="polite">
      <Text style={s.label}>{running ? 'Gemini Live · 화면 전달 중' : 'AI Live 촬영 코치'}</Text>
      {feedback && age <= 12 ? <>
        <Text style={s.instruction}>{feedback.text}</Text>
        <Text style={s.small}>{`${age}초 전 화면 기준 · 표시까지 ${(feedback.delay / 1000).toFixed(1)}초`}</Text>
      </> : <Text style={s.instruction}>{feedback ? '안내를 갱신하고 있어요. 카메라를 잠시 유지해 주세요.' : status}</Text>}
      {feedback && <Text style={s.small}>{status}</Text>}
      {!ready && !running && <Text style={s.small}>카메라 준비 신호를 기다리고 있어요. 아래 버튼으로 다시 연결할 수 있어요.</Text>}
      <Pressable accessibilityRole="button" onPress={() => {
        if (running) stop('Live 코치를 중지했어요.');
        else if (!ready) { setStatus('카메라를 다시 연결하고 있어요.'); onRetryCamera(); }
        else setConsent(true);
      }} style={s.button}>
        <Text style={s.buttonText}>{running ? 'Live 중지' : ready ? 'AI Live 시작' : '카메라 다시 연결'}</Text>
      </Pressable>
    </View></View>
    <Modal visible={consent} transparent animationType="fade" onRequestClose={() => setConsent(false)}>
      <View style={s.shade}><ScrollView style={s.dialog} contentContainerStyle={s.dialogContent} bounces={false}>
        <Text style={s.title}>Live 촬영 안내 시험</Text>
        <Text style={s.body}>{`레퍼런스 ${references.length}장과 카메라 화면의 축소본을 맥 서버를 거쳐 Gemini Live에 보내요. 연결을 유지하며 초당 최대 1장, 최대 1분 동안 전달해요. 안내 속도는 실제 연결 상태에 따라 달라요.`}</Text>
        <Text style={s.body}>마이크는 보내지 않고 소리도 재생하지 않아요. AI 음성 응답의 텍스트를 화면에 표시해요. 무료 API 사진은 서비스 개선·검토에 쓰일 수 있으므로 식별 가능한 얼굴이나 개인정보가 없는 화면으로 시험해 주세요.</Text>
        <Text style={s.body}>중지·앱 전환·카메라 전환·촬영 화면 종료 시 연결을 끊어요. 노출 수치는 조절 제안이며 자동 적용되지 않아요.</Text>
        <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL('https://ai.google.dev/gemini-api/terms').catch(() => {}); }} style={s.link}><Text>Google 데이터 처리 안내 ↗</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={start} style={s.button}><Text style={s.buttonText}>확인하고 Live 시작</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => setConsent(false)} style={s.link}><Text>취소</Text></Pressable>
      </ScrollView></View>
    </Modal>
  </>;
}
const s = StyleSheet.create({
  overlay: { position: 'absolute', left: 10, right: 10, bottom: 10, zIndex: 2 },
  panel: { backgroundColor: '#171B19E8', borderRadius: 12, padding: 14 },
  label: { color: '#DCECB8', fontSize: 10, marginBottom: 6 },
  instruction: { color: '#FFF', fontSize: 18, lineHeight: 26, minHeight: 78, fontWeight: '600' },
  small: { color: '#C7CCBF', fontSize: 10, lineHeight: 16, marginTop: 5 },
  button: { backgroundColor: '#DDE9C3', minHeight: 44, padding: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  buttonText: { color: '#26321F', fontSize: 13, fontWeight: '700' },
  shade: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0009' },
  dialog: { backgroundColor: '#F7F6F0', maxHeight: '90%', flexGrow: 0, borderRadius: 16 },
  dialogContent: { padding: 22 },
  title: { color: '#262722', fontSize: 22, fontWeight: '600' },
  body: { color: '#555D4C', fontSize: 13, lineHeight: 23, marginTop: 14 },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
});
