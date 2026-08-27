# iOS Build Guide

_Last updated: 2026-08-27 (branch `claude/ios-build`)._

The app has only ever run on Expo web. This document covers getting it onto an
iOS simulator or device. Config is done; the only thing standing between you and
a running app is a full **Xcode.app** install (local path) or an **Expo
account** (cloud/EAS path).

---

## Current status

| Step | State |
|------|-------|
| `ios.bundleIdentifier` + iOS config in `app.json` | ✅ done — `com.cooperj.mindmarathon` |
| `expo-dev-client` + `expo-build-properties` added | ✅ done (`package.json`) |
| `eas.json` with `development` / `preview` / `production` profiles | ✅ done |
| `npx expo prebuild --platform ios` | ✅ succeeds — generates `/ios` (gitignored) |
| `pod install` | ✅ succeeds (needs `LANG=en_US.UTF-8`, see gotcha below) |
| `npx expo run:ios` (compile + launch in simulator) | ❌ **BLOCKED** — no full Xcode on this Mac |
| EAS cloud build | ⏸️ not attempted — needs `eas login` (Expo account) |

**Bottom line:** everything short of the actual native compile works. The
compile is blocked on tooling/credentials the user must provide.

---

## What the user must supply

### For a local build (fastest once unblocked)
1. **Install Xcode.app** from the Mac App Store (~15 GB). This machine currently
   only has the Command Line Tools:
   ```
   $ xcode-select -p
   /Library/Developer/CommandLineTools        # <-- not a full Xcode
   ```
2. Point the toolchain at it and accept the license:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -license accept
   xcodebuild -runFirstLaunch
   ```
3. Open Xcode once, let it install the iOS platform + a simulator runtime
   (Settings ▸ Components).

No paid Apple Developer account is required for the **simulator**. Running on a
**physical device** needs a free Apple ID added in Xcode (Settings ▸ Accounts)
for local signing, or the EAS path below.

### For an EAS cloud build (no Xcode needed)
1. A free **Expo account**: `npx eas login`
2. `npx eas init` — creates the EAS project and writes `extra.eas.projectId`
   into `app.json` (commit that).
3. For **device** builds (not simulator), EAS will prompt to create iOS
   credentials. A simulator build (`--profile development`) needs no Apple
   account at all; a device/TestFlight build needs a **paid Apple Developer
   Program membership** ($99/yr) and EAS can manage the certs/profiles for you.

---

## Local build — exact commands

```bash
cd /path/to/mind-marathon-app        # or the worktree
npm install                          # if node_modules isn't set up

# one-time (or after changing app.json / native deps):
npx expo prebuild --platform ios --clean

# CocoaPods on this Mac chokes on a non-UTF-8 locale — export this first:
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# compile + boot simulator + install the dev client:
npx expo run:ios
# or target a specific sim:
npx expo run:ios --device "iPhone 16 Pro"
```

`expo run:ios` starts the Metro bundler itself. On later runs you can just do
`npm start` (which runs `expo start --dev-client`) and press `i`, as long as the
dev-client build is already installed on the sim.

The app should launch to the **login screen** (`src/screens/LoginScreen.tsx`);
`useAuth` restores any stored session from the iOS keychain via
`expo-secure-store`.

## EAS build — exact commands

```bash
npx eas login
npx eas init                                   # writes projectId into app.json
npx eas build --profile development --platform ios   # simulator .app (no Apple acct)
#   or, for a real device / TestFlight:
npx eas build --profile preview     --platform ios
npx eas build --profile production  --platform ios
```

Install a simulator build: unzip the artifact and drag the `.app` onto a booted
simulator, or `eas build:run -p ios`. Install a device build via the QR
code / install link EAS gives you (internal distribution).

---

## Config reference (what changed on this branch)

### `app.json`
- `ios.bundleIdentifier`: `com.cooperj.mindmarathon` (also set `android.package` to match)
- `ios.buildNumber`: `"1"`
- `ios.infoPlist.ITSAppUsesNonExemptEncryption`: `false` — skips the App Store
  export-compliance prompt (the app only uses standard HTTPS/TLS).
- top-level `scheme`: `mindmarathon` — required by `expo-dev-client` for deep links.
- `plugins`: `expo-dev-client`, `expo-secure-store`, `expo-build-properties`
  (iOS `deploymentTarget` pinned to `16.4` — **SDK 56 / RN 0.85 rejects anything lower**).
- `name` changed to `Mind Marathon` (was `mind-marathon-app`).

### `package.json`
- `+ expo-dev-client`, `+ expo-build-properties`
- `scripts.ios` / `scripts.android` now `expo run:*` (was `expo start --*`),
  which is correct for a dev-client workflow.

### `eas.json` (new)
- `development` — dev client, internal distribution, **`ios.simulator: true`**
- `development-device` — same but for a physical device
- `preview` — internal distribution, release build
- `production` — store build, `autoIncrement`

---

## Native-module notes (SDK 56 / RN 0.85)

All three native deps that could have been trouble are fine:
- **react-native-svg** (`15.15.4`, used in `BoardView.tsx`) — autolinks, no config.
- **expo-secure-store** — config plugin added; default keychain access, no Face ID
  prompt (we don't set `requireAuthentication`).
- **react-native-screens** / **react-native-safe-area-context** — autolink cleanly.
- `pod install` reports "Unexpected XCode version string ''" — that is only
  because `xcodebuild` isn't resolvable yet; it resolves once real Xcode is set.

## Known pre-existing issues (not iOS-specific, not fixed here)

`npx expo-doctor` flags two things that predate this work and are out of scope:
- **Hermes V1 memory regression** in `expo@56.0.5` / RN 0.85 — fix is to move to
  SDK 57. Deliberately not done on this branch.
- Minor/patch version drift: `expo`, `@expo/metro-runtime`,
  `react-native-screens`, `react-native-safe-area-context` are slightly behind
  what SDK 56 wants. Run `npx expo install --check` to align when ready.

## Push notifications (roadmap B4)

This dev build is the prerequisite. Once a dev/EAS build runs on a real device:
add `expo-notifications`, register for a push token on login, store it on
`profiles.push_token`, and send from an `end_turn` DB webhook → Expo Push API.
Expo Go cannot get an iOS push token, which is why B4 was blocked until now.
