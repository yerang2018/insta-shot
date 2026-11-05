# Insta Shot

레퍼런스 사진처럼 구도와 포즈를 맞춰 촬영하는 Expo 앱입니다. 기존 프로젝트를 이어서 개발합니다.

- 레퍼런스 1–10장 선택, 반투명 겹치기·이동·확대·진하기 조절
- 촬영, 비교, 앨범 저장
- 선택 기능: Gemini 분석 및 카메라 위 Live 안내 (기본 꺼짐)

## 처음 실행

컴퓨터에 Git, Node.js 22.13 이상인 22 버전, 휴대폰에 Expo Go가 필요합니다. iPhone의 Expo Go가 이 프로젝트의 SDK 58을 지원해야 합니다.

저장소를 내려받아 해당 폴더에서 실행합니다.

```sh
npm ci
npm run setup:analysis
npm start -- --go --lan
```

컴퓨터와 본인 휴대폰을 같은 와이파이에 연결하고 Expo QR을 엽니다. 두 개발자가 서로 다른 집에 있어도 각자의 컴퓨터와 휴대폰으로 실행하면 됩니다. 상대방 집의 QR을 그대로 사용하는 구성은 아닙니다.

사진 겹치기·촬영은 Gemini 키 없이 사용할 수 있습니다. 카메라와 저장의 실제 동작은 휴대폰에서 확인하세요.

## AI 기능도 실행하기

1. `npm run setup:analysis`가 만든 `server/.env.local`을 편집기에서 엽니다.
2. 본인의 Gemini API 키를 `GEMINI_API_KEY=` 뒤에 넣고 저장합니다. 키를 채팅이나 GitHub에 올리지 않습니다.
3. 별도 터미널에서 실행합니다.

```sh
npm run server
```

Expo와 AI 서버를 둘 다 켜 둡니다. 각자 생성한 `.env.local`과 `server/.env.local`을 사용하며 파일을 서로 보내지 않습니다. 로컬 개발용 서버이며 인터넷에 공개 배포하도록 보안 설계된 서비스는 아닙니다. AI를 켜고 앱에서 전송을 확인해야 사진을 보냅니다. 자세한 내용은 [서버 안내](server/README.md)를 확인하세요.

## 수정과 검사

[협업 안내](COLLABORATION.md)에 따라 본인 브랜치에서 수정하세요. Codex·Claude Code에는 먼저 AGENTS.md와 HANDOFF.md를 읽도록 요청하세요.

```sh
npm run typecheck
npm test
```

현재 iPhone 테스트가 필요한 사항과 구현 범위는 [HANDOFF.md](HANDOFF.md)에 기록합니다.
