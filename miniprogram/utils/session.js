const TOKEN_KEY = "zhiqun_token";
const GROUP_ID_KEY = "zhiqun_current_group_id";

function getStoredToken() {
  return wx.getStorageSync(TOKEN_KEY) || null;
}

function setStoredToken(token) {
  wx.setStorageSync(TOKEN_KEY, token);
}

function clearStoredToken() {
  wx.removeStorageSync(TOKEN_KEY);
}

function getStoredGroupId() {
  const value = wx.getStorageSync(GROUP_ID_KEY);
  return value ? Number(value) : null;
}

function setStoredGroupId(groupId) {
  wx.setStorageSync(GROUP_ID_KEY, groupId);
}

function clearStoredGroupId() {
  wx.removeStorageSync(GROUP_ID_KEY);
}

module.exports = {
  getStoredToken,
  setStoredToken,
  clearStoredToken,
  getStoredGroupId,
  setStoredGroupId,
  clearStoredGroupId
};
