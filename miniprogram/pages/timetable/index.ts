// @ts-nocheck
const { request } = require("../../utils/request");

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

Page({
  data: {
    currentGroupId: null,
    hasSemester: false,
    semester: null,
    week: 1,
    weekdays: ["一", "二", "三", "四", "五", "六", "日"],
    periods: [],
    courses: []
  },

  onShow() {
    this.loadTimetable();
  },

  async loadTimetable() {
    const groupId = getApp().globalData.currentGroupId;
    this.setData({ currentGroupId: groupId });
    if (!groupId) {
      this.setData({ hasSemester: false, courses: [], periods: [] });
      return;
    }
    try {
      const periods = await request(`/groups/${groupId}/periods`);
      let semester = null;
      try {
        semester = await request(`/groups/${groupId}/semesters/current`);
      } catch {
        this.setData({ periods, hasSemester: false, semester: null, courses: [] });
        return;
      }
      const courses = await request(`/groups/${groupId}/courses?week=${this.data.week}`);
      this.setData({ periods, semester, hasSemester: true, courses });
    } catch (error) {
      console.error("load timetable failed", error);
      wx.showToast({ title: "加载课程失败", icon: "none" });
    }
  },

  async createDefaultSemester() {
    const groupId = getApp().globalData.currentGroupId;
    if (!groupId) {
      wx.showToast({ title: "请先选择群组", icon: "none" });
      return;
    }
    const start = todayString();
    try {
      await request(`/groups/${groupId}/semesters`, {
        method: "POST",
        data: {
          name: "默认学期",
          start_date: start,
          end_date: addDays(start, 140)
        }
      });
      wx.showToast({ title: "已创建学期", icon: "success" });
      this.loadTimetable();
    } catch (error) {
      console.error("create semester failed", error);
      wx.showToast({ title: "创建学期失败", icon: "none" });
    }
  },

  refresh() {
    this.loadTimetable();
  },

  goCreateCourse() {
    if (!getApp().globalData.currentGroupId) {
      wx.showToast({ title: "请先选择群组", icon: "none" });
      return;
    }
    if (!this.data.hasSemester) {
      wx.showToast({ title: "请先创建学期", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/course-edit/index" });
  }
});


