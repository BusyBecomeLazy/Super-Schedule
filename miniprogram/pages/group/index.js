const { request } = require("../../utils/request");
const { clearStoredGroupId, getStoredGroupId, setStoredGroupId } = require("../../utils/session");

Page({
  data: {
    groupName: "",
    inviteCode: "",
    groups: [],
    currentGroupId: null
  },

  onShow() {
    this.setData({ currentGroupId: getStoredGroupId() });
    this.loadGroups();
  },

  onGroupNameInput(event) {
    this.setData({ groupName: event.detail.value });
  },

  onInviteCodeInput(event) {
    this.setData({ inviteCode: event.detail.value });
  },

  async loadGroups() {
    try {
      const groups = await request("/groups");
      this.setData({ groups });
      const currentGroupId = getStoredGroupId();
      const currentIsValid = groups.some((group) => Number(group.id) === Number(currentGroupId));
      if ((!currentGroupId || !currentIsValid) && groups.length > 0) {
        this.setCurrentGroup(groups[0].id);
      } else if (groups.length === 0) {
        clearStoredGroupId();
        getApp().globalData.currentGroupId = null;
        this.setData({ currentGroupId: null });
      }
    } catch (error) {
      console.error("load groups failed", error);
      wx.redirectTo({ url: "/pages/login/index" });
    }
  },

  async createGroup() {
    const name = this.data.groupName.trim();
    if (!name) {
      wx.showToast({ title: "请输入群组名称", icon: "none" });
      return;
    }
    try {
      const group = await request("/groups", { method: "POST", data: { name } });
      this.setData({ groupName: "" });
      this.setCurrentGroup(group.id);
      await this.loadGroups();
      wx.showToast({ title: "已创建并选中", icon: "success" });
    } catch (error) {
      console.error("create group failed", error);
      wx.showToast({ title: "创建失败", icon: "none" });
    }
  },

  async joinGroup() {
    const inviteCode = this.data.inviteCode.trim();
    if (!inviteCode) {
      wx.showToast({ title: "请输入邀请码", icon: "none" });
      return;
    }
    try {
      const group = await request("/groups/join", {
        method: "POST",
        data: { invite_code: inviteCode }
      });
      this.setData({ inviteCode: "" });
      this.setCurrentGroup(group.id);
      await this.loadGroups();
      wx.showToast({ title: "已加入并选中", icon: "success" });
    } catch (error) {
      console.error("join group failed", error);
      wx.showToast({ title: "加入失败", icon: "none" });
    }
  },

  selectGroup(event) {
    const groupId = Number(event.currentTarget.dataset.id);
    this.setCurrentGroup(groupId);
    wx.showToast({ title: "已切换群组", icon: "success" });
  },

  setCurrentGroup(groupId) {
    setStoredGroupId(groupId);
    getApp().globalData.currentGroupId = groupId;
    this.setData({ currentGroupId: groupId });
  }
});
