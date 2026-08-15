import { useSyncExternalStore } from "react";

const KEY = "cowork.prefs";
const listeners = new Set<() => void>();

export type StreamSpeed = "normal" | "fast";

export interface UserPrefs {
  soundEnabled: boolean;
  streamSpeed: StreamSpeed;
}

const defaults: UserPrefs = { soundEnabled: true, streamSpeed: "fast" };
let snapshot: UserPrefs = defaults;

function emit() {
  for (const listener of listeners) listener();
}

function readStored(): UserPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<UserPrefs>;
    return {
      soundEnabled: parsed.soundEnabled !== false,
      streamSpeed: parsed.streamSpeed === "normal" ? "normal" : "fast",
    };
  } catch {
    return defaults;
  }
}

function remember(next: UserPrefs): UserPrefs {
  if (snapshot.soundEnabled === next.soundEnabled && snapshot.streamSpeed === next.streamSpeed) {
    return snapshot;
  }
  snapshot = next;
  return snapshot;
}

export function loadPrefs(): UserPrefs {
  return remember(readStored());
}

export function savePrefs(patch: Partial<UserPrefs>): UserPrefs {
  const next = remember({ ...loadPrefs(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / tests
  }
  emit();
  return next;
}

export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePrefs(): UserPrefs {
  return useSyncExternalStore(subscribePrefs, loadPrefs, () => defaults);
}

export function playCompletionChime() {
  if (typeof window === "undefined" || !loadPrefs().soundEnabled) return;
  const AudioCtx =
    window.AudioContext ||
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.value = 0.04;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
  osc.stop(ctx.currentTime + 0.2);
  void ctx.close().catch(() => undefined);
}
