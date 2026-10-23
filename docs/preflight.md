# RoomSmith preflight

Recorded 2026-10-23 for the initial local foundation. This is a workstation record, not a native-device, playtest, or release certification.

## Available and exercised

| Capability | Recorded version/state |
| --- | --- |
| Node.js / pnpm | Node 22.22.3; pnpm 10.17.1 through Corepack |
| TypeScript / tests | TypeScript 5.9.3; Vitest 5.0.5 |
| Kotlin compiler | Official npm `kotlin-compiler` 2.4.21, pinned and lockfile-controlled |
| Java runtime | Temurin 17.0.9+9, sufficient for the pure Kotlin compiler harness |
| Schema validation | Ajv 2020 8.20.0 and ajv-formats 3.0.1 |

The pure Kotlin harness compiles domain/main/test sources without Gradle. Set `JAVA_HOME` or put Java 17 on `PATH`. This produces test/domain JARs only, not Android or Fire OS packages.

## Blocked or not implemented

- Full JDK/javac, Android/Fire OS SDKs, signing, Fire TV and Android devices or permitted simulators.
- CameraX, MediaPipe, OpenCV, printable PlayMat, object kit, and real physical interactions.
- WebRTC DataChannels, SDP/ICE signaling, TURN, cloud fallback, pairing, and revocation services.
- AWS director/content services, signed assets/bundles, full solver verification, and publication.
- Illustrated rendering, playtests, accessibility studies, performance/false-accept campaigns, and release evidence.

The `apps/`, `services/`, `packages/perception/`, and `infra/` directories are placeholders except for the documented domain/compiler code.

## First local checks

```bash
node --version
java -version
make bootstrap
make lint typecheck test-unit test-contract test-security build
corepack pnpm validate:content
make dev
```

Publication preflight must reject the current draft. Fixture remote completion is not evidence of camera perception, WebRTC, offline app behavior, or physical playability.
