function currentRoute() {
  const pages = getCurrentPages();
  if (!pages.length) {
    return "";
  }
  return `/${pages[pages.length - 1].route}`;
}

function buildTabs() {
  const app = getApp();
  const permissions = app.globalData.permissions || {};
  const hasGroup = Boolean(app.globalData.currentGroupId);
  const tabs = [];
  if (permissions.can_view_events) {
    tabs.push({ pagePath: "/pages/calendar/index", text: "日程", icon: "calendar" });
  }
  if (permissions.can_view_courses !== false) {
    tabs.push({ pagePath: "/pages/course/index", text: "课程表", icon: "course" });
  }
  if (!hasGroup || permissions.can_view_management) {
    tabs.push({ pagePath: "/pages/manage/index", text: "管理", icon: "manage" });
  }
  return tabs;
}

Component({
  data: {
    list: [],
    selectedPath: "",
    hidden: false
  },

  lifetimes: {
    attached() {
      this.refresh();
    }
  },

  pageLifetimes: {
    show() {
      this.refresh();
    }
  },

  methods: {
    refresh() {
      this.setData({
        list: buildTabs(),
        selectedPath: currentRoute()
      });
    },

    switchTab(event) {
      const path = event.currentTarget.dataset.path;
      if (!path || path === this.data.selectedPath) {
        return;
      }
      wx.switchTab({ url: path });
    },

    setHidden(hidden) {
      this.setData({ hidden: Boolean(hidden) });
    }
  }
});
