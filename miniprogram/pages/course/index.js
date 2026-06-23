const { request } = require("../../utils/request");
const { connectGroupSocket } = require("../../utils/socket");
const { refreshGroupAccess, refreshTabBar } = require("../../utils/access");
const { toastTitle } = require("../../utils/errors");
const { clearStoredGroupId, getStoredToken } = require("../../utils/session");
const { buildTimeBandCardGroups, buildTimeBands, buildTimeSegments, findTimeSegment } = require("../../utils/schedule-segments");

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const courseColors = [
  { background: "linear-gradient(160deg, #5b8def 0%, #7db7ff 100%)", shadow: "0 8rpx 18rpx rgba(91, 141, 239, 0.24)" },
  { background: "linear-gradient(160deg, #20c997 0%, #70e0b4 100%)", shadow: "0 8rpx 18rpx rgba(32, 201, 151, 0.22)" },
  { background: "linear-gradient(160deg, #f06f8f 0%, #ff9bb1 100%)", shadow: "0 8rpx 18rpx rgba(240, 111, 143, 0.22)" },
  { background: "linear-gradient(160deg, #8f73e6 0%, #b49cff 100%)", shadow: "0 8rpx 18rpx rgba(143, 115, 230, 0.24)" },
  { background: "linear-gradient(160deg, #f18a64 0%, #ffb180 100%)", shadow: "0 8rpx 18rpx rgba(241, 138, 100, 0.22)" },
  { background: "linear-gradient(160deg, #22b8cf 0%, #5adfe8 100%)", shadow: "0 8rpx 18rpx rgba(34, 184, 207, 0.22)" },
  { background: "linear-gradient(160deg, #7bcf3f 0%, #b3e958 100%)", shadow: "0 8rpx 18rpx rgba(123, 207, 63, 0.22)" },
  { background: "linear-gradient(160deg, #f59f00 0%, #ffd166 100%)", shadow: "0 8rpx 18rpx rgba(245, 159, 0, 0.2)" }
];

function pad(value) {
  return `${value}`.padStart(2, "0");
}

function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDate(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const value = parseDate(date);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function getWeekStart(dateString) {
  const date = parseDate(dateString);
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() - weekday + 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function calculateTeachingWeek(startDate, targetDate = todayString()) {
  const today = parseDate(targetDate);
  const start = parseDate(startDate);
  const days = Math.floor((today.getTime() - start.getTime()) / 86400000);
  if (days < 0) {
    return 1;
  }
  return Math.min(30, Math.floor(days / 7) + 1);
}

function currentSyncedWeekStart(weekDays) {
  return getApp().globalData.scheduleWeekStart || (weekDays && weekDays[0] && weekDays[0].date) || getWeekStart(todayString());
}

function formatDateLabel(dateString) {
  const date = parseDate(dateString);
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function formatMonthLabel(dateString) {
  const date = parseDate(dateString);
  return `${pad(date.getMonth() + 1)}月`;
}

function formatClock(value) {
  return String(value || "").slice(0, 5);
}

function minutesFromClock(value) {
  const parts = formatClock(value).split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

function courseColorIndex(course) {
  const key = String(course.name || course.id || "");
  let value = Number(course.id || 0);
  for (let index = 0; index < key.length; index += 1) {
    value += key.charCodeAt(index);
  }
  return Math.abs(value) % courseColors.length;
}

function colorForCourse(course) {
  return courseColors[courseColorIndex(course)];
}

function courseDetailContent(course) {
  const rows = [
    course.locationText,
    course.teacherText ? `教师：${course.teacherText}` : "",
    course.periodText,
    course.weekText
  ];
  return rows.filter(Boolean).join("\n");
}

function buildDraftRows(result) {
  if (!result || !result.draft) {
    return [];
  }
  const draft = result.draft;
  if (result.intent === "update_course" || result.intent === "delete_course") {
    const rows = [
      { label: "类型", value: result.intent === "update_course" ? "修改课程" : "删除课程" },
      { label: "目标", value: draft.target_summary || "未识别" }
    ];
    if (result.intent === "update_course") {
      rows.push({ label: "修改为", value: draft.change_summary || "未识别" });
    }
    return rows;
  }
  if (result.intent !== "create_course") {
    return [{ label: "类型", value: "不是课程" }];
  }
  return [
    { label: "类型", value: "新建课程" },
    { label: "课程", value: draft.name || "" },
    { label: "星期", value: `周${weekdays[(draft.day_of_week || 1) - 1]}` },
    { label: "节次", value: `${draft.start_period}-${draft.end_period}节` },
    { label: "周次", value: `${draft.week_start || 1}-${draft.week_end || 16}周` },
    { label: "地点", value: draft.location || "" }
  ].filter((row) => row.value);
}

function isCourseIntent(intent) {
  return intent === "create_course" || intent === "update_course" || intent === "delete_course";
}

function nlpTitle(intent) {
  const titles = {
    create_course: "识别为新建课程",
    update_course: "识别为修改课程",
    delete_course: "识别为删除课程"
  };
  return titles[intent] || "暂未识别课程";
}

function nlpConfirmText(intent) {
  if (intent === "delete_course") {
    return "确认删除课程";
  }
  if (intent === "update_course") {
    return "确认修改课程";
  }
  return "确认创建课程";
}

function parserSourceText(result) {
  if (!result) {
    return "";
  }
  if (result.parser_source === "deepseek") {
    return "DeepSeek AI";
  }
  if ((result.warnings || []).some((item) => String(item).indexOf("AI解析失败") >= 0)) {
    return "本地解析（AI回退）";
  }
  return "本地解析";
}

function confidenceText(result) {
  if (!result || typeof result.confidence !== "number") {
    return "";
  }
  return `${Math.round(result.confidence * 100)}%`;
}

function missingFields(result) {
  return (result && result.missing_fields) || [];
}

function canConfirmNlp(result) {
  return Boolean(result && isCourseIntent(result.intent) && missingFields(result).length === 0);
}

function riskNotice(result) {
  if (!result || !isCourseIntent(result.intent)) {
    return "";
  }
  const notices = [];
  if (result.intent === "delete_course") {
    notices.push("删除课程不可恢复，请确认目标无误");
  }
  if (typeof result.confidence === "number" && result.confidence < 0.7) {
    notices.push("识别置信度较低，请仔细核对后再确认");
  }
  return notices.join("；");
}

function selectedDraft(result, candidate) {
  const draft = Object.assign({}, result.draft || {});
  const target = Object.assign({}, draft.target || {}, candidate.target || { id: candidate.id });
  draft.target = target;
  draft.target_summary = `${candidate.title} / ${candidate.subtitle || candidate.meta || ""}`;
  return Object.assign({}, result, { draft });
}

Page({
  data: {
    currentGroupId: null,
    hasSemester: false,
    semester: null,
    week: 1,
    weekInitialized: false,
    weekTitle: "第 1 周",
    weekRangeText: "",
    weekMonthText: "",
    weekdays,
    weekDays: [],
    periods: [],
    periodRows: [],
    timeSegments: [],
    timeBands: [],
    courses: [],
    courseCards: [],
    courseCardGroups: [],
    courseStackItems: [],
    periodLabels: ["1节", "2节"],
    canManageCourses: false,
    actionMenuVisible: false,
    nlpVisible: false,
    nlpParsing: false,
    nlpText: "",
    parseResult: null,
    parseTitle: "",
    confirmText: "确认创建课程",
    parserSourceText: "",
    confidenceText: "",
    missingFields: [],
    canConfirmNlp: false,
    riskNotice: "",
    nlpCandidates: [],
    selectedCandidateId: null,
    draftRows: [],
    warnings: [],
    syncStatus: "idle",
    sheetVisible: false,
    sheetMode: "",
    sheetTitle: "",
    activeCourse: null,
    courseForm: {
      isEdit: false,
      courseId: null,
      version: null,
      name: "",
      teacher: "",
      location: "",
      weekdayIndex: 0,
      startPeriodIndex: 0,
      endPeriodIndex: 1,
      weekStart: "1",
      weekEnd: "16"
    },
    courseSaving: false
  },

  onShow() {
    if (!getStoredToken()) {
      clearStoredGroupId();
      getApp().globalData.currentGroupId = null;
      this.setData({
        currentGroupId: null,
        hasSemester: false,
        courses: [],
        courseCards: [],
        courseCardGroups: [],
        timeBands: [],
        periods: [],
        canManageCourses: false,
        actionMenuVisible: false
      });
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.loadTimetable();
  },

  async loadTimetable() {
    const groupId = getApp().globalData.currentGroupId;
    this.setData({ currentGroupId: groupId });
    refreshTabBar(this);
    if (!groupId) {
      this.setData({
        hasSemester: false,
        courses: [],
        periods: [],
        canManageCourses: false,
        actionMenuVisible: false
      });
      return;
    }
    let access = null;
    try {
      access = await refreshGroupAccess(groupId);
    } catch (error) {
      console.error("load course access failed", error);
      this.setData({ hasSemester: false, courses: [], courseCards: [], courseCardGroups: [], timeBands: [], canManageCourses: false });
      return;
    }
    if (!access) {
      this.setData({ hasSemester: false, courses: [], courseCards: [], courseCardGroups: [], timeBands: [], canManageCourses: false });
      return;
    }
    this.setData({ canManageCourses: Boolean(access.permissions.can_manage_courses) });
    refreshTabBar(this);
    connectGroupSocket(groupId, this.handleSocketMessage.bind(this));
    try {
      const periods = await request(`/groups/${groupId}/periods`);
      let semester = null;
      try {
        semester = await request(`/groups/${groupId}/semesters/current`);
      } catch {
        this.setData({ periods, hasSemester: false, semester: null, courses: [] });
        return;
      }
      const syncedWeekStart = currentSyncedWeekStart(this.data.weekDays);
      const syncedSelectedDate = getApp().globalData.scheduleSelectedDate;
      const teachingDate =
        syncedSelectedDate && getWeekStart(syncedSelectedDate) === syncedWeekStart ? syncedSelectedDate : syncedWeekStart;
      const week = calculateTeachingWeek(semester.start_date, teachingDate);
      const courses = await request(`/groups/${groupId}/courses?week=${week}`);
      this.setData(
        Object.assign({}, this.buildGridState({ semester, periods, courses, week, weekStart: syncedWeekStart }), {
          hasSemester: true,
          weekInitialized: true
        })
      );
    } catch (error) {
      console.error("load timetable failed", error);
      wx.showToast({ title: "加载课程失败", icon: "none" });
    }
  },

  buildGridState({ semester, periods, courses, week, weekStart }) {
    const weekBase = weekStart || getWeekStart(todayString());
    getApp().globalData.scheduleWeekStart = weekBase;
    const today = todayString();
    const weekDays = weekdays.map((weekday, index) => {
      const date = addDays(weekBase, index);
      return {
        weekday,
        date,
        dateLabel: formatDateLabel(date),
        isToday: date === today
      };
    });
    const periodRows = periods.map((period, index) => ({
      ...period,
      row: index + 1,
      startText: formatClock(period.start_time),
      endText: formatClock(period.end_time),
      startMinute: minutesFromClock(period.start_time),
      endMinute: minutesFromClock(period.end_time)
    }));
    const periodIndexMap = {};
    periodRows.forEach((period) => {
      periodIndexMap[period.period_index] = period.row;
    });
    const timeSegments = buildTimeSegments(periodRows);
    const courseCards = courses.map((course) => {
      const color = colorForCourse(course);
      const row = periodIndexMap[course.start_period] || course.start_period;
      const startPeriod = periodRows.find((period) => period.period_index === course.start_period);
      const endPeriod = periodRows.find((period) => period.period_index === course.end_period) || startPeriod;
      const segment = findTimeSegment(timeSegments, row);
      const span = Math.max(1, Number(course.end_period || course.start_period) - Number(course.start_period) + 1);
      return {
        ...course,
        column: Number(course.day_of_week || 1) + 1,
        row,
        span,
        background: color.background,
        shadow: color.shadow,
        dayIndex: Math.max(0, Number(course.day_of_week || 1) - 1),
        segmentKey: segment ? segment.key : "",
        sortOrder: startPeriod ? startPeriod.startMinute : row,
        startMinute: startPeriod ? startPeriod.startMinute : row * 60,
        endMinute: endPeriod ? endPeriod.endMinute : (startPeriod ? startPeriod.endMinute : row * 60 + 45),
        timeText: startPeriod && endPeriod ? `${startPeriod.startText}-${endPeriod.endText}` : `${course.start_period}-${course.end_period}\u8282`,
        metaText: course.location || course.teacher || `${course.start_period}-${course.end_period}\u8282`,
        periodText: `${course.start_period}-${course.end_period}节`,
        weekText: `第 ${course.week_start}-${course.week_end} 周`,
        teacherText: course.teacher || "",
        locationText: course.location || "",
        compact: span <= 1
      };
    });
    const courseCardGroups = buildTimeBandCardGroups(courseCards);
    const timeBands = buildTimeBands(timeSegments, courseCardGroups);
    return {
      semester,
      week,
      weekTitle: `第 ${week} 周`,
      weekRangeText: `${weekDays[0].dateLabel} - ${weekDays[6].dateLabel}`,
      weekMonthText: formatMonthLabel(weekDays[0].date),
      weekDays,
      periods,
      periodLabels: periods.map((period) => `${period.period_index}节`),
      periodRows,
      timeSegments,
      timeBands,
      courses,
      courseCards,
      courseCardGroups
    };
  },

  handleSocketMessage(message) {
    const groupId = getApp().globalData.currentGroupId;
    if (!message || Number(message.group_id) !== Number(groupId)) {
      return;
    }
    const type = message.type || "";
    if (type === "permissions.updated") {
      refreshGroupAccess(groupId).then((access) => {
        this.setData({
          canManageCourses: Boolean(access.permissions.can_manage_courses),
          actionMenuVisible: false
        });
        refreshTabBar(this);
      });
      return;
    }
    if (type.startsWith("course.") || type.startsWith("semester.")) {
      this.setData({ syncStatus: "syncing" });
      this.loadTimetable().finally(() => {
        this.setData({ syncStatus: "idle" });
      });
    }
  },

  async createDefaultSemester() {
    const groupId = getApp().globalData.currentGroupId;
    if (!groupId) {
      wx.showToast({ title: "请先选择群组", icon: "none" });
      return;
    }
    if (!this.data.canManageCourses) {
      wx.showToast({ title: "没有课程管理权限", icon: "none" });
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
    this.setData({ actionMenuVisible: false });
    this.loadTimetable();
  },

  prevWeek() {
    this.setData({ actionMenuVisible: false });
    if (this.data.week <= 1) {
      wx.showToast({ title: "已经是第1周", icon: "none" });
      return;
    }
    const weekStart = addDays(currentSyncedWeekStart(this.data.weekDays), -7);
    const app = getApp();
    app.globalData.scheduleWeekStart = weekStart;
    app.globalData.scheduleSelectedDate = weekStart;
    this.setData({ weekInitialized: false });
    this.loadTimetable();
  },

  nextWeek() {
    this.setData({ actionMenuVisible: false });
    if (this.data.week >= 30) {
      wx.showToast({ title: "最多查看第30周", icon: "none" });
      return;
    }
    const weekStart = addDays(currentSyncedWeekStart(this.data.weekDays), 7);
    const app = getApp();
    app.globalData.scheduleWeekStart = weekStart;
    app.globalData.scheduleSelectedDate = weekStart;
    this.setData({ weekInitialized: false });
    this.loadTimetable();
  },

  goCurrentWeek() {
    this.setData({ actionMenuVisible: false });
    if (!this.data.semester) {
      return;
    }
    const selectedDate = todayString();
    const app = getApp();
    app.globalData.scheduleSelectedDate = selectedDate;
    app.globalData.scheduleWeekStart = getWeekStart(selectedDate);
    this.setData({
      weekInitialized: false
    });
    this.loadTimetable();
  },

  toggleActionMenu() {
    if (!this.data.canManageCourses) {
      wx.showToast({ title: "没有课程管理权限", icon: "none" });
      return;
    }
    this.setData({ actionMenuVisible: !this.data.actionMenuVisible });
  },

  openNlpFromMenu() {
    this.setData({ actionMenuVisible: false });
    this.openNlp();
  },

  goManage() {
    this.setData({ actionMenuVisible: false });
    wx.switchTab({ url: "/pages/manage/index" });
  },

  goCreateCourseFromMenu() {
    this.setData({ actionMenuVisible: false });
    this.goCreateCourse();
  },

  goCreateCourse() {
    this.setData({ actionMenuVisible: false });
    if (!getApp().globalData.currentGroupId) {
      wx.showToast({ title: "请先选择群组", icon: "none" });
      return;
    }
    if (!this.data.canManageCourses) {
      wx.showToast({ title: "没有课程管理权限", icon: "none" });
      return;
    }
    if (!this.data.hasSemester) {
      wx.showToast({ title: "请先创建学期", icon: "none" });
      return;
    }
    this.openCourseSheet(null);
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

  goEditCourse(event) {
    const courseId = event.currentTarget.dataset.id;
    const course = this.data.courseCards.find((item) => Number(item.id) === Number(courseId));
    if (!course) {
      return;
    }
    this.openCourseCard(course);
  },

  openCourseCardGroup(event) {
    const key = event.currentTarget.dataset.key;
    const group = this.data.courseCardGroups.find((item) => item.key === key);
    if (!group) {
      return;
    }
    if (group.isStack) {
      this.setCustomTabBarHidden(true);
      this.setData({
        sheetVisible: true,
        sheetMode: "course-stack",
        sheetTitle: "\u91cd\u53e0\u8bfe\u7a0b",
        courseStackItems: group.items,
        activeCourse: null,
        actionMenuVisible: false
      });
      return;
    }
    this.openCourseCard(group.main);
  },

  selectCourseStackItem(event) {
    const courseId = event.currentTarget.dataset.id;
    const course = this.data.courseStackItems.find((item) => Number(item.id) === Number(courseId));
    if (course) {
      this.openCourseCard(course);
    }
  },

  openCourseCard(course) {
    if (!this.data.canManageCourses) {
      this.openCourseDetailSheet(course);
      return;
    }
    this.openCourseSheet(course);
  },

  openCourseDetailSheet(course) {
    this.setCustomTabBarHidden(true);
    this.setData({
      sheetVisible: true,
      sheetMode: "course-detail",
      sheetTitle: course.name,
      activeCourse: course,
      courseStackItems: [],
      actionMenuVisible: false
    });
  },

  closeSheet() {
    this.setCustomTabBarHidden(false);
    this.setData({
      sheetVisible: false,
      sheetMode: "",
      sheetTitle: "",
      activeCourse: null,
      courseStackItems: [],
      courseSaving: false
    });
  },

  openCourseSheet(course) {
    if (!this.data.hasSemester || !this.data.semester) {
      wx.showToast({ title: "请先创建学期", icon: "none" });
      return;
    }
    const periods = this.data.periods;
    const defaultEndIndex = Math.min(1, Math.max(0, periods.length - 1));
    let form = {
      isEdit: false,
      courseId: null,
      version: null,
      name: "",
      teacher: "",
      location: "",
      weekdayIndex: 0,
      startPeriodIndex: 0,
      endPeriodIndex: defaultEndIndex,
      weekStart: "1",
      weekEnd: "16"
    };
    if (course) {
      const startPeriodIndex = Math.max(
        0,
        periods.findIndex((period) => period.period_index === course.start_period)
      );
      const endPeriodIndex = Math.max(
        startPeriodIndex,
        periods.findIndex((period) => period.period_index === course.end_period)
      );
      form = {
        isEdit: true,
        courseId: course.id,
        version: course.version,
        name: course.name || "",
        teacher: course.teacher || "",
        location: course.location || "",
        weekdayIndex: Math.max(0, (course.day_of_week || 1) - 1),
        startPeriodIndex,
        endPeriodIndex,
        weekStart: String(course.week_start || 1),
        weekEnd: String(course.week_end || 16)
      };
    }
    this.setCustomTabBarHidden(true);
    this.setData({
      sheetVisible: true,
      sheetMode: "course-form",
      sheetTitle: course ? "编辑课程" : "新增课程",
      activeCourse: course || null,
      courseStackItems: [],
      courseForm: form,
      actionMenuVisible: false
    });
  },

  onCourseNameInput(event) {
    this.setData({ "courseForm.name": event.detail.value });
  },

  onCourseTeacherInput(event) {
    this.setData({ "courseForm.teacher": event.detail.value });
  },

  onCourseLocationInput(event) {
    this.setData({ "courseForm.location": event.detail.value });
  },

  onCourseWeekdayChange(event) {
    this.setData({ "courseForm.weekdayIndex": Number(event.detail.value) });
  },

  onCourseStartPeriodChange(event) {
    const startPeriodIndex = Number(event.detail.value);
    this.setData({
      "courseForm.startPeriodIndex": startPeriodIndex,
      "courseForm.endPeriodIndex": Math.max(this.data.courseForm.endPeriodIndex, startPeriodIndex)
    });
  },

  onCourseEndPeriodChange(event) {
    this.setData({ "courseForm.endPeriodIndex": Number(event.detail.value) });
  },

  onCourseWeekStartInput(event) {
    this.setData({ "courseForm.weekStart": event.detail.value });
  },

  onCourseWeekEndInput(event) {
    this.setData({ "courseForm.weekEnd": event.detail.value });
  },

  async submitCourseInSheet() {
    const groupId = getApp().globalData.currentGroupId;
    const form = this.data.courseForm;
    if (!groupId || this.data.courseSaving) {
      return;
    }
    if (!this.data.canManageCourses) {
      wx.showToast({ title: "没有课程管理权限", icon: "none" });
      return;
    }
    const name = form.name.trim();
    if (!name) {
      wx.showToast({ title: "请输入课程名称", icon: "none" });
      return;
    }
    const startPeriod = this.data.periods[form.startPeriodIndex];
    const endPeriod = this.data.periods[form.endPeriodIndex];
    if (!startPeriod || !endPeriod || endPeriod.period_index < startPeriod.period_index) {
      wx.showToast({ title: "节次范围不正确", icon: "none" });
      return;
    }
    const weekStart = Number(form.weekStart);
    const weekEnd = Number(form.weekEnd);
    if (!weekStart || !weekEnd || weekEnd < weekStart) {
      wx.showToast({ title: "周次范围不正确", icon: "none" });
      return;
    }
    const data = {
      name,
      teacher: form.teacher.trim() || null,
      location: form.location.trim() || null,
      day_of_week: form.weekdayIndex + 1,
      start_period: startPeriod.period_index,
      end_period: endPeriod.period_index,
      week_start: weekStart,
      week_end: weekEnd
    };
    if (form.isEdit) {
      data.version = form.version;
    } else {
      data.semester_id = this.data.semester.id;
    }
    this.setData({ courseSaving: true });
    try {
      await request(
        form.isEdit ? `/groups/${groupId}/courses/${form.courseId}` : `/groups/${groupId}/courses`,
        { method: form.isEdit ? "PATCH" : "POST", data }
      );
      wx.showToast({ title: "已保存", icon: "success" });
      this.closeSheet();
      this.loadTimetable();
    } catch (error) {
      console.error("save course in sheet failed", error);
      wx.showToast({ title: toastTitle(error, "保存失败"), icon: "none" });
    } finally {
      this.setData({ courseSaving: false });
    }
  },

  deleteCourseInSheet() {
    const groupId = getApp().globalData.currentGroupId;
    const form = this.data.courseForm;
    if (!groupId || !form.courseId) {
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
        try {
          await request(`/groups/${groupId}/courses/${form.courseId}`, { method: "DELETE" });
          wx.showToast({ title: "已删除", icon: "success" });
          this.closeSheet();
          this.loadTimetable();
        } catch (error) {
          console.error("delete course in sheet failed", error);
          wx.showToast({ title: toastTitle(error, "删除失败"), icon: "none" });
        }
      }
    });
  },

  openNlp() {
    this.setData({ actionMenuVisible: false });
    if (!this.data.canManageCourses) {
      wx.showToast({ title: "没有课程管理权限", icon: "none" });
      return;
    }
    if (!this.data.hasSemester) {
      wx.showToast({ title: "请先创建学期", icon: "none" });
      return;
    }
    this.setCustomTabBarHidden(true);
    this.setData({ nlpVisible: true });
  },

  closeNlp() {
    this.setCustomTabBarHidden(false);
    this.setData({
      nlpVisible: false,
      nlpParsing: false,
      nlpText: "",
      parseResult: null,
      parseTitle: "",
      confirmText: "确认创建课程",
      parserSourceText: "",
      confidenceText: "",
      missingFields: [],
      canConfirmNlp: false,
      riskNotice: "",
      nlpCandidates: [],
      selectedCandidateId: null,
      draftRows: [],
      warnings: []
    });
  },

  onNlpInput(event) {
    this.setData({
      nlpText: event.detail.value,
      parseResult: null,
      parseTitle: "",
      confirmText: "确认创建课程",
      parserSourceText: "",
      confidenceText: "",
      missingFields: [],
      canConfirmNlp: false,
      riskNotice: "",
      nlpCandidates: [],
      selectedCandidateId: null,
      draftRows: [],
      warnings: []
    });
  },

  async parseNlp() {
    const groupId = getApp().globalData.currentGroupId;
    const text = this.data.nlpText.trim();
    if (!groupId) {
      wx.showToast({ title: "请先选择群组", icon: "none" });
      return;
    }
    if (!text) {
      wx.showToast({ title: "请输入一句话", icon: "none" });
      return;
    }
    if (this.data.nlpParsing) {
      return;
    }
    try {
      this.setData({ nlpParsing: true });
      const result = await request("/nlp/parse", {
        method: "POST",
        data: {
          group_id: groupId,
          text,
          context: {
            current_date: todayString(),
            timezone: "Asia/Shanghai"
          }
        }
      });
      if (!isCourseIntent(result.intent)) {
        wx.showToast({ title: "未识别为课程操作", icon: "none" });
      }
      this.setData({
        parseResult: result,
        parseTitle: nlpTitle(result.intent),
        confirmText: nlpConfirmText(result.intent),
        parserSourceText: parserSourceText(result),
        confidenceText: confidenceText(result),
        missingFields: missingFields(result),
        canConfirmNlp: canConfirmNlp(result),
        riskNotice: riskNotice(result),
        nlpCandidates: [],
        selectedCandidateId: null,
        draftRows: buildDraftRows(result),
        warnings: result.warnings || []
      });
    } catch (error) {
      console.error("parse course nlp failed", error);
      wx.showToast({ title: toastTitle(error, "解析失败"), icon: "none" });
    } finally {
      this.setData({ nlpParsing: false });
    }
  },

  async confirmNlp() {
    const groupId = getApp().globalData.currentGroupId;
    const result = this.data.parseResult;
    if (!groupId || !result || !isCourseIntent(result.intent)) {
      wx.showToast({ title: "没有可执行的课程操作", icon: "none" });
      return;
    }
    if (!this.data.canConfirmNlp) {
      wx.showToast({ title: "请先补充缺失信息", icon: "none" });
      return;
    }
    if (this.data.nlpCandidates.length > 0 && !this.data.selectedCandidateId) {
      wx.showToast({ title: "请先选择目标", icon: "none" });
      return;
    }
    const safeToContinue = await this.confirmRiskAction(result);
    if (!safeToContinue) {
      return;
    }
    try {
      const confirmed = await request("/nlp/confirm", {
        method: "POST",
        data: {
          group_id: groupId,
          intent: result.intent,
          draft: result.draft,
          missing_fields: this.data.missingFields
        }
      });
      if (confirmed.action === "select_target") {
        this.setData({
          nlpCandidates: confirmed.candidates || [],
          selectedCandidateId: null,
          warnings: [confirmed.message || "请选择要操作的目标"]
        });
        wx.showToast({ title: "请选择目标", icon: "none" });
        return;
      }
      wx.showToast({ title: "已完成", icon: "success" });
      this.closeNlp();
      this.loadTimetable();
    } catch (error) {
      console.error("confirm course nlp failed", error);
      wx.showToast({ title: toastTitle(error, "操作失败"), icon: "none" });
    }
  },

  selectNlpCandidate(event) {
    const candidateId = Number(event.currentTarget.dataset.id);
    const candidate = this.data.nlpCandidates.find((item) => Number(item.id) === candidateId);
    if (!candidate || !this.data.parseResult) {
      return;
    }
    const nextResult = selectedDraft(this.data.parseResult, candidate);
    this.setData({
      parseResult: nextResult,
      selectedCandidateId: candidateId,
      draftRows: buildDraftRows(nextResult),
      warnings: []
    });
  },

  confirmRiskAction(result) {
    const notice = riskNotice(result);
    if (!notice) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      wx.showModal({
        title: "确认课程操作",
        content: notice,
        confirmText: result.intent === "delete_course" ? "确认删除" : "继续",
        cancelText: "取消",
        success(res) {
          resolve(Boolean(res.confirm));
        },
        fail() {
          resolve(false);
        }
      });
    });
  }
});
