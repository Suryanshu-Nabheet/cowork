import * as Notifications from "expo-notifications";
import { rpc } from "./api";

export async function registerPushToken() {
  const existing = await Notifications.getPermissionsAsync();
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;
  try {
    const projectId = process.env.EXPO_PUBLIC_PROJECT_ID;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : {})).data;
    if (!token) return;
    await rpc("notifications/registerPush", { token });
  } catch {
    // Expo Go cannot mint an ExponentPushToken without an EAS project id.
  }
}
