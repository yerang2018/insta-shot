# Native camera phase — planned, not implemented

## Accepted direction

Keep the existing Expo project. First measure Gemini Live feedback on the phone, then add local frame analysis for fast, observable adjustments. Do not present either a timer change or frame upload as on-device vision.

## Current prerequisite

On 2026-11-04, `xcode-select -p` returned `/Library/Developer/CommandLineTools`. A full Xcode installation/build environment was not established. Expo Go cannot load a new VisionCamera/native frame-processing module. A development build of THIS app is required; do not scaffold a replacement app. Ask about the installation/build route after obtaining the phone Live result. Do not enable paid Apple/Expo/Google services without explicit authorization.

## Implementation sequence

1. Verify Live overlay timing, shutter, front/back camera lifecycle, stop, and foreground/background on physical iPhone. Current path still samples with expo-camera `takePictureAsync` and can introduce capture overhead/shutter effects.
2. Establish Xcode and signing for a local development build or a user-authorized alternative. Preserve source and local-only config before generating native directories. Build the existing app before migrating the camera.
3. Replace the camera surface with a native frame source (evaluate current compatible VisionCamera release; use current APIs, not older frame-processor snippets). Obtain frame data, rotation/crop coordinates, timestamps, camera capabilities, and exposure bias. Keep last-frame-only processing and bounded buffers.
4. Add on-device measurements: person bounding box and pose landmarks (Vision/Core ML or a verified compatible detector), orientation/tilt, clipping/brightness histogram. Do not claim these measure physical camera height or absolute depth from one frame.
5. Gemini extracts candidate target scenes from the 1–10 references. User chooses a target if needed. Local feedback compares observable features against that target with confidence thresholds, hysteresis and stable timing. Rule-generated feedback must be distinguished from a fresh AI scene interpretation. Avoid alternating contradictory instructions.
6. Exposure guidance combines actual camera bias/capabilities and clipping measurements. Clamp manual controls to device ranges; recommendations are proposed adjustments, not a universal exposure target inferred from a reference JPEG.
7. Measure device latency, heat, battery and false instructions; publish measured results separately from targets. Subsecond local feedback is a goal, not a current claim.

## Sources consulted

- https://visioncamera.margelo.com/docs/visioncamera-vs-expo-camera
- https://visioncamera.margelo.com/docs/exposure-bias
- https://developer.apple.com/documentation/createml/detecting-human-actions-in-a-live-video-feed
- https://aistudio.google.com/docs/live-api/capabilities

## Data boundary

The user's current Gemini API is unpaid. Do not upload identifiable faces/personal information in phone tests. Local processing does not make an uploaded reference or Live frame local. Decide the provider data-handling route before testing the eventual portrait use case.
