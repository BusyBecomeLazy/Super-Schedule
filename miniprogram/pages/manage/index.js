const { refreshGroupAccess, refreshTabBar, setGroupAccess } = require("../../utils/access");
const { request } = require("../../utils/request");
const { clearStoredGroupId, clearStoredToken, getStoredGroupId, getStoredToken, setStoredGroupId } = require("../../utils/session");
const { connectGroupSocket } = require("../../utils/socket");

const roleOptions = [
  { value: "student", label: "学员", description: "只能查看课程表" },
  { value: "staff", label: "员工", description: "可管理日程，不能管理课程" },
  { value: "course_manager", label: "课程管理员", description: "可管理课程和日程" },
  { value: "super_admin", label: "超级管理员", description: "拥有成员、课程、日程全部权限" }
];

function normalizeRole(role) {
  if (role === "creator" || role === "admin") {
    return "super_admin";
  }
  if (role === "member") {
    return "staff";
  }
  return role || "student";
}

function roleIndex(role) {
  return Math.max(
    0,
    roleOptions.findIndex((item) => item.value === normalizeRole(role))
  );
}

function roleLabel(role) {
  return roleOptions[roleIndex(role)].label;
}

function roleDescription(role) {
  return roleOptions[roleIndex(role)].description;
}

function avatarInitial(name, fallback) {
  const text = String(name || fallback || "智").trim();
  return (text.slice(0, 1) || "智").toUpperCase();
}

function errorTitle(error, fallback) {
  if (error && typeof error === "object" && error.detail) {
    return String(error.detail).slice(0, 20);
  }
  if (typeof error === "string") {
    return error.slice(0, 20);
  }
  return fallback;
}

Page({
  data: {
    profileName: "智群用户",
    roleText: "未加入群组",
    groupSummary: "创建或加入群组后开始配置权限",
    memberEntryDesc: "先创建或加入群组",
    avatarInitial: "智",
    currentGroupId: null,
    access: null,
    canManageMembers: false,
    groups: [],
    members: [],
    groupsLoading: false,
    membersLoading: false,
    groupName: "",
    inviteCode: "",
    groupCreating: false,
    groupJoining: false,
    updatingMemberId: null,
    activeSheet: "",
    sheetTitle: "",
    sheetSubtitle: "",
    roleOptions
  },

  onShow() {
    if (!getStoredToken()) {
      this.clearSessionAndAccess();
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.loadHome();
  },

  onHide() {
    this.setCustomTabBarHidden(false);
  },

  onUnload() {
    this.setCustomTabBarHidden(false);
  },

  setCustomTabBarHidden(hidden) {
    if (typeof this.getTabBar === "function") {
      const tabBar = this.getTabBar();
      if (tabBar && typeof tabBar.setHidden === "function") {
        tabBar.setHidden(hidden);
      }
    }
    const methodName = hidden ? "hideTabBar" : "showTabBar";
    if (typeof wx[methodName] === "function") {
      wx[methodName]({
        animation: false,
        fail() {}
      });
    }
  },

  clearSessionAndAccess() {
    clearStoredToken();
    clearStoredGroupId();
    getApp().globalData.token = null;
    getApp().globalData.currentGroupId = null;
    getApp().globalData.user = null;
    setGroupAccess(null);
  },

  async loadHome() {
    try {
      const user = await this.loadUser();
      const groups = await request("/groups");
      let currentGroupId = getStoredGroupId();
      const currentIsValid = groups.some((group) => Number(group.id) === Number(currentGroupId));
      if ((!currentGroupId || !currentIsValid) && groups.length > 0) {
        currentGroupId = Number(groups[0].id);
        setStoredGroupId(currentGroupId);
        getApp().globalData.currentGroupId = currentGroupId;
      } else if (groups.length === 0) {
        currentGroupId = null;
        clearStoredGroupId();
        getApp().globalData.currentGroupId = null;
        setGroupAccess(null);
      }

      let access = null;
      if (currentGroupId) {
        access = await refreshGroupAccess(currentGroupId);
      }
      const currentGroup = groups.find((group) => Number(group.id) === Number(currentGroupId));
      const profileName = (user && user.nickname) || (access && `用户 ${access.user_id}`) || "智群用户";
      this.setData({
        profileName,
        avatarInitial: avatarInitial(profileName, access && access.user_id),
        roleText: access ? access.role_label : "未加入群组",
        groupSummary: currentGroup ? `当前群组：${currentGroup.name}` : "创建或加入群组后开始配置权限",
        memberEntryDesc: currentGroupId ? "管理成员角色和权限" : "先创建或加入群组",
        currentGroupId,
        access,
        canManageMembers: Boolean(access && access.permissions.can_manage_members),
        groups
      });
      refreshTabBar(this);
    } catch (error) {
      console.error("load manage home failed", error);
      wx.redirectTo({ url: "/pages/login/index" });
    }
  },

  async loadUser() {
    try {
      const app = getApp();
      if (app.globalData.user) {
        return app.globalData.user;
      }
      const user = await request("/users/me");
      app.globalData.user = user;
      return user;
    } catch (error) {
      console.error("load user failed", error);
      return null;
    }
  },

  openManageSheet(type) {
    const titles = {
      groups: ["群组管理", "创建、加入或切换当前使用的群组"],
      members: ["成员权限设置", "调整成员角色，并确保至少保留一名超级管理员"],
      dev: ["开发选项", "低频调试操作集中放在这里"]
    };
    const title = titles[type] || ["管理", ""];
    this.setCustomTabBarHidden(true);
    this.setData({
      activeSheet: type,
      sheetTitle: title[0],
      sheetSubtitle: title[1]
    });
  },

  closeManageSheet() {
    this.setCustomTabBarHidden(false);
    this.setData({
      activeSheet: "",
      sheetTitle: "",
      sheetSubtitle: "",
      groupCreating: false,
      groupJoining: false,
      updatingMemberId: null
    });
    this.loadHome();
  },

  goGroups() {
    this.openManageSheet("groups");
    this.loadGroups();
  },

  goMembers() {
    this.openManageSheet("members");
    this.loadAccessAndMembers();
  },

  goDevOptions() {
    this.openManageSheet("dev");
  },

  onGroupNameInput(event) {
    this.setData({ groupName: event.detail.value });
  },

  onInviteCodeInput(event) {
    this.setData({ inviteCode: event.detail.value });
  },

  async loadGroups() {
    this.setData({ groupsLoading: true });
    try {
      const groups = await request("/groups");
      this.setData({ groups });
      const currentGroupId = getStoredGroupId();
      const currentIsValid = groups.some((group) => Number(group.id) === Number(currentGroupId));
      if ((!currentGroupId || !currentIsValid) && groups.length > 0) {
        await this.setCurrentGroup(groups[0].id);
      } else if (groups.length === 0) {
        clearStoredGroupId();
        getApp().globalData.currentGroupId = null;
        setGroupAccess(null);
        this.setData({
          currentGroupId: null,
          access: null,
          canManageMembers: false,
          members: []
        });
        refreshTabBar(this);
        await this.loadHome();
      }
    } catch (error) {
      console.error("load groups failed", error);
      wx.redirectTo({ url: "/pages/login/index" });
    } finally {
      this.setData({ groupsLoading: false });
    }
  },

  async createGroup() {
    if (this.data.groupCreating) {
      return;
    }
    const name = this.data.groupName.trim();
    if (!name) {
      wx.showToast({ title: "请输入群组名称", icon: "none" });
      return;
    }
    this.setData({ groupCreating: true });
    try {
      const group = await request("/groups", { method: "POST", data: { name } });
      this.setData({ groupName: "" });
      await this.setCurrentGroup(group.id);
      await this.loadGroups();
      await this.loadHome();
      wx.showToast({ title: "已创建并选中", icon: "success" });
    } catch (error) {
      console.error("create group failed", error);
      wx.showToast({ title: "创建失败", icon: "none" });
    } finally {
      this.setData({ groupCreating: false });
    }
  },

  async joinGroup() {
    if (this.data.groupJoining) {
      return;
    }
    const inviteCode = this.data.inviteCode.trim();
    if (!inviteCode) {
      wx.showToast({ title: "请输入邀请码", icon: "none" });
      return;
    }
    this.setData({ groupJoining: true });
    try {
      const group = await request("/groups/join", {
        method: "POST",
        data: { invite_code: inviteCode }
      });
      this.setData({ inviteCode: "" });
      await this.setCurrentGroup(group.id);
      await this.loadGroups();
      await this.loadHome();
      wx.showToast({ title: "已加入并选中", icon: "success" });
    } catch (error) {
      console.error("join group failed", error);
      wx.showToast({ title: "加入失败", icon: "none" });
    } finally {
      this.setData({ groupJoining: false });
    }
  },

  async selectGroup(event) {
    const groupId = Number(event.currentTarget.dataset.id);
    await this.setCurrentGroup(groupId);
    await this.loadHome();
    wx.showToast({ title: "已切换群组", icon: "success" });
  },

  async setCurrentGroup(groupId) {
    setStoredGroupId(groupId);
    getApp().globalData.currentGroupId = groupId;
    this.setData({ currentGroupId: groupId });
    try {
      const access = await refreshGroupAccess(groupId);
      this.setData({
        access,
        canManageMembers: Boolean(access && access.permissions.can_manage_members)
      });
      refreshTabBar(this);
    } catch (error) {
      console.error("refresh group access failed", error);
    }
  },

  copyInviteCode(event) {
    const code = event.currentTarget.dataset.code;
    if (!code) {
      return;
    }
    wx.setClipboardData({ data: code });
  },

  async loadAccessAndMembers() {
    const groupId = getStoredGroupId();
    if (!groupId) {
      this.setData({ currentGroupId: null, access: null, canManageMembers: false, members: [], membersLoading: false });
      refreshTabBar(this);
      return;
    }
    this.setData({ currentGroupId: groupId, membersLoading: true });
    let access = null;
    try {
      access = await refreshGroupAccess(groupId);
    } catch (error) {
      console.error("load member access failed", error);
      this.setData({ access: null, canManageMembers: false, members: [], membersLoading: false });
      return;
    }
    const canManageMembers = Boolean(access && access.permissions.can_manage_members);
    this.setData({ access, canManageMembers, currentGroupId: groupId });
    refreshTabBar(this);
    if (!canManageMembers) {
      this.setData({ members: [], membersLoading: false });
      return;
    }
    try {
      connectGroupSocket(groupId, this.handleSocketMessage.bind(this));
      await this.loadMembers();
    } finally {
      this.setData({ membersLoading: false });
    }
  },

  handleSocketMessage(message) {
    const groupId = getStoredGroupId();
    if (!message || Number(message.group_id) !== Number(groupId)) {
      return;
    }
    const type = message.type || "";
    if (type === "group.member_joined" || type === "permissions.updated") {
      this.loadAccessAndMembers();
    }
  },

  async loadMembers() {
    const groupId = getStoredGroupId();
    if (!groupId) {
      return;
    }
    try {
      const members = await request(`/groups/${groupId}/members`);
      const currentUserId = this.data.access && this.data.access.user_id;
      const normalizedMembers = members.map((member) => ({
        ...member,
        role: normalizeRole(member.role)
      }));
      const superAdminCount = normalizedMembers.filter((member) => member.role === "super_admin").length;
      this.setData({
        members: normalizedMembers.map((member) => {
          const isSelf = Number(member.user_id) === Number(currentUserId);
          const locked = isSelf && member.role === "super_admin" && superAdminCount <= 1;
          const lockHint = locked ? "至少保留一名超级管理员" : "";
          const hint = roleDescription(member.role);
          const nickname = (member.user && member.user.nickname) || `用户 ${member.user_id}`;
          return {
            ...member,
            isSelf,
            roleLocked: locked,
            roleIndex: roleIndex(member.role),
            roleLabel: roleLabel(member.role),
            roleHint: hint,
            roleDesc: lockHint ? `${hint} · ${lockHint}` : hint,
            lockHint,
            nickname,
            avatarInitial: avatarInitial(nickname, member.user_id)
          };
        })
      });
    } catch (error) {
      console.error("load members failed", error);
      wx.showToast({ title: "加载成员失败", icon: "none" });
    }
  },

  async onRoleChange(event) {
    if (this.data.updatingMemberId) {
      wx.showToast({ title: "权限更新中", icon: "none" });
      return;
    }
    const memberId = Number(event.currentTarget.dataset.id);
    const role = roleOptions[Number(event.detail.value)].value;
    const groupId = getStoredGroupId();
    if (!memberId || !groupId) {
      return;
    }
    const member = this.data.members.find((item) => Number(item.id) === memberId);
    if (!member) {
      return;
    }
    if (member.roleLocked) {
      wx.showToast({ title: member.lockHint, icon: "none" });
      return;
    }
    if (member.role === role) {
      wx.showToast({ title: "权限未变化", icon: "none" });
      return;
    }
    const confirmed = await this.confirmRoleChange(member, role);
    if (!confirmed) {
      return;
    }
    this.setData({ updatingMemberId: memberId });
    try {
      await request(`/groups/${groupId}/members/${memberId}/role`, {
        method: "PATCH",
        data: { role }
      });
      wx.showToast({ title: "权限已更新", icon: "success" });
      if (member.isSelf) {
        await this.loadAccessAndMembers();
      } else {
        await this.loadMembers();
      }
      await this.loadHome();
    } catch (error) {
      console.error("update role failed", error);
      wx.showToast({ title: errorTitle(error, "权限更新失败"), icon: "none" });
    } finally {
      this.setData({ updatingMemberId: null });
    }
  },

  confirmRoleChange(member, nextRole) {
    const nextLabel = roleLabel(nextRole);
    if (member.role !== "super_admin" || nextRole === "super_admin") {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      wx.showModal({
        title: "确认调整权限",
        content: member.isSelf
          ? `你正在把自己的权限改为「${nextLabel}」，确认后可能会离开管理页。`
          : `确认把「${member.nickname}」从超级管理员改为「${nextLabel}」？`,
        confirmText: "确认",
        cancelText: "取消",
        success(result) {
          resolve(Boolean(result.confirm));
        },
        fail() {
          resolve(false);
        }
      });
    });
  },

  switchDevAccount() {
    wx.showModal({
      title: "切换开发账号",
      content: "当前登录状态会被清除，确认切换吗？",
      confirmText: "切换",
      cancelText: "取消",
      success: (result) => {
        if (!result.confirm) {
          return;
        }
        this.clearSessionAndAccess();
        this.setCustomTabBarHidden(false);
        wx.reLaunch({ url: "/pages/login/index" });
      }
    });
  }
});
