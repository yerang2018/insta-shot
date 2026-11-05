export const MIN_REFERENCES = 1;
export const MAX_REFERENCES = 10;

export type Photo = {
  id: string;
  uri: string;
  width: number;
  height: number;
};

export type Stage = 'references' | 'camera' | 'review';
export type Session = {
  references: Photo[];
  scene: Photo | null;
  stage: Stage;
};

export const initialSession: Session = {
  references: [],
  scene: null,
  stage: 'references',
};

export type Action =
  | { type: 'add'; photos: Photo[] }
  | { type: 'remove'; id: string }
  | { type: 'open-camera' }
  | { type: 'captured'; photo: Photo }
  | { type: 'back' }
  | { type: 'retake' }
  | { type: 'reset' };

export function mergeReferences(existing: Photo[], added: Photo[]): Photo[] {
  const ids = new Set(existing.map((photo) => photo.id));
  const uris = new Set(existing.map((photo) => photo.uri));
  const result = [...existing];
  for (const photo of added) {
    if (result.length >= MAX_REFERENCES) break;
    if (!photo.uri || photo.width <= 0 || photo.height <= 0) continue;
    if (ids.has(photo.id) || uris.has(photo.uri)) continue;
    result.push(photo);
    ids.add(photo.id);
    uris.add(photo.uri);
  }
  return result;
}

export function sessionReducer(state: Session, action: Action): Session {
  switch (action.type) {
    case 'add':
      return { ...state, references: mergeReferences(state.references, action.photos) };
    case 'remove': {
      const references = state.references.filter((photo) => photo.id !== action.id);
      return {
        ...state,
        references,
        stage: references.length < MIN_REFERENCES ? 'references' : state.stage,
      };
    }
    case 'open-camera':
      return state.references.length >= MIN_REFERENCES ? { ...state, stage: 'camera' } : state;
    case 'captured':
      return state.stage === 'camera' && state.references.length >= MIN_REFERENCES
        ? { ...state, scene: action.photo, stage: 'review' }
        : state;
    case 'retake':
      // Keep the previous shot until the replacement is successfully captured.
      return state.scene && state.references.length >= MIN_REFERENCES
        ? { ...state, stage: 'camera' }
        : state;
    case 'back':
      return {
        ...state,
        stage: state.stage === 'review'
          ? 'references'
          : state.stage === 'camera' && state.scene
            ? 'review'
            : 'references',
      };
    case 'reset':
      return { references: [], scene: null, stage: 'references' };
  }
}
