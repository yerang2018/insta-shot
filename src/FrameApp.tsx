import React, { useEffect, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { CameraType } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { initialSession, MAX_REFERENCES, MIN_REFERENCES, sessionReducer } from './domain/session';
import AnalysisPanel from './AnalysisPanel';
import LiveCoach from './LiveCoach';
import ReferenceOverlay from './ReferenceOverlay';
import type { AnalysisResult } from './domain/analysis';

const c = { ink: '#262722', muted: '#777B70', paper: '#F7F6F0', line: '#DFE1D5', accent: '#C34D31', soft: '#EEEDE4' };

function Button({ title, onPress, disabled, secondary, busy, dimWhenDisabled = true }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; busy?: boolean; dimWhenDisabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled || !!busy, busy }} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [s.button, secondary && s.secondaryButton, ((disabled && dimWhenDisabled) || busy) && s.disabled, pressed && s.pressed]}>
    {busy ? <ActivityIndicator color={secondary ? c.ink : '#FFF'} /> : <Text style={[s.buttonText, secondary && s.secondaryText]}>{title}</Text>}
  </Pressable>;
}

function Illustration() {
  return <View style={s.illustration} accessible={false}>
    <View style={s.artCircle} />
    <View style={[s.artPhoto, s.artBack]}><View style={s.artSun} /></View>
    <View style={[s.artPhoto, s.artFront]}><View style={s.artWindow} /><View style={s.artHead} /><View style={s.artBody} /><View style={s.artGuide} /></View>
    <Text style={s.artLabel}>01 / YOUR INSPIRATION</Text>
  </View>;
}

function FrameApp() {
  const [session, dispatch] = useReducer(sessionReducer, initialSession);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [ready, setReady] = useState(false);
  const [cameraRevision, setCameraRevision] = useState(0);
  const [cameraError, setCameraError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [notice, setNotice] = useState('');
  const [grid, setGrid] = useState(true);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [analysis, setAnalysis] = useState<{ key: string; result: AnalysisResult } | null>(null);
  const lock = useRef(false);
  const camera = useRef<CameraView>(null);
  const { width } = useWindowDimensions();
  const tileWidth = (Math.min(width, 640) - 68) / 3;
  const { stage, references, scene } = session;
  const analysisKey = JSON.stringify([references.map(p => p.uri), scene?.uri]);
  const currentAnalysis = analysis?.key === analysisKey ? analysis.result : null;
  const enough = references.length >= MIN_REFERENCES;

  useEffect(() => {
    setNotice(''); setConfirmReset(false);
    if (stage === 'camera') { setReady(false); setCameraError(false); setAiEnabled(false); }
  }, [stage]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (lock.current) return true;
      if (stage === 'references') return false;
      dispatch({ type: 'back' }); return true;
    });
    return () => sub.remove();
  }, [stage]);

  useEffect(() => {
    if (stage !== 'camera') return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void getPermission().catch(() => setNotice('카메라 권한을 다시 확인해 주세요.'));
    });
    return () => sub.remove();
  }, [stage, getPermission]);

  async function pickPhotos() {
    if (lock.current) return;
    if (references.length >= MAX_REFERENCES) { setNotice('레퍼런스는 최대 10장까지 담을 수 있어요.'); return; }
    lock.current = true; setBusy(true); setNotice('');
    try {
      // The system picker grants access to selected photos; no broad library read permission is needed.
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_REFERENCES - references.length, orderedSelection: true, quality: 1, exif: false });
      if (!result.canceled) dispatch({ type: 'add', photos: result.assets.map((asset) => ({ id: asset.assetId ?? asset.uri, uri: asset.uri, width: asset.width, height: asset.height })) });
    } catch { setNotice('사진을 불러오지 못했어요. 사진 접근 설정을 확인하고 다시 선택해 주세요.'); }
    finally { lock.current = false; setBusy(false); }
  }

  async function allowCamera() {
    try {
      if (permission && !permission.canAskAgain) {
        if (Platform.OS === 'web') setNotice('브라우저의 사이트 설정에서 카메라를 허용한 뒤 새로고침해 주세요.');
        else await Linking.openSettings();
      } else {
        const result = await requestPermission();
        if (!result.granted) setNotice('촬영하려면 카메라 권한이 필요해요. 선택한 레퍼런스는 그대로 있어요.');
      }
    } catch { setNotice('휴대폰 설정에서 카메라 권한을 확인해 주세요.'); }
  }

  async function takePhoto() {
    if (!camera.current || !ready || lock.current) return;
    lock.current = true; setBusy(true); setNotice('');
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.9, exif: false });
      if (!photo) throw new Error('No photo');
      setSaved(false);
      dispatch({ type: 'captured', photo: { id: `scene-${Date.now()}`, uri: photo.uri, width: photo.width, height: photo.height } });
    } catch { setNotice('촬영하지 못했어요. 잠시 기다린 뒤 다시 눌러 주세요.'); }
    finally { lock.current = false; setBusy(false); }
  }

  async function capturePreview() {
    if (!camera.current || !ready || cameraError || lock.current || AppState.currentState !== 'active') return null;
    lock.current = true; setSampling(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.45, exif: false, shutterSound: false });
      return photo ? { id: `preview-${Date.now()}`, uri: photo.uri, width: photo.width, height: photo.height } : null;
    } finally { lock.current = false; setSampling(false); }
  }

  async function savePhoto() {
    if (!scene || saved || lock.current) return;
    if (Platform.OS === 'web') { setNotice('앨범 저장은 휴대폰 앱에서 지원해요. Expo Go에서 실행해 주세요.'); return; }
    lock.current = true; setBusy(true); setNotice('');
    try {
      const access = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
      if (!access.granted) { setNotice('저장 권한이 필요해요. 휴대폰 설정에서 사진 추가 권한을 허용해 주세요.'); return; }
      await MediaLibrary.saveToLibraryAsync(scene.uri);
      setSaved(true); setNotice('휴대폰 사진 앨범에 저장했어요.');
    } catch { setNotice('사진을 저장하지 못했어요. 저장 권한과 여유 공간을 확인해 주세요.'); }
    finally { lock.current = false; setBusy(false); }
  }

  function strip() {
    return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
      {references.map((photo, index) => <View key={photo.id} style={s.stripPhoto}>
        <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={`레퍼런스 ${index + 1}`} /><Text style={s.photoNumber}>{String(index + 1).padStart(2, '0')}</Text>
      </View>)}
    </ScrollView>;
  }

  function screenTitle(title: string, subtitle: string) {
    return <View style={s.titleRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="이전 화면으로" disabled={busy || sampling} onPress={() => dispatch({ type: 'back' })} hitSlop={10} style={s.back}><Text style={s.backText}>←</Text></Pressable>
      <View style={s.flex}><Text style={s.screenTitle}>{title}</Text><Text style={s.caption}>{subtitle}</Text></View>
    </View>;
  }

  const step = stage === 'references' ? 0 : stage === 'camera' ? 1 : 2;
  return <SafeAreaView style={s.safe}>
    <StatusBar style="dark" />
    <View style={s.container}>
      <View style={s.header}><View style={s.brandRow}><View style={s.brandDot} /><Text style={s.brand}>FRAME</Text></View><View style={s.badge}><Text style={s.badgeText}>첫 번째 프로토타입</Text></View></View>
      <View style={s.steps}>{['레퍼런스', '현장 촬영', '함께 보기'].map((label, i) => <View key={label} style={[s.step, step === i && s.activeStep]}><Text style={[s.stepText, step === i && s.activeStepText]}>{`0${i + 1}  ${label}`}</Text></View>)}</View>

      {stage === 'references' && <ScrollView key="references" contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.eyebrow}>START WITH YOUR INSPIRATION</Text>
        <Text style={s.hero}>{'그 느낌,\n여기서도.'}</Text>
        <Text style={s.description}>{'좋아하는 사진 한 장부터 시작해 보세요.\n같은 장소의 사진을 여러 장 모아도 좋아요.'}</Text>
        {!references.length && <Illustration />}
        <View style={s.sectionHeading}><Text style={s.sectionTitle}>나의 레퍼런스</Text><Text style={s.counter}>{references.length}<Text style={s.counterMuted}> / 10</Text></Text></View>
        <Text style={s.caption}>인스타 스크린샷이나 앨범 사진을 {MIN_REFERENCES}~{MAX_REFERENCES}장 선택해 주세요.</Text>
        <View style={s.photoGrid}>{references.map((photo, index) => <View key={photo.id} style={[s.photoTile, { width: tileWidth, height: tileWidth * 1.28 }]}>
          <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={`선택한 레퍼런스 ${index + 1}`} />
          <Text style={s.photoNumber}>{String(index + 1).padStart(2, '0')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`레퍼런스 ${index + 1} 삭제`} disabled={busy} onPress={() => dispatch({ type: 'remove', id: photo.id })} style={s.remove}><Text style={s.removeText}>×</Text></Pressable>
        </View>)}
          {references.length < MAX_REFERENCES && <Pressable accessibilityRole="button" accessibilityLabel="레퍼런스 사진 추가" disabled={busy} onPress={pickPhotos} style={({ pressed }) => [s.addTile, { width: references.length ? tileWidth : '100%', height: references.length ? tileWidth * 1.28 : 90 }, pressed && s.pressed]}>
            {busy ? <ActivityIndicator color={c.accent} /> : <Text style={s.plus}>+</Text>}<Text style={s.addText}>{references.length ? '추가하기' : '앨범에서 사진 선택'}</Text>
          </Pressable>}
        </View>
        <Text style={s.privacyNote}>AI 분석 전 전송을 확인하셨을 때만 사진을 보내요.</Text>
      </ScrollView>}

      {stage === 'camera' && <View key="camera" style={[s.content, { flex: 1, paddingTop: 12, paddingBottom: 8 }]}>
        {screenTitle('레퍼런스처럼 찍기', `레퍼런스 ${references.length}장 · 겹쳐 보며 구도를 맞춰보세요`)}
        <View style={[s.cameraFrame, { flex: 1, aspectRatio: undefined }]}>
          {permission?.granted && !cameraError ? <>
            <CameraView key={`camera-${facing}-${cameraRevision}`} ref={camera} style={StyleSheet.absoluteFill} facing={facing} mode="picture" mirror={false} flash="off" animateShutter={false} onCameraReady={() => setReady(true)}
              onMountError={() => { setCameraError(true); setReady(false); setNotice('카메라를 열지 못했어요. 다른 카메라 앱을 닫고 다시 시도해 주세요.'); }} />
            {grid && <View pointerEvents="none" style={StyleSheet.absoluteFill}><View style={[s.vGuide, { left: '33.333%' }]} /><View style={[s.vGuide, { left: '66.667%' }]} /><View style={[s.hGuide, { top: '33.333%' }]} /><View style={[s.hGuide, { top: '66.667%' }]} /></View>}
            <ReferenceOverlay key={JSON.stringify(['reference-overlay', facing, references.map(p => p.uri)])} references={references} />
            {aiEnabled && <LiveCoach key={JSON.stringify(['live-coach', facing, references.map(p => p.uri)])} references={references} capture={capturePreview} ready={ready && !cameraError}
              onRetryCamera={() => { setReady(false); setCameraRevision(n => n + 1); }} />}
          </> : <View style={s.permissionPanel}>
            <Text style={s.permissionIcon}>◎</Text><Text style={s.permissionTitle}>{cameraError ? '카메라를 다시 열어주세요' : '카메라로 장소를 담아주세요'}</Text>
            <Text style={s.permissionDescription}>{cameraError ? '이전 화면으로 돌아간 뒤\n현장 촬영을 다시 열어주세요.' : '카메라 접근을 허용하면\n현재 장소의 사진을 찍을 수 있어요.'}</Text>
            {!cameraError && <Pressable accessibilityRole="button" onPress={allowCamera} style={s.permissionButton}><Text style={s.permissionButtonText}>{permission && !permission.canAskAgain ? '설정에서 허용하기' : '카메라 허용하기'}</Text></Pressable>}
          </View>}
        </View>
        <View style={s.cameraControls}>
          <Pressable accessibilityRole="button" accessibilityLabel={grid ? '격자 끄기' : '격자 켜기'} onPress={() => setGrid(!grid)} style={s.control}><Text style={s.controlText}>{grid ? '격자 켜짐' : '격자 꺼짐'}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={aiEnabled ? 'AI 안내 끄기' : 'AI 안내 켜기'} onPress={() => setAiEnabled(!aiEnabled)} style={s.control}><Text style={s.controlText}>{aiEnabled ? 'AI 안내 끄기' : 'AI 안내 켜기'}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="전면 후면 카메라 전환" disabled={busy || sampling || !permission?.granted || cameraError} onPress={() => { setReady(false); setFacing(facing === 'back' ? 'front' : 'back'); }} style={s.control}><Text style={s.controlText}>↻  전환</Text></Pressable>
        </View>
      </View>}

      {stage === 'review' && scene && <ScrollView key="review" contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {screenTitle('같은 느낌의 시작', '레퍼런스와 지금 찍은 사진을 함께 확인해요.')}
        <View style={s.reviewFrame}><Image source={{ uri: scene.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel="촬영한 현장 사진" /><View style={s.cameraBadge}><Text style={s.cameraBadgeText}>MY FRAME</Text></View></View>
        <View style={s.sectionHeading}><Text style={s.sectionTitle}>나의 레퍼런스</Text><Text style={s.caption}>{references.length}장</Text></View>{strip()}
        <AnalysisPanel key={analysisKey} references={references} scene={scene} result={currentAnalysis}
          onResult={result => setAnalysis({ key: analysisKey, result })} />
        {confirmReset ? <View style={s.resetBox}><Text style={s.caption}>선택한 사진과 저장하지 않은 촬영 사진을 비울까요?</Text><View style={s.resetActions}>
          <Pressable accessibilityRole="button" onPress={() => setConfirmReset(false)} style={s.link}><Text style={s.linkText}>취소</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => { dispatch({ type: 'reset' }); setSaved(false); }} style={s.link}><Text style={[s.linkText, { color: c.accent }]}>비우고 새로 시작</Text></Pressable>
        </View></View> : <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmReset(true)} style={s.link}><Text style={s.linkText}>새로운 촬영 시작하기</Text></Pressable>}
      </ScrollView>}

      {notice ? <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.notice}><Text style={s.noticeText}>{notice}</Text><Pressable accessibilityRole="button" accessibilityLabel="안내 닫기" onPress={() => setNotice('')} hitSlop={10}><Text style={s.noticeClose}>×</Text></Pressable></View> : null}
      <View style={s.footer}>
        {stage === 'references' && <><Text style={s.footerHint}>{enough ? `${references.length}장의 레퍼런스가 준비됐어요` : `레퍼런스를 ${MIN_REFERENCES - references.length}장 더 선택해 주세요`}</Text><Button title="현재 장소 촬영하기  →" onPress={() => dispatch({ type: 'open-camera' })} disabled={!enough || busy} /></>}
        {stage === 'camera' && <Button title={ready ? '현장 사진 찍기' : '카메라를 준비해 주세요'} onPress={takePhoto} disabled={!ready || cameraError || sampling} dimWhenDisabled={!ready || cameraError} busy={busy} />}
        {stage === 'review' && <View style={s.footerRow}><View style={s.flex}><Button title="다시 찍기" secondary onPress={() => dispatch({ type: 'retake' })} disabled={busy} /></View><View style={s.flex}><Button title={saved ? '저장 완료' : '앨범에 저장'} onPress={savePhoto} disabled={saved} busy={busy} /></View></View>}
      </View>
    </View>
  </SafeAreaView>;
}

export default function App() { return <SafeAreaProvider><FrameApp /></SafeAreaProvider>; }

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.paper }, container: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' }, flex: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, brandDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent }, brand: { color: c.ink, fontSize: 20, letterSpacing: 3, fontWeight: '800' }, badge: { borderWidth: 1, borderColor: c.line, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 }, badgeText: { fontSize: 10, color: c.muted },
  steps: { flexDirection: 'row', paddingHorizontal: 24, gap: 14 }, step: { flex: 1, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: c.line }, activeStep: { borderBottomColor: c.accent }, stepText: { fontSize: 11, color: c.muted }, activeStepText: { color: c.accent, fontWeight: '700' },
  content: { paddingHorizontal: 24, paddingTop: 30, paddingBottom: 24 }, eyebrow: { fontSize: 9, letterSpacing: 1.8, fontWeight: '600', color: c.accent }, hero: { fontSize: 44, lineHeight: 56, letterSpacing: -2.5, fontWeight: '600', color: c.ink, marginTop: 14 }, description: { fontSize: 13, lineHeight: 22, color: c.muted, marginTop: 14 },
  illustration: { height: 230, marginTop: 12, marginBottom: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, artCircle: { position: 'absolute', width: 195, height: 195, backgroundColor: '#E9EAD9', borderRadius: 100, top: 12 }, artPhoto: { position: 'absolute', width: 124, height: 161, borderWidth: 6, borderBottomWidth: 22, borderColor: '#FFFDF7', borderRadius: 3, overflow: 'hidden' }, artBack: { transform: [{ rotate: '-13deg' }], marginLeft: -92, top: 26, backgroundColor: '#B3B9A1' }, artFront: { transform: [{ rotate: '9deg' }], marginLeft: 70, top: 34, backgroundColor: '#E7BFA3' }, artSun: { width: 42, height: 42, borderRadius: 22, backgroundColor: '#F5E3BB', margin: 14 }, artWindow: { position: 'absolute', top: 0, right: 0, width: 48, height: 112, backgroundColor: '#F4DBB9', borderLeftWidth: 4, borderLeftColor: '#A28C6A' }, artHead: { position: 'absolute', width: 22, height: 25, borderRadius: 14, backgroundColor: '#4E4D3D', top: 48, left: 37 }, artBody: { position: 'absolute', width: 38, height: 64, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#F3EFE0', top: 76, left: 30 }, artGuide: { position: 'absolute', width: 1, backgroundColor: '#FFFFFF60', top: 0, bottom: 0, left: '33.33%' }, artLabel: { position: 'absolute', bottom: 0, fontSize: 8, letterSpacing: 2, color: c.muted },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 8 }, sectionTitle: { fontSize: 16, fontWeight: '600', color: c.ink, letterSpacing: -0.4 }, counter: { fontSize: 16, fontWeight: '700', color: c.accent }, counterMuted: { color: '#ACAEA3', fontWeight: '400' }, caption: { fontSize: 11, lineHeight: 19, color: c.muted },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 }, photoTile: { borderRadius: 10, overflow: 'hidden', backgroundColor: c.soft }, photoNumber: { position: 'absolute', bottom: 6, left: 6, fontSize: 9, color: '#FFF', fontWeight: '600', backgroundColor: '#26272285', padding: 3, borderRadius: 3 }, remove: { position: 'absolute', top: 0, right: 0, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, removeText: { color: '#FFF', fontSize: 22, width: 27, height: 27, textAlign: 'center', lineHeight: 25, backgroundColor: '#262722A0', borderRadius: 14 }, addTile: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#BBBEAE', borderRadius: 10, backgroundColor: '#F0F0E6', alignItems: 'center', justifyContent: 'center', gap: 4 }, plus: { fontSize: 26, color: c.accent, fontWeight: '300' }, addText: { fontSize: 12, color: c.ink, fontWeight: '500' }, privacyNote: { fontSize: 10, color: c.muted, textAlign: 'center', marginTop: 18 },
  button: { minHeight: 54, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 16, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }, buttonText: { fontSize: 14, fontWeight: '600', color: '#FFFDF7' }, secondaryButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.line }, secondaryText: { color: c.ink }, disabled: { opacity: 0.38 }, pressed: { opacity: 0.7 }, footer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.paper }, footerHint: { fontSize: 10, color: c.muted, textAlign: 'center', marginBottom: 10 }, footerRow: { flexDirection: 'row', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22 }, back: { width: 32, minHeight: 44, justifyContent: 'center' }, backText: { fontSize: 25, color: c.ink }, screenTitle: { fontSize: 24, fontWeight: '600', letterSpacing: -1, color: c.ink, marginBottom: 5 }, cameraFrame: { aspectRatio: 3 / 4, width: '100%', backgroundColor: '#34372F', borderRadius: 16, overflow: 'hidden' }, vGuide: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#FFFFFF55' }, hGuide: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#FFFFFF55' }, cameraBadge: { position: 'absolute', top: 16, left: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#262722A0', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 }, liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#E6F5B6' }, cameraBadgeText: { color: '#FFFDF7', fontSize: 9, fontWeight: '600', letterSpacing: 1 },
  permissionPanel: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }, permissionIcon: { fontSize: 44, color: '#D4D9BF', marginBottom: 18 }, permissionTitle: { fontSize: 17, color: '#F7F6F0', fontWeight: '600', textAlign: 'center' }, permissionDescription: { fontSize: 12, lineHeight: 21, color: '#BABEAE', textAlign: 'center', marginTop: 12 }, permissionButton: { marginTop: 25, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 8, backgroundColor: '#E8ECD9' }, permissionButtonText: { color: '#34372F', fontSize: 12, fontWeight: '600' }, cameraControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }, control: { minHeight: 44, minWidth: 65, justifyContent: 'center' }, controlText: { fontSize: 12, color: c.ink }, cameraHint: { fontSize: 10, color: c.muted },
  strip: { gap: 8, paddingVertical: 4 }, stripPhoto: { width: 74, height: 96, borderRadius: 7, overflow: 'hidden', backgroundColor: c.soft }, reviewFrame: { width: '100%', aspectRatio: 3 / 4, borderRadius: 14, overflow: 'hidden', backgroundColor: '#DDDFD3' }, comingCard: { borderRadius: 14, padding: 20, backgroundColor: '#ECEEE1', marginTop: 24 }, comingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }, comingLabel: { fontSize: 8, letterSpacing: 1.5, color: '#646D4E', fontWeight: '700' }, comingTag: { fontSize: 9, color: '#737A62' }, comingTitle: { fontSize: 23, lineHeight: 32, fontWeight: '500', letterSpacing: -0.8, color: c.ink, marginTop: 18 }, comingDescription: { fontSize: 12, lineHeight: 21, color: '#717761', marginTop: 12 }, link: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingVertical: 12, marginTop: 8 }, linkText: { fontSize: 11, color: c.muted }, resetBox: { marginTop: 20, borderWidth: 1, borderColor: c.line, padding: 14, borderRadius: 10 }, resetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20 }, notice: { marginHorizontal: 24, marginBottom: 10, padding: 14, flexDirection: 'row', gap: 12, borderRadius: 10, backgroundColor: '#F0E4D9' }, noticeText: { flex: 1, fontSize: 12, lineHeight: 19, color: '#78442E' }, noticeClose: { fontSize: 20, color: '#78442E' },
});
