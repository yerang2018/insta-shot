// Shared wire contract. Never import server configuration or credentials here.
export type EncodedPhoto = { mediaType: 'image/jpeg'; data: string };
export type AnalysisRequest = { references: EncodedPhoto[]; scene: EncodedPhoto; mode?: 'live' };
export type ShotGuide = {
  title: string;
  referenceNumbers: number[];
  composition: string;
  pose: string;
  light: string;
  adaptation: string;
};
export type AnalysisResult = {
  summary: string;
  referenceNotes: { referenceNumber: number; observation: string }[];
  shots: ShotGuide[];
  nextAction: string;
  uncertainty: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 1600;
const refNumber = (v: unknown, count: number): v is number => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= count;

export function isAnalysisResult(value: unknown, referenceCount: number): value is AnalysisResult {
  if (!isRecord(value) || !text(value.summary) || !text(value.nextAction) || !text(value.uncertainty)) return false;
  const notes = value.referenceNotes;
  if (!Array.isArray(notes) || notes.length !== referenceCount) return false;
  if (!notes.every(n => isRecord(n) && refNumber(n.referenceNumber, referenceCount) && text(n.observation))) return false;
  if (new Set(notes.map(n => n.referenceNumber)).size !== referenceCount) return false;
  return Array.isArray(value.shots) && value.shots.length >= 1 && value.shots.length <= 4 && value.shots.every(shot =>
    isRecord(shot) && text(shot.title) && text(shot.composition) && text(shot.pose) && text(shot.light) && text(shot.adaptation)
    && Array.isArray(shot.referenceNumbers) && shot.referenceNumbers.length >= 1 && shot.referenceNumbers.length <= referenceCount
    && shot.referenceNumbers.every(n => refNumber(n, referenceCount))
    && new Set(shot.referenceNumbers).size === shot.referenceNumbers.length);
}
