const { request } = require("../../utils/request");
const { setStoredToken } = require("../../utils/session");
const { setGroupAccess } = require("../../utils/access");

const devAccounts = [
  { openid: "dev_local_user", nickname: "开发管理员" },
  { openid: "dev_test_user_a", nickname: "测试账号A" },
  { openid: "dev_test_user_b", nickname: "测试账号B" },
  { openid: "dev_test_user_c", nickname: "测试账号C" }
];

Page({
  data: {
    devAccounts,
    selectedAccountIndex: 0,
    selectedAccountName: devAccounts[0].nickname
  },

  selectAccount(event) {
    const index = Number(event.currentTarget.dataset.index);
    const account = devAccounts[index];
    if (!account) {
      return;
    }
    this.setData({
      selectedAccountIndex: index,
      selectedAccountName: account.nickname
    });
  },

  async login() {
    const account = devAccounts[this.data.selectedAccountIndex] || devAccounts[0];
    try {
      const response = await request("/auth/wechat-login", {
        method: "POST",
        data: {
          dev_openid: account.openid,
          nickname: account.nickname
        }
      });
      setStoredToken(response.access_token);
      getApp().globalData.token = response.access_token;
      getApp().globalData.user = response.user;
      setGroupAccess(null);
      wx.switchTab({ url: "/pages/manage/index" });
    } catch (error) {
      console.error("login failed", error);
      wx.showToast({ title: "登录失败", icon: "none" });
    }
  }
});
