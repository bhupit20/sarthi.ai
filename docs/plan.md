# SARTHI.AI: Mac desktop plan

Date: 2026-11-18. Owner request: turn the Meet Reply Assistant Chrome extension
(`bhupit20/GMeet-ai`, kept unchanged) into a Mac desktop app, add the useful
features of the competitor ParakeetAI, and use the KRAFTDASH visual style.

## Why

The owner understands clients but is slow to form English sentences on live
calls (English is the second language, Hindi the first). SARTHI.AI listens to
the call and shows ready-to-say replies, remembers each client, and turns the
owner's Hindi answers into natural English.

## What the desktop version adds

| Need | Extension | SARTHI.AI |
|---|---|---|
| Hearing the client | Reads Google Meet captions (Meet only, captions must be on) | Listens to the call audio itself: works with Meet, Zoom, Teams, any app |
| Who is speaking | Meet speaker names; owner sets "My name in Meet" | System audio = client, microphone = owner. No setup |
| Speech to text | Meet's captions | Whisper on the Mac. Free, private, no key |
| Screen sharing | Panel inside Chrome | Floating copilot window marked hidden from capture, plus clear guidance |
| Shortcuts | Alt+S in Chrome | Global: works while Meet/Zoom has focus |
| API keys | Browser storage | macOS Keychain (Electron safeStorage); AI calls from the main process |

Kept from the extension: Claude, Gemini, OpenAI and NVIDIA with fallback;
Short / Detailed / Safe replies in spoken, human English; Hindi answer
translation; prepared answers; small-talk skipping; clients with notes;
after-meeting summary and phrases to practise.

## Decisions (with the reason)

- **Electron + React + TypeScript**, bundled with esbuild, tested with Vitest
  and Playwright. Reuses the extension's tested logic. Electron 39 captures
  system audio on macOS 14.2+ through the CoreAudio tap.
- **Local Whisper (`onnx-community/whisper-base.en`) through transformers.js**
  in a worker, WebGPU when available. Tested on a real recording: exact text
  with punctuation. Moonshine was faster but drops punctuation, which the
  question detection needs. About 80 MB, downloaded once.
- **Utterances from audio:** an energy-based voice detector cuts each stream
  at pauses; each utterance is transcribed and becomes a transcript line.
  Lines heard on the microphone that repeat what the client just said (echo
  from speakers) are dropped.
- **Two windows:** the dashboard (sidebar app in the KRAFTDASH style) runs the
  session; the copilot overlay mirrors it over IPC and sends actions back.
- **Screen sharing:** `setContentProtection(true)` on the copilot. Electron
  documents that ScreenCaptureKit-based capture on macOS 15+ can still see such
  windows, so the app also tells the owner to share a window or tab.
- **Not built:** hiding from Activity Monitor or the Dock (no user value for
  client calls), question banks, mock interviews.

## Phases

1. Project, shared core ported from the extension with its tests.
2. Audio core: resampling, voice detector, echo filter (unit tested).
3. Main process: windows, Keychain keys, AI over IPC, system-audio handler,
   global shortcuts, permissions.
4. Dashboard and copilot UI in the KRAFTDASH style.
5. End-to-end test in Electron under a virtual display, including a fake
   microphone playing a real recording through the whole pipeline.
6. Mac packaging (electron-builder, entitlements, usage descriptions) and guide.
7. Next: "Ask about my screen" (screenshot to a vision model).

## Cannot be verified from the build machine (Linux)

macOS permissions prompts, system-audio capture on a real Mac, whether a given
meeting app shows the copilot while sharing, signing and notarisation.
