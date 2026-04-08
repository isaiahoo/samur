// SPDX-License-Identifier: AGPL-3.0-only
import vkBridge from "@vkontakte/vk-bridge";

export { vkBridge };

export interface VkGeodata {
  lat: number;
  long: number;
  available: boolean;
}

export interface VkUserInfo {
  id: number;
  first_name: string;
  last_name: string;
  photo_100: string;
}

export async function getGeodata(): Promise<VkGeodata | null> {
  try {
    const result = await vkBridge.send("VKWebAppGetGeodata");
    if (result.available) {
      return { lat: result.lat, long: result.long, available: true };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getUserInfo(): Promise<VkUserInfo | null> {
  try {
    const result = await vkBridge.send("VKWebAppGetUserInfo");
    return result as unknown as VkUserInfo;
  } catch {
    return null;
  }
}

export async function allowNotifications(): Promise<boolean> {
  try {
    const result = await vkBridge.send("VKWebAppAllowNotifications");
    return result.result;
  } catch {
    return false;
  }
}

export async function shareApp(message: string): Promise<void> {
  try {
    await vkBridge.send("VKWebAppShare", { link: message });
  } catch {
    // User cancelled or not supported
  }
}

export async function shareToWall(message: string, link: string): Promise<void> {
  try {
    await vkBridge.send("VKWebAppShowWallPostBox", {
      message,
      attachments: link,
    });
  } catch {
    // User cancelled
  }
}

export function getLaunchParams(): string {
  return window.location.search.slice(1);
}

export function getVkPlatform(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("vk_platform") ?? "desktop_web";
}
