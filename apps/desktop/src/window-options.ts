export function browserWindowOptions(platform: NodeJS.Platform) {
  const mac = platform === "darwin";
  return {
    width: 1440,
    height: 900,
    backgroundColor: "#050506",
    show: true,
    autoHideMenuBar: true,
    frame: mac,
    titleBarStyle: mac ? ("hiddenInset" as const) : undefined,
    trafficLightPosition: mac ? { x: 16, y: 16 } : undefined,
  };
}
