export interface CoWorkDesktop {
  platform: string;
  window: {
    close: () => Promise<void>;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    state: () => Promise<{ minimized: boolean; maximized: boolean; fullScreen: boolean }>;
  };
}

declare global {
  interface Window {
    coworkDesktop?: CoWorkDesktop;
  }
}

export function desktopBridge(): CoWorkDesktop | undefined {
  return typeof window === "undefined" ? undefined : window.coworkDesktop;
}

export function windowChromeKind(desktop?: CoWorkDesktop): "spacer" | "darwin" | "controls" {
  if (!desktop) return "spacer";
  if (desktop.platform === "darwin") return "darwin";
  return "controls";
}
