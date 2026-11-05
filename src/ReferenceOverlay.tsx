import React, { useRef, useState } from 'react';
import { Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import type { Photo } from './domain/session';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
type Placement = { x: number; y: number; scale: number };
const initial: Placement = { x: 0, y: 0, scale: 1 };
const center = (e: GestureResponderEvent) => {
  const touches = e.nativeEvent.touches;
  return { x: touches.reduce((n, t) => n + t.pageX, 0) / touches.length,
    y: touches.reduce((n, t) => n + t.pageY, 0) / touches.length };
};
const distance = (e: GestureResponderEvent) => {
  const t = e.nativeEvent.touches;
  return t.length >= 2 ? Math.hypot(t[1].pageX - t[0].pageX, t[1].pageY - t[0].pageY) : 0;
};

// Display-only layer: no capture/compositing/upload or album-save APIs are used here.
export default function ReferenceOverlay({ references }: { references: Photo[] }) {
  const [selectedId, setSelectedId] = useState(references[0]?.id);
  const selected = references.find(p => p.id === selectedId) ?? references[0];
  const [opacity, setOpacity] = useState(0.3);
  const [visible, setVisible] = useState(true);
  const [peeking, setPeeking] = useState(false);
  const [locked, setLocked] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [placements, setPlacements] = useState<Record<string, Placement>>({});
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const placement = placements[selected?.id ?? ''] ?? initial;
  const state = useRef({ selectedId: selected?.id, placement, locked, visible, peeking });
  state.current = { selectedId: selected?.id, placement, locked, visible, peeking };
  const bounds = useRef({ width: 1, height: 1 });
  const start = useRef({ placement, point: { x: 0, y: 0 }, distance: 0, touches: 0 });
  const update = (next: Placement) => {
    const id = state.current.selectedId; if (!id) return;
    setPlacements(old => ({ ...old, [id]: { x: clamp(next.x, -0.75, 0.75), y: clamp(next.y, -0.75, 0.75), scale: clamp(next.scale, 0.5, 3) } }));
  };
  const begin = (e: GestureResponderEvent) => {
    start.current = { placement: state.current.placement, point: center(e), distance: distance(e), touches: e.nativeEvent.touches.length };
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !state.current.locked && state.current.visible && !state.current.peeking,
    onMoveShouldSetPanResponder: () => !state.current.locked && state.current.visible && !state.current.peeking,
    onPanResponderGrant: begin,
    onPanResponderMove: e => {
      if (state.current.locked || !state.current.visible || state.current.peeking || !e.nativeEvent.touches.length) return;
      if (e.nativeEvent.touches.length !== start.current.touches) { begin(e); return; }
      const point = center(e), previous = start.current;
      update({ x: previous.placement.x + (point.x - previous.point.x) / bounds.current.width,
        y: previous.placement.y + (point.y - previous.point.y) / bounds.current.height,
        scale: previous.distance > 0 ? previous.placement.scale * distance(e) / previous.distance : previous.placement.scale });
    },
    onPanResponderTerminationRequest: () => true,
  })).current;
  const showing = visible && !peeking && !failed;
  if (!selected) return null;
  const button = (label: string, action: () => void, active = false, disabled = false) => <Pressable
    key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onPress={action} style={({ pressed }) => [s.button, active && s.active, disabled && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}>
    <Text style={s.buttonText}>{label}</Text>
  </Pressable>;
  return <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={e => {
    bounds.current = { width: Math.max(1, e.nativeEvent.layout.width), height: Math.max(1, e.nativeEvent.layout.height) };
    setSize(old => old.width === bounds.current.width && old.height === bounds.current.height ? old : bounds.current);
  }}>
    <View style={StyleSheet.absoluteFill} pointerEvents={showing && !locked ? 'auto' : 'none'} {...pan.panHandlers}>
      <Image key={selected.uri} source={{ uri: selected.uri }} resizeMode="contain" accessible={false}
        onError={() => setFailed(true)} onLoad={() => setFailed(false)}
        style={[StyleSheet.absoluteFill, { opacity: showing ? opacity : 0,
          transform: [{ translateX: placement.x * size.width }, { translateY: placement.y * size.height }, { scale: placement.scale }] }]} />
    </View>
    <View style={s.top} pointerEvents="box-none">
      <View style={s.topRow}>
        {button(visible ? '겹치기 켜짐' : '겹치기 꺼짐', () => setVisible(!visible), visible)}
        {button(locked ? '위치 잠김' : '위치 잠그기', () => setLocked(!locked), locked, !visible)}
        {button(expanded ? '조절 닫기' : '조절', () => setExpanded(!expanded), expanded)}
        <Pressable accessibilityRole="button" accessibilityLabel="레퍼런스 잠시 숨기기" disabled={!visible}
          onPressIn={() => setPeeking(true)} onPressOut={() => setPeeking(false)} style={s.button}>
          <Text style={s.buttonText}>{peeking ? '비교 중' : '원본 보기'}</Text>
        </Pressable>
      </View>
      <View style={s.hint} pointerEvents="none"><Text style={s.small}>{failed ? '레퍼런스를 표시하지 못했어요. 다른 사진을 선택해 주세요.'
        : !visible ? '겹치기를 켜면 레퍼런스가 다시 보여요.' : locked ? '위치가 잠겼어요 · 카메라를 움직여 구도를 맞춰보세요.'
          : '한 손가락으로 이동 · 두 손가락으로 크기 조절'}</Text></View>
      {expanded && <View style={s.panel}>
        <Text style={s.caption}>따라 찍을 사진 · {references.indexOf(selected) + 1}/{references.length}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photos}>
          {references.map((photo, i) => <Pressable key={photo.id} accessibilityRole="button" accessibilityLabel={`겹쳐 볼 레퍼런스 ${i + 1}`}
            accessibilityState={{ selected: photo.id === selected.id }} onPress={() => { setSelectedId(photo.id); setFailed(false); }}
            style={[s.thumb, photo.id === selected.id && s.selected]}>
            <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <Text style={s.number}>{i + 1}</Text>
          </Pressable>)}
        </ScrollView>
        <OpacitySlider value={opacity} onChange={setOpacity} />
        <View style={s.topRow}>
          {button('− 축소', () => update({ ...placement, scale: placement.scale - 0.1 }), false, locked || !visible)}
          <Text style={s.scale}>{Math.round(placement.scale * 100)}%</Text>
          {button('＋ 확대', () => update({ ...placement, scale: placement.scale + 0.1 }), false, locked || !visible)}
          {button('위치 초기화', () => update(initial), false, locked)}
        </View>
        <Text style={s.small}>레퍼런스는 화면에만 겹쳐 보여요. 촬영 사진에는 포함되지 않아요.</Text>
      </View>}
    </View>
  </View>;
}

function OpacitySlider({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const width = useRef(1);
  const change = useRef(onChange); change.current = onChange;
  const move = (e: GestureResponderEvent) => change.current(clamp(e.nativeEvent.locationX / width.current, 0, 1) * 0.8);
  const pan = useRef(PanResponder.create({ onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: move, onPanResponderMove: move })).current;
  return <View>
    <Text style={s.caption}>겹친 사진 진하기 · {Math.round(value * 100)}%</Text>
    <View accessibilityRole="adjustable" accessibilityLabel="레퍼런스 진하기" accessibilityValue={{ min: 0, max: 80, now: Math.round(value * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={e => onChange(clamp(value + (e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05), 0, 0.8))}
      onLayout={e => { width.current = Math.max(1, e.nativeEvent.layout.width); }} style={s.trackTouch} {...pan.panHandlers}>
      <View pointerEvents="none" style={s.track}><View style={[s.fill, { width: `${value / 0.8 * 100}%` }]} /></View>
      <View pointerEvents="none" style={[s.knob, { left: `${value / 0.8 * 100}%` }]} />
    </View>
  </View>;
}
const s = StyleSheet.create({
  top: { position: 'absolute', top: 10, left: 10, right: 10 }, topRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  button: { minHeight: 40, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 8, backgroundColor: '#17201CE0' }, active: { backgroundColor: '#4E613BEC' },
  buttonText: { color: '#FFF', fontSize: 11, fontWeight: '600' }, hint: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: '#17201CC9', marginTop: 6 },
  small: { fontSize: 10, lineHeight: 17, color: '#E5EBD9' }, panel: { padding: 12, borderRadius: 10, backgroundColor: '#17201CEE', marginTop: 6 },
  caption: { color: '#E5EBD9', fontSize: 11, lineHeight: 18 }, photos: { gap: 8, paddingVertical: 8 }, thumb: { width: 42, height: 52, borderWidth: 2, borderColor: 'transparent', borderRadius: 5, overflow: 'hidden' }, selected: { borderColor: '#DBEDA9' },
  number: { position: 'absolute', bottom: 0, left: 0, paddingHorizontal: 3, color: '#FFF', backgroundColor: '#0008', fontSize: 10 }, scale: { fontSize: 11, color: '#FFF', minWidth: 38, textAlign: 'center' },
  peekRow: { position: 'absolute', bottom: 10, right: 10 }, peek: { minHeight: 40, backgroundColor: '#17201CE0', paddingHorizontal: 12, justifyContent: 'center', borderRadius: 8 },
  trackTouch: { height: 40, marginHorizontal: 12, justifyContent: 'center' }, track: { height: 4, borderRadius: 2, backgroundColor: '#73816D' }, fill: { height: 4, backgroundColor: '#D9EDAF', borderRadius: 2 },
  knob: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#D9EDAF', marginLeft: -11, top: 9 },
});
