const { request } = require("./request");

const DEFAULT_PERMISSIONS = {
  can_view_courses: true,
  can_manage_courses: false,
  can_view_events: false,
  can_manage_events: false,
  can_manage_members: false,
  can_view_management: false
};

function getAppInstance() {
  try {
    return getApp();
  } catch {
    return null;
  }
}

function setGroupAccess(access) {
  const app = getAppInstance();
  if (!app) {
    return;
  }
  app.globalData.groupAccess = access || null;
  app.globalData.permissions = access ? access.permissions : { ...DEFAULT_PERMISSIONS };
}

async function refreshGroupAccess(groupId) {
  if (!groupId) {
    setGroupAccess(null);
    return null;
  }
  const access = await request(`/groups/${groupId}/me`);
  setGroupAccess(access);
  return access;
}

function getPermissions() {
  const app = getAppInstance();
  return (app && app.globalData.permissions) || { ...DEFAULT_PERMISSIONS };
}

function refreshTabBar(page) {
  if (!page || typeof page.getTabBar !== "function") {
    return;
  }
  const tabBar = page.getTabBar();
  if (tabBar && typeof tabBar.refresh === "function") {
    tabBar.refresh();
  }
}

module.exports = {
  DEFAULT_PERMISSIONS,
  getPermissions,
  refreshGroupAccess,
  refreshTabBar,
  setGroupAccess
};
