import { WS_BASE_URL } from "./config";
import { getStoredToken } from "./session";

let socketTask: WechatMiniprogram.SocketTask | null = null;

export function connectGroupSocket(
  groupId: number,
  onMessage: (payload: Record<string, unknown>) => void
): void {
  const token = getStoredToken();
  if (!token) {
    return;
  }
  if (socketTask) {
    socketTask.close({});
  }
  socketTask = wx.connectSocket({
    url: `${WS_BASE_URL}/ws/groups/${groupId}?token=${encodeURIComponent(token)}`
  });
  socketTask.onMessage((event) => {
    try {
      onMessage(JSON.parse(event.data as string));
    } catch {
      // Ignore malformed messages in MVP.
    }
  });
}

export function closeGroupSocket(): void {
  if (socketTask) {
    socketTask.close({});
    socketTask = null;
  }
}

