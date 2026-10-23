# RoomSmith dependencies

## Locked local toolchain

- Node.js 22.x, Corepack, and pnpm 10.17.1.
- TypeScript 5.9.3, ESLint 10.13.0, Prettier 3.6.2, and Vitest 5.0.5.
- Ajv 8.20.0 and ajv-formats 3.0.1.
- Official npm `kotlin-compiler` 2.4.21 for the pure Kotlin harness.
- Java 17 runtime supplied by the workstation; not a bundled Android JDK.

All npm packages are development dependencies in this phase. `pnpm-lock.yaml` controls the resolved graph, and only `esbuild` install scripts are explicitly allowed. No Gradle, Android, WebRTC, TURN, or AWS dependency graph has been introduced.

## Security audit

The first audit found Vitest/Tinypool and Ajv advisories. Vitest was updated from 3.2.4 to 5.0.5 and Ajv from 8.17.1 to 8.20.0. After lockfile updates and test reruns, this command reported no known vulnerabilities on 2026-10-23:

```bash
corepack pnpm audit --audit-level=moderate
```

The audit does not cover the external Java runtime or absent native/cloud dependencies. License, native supply-chain, transport, and release security reviews remain separate gates.

## External dependencies still blocked

Fire OS/Android SDKs and devices, CameraX/MediaPipe/OpenCV, WebRTC/TURN/signaling, Bedrock, Polly, signed content storage, and credentials remain absent. The pure Kotlin compiler is not evidence that native application dependencies are available.
