const { API_BASE_URL } = require("./config");
const { clearStoredGroupId, clearStoredToken, getStoredToken } = require("./session");

const DEFAULT_PERMISSIONS = {
  can_view_courses: true,
  can_manage_courses: false,
  can_view_events: false,
  can_manage_events: false,
  can_manage_members: false,
  can_view_management: false
};

let authRedirecting = false;

function resetAuthState() {
  clearStoredToken();
  clearStoredGroupId();
  try {
    const app = getApp();
    app.globalData.token = null;
    app.globalData.currentGroupId = null;
    app.globalData.user = null;
    app.globalData.groupAccess = null;
    app.globalData.permissions = { ...DEFAULT_PERMISSIONS };
  } catch {
    // getApp may be unavailable during early startup.
  }
}

function handleUnauthorized(path) {
  if (path === "/auth/wechat-login") {
    return;
  }
  resetAuthState();
  if (authRedirecting) {
    return;
  }
  authRedirecting = true;
  wx.showToast({ title: "登录已过期", icon: "none" });
  setTimeout(() => {
    wx.reLaunch({
      url: "/pages/login/index",
      complete() {
        authRedirecting = false;
      }
    });
  }, 300);
}

function request(path, options = {}) {
  const token = getStoredToken();
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${path}`,
      method: options.method || "GET",
      data: options.data,
      header: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        if (response.statusCode === 401) {
          handleUnauthorized(path);
        }
        reject(response.data || response.errMsg);
      },
      fail: reject
    });
  });
}

module.exports = {
  request
};
