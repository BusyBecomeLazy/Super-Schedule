// @ts-nocheck
const { request } = require("../../utils/request");
const { refreshGroupAccess } = require("../../utils/access");
const { toastTitle } = require("../../utils/errors");

function goBackToCourse() {
  setTimeout(() => {
    wx.switchTab({ url: "/pages/course/index" });
  }, 350);
}

Page({
  data: {
    isEdit: false,
    courseId: null,
    version: null,
    pageTitle: "新建课程",
    submitText: "保存课程",
    semester: null,
    periods: [],
    periodLabels: ["1节", "2节"],
    weekdays: ["一", "二", "三", "四", "五", "六", "日"],
    weekdayIndex: 0,
    startPeriodIndex: 0,
    endPeriodIndex: 1,
    name: "",
    teacher: "",
    location: "",
    weekStart: "1",
    weekEnd: "16"
  },

  async ensureCanManageCourses() {
    const groupId = getApp().globalData.currentGroupId;
    if (!groupId) {
      wx.showToast({ title: "请先选择群组", icon: "none" });
      return false;
    }
    try {
      const access = await refreshGroupAccess(groupId);
      if (!access.permissions.can_manage_courses) {
        wx.showToast({ title: "没有课程管理权限", icon: "none" });
        return false;
      }
      return true;
    } catch (error) {
      console.error("check course permission failed", error);
      wx.showToast({ title: "权限校验失败", icon: "none" });
      return false;
    }
  },

  onLoad(options) {
    if (options && options.course_id) {
      this.setData({
        isEdit: true,
        courseId: Number(options.course_id),
        pageTitle: "编辑课程",
        submitText: "保存修改"
      });
    }
  },

  onShow() {
    this.loadContext();
  },

  async loadContext() {
    if (!(await this.ensureCanManageCourses())) {
      wx.switchTab({ url: "/pages/course/index" });
      return;
    }
    const groupId = getApp().globalData.currentGroupId;
    if (!groupId) {
      wx.showToast({ title: "请先选择群组", icon: "none" });
      return;
    }
    try {
      const semester = await request(`/groups/${groupId}/semesters/current`);
      const periods = await request(`/groups/${groupId}/periods`);
      const periodLabels = periods.map((period) => `${period.period_index}节`);
      this.setData({
        semester,
        periods,
        periodLabels,
        endPeriodIndex: Math.min(1, Math.max(0, periods.length - 1))
      });
      if (this.data.isEdit) {
        await this.loadCourse(groupId, periods);
      }
    } catch (error) {
      console.error("load course context failed", error);
      wx.showToast({ title: "请先创建学期", icon: "none" });
    }
  },

  async loadCourse(groupId, periods) {
    try {
      const course = await request(`/groups/${groupId}/courses/${this.data.courseId}`);
      const startPeriodIndex = Math.max(
        0,
        periods.findIndex((period) => period.period_index === course.start_period)
      );
      const endPeriodIndex = Math.max(
        startPeriodIndex,
        periods.findIndex((period) => period.period_index === course.end_period)
      );
      this.setData({
        name: course.name || "",
        teacher: course.teacher || "",
        location: course.location || "",
        weekdayIndex: Math.max(0, (course.day_of_week || 1) - 1),
        startPeriodIndex,
        endPeriodIndex,
        weekStart: String(course.week_start || 1),
        weekEnd: String(course.week_end || 16),
        version: course.version
      });
    } catch (error) {
      console.error("load course failed", error);
      wx.showToast({ title: "加载课程失败", icon: "none" });
    }
  },

  onNameInput(event) {
    this.setData({ name: event.detail.value });
  },

  onTeacherInput(event) {
    this.setData({ teacher: event.detail.value });
  },

  onLocationInput(event) {
    this.setData({ location: event.detail.value });
  },

  onWeekdayChange(event) {
    this.setData({ weekdayIndex: Number(event.detail.value) });
  },

  onStartPeriodChange(event) {
    const startPeriodIndex = Number(event.detail.value);
    this.setData({
      startPeriodIndex,
      endPeriodIndex: Math.max(this.data.endPeriodIndex, startPeriodIndex)
    });
  },

  onEndPeriodChange(event) {
    this.setData({ endPeriodIndex: Number(event.detail.value) });
  },

  onWeekStartInput(event) {
    this.setData({ weekStart: event.detail.value });
  },

  onWeekEndInput(event) {
    this.setData({ weekEnd: event.detail.value });
  },

  async submit() {
    if (!(await this.ensureCanManageCourses())) {
      return;
    }
    const groupId = getApp().globalData.currentGroupId;
    if (!groupId || !this.data.semester) {
      wx.showToast({ title: "请先创建学期", icon: "none" });
      return;
    }
    const name = this.data.name.trim();
    if (!name) {
      wx.showToast({ title: "请输入课程名称", icon: "none" });
      return;
    }
    const startPeriod = this.data.periods[this.data.startPeriodIndex];
    const endPeriod = this.data.periods[this.data.endPeriodIndex];
    if (!startPeriod || !endPeriod || endPeriod.period_index < startPeriod.period_index) {
      wx.showToast({ title: "节次范围不正确", icon: "none" });
      return;
    }
    const weekStart = Number(this.data.weekStart);
    const weekEnd = Number(this.data.weekEnd);
    if (!weekStart || !weekEnd || weekEnd < weekStart) {
      wx.showToast({ title: "周次范围不正确", icon: "none" });
      return;
    }

    const data = {
      name,
      teacher: this.data.teacher.trim() || null,
      location: this.data.location.trim() || null,
      day_of_week: this.data.weekdayIndex + 1,
      start_period: startPeriod.period_index,
      end_period: endPeriod.period_index,
      week_start: weekStart,
      week_end: weekEnd
    };
    if (this.data.isEdit) {
      data.version = this.data.version;
    } else {
      data.semester_id = this.data.semester.id;
    }

    try {
      await request(
        this.data.isEdit
          ? `/groups/${groupId}/courses/${this.data.courseId}`
          : `/groups/${groupId}/courses`,
        {
          method: this.data.isEdit ? "PATCH" : "POST",
          data
        }
      );
      wx.showToast({ title: "已保存", icon: "success" });
      goBackToCourse();
    } catch (error) {
      console.error("save course failed", error);
      wx.showToast({ title: toastTitle(error, "保存失败"), icon: "none" });
    }
  },

  deleteCourse() {
    const groupId = getApp().globalData.currentGroupId;
    if (!groupId || !this.data.courseId) {
      return;
    }
    wx.showModal({
      title: "删除课程",
      content: "确定删除这门课程吗？",
      confirmColor: "#d93025",
      success: async (result) => {
        if (!result.confirm) {
          return;
        }
        if (!(await this.ensureCanManageCourses())) {
          return;
        }
        try {
          await request(`/groups/${groupId}/courses/${this.data.courseId}`, { method: "DELETE" });
          wx.showToast({ title: "已删除", icon: "success" });
          goBackToCourse();
        } catch (error) {
          console.error("delete course failed", error);
          wx.showToast({ title: toastTitle(error, "删除失败"), icon: "none" });
        }
      }
    });
  }
});
