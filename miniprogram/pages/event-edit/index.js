const { request } = require("../../utils/request");
const { refreshGroupAccess } = require("../../utils/access");
const { toastTitle } = require("../../utils/errors");

function pad(value) {
  return `${value}`.padStart(2, "0");
}

function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toIsoLocal(date, time) {
  return `${date}T${time}:00`;
}

function isoDate(value) {
  return String(value || "").slice(0, 10) || todayString();
}

function isoTime(value) {
  return String(value || "").slice(11, 16) || "09:00";
}

function goBackToCalendar() {
  setTimeout(() => {
    wx.switchTab({ url: "/pages/calendar/index" });
  }, 350);
}

function isDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

Page({
  data: {
    isEdit: false,
    eventId: null,
    version: null,
    pageTitle: "新建日程",
    submitText: "保存日程",
    title: "",
    date: todayString(),
    startTime: "09:00",
    endTime: "10:00",
    location: "",
    note: "",
    saving: false
  },

  onLoad(options) {
    if (options && isDateString(options.date)) {
      this.setData({ date: options.date });
    }
    if (options && options.event_id) {
      this.setData({
        isEdit: true,
        eventId: Number(options.event_id),
        pageTitle: "编辑日程",
        submitText: "保存修改"
      });
      this.loadEvent();
    }
  },

  async ensureCanManageEvents() {
    const groupId = getApp().globalData.currentGroupId;
    if (!groupId) {
      wx.showToast({ title: "请先选择群组", icon: "none" });
      return false;
    }
    try {
      const access = await refreshGroupAccess(groupId);
      if (!access.permissions.can_manage_events) {
        wx.showToast({ title: "没有日程管理权限", icon: "none" });
        return false;
      }
      return true;
    } catch (error) {
      console.error("check event permission failed", error);
      wx.showToast({ title: "权限校验失败", icon: "none" });
      return false;
    }
  },

  async loadEvent() {
    const groupId = getApp().globalData.currentGroupId;
    if (!groupId || !this.data.eventId) {
      return;
    }
    try {
      const event = await request(`/groups/${groupId}/events/${this.data.eventId}`);
      this.setData({
        title: event.title || "",
        date: isoDate(event.start_time),
        startTime: isoTime(event.start_time),
        endTime: isoTime(event.end_time),
        location: event.location || "",
        note: event.note || "",
        version: event.version
      });
    } catch (error) {
      console.error("load event failed", error);
      wx.showToast({ title: "加载日程失败", icon: "none" });
    }
  },

  onTitleInput(event) {
    this.setData({ title: event.detail.value });
  },

  onDateChange(event) {
    this.setData({ date: event.detail.value });
  },

  onStartTimeChange(event) {
    this.setData({ startTime: event.detail.value });
  },

  onEndTimeChange(event) {
    this.setData({ endTime: event.detail.value });
  },

  onLocationInput(event) {
    this.setData({ location: event.detail.value });
  },

  onNoteInput(event) {
    this.setData({ note: event.detail.value });
  },

  async submit() {
    if (!(await this.ensureCanManageEvents())) {
      return;
    }
    const groupId = getApp().globalData.currentGroupId;
    if (!groupId) {
      wx.showToast({ title: "请先选择群组", icon: "none" });
      return;
    }
    if (!this.data.title.trim()) {
      wx.showToast({ title: "请输入标题", icon: "none" });
      return;
    }
    const start = new Date(toIsoLocal(this.data.date, this.data.startTime));
    const end = new Date(toIsoLocal(this.data.date, this.data.endTime));
    if (end <= start) {
      wx.showToast({ title: "结束时间需晚于开始时间", icon: "none" });
      return;
    }

    const data = {
      title: this.data.title.trim(),
      location: this.data.location.trim() || null,
      note: this.data.note.trim() || null,
      start_time: toIsoLocal(this.data.date, this.data.startTime),
      end_time: toIsoLocal(this.data.date, this.data.endTime),
      is_all_day: false
    };
    if (this.data.isEdit) {
      data.version = this.data.version;
    }

    this.setData({ saving: true });
    try {
      await request(
        this.data.isEdit
          ? `/groups/${groupId}/events/${this.data.eventId}`
          : `/groups/${groupId}/events`,
        {
          method: this.data.isEdit ? "PATCH" : "POST",
          data
        }
      );
      wx.showToast({ title: "已保存", icon: "success" });
      goBackToCalendar();
    } catch (error) {
      console.error("save event failed", error);
      wx.showToast({ title: toastTitle(error, "保存失败"), icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  deleteEvent() {
    const groupId = getApp().globalData.currentGroupId;
    if (!groupId || !this.data.eventId) {
      return;
    }
    wx.showModal({
      title: "删除日程",
      content: "确定删除这条日程吗？",
      confirmColor: "#d93025",
      success: async (result) => {
        if (!result.confirm) {
          return;
        }
        if (!(await this.ensureCanManageEvents())) {
          return;
        }
        try {
          await request(`/groups/${groupId}/events/${this.data.eventId}`, { method: "DELETE" });
          wx.showToast({ title: "已删除", icon: "success" });
          goBackToCalendar();
        } catch (error) {
          console.error("delete event failed", error);
          wx.showToast({ title: toastTitle(error, "删除失败"), icon: "none" });
        }
      }
    });
  }
});
