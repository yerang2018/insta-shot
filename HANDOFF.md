# Development handoff

Read AGENTS.md and COLLABORATION.md before changes. Continue this existing project; do not scaffold a replacement.

## Current product
- Expo SDK 58 camera app; 1–10 references, local translucent reference overlay, capture/review/save, optional Gemini analysis and Live instructions.
- Default: overlay visible, AI off. Overlay supports selection, opacity, pan/pinch, placement lock and temporary hide. It is display-only; captures come from CameraView and album save uses the capture URI.
- Keep provider API keys in server/.env.local; setup:analysis creates independent local pairing/config files. Do not share .env files, photos, or local session notes.
- Optional Live: phone -> local Node WebSocket gateway -> Gemini. About one snapshot per 1.2 s (gateway max 1 fps), refs once, one instruction at a time, 60-second sessions, six starts/hour/process. No microphone or audio playback; generated audio transcript becomes text. No automatic reconnect.
- Cloud guidance still takes seconds. Native local ML remains planned, not implemented. Free API testing must respect the consent shown in the app; no billing changes authorized.

## Recent fixes and evidence
- React sibling keys for overlay and Live are now distinct.
- Explicit camera recovery button and Live control zIndex; scrollable consent dialog.
- Gateway accepts same-target HTTP Origin for native LAN sockets; still requires pairing and rejects unrelated browser Origins. Sanitized end codes and numeric close codes only; no raw provider reasons/media/keys in logs.
- User confirmed Live works after connection fixes; then reported distracting flicker.
- Latest flicker changes: animateShutter=false, flash=off, shutter button no longer pulses opacity per sample; only completed AI instructions displayed, with reserved text height. Physical improvement remains unconfirmed. Still-photo sampling can cause device-specific preview interruptions.
- Latest automated checks before collaboration work: typecheck and 20 tests passed. These do not prove phone gestures, saved-photo exclusion, touch handling or visual smoothness.

## Collaboration
- main is the agreed shared version. Use separate work branches and Pull Requests; never assume edits are automatically shared.
- Local runtime addresses/process IDs differ per computer and are not shared configuration. Each person runs their own Expo and backend with their own local credentials.
- Historical local-only development notes are preserved under ignored local-notes/ on the original computer.
