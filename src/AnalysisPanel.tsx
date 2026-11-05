import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { checkAnalysisServer, requestAnalysis } from './services/analysis';
import type { AnalysisResult } from './domain/analysis';
import type { Photo } from './domain/session';

export default function AnalysisPanel({ references, scene, result, onResult }: {
  references: Photo[]; scene: Photo; result: AnalysisResult | null; onResult: (result: AnalysisResult) => void;
}) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'unconfigured' | 'offline'>('checking');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const current = useRef<AbortController | null>(null);
  const health = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void check();
    return () => { mounted.current = false; current.current?.abort(); health.current?.abort(); };
  }, []);

  async function check() {
    health.current?.abort();
    const controller = new AbortController(); health.current = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    setStatus('checking'); setError('');
    try {
      const ready = await checkAnalysisServer(controller.signal);
      if (mounted.current && health.current === controller) setStatus(ready ? 'ready' : 'unconfigured');
    } catch {
      if (mounted.current && health.current === controller) setStatus('offline');
    } finally { clearTimeout(timeout); }
  }

  async function analyze() {
    if (current.current || status !== 'ready') return;
    const controller = new AbortController(); current.current = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 140_000);
    setBusy(true); setConsent(false); setError('');
    try {
      const data = await requestAnalysis(references, scene, controller.signal, message => { if (mounted.current) setProgress(message); });
      if (mounted.current && !controller.signal.aborted) onResult(data);
    } catch (e) {
      if (mounted.current) setError(controller.signal.aborted
        ? controller.signal.reason === 'timeout' ? '분석 시간이 길어졌어요. 잠시 후 다시 시도해 주세요.' : '분석을 중단했어요. 이미 전송된 요청에는 이용 요금이 발생할 수 있어요.'
        : e instanceof Error && !/Network request failed|Failed to fetch/.test(e.message) ? e.message : '분석 서버에 연결하지 못했어요. 맥과 아이폰의 연결을 확인해 주세요.');
    } finally {
      clearTimeout(timeout); current.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  return <View style={s.card}>
    <Text style={s.eyebrow}>AI 촬영 가이드</Text>
    <Text style={s.title}>{result ? '이 장소에서 이렇게 찍어보세요' : '원하는 느낌을, 지금 이 장소에.'}</Text>
    {result ? <>
      <Text style={s.body}>{result.summary}</Text>
      <View style={s.next}><Text style={s.label}>먼저 해볼 한 가지</Text><Text style={s.body}>{result.nextAction}</Text></View>
      <Text style={s.heading}>사진별 관찰</Text>
      {result.referenceNotes.map(note => <Text key={note.referenceNumber} style={s.body}>{`사진 ${note.referenceNumber} · ${note.observation}`}</Text>)}
      {result.shots.map((shot, index) => <View key={index} style={s.shot}>
        <Text style={s.heading}>{`${index + 1}. ${shot.title}`}</Text>
        <Text style={s.small}>{`참고 사진 ${shot.referenceNumbers.join(', ')}`}</Text>
        {([['구도', shot.composition], ['포즈', shot.pose], ['빛', shot.light], ['여기서 적용하기', shot.adaptation]] as const).map(([label, body]) =>
          <View key={label} style={s.section}><Text style={s.label}>{label}</Text><Text style={s.body}>{body}</Text></View>)}
      </View>)}
      <Text style={s.small}>{`사진만으로 확인하기 어려운 점 · ${result.uncertainty}`}</Text>
      <Text style={s.small}>AI의 제안이에요. 실제 공간과 빛을 보며 조절해 주세요.</Text>
      <Text style={s.small}>다시 찍기를 눌러 가이드를 적용해 보세요. 새 사진을 찍으면 이 결과는 초기화돼요.</Text>
    </> : busy ? <View accessibilityLiveRegion="polite">
      <ActivityIndicator color="#C34D31" style={s.spinner} /><Text style={s.body}>{progress}</Text>
      <Action title="분석 중단" secondary onPress={() => current.current?.abort()} />
    </View> : <>
      <Text style={s.body}>레퍼런스의 특징과 지금 찍은 사진을 함께 보고 구도·포즈·빛을 제안해요.</Text>
      {status === 'checking' ? <Text style={s.small}>AI 연결을 확인하고 있어요.</Text>
        : status === 'unconfigured' ? <Text style={s.body}>AI 연결 준비 중이에요. 촬영과 앨범 저장은 계속 사용할 수 있어요.</Text>
          : status === 'offline' ? <Text style={s.body}>분석 서버에 연결하지 못했어요. 맥이 켜져 있고 같은 Wi-Fi인지 확인해 주세요.</Text>
            : consent ? <View style={s.next}>
              <Text style={s.label}>사진을 보내기 전에 확인해 주세요</Text>
              <Text style={s.body}>{`레퍼런스 ${references.length}장과 현장 사진 1장의 축소본을 맥의 분석 서버를 거쳐 Google Gemini에 전송해요. 분석 서버는 사진을 파일로 저장하지 않아요. Google의 데이터 처리 정책이 적용되며, API 이용 요금이 발생할 수 있어요.`}</Text>
              <Text style={s.small}>무료 API에서는 사진과 응답이 Google 서비스 개선 및 검토에 사용될 수 있어요. 무료 API로 시험할 때는 인물이 식별되는 사진 등 개인정보가 담긴 사진을 보내지 마세요.</Text>
              <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL('https://ai.google.dev/gemini-api/terms').catch(() => setError('데이터 처리 안내를 열지 못했어요. 잠시 후 다시 시도해 주세요.')); }} style={{ paddingVertical: 12 }}>
                <Text style={s.label}>Google 데이터 처리 안내 보기 ↗</Text>
              </Pressable>
              <Action title="사진 보내고 분석" onPress={analyze} />
              <Action title="취소" secondary onPress={() => setConsent(false)} />
            </View> : <Action title="AI 촬영 가이드 받기" onPress={() => setConsent(true)} />}
      {(status === 'unconfigured' || status === 'offline') && <Action title="연결 다시 확인" secondary onPress={check} />}
    </>}
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    <Text style={s.small}>사진은 전송을 확인하셨을 때만 보내요.</Text>
  </View>;
}

function Action({ title, onPress, secondary = false }: { title: string; onPress: () => void; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.button, secondary && s.secondary, pressed && { opacity: 0.7 }]}>
    <Text style={[s.buttonText, secondary && { color: '#262722' }]}>{title}</Text>
  </Pressable>;
}
const s = StyleSheet.create({
  card: { borderRadius: 14, padding: 20, backgroundColor: '#ECEEE1', marginTop: 24 },
  eyebrow: { fontSize: 10, letterSpacing: 1.3, fontWeight: '700', color: '#646D4E' },
  title: { fontSize: 22, lineHeight: 31, fontWeight: '600', color: '#262722', marginTop: 14 },
  heading: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: '#262722', marginTop: 16 },
  label: { fontSize: 12, lineHeight: 20, fontWeight: '700', color: '#525C3B' },
  body: { fontSize: 13, lineHeight: 23, color: '#414738', marginTop: 8 },
  small: { fontSize: 11, lineHeight: 19, color: '#656D58', marginTop: 10 },
  next: { padding: 14, borderRadius: 10, backgroundColor: '#F7F6F0', marginTop: 16 },
  shot: { borderTopWidth: 1, borderTopColor: '#CDD2BF', marginTop: 16 }, section: { marginTop: 12 },
  button: { minHeight: 48, borderRadius: 10, padding: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#262722', marginTop: 14 },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#BFC7AB' },
  buttonText: { fontSize: 13, fontWeight: '600', color: '#FFFDF7' },
  spinner: { marginTop: 20 }, error: { fontSize: 12, lineHeight: 21, color: '#923D25', marginTop: 14 },
});
