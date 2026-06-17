const TOKEN_KEY = "zhiqun_token";
const GROUP_ID_KEY = "zhiqun_current_group_id";

export function getStoredToken(): string | null {
  return wx.getStorageSync(TOKEN_KEY) || null;
}

export function setStoredToken(token: string): void {
  wx.setStorageSync(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  wx.removeStorageSync(TOKEN_KEY);
}

export function getStoredGroupId(): number | null {
  const value = wx.getStorageSync(GROUP_ID_KEY);
  return value ? Number(value) : null;
}

export function setStoredGroupId(groupId: number): void {
  wx.setStorageSync(GROUP_ID_KEY, groupId);
}

export function clearStoredGroupId(): void {
  wx.removeStorageSync(GROUP_ID_KEY);
}
