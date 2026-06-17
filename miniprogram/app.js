const { getStoredToken, getStoredGroupId } = require("./utils/session");

App({
  globalData: {
    token: getStoredToken(),
    currentGroupId: getStoredGroupId(),
    user: null,
    groupAccess: null,
    permissions: {
      can_view_courses: true,
      can_manage_courses: false,
      can_view_events: false,
      can_manage_events: false,
      can_manage_members: false,
      can_view_management: false
    }
  }
});
