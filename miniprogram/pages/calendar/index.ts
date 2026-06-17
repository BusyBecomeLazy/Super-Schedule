// @ts-nocheck
const { request } = require("../../utils/request");
const { connectGroupSocket } = require("../../utils/socket");
const { refreshGroupAccess, refreshTabBar } = require("../../utils/access");
const { toastTitle } = require("../../utils/errors");
const { clearStoredGroupId, getStoredToken } = require("../../utils/session");

const weekLabels = ["一", "二", "三", "四", "五", "六", "日"];
const courseColors = [
  { background: "linear-gradient(160deg, #5b8def 0%, #7db7ff 100%)", shadow: "0 8rpx 18rpx rgba(91, 141, 239, 0.24)" },
  { background: "linear-gradient(160deg, #20c997 0%, #70e0b4 100%)", shadow: "0 8rpx 18rpx rgba(32, 201, 151, 0.22)" },
  { background: "linear-gradient(160deg, #8f73e6 0%, #b49cff 100%)", shadow: "0 8rpx 18rpx rgba(143, 115, 230, 0.24)" },
  { background: "linear-gradient(160deg, #22b8cf 0%, #5adfe8 100%)", shadow: "0 8rpx 18rpx rgba(34, 184, 207, 0.22)" },
  { background: "linear-gradient(160deg, #f18a64 0%, #ffb180 100%)", shadow: "0 8rpx 18rpx rgba(241, 138, 100, 0.22)" }
];
const eventColors = [
  { background: "linear-gradient(160deg, #f59e0b 0%, #ffd166 100%)", shadow: "0 8rpx 18rpx rgba(245, 158, 11, 0.22)" },
  { background: "linear-gradient(160deg, #ef6f8f 0%, #ff9bb1 100%)", shadow: "0 8rpx 18rpx rgba(239, 111, 143, 0.22)" },
  { background: "linear-gradient(160deg, #14b8a6 0%, #5eead4 100%)", shadow: "0 8rpx 18rpx rgba(20, 184, 166, 0.22)" },
  { background: "linear-gradient(160deg, #6366f1 0%, #a5b4fc 100%)", shadow: "0 8rpx 18rpx rgba(99, 102, 241, 0.22)" }
];

function pad(value) {
  return `${value}`.padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayString() {
  return formatDate(new Date());
}

function parseDate(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(dateString, days) {
  const date = parseDate(dateString);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function getWeekStart(dateString) {
  const date = parseDate(dateString);
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() - weekday + 1);
  return formatDate(date);
}

function formatDateLabel(dateString) {
  const date = parseDate(dateString);
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function formatMonthLabel(dateString) {
  const date = parseDate(dateString);
  return `${pad(date.getMonth() + 1)}月`;
}

function formatTime(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string" && /^\d{2}:\d{2}/.test(value)) {
    return value.slice(0, 5);
  }
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function minutesFromClock(value) {
  if (!value) {
    return 0;
  }
  const parts = String(value).slice(0, 5).split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

function minutesFromDateTime(value) {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function formatDateTimeRange(startValue, endValue) {
  if (!startValue || !endValue) {
    return "";
  }
  const date = String(startValue).slice(0, 10);
  return `${date} ${formatTime(startValue)}-${formatTime(endValue)}`;
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

function formatSelectedDate(dateString) {
  const date = parseDate(dateString);
  const weekday = weekLabels[(date.getDay() || 7) - 1];
  return `${dateString} 周${weekday}`;
}

function pickColor(list, item) {
  const key = String(item.title || item.name || item.id || "");
  let value = Number(item.id || item.dayIndex || 0);
  for (let index = 0; index < key.length; index += 1) {
    value += key.charCodeAt(index);
  }
  return list[Math.abs(value) % list.length];
}

function scheduleDetailContent(card) {
  const rows = [card.primaryText, card.secondaryText, card.date];
  return rows.filter(Boolean).join("\n");
}

function buildDraftRows(result) {
  if (!result || !result.draft) {
    return [];
  }
  const draft = result.draft;
  if (result.intent === "create_event") {
    return [
      { label: "类型", value: "日程" },
      { label: "标题", value: draft.title || "" },
      { label: "时间", value: formatDateTimeRange(draft.start_time, draft.end_time) },
      { label: "地点", value: draft.location || "" }
    ].filter((row) => row.value);
  }
  if (result.intent === "update_event" || result.intent === "delete_event") {
    const rows = [
      { label: "类型", value: result.intent === "update_event" ? "修改日程" : "删除日程" },
      { label: "目标", value: draft.target_summary || "未识别" }
    ];
    if (result.intent === "update_event") {
      rows.push({ label: "修改为", value: draft.change_summary || "未识别" });
    }
    return rows;
  }
  if (result.intent === "create_course") {
    return [
      { label: "类型", value: "课程" },
      { label: "课程", value: draft.name || "" },
      { label: "星期", value: `周${weekLabels[(draft.day_of_week || 1) - 1]}` },
      { label: "节次", value: `${draft.start_period}-${draft.end_period}节` },
      { label: "周次", value: `${draft.week_start || 1}-${draft.week_end || 16}周` },
      { label: "地点", value: draft.location || "" }
    ].filter((row) => row.value);
  }
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
  return [{ label: "类型", value: "未识别" }];
}

function nlpTitle(intent) {
  const titles = {
    create_event: "识别为新建日程",
    update_event: "识别为修改日程",
    delete_event: "识别为删除日程",
    create_course: "识别为新建课程",
    update_course: "识别为修改课程",
    delete_course: "识别为删除课程"
  };
  return titles[intent] || "暂未识别";
}

function nlpConfirmText(intent) {
  if (intent && intent.indexOf("delete_") === 0) {
    return "确认删除";
  }
  if (intent && intent.indexOf("update_") === 0) {
    return "确认修改";
  }
  return "确认创建";
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
  return Boolean(result && result.intent !== "unknown" && missingFields(result).length === 0);
}

function riskNotice(result) {
  if (!result || result.intent === "unknown") {
    return "";
  }
  const notices = [];
  if (result.intent.indexOf("delete_") === 0) {
    notices.push("删除操作不可恢复，请确认目标无误");
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

function eventPlacement(periodRows, startValue, endValue) {
  if (!periodRows.length) {
    return { row: 1, span: 1 };
  }
  const start = minutesFromDateTime(startValue);
  const end = minutesFromDateTime(endValue) || start + 45;
  const overlaps = periodRows.filter((period) => period.startMinute < end && period.endMinute > start);
  if (overlaps.length) {
    const row = overlaps[0].row;
    return { row, span: Math.max(1, overlaps[overlaps.length - 1].row - row + 1) };
  }
  const next = periodRows.find((period) => period.startMinute >= start);
  if (next) {
    return { row: next.row, span: 1 };
  }
  return { row: periodRows[periodRows.length - 1].row, span: 1 };
}

function cardRangesOverlap(left, right) {
  if (left.column !== right.column) {
    return false;
  }
  return left.row < right.row + right.span && right.row < left.row + left.span;
}

function buildScheduleStacks(cards) {
  const cardsByColumn = {};
  cards.forEach((card) => {
    const column = String(card.column);
    if (!cardsByColumn[column]) {
      cardsByColumn[column] = [];
    }
    cardsByColumn[column].push(card);
  });

  const stacks = [];
  Object.keys(cardsByColumn).forEach((column) => {
    const columnCards = cardsByColumn[column].sort((left, right) => {
      if (left.row !== right.row) {
        return left.row - right.row;
      }
      return right.span - left.span;
    });
    let groupCards = [];
    let groupEnd = 0;
    const flushGroup = () => {
      if (!groupCards.length) {
        return;
      }
      const sortedCards = groupCards.slice().sort((left, right) => {
        if (left.row !== right.row) {
          return left.row - right.row;
        }
        return right.span - left.span;
      });
      const row = Math.min(...sortedCards.map((card) => card.row));
      const endRow = Math.max(...sortedCards.map((card) => card.row + card.span));
      const topCard = sortedCards[0];
      const stack = {
        ...topCard,
        stackKey: sortedCards.map((card) => card.key).join("|"),
        isStack: sortedCards.length > 1,
        itemCount: sortedCards.length,
        items: sortedCards,
        previewItems: sortedCards.slice(0, 3),
        row,
        span: Math.max(1, endRow - row),
        column: Number(column),
        zIndex: sortedCards.length > 1 ? 8 : 2,
        layerStyles: sortedCards.slice(1, 3).map((card, index) => {
          const offset = (index + 1) * 8;
          const inset = (index + 1) * 2;
          const opacity = 0.72 - index * 0.16;
          return `background: ${card.background}; left: ${inset}rpx; top: ${inset}rpx; right: -${offset}rpx; bottom: -${offset}rpx; opacity: ${opacity};`;
        })
      };
      stacks.push(stack);
    };

    columnCards.forEach((card) => {
      const cardEnd = card.row + card.span;
      if (!groupCards.length || card.row < groupEnd) {
        groupCards.push(card);
        groupEnd = Math.max(groupEnd, cardEnd);
        return;
      }
      flushGroup();
      groupCards = [card];
      groupEnd = cardEnd;
    });
    flushGroup();
  });

  return stacks.sort((left, right) => {
    if (left.column !== right.column) {
      return left.column - right.column;
    }
    return left.row - right.row;
  });
}

Page({
  data: {
    currentGroupId: null,
    selectedDate: todayString(),
    selectedDateText: "",
    weekStart: "",
    weekRangeText: "",
    weekMonthText: "",
    weekLabels,
    weekDays: [],
    periods: [],
    periodRows: [],
    gridCells: [],
    gridRowsStyle: "",
    scheduleCards: [],
    scheduleStacks: [],
    eventCount: 0,
    courseCount: 0,
    loading: false,
    canManageEvents: false,
    canManageCourses: false,
    actionMenuVisible: false,
    nlpHint: "员工可创建日程；课程管理员可创建课程和日程",
    nlpVisible: false,
    nlpParsing: false,
    nlpText: "",
    parseResult: null,
    parseTitle: "",
    confirmText: "确认创建",
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
    sheetItems: [],
    activeCard: null,
    eventForm: {
      isEdit: false,
      eventId: null,
      version: null,
      title: "",
      date: todayString(),
      startTime: "09:00",
      endTime: "10:00",
      location: "",
      note: ""
    },
    eventSaving: false,
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
    coursePeriodLabels: ["1节", "2节"],
    courseSaving: false
  },

  onLoad() {
    this.rebuildWeek(todayString());
  },

  async onShow() {
    if (!getStoredToken()) {
      clearStoredGroupId();
      getApp().globalData.currentGroupId = null;
      this.setData({
        currentGroupId: null,
        scheduleCards: [],
        scheduleStacks: [],
        eventCount: 0,
        courseCount: 0,
        canManageEvents: false,
        canManageCourses: false,
        actionMenuVisible: false
      });
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    const groupId = getApp().globalData.currentGroupId;
    const selectedDate = this.data.selectedDate || todayString();
    this.setData({ currentGroupId: groupId });
    refreshTabBar(this);
    this.rebuildWeek(selectedDate);
    if (!groupId) {
      this.setData({
        scheduleCards: [],
        scheduleStacks: [],
        eventCount: 0,
        courseCount: 0,
        canManageEvents: false,
        canManageCourses: false,
        actionMenuVisible: false
      });
      return;
    }
    let access = null;
    try {
      access = await refreshGroupAccess(groupId);
    } catch (error) {
      console.error("load calendar access failed", error);
      this.setData({ scheduleCards: [], scheduleStacks: [], canManageEvents: false, canManageCourses: false });
      return;
    }
    if (!access) {
      this.setData({ scheduleCards: [], scheduleStacks: [], canManageEvents: false, canManageCourses: false });
      return;
    }
    const canManageEvents = Boolean(access.permissions.can_manage_events);
    const canManageCourses = Boolean(access.permissions.can_manage_courses);
    this.setData({
      canManageEvents,
      canManageCourses,
      nlpHint: canManageCourses ? "可创建、修改、删除课程和日程" : "当前身份可创建、修改、删除日程"
    });
    refreshTabBar(this);
    if (!access.permissions.can_view_events) {
      wx.switchTab({ url: "/pages/course/index" });
      return;
    }
    connectGroupSocket(groupId, this.handleSocketMessage.bind(this));
    this.loadWeekSchedule();
  },

  rebuildWeek(selectedDate) {
    const weekStart = getWeekStart(selectedDate);
    const today = todayString();
    const weekDays = weekLabels.map((weekday, index) => {
      const date = addDays(weekStart, index);
      return {
        weekday,
        date,
        dateLabel: formatDateLabel(date),
        isToday: date === today,
        isSelected: date === selectedDate
      };
    });
    this.setData({
      selectedDate,
      selectedDateText: formatSelectedDate(selectedDate),
      weekStart,
      weekRangeText: `${weekDays[0].dateLabel} - ${weekDays[6].dateLabel}`,
      weekMonthText: formatMonthLabel(weekDays[0].date),
      weekDays
    });
  },

  async loadWeekSchedule() {
    const groupId = getApp().globalData.currentGroupId;
    if (!groupId) {
      this.setData({ scheduleCards: [], scheduleStacks: [], eventCount: 0, courseCount: 0, loading: false });
      return;
    }
    const dates = this.data.weekDays.map((day) => day.date);
    this.setData({ loading: true });
    try {
      const periods = await request(`/groups/${groupId}/periods`);
      const dailyGroups = await Promise.all(
        dates.map((date, dayIndex) =>
          request(`/groups/${groupId}/events/daily?target_date=${date}`).then((items) =>
            items.map((item) => Object.assign({ date, dayIndex }, item))
          )
        )
      );
      const rawItems = [];
      dailyGroups.forEach((items) => {
        items.forEach((item) => rawItems.push(item));
      });
      this.setData(this.buildGridState(periods, rawItems));
    } catch (error) {
      console.error("load week schedule failed", error);
      wx.showToast({ title: "加载日程失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  buildGridState(periods, rawItems) {
    const periodRows = periods.map((period, index) => ({
      ...period,
      row: index + 1,
      startText: formatTime(period.start_time),
      endText: formatTime(period.end_time),
      startMinute: minutesFromClock(period.start_time),
      endMinute: minutesFromClock(period.end_time)
    }));
    const periodIndexMap = {};
    periodRows.forEach((period) => {
      periodIndexMap[period.period_index] = period.row;
    });
    const gridCells = [];
    periodRows.forEach((period) => {
      for (let day = 1; day <= 7; day += 1) {
        gridCells.push({
          key: `${period.period_index}-${day}`,
          row: period.row,
          column: day + 1
        });
      }
    });
    const scheduleCards = rawItems.map((item) => {
      if (item.type === "course") {
        const color = pickColor(courseColors, item);
        const row = periodIndexMap[item.start_period] || Number(item.start_period || 1);
        const span = Math.max(1, Number(item.end_period || item.start_period) - Number(item.start_period) + 1);
        return {
          key: `course-${item.id}-${item.date}`,
          id: item.id,
          type: "course",
          title: item.title,
          date: item.date,
          column: item.dayIndex + 2,
          row,
          span,
          background: color.background,
          shadow: color.shadow,
          typeLabel: "课程",
          primaryText: item.location || "",
          secondaryText: `${item.start_period}-${item.end_period}节`,
          compact: span <= 1
        };
      }
      const placement = eventPlacement(periodRows, item.start_time, item.end_time);
      const color = pickColor(eventColors, item);
      return {
        key: `event-${item.id}-${item.date}`,
        id: item.id,
        type: "event",
        title: item.title,
        date: item.date,
        column: item.dayIndex + 2,
        row: placement.row,
        span: placement.span,
        background: color.background,
        shadow: color.shadow,
        typeLabel: "日程",
        primaryText: item.location || "",
        secondaryText: `${formatTime(item.start_time)}-${formatTime(item.end_time)}`,
        compact: placement.span <= 1
      };
    });
    const scheduleStacks = buildScheduleStacks(scheduleCards);
    const eventCount = scheduleCards.filter((item) => item.type === "event").length;
    const courseCount = scheduleCards.filter((item) => item.type === "course").length;
    return {
      periods,
      periodRows,
      gridCells,
      gridRowsStyle: `grid-template-rows: repeat(${Math.max(periodRows.length, 1)}, 108rpx);`,
      scheduleCards,
      scheduleStacks,
      eventCount,
      courseCount
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
          canManageEvents: Boolean(access.permissions.can_manage_events),
          canManageCourses: Boolean(access.permissions.can_manage_courses),
          actionMenuVisible: false
        });
        this.setData({
          nlpHint: access.permissions.can_manage_courses
            ? "可创建、修改、删除课程和日程"
            : "当前身份可创建、修改、删除日程"
        });
        refreshTabBar(this);
        if (!access.permissions.can_view_events) {
          wx.switchTab({ url: "/pages/course/index" });
        }
      });
      return;
    }
    if (type.startsWith("event.") || type.startsWith("course.") || type.startsWith("semester.")) {
      this.setData({ syncStatus: "syncing" });
      this.loadWeekSchedule().finally(() => {
        this.setData({ syncStatus: "idle" });
      });
    }
  },

  selectDate(event) {
    const date = event.currentTarget.dataset.date;
    if (!date) {
      return;
    }
    this.setData({ actionMenuVisible: false });
    this.rebuildWeek(date);
  },

  selectDateByValue(date) {
    this.setData({ actionMenuVisible: false });
    this.rebuildWeek(date);
    this.loadWeekSchedule();
  },

  prevWeek() {
    this.setData({ actionMenuVisible: false });
    this.selectDateByValue(addDays(this.data.weekStart, -7));
  },

  nextWeek() {
    this.setData({ actionMenuVisible: false });
    this.selectDateByValue(addDays(this.data.weekStart, 7));
  },

  goToday() {
    this.setData({ actionMenuVisible: false });
    this.selectDateByValue(todayString());
  },

  refresh() {
    this.setData({ actionMenuVisible: false });
    this.loadWeekSchedule();
  },

  toggleActionMenu() {
    if (!this.data.canManageEvents) {
      wx.showToast({ title: "没有日程管理权限", icon: "none" });
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

  goCreateEventFromMenu() {
    this.setData({ actionMenuVisible: false });
    this.goCreateEvent();
  },

  goCreateEvent() {
    this.setData({ actionMenuVisible: false });
    if (!getApp().globalData.currentGroupId) {
      wx.showToast({ title: "请先选择群组", icon: "none" });
      return;
    }
    if (!this.data.canManageEvents) {
      wx.showToast({ title: "没有日程管理权限", icon: "none" });
      return;
    }
    this.openEventSheet();
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

  openScheduleStack(event) {
    const stackKey = event.currentTarget.dataset.stackKey;
    const stack = this.data.scheduleStacks.find((item) => item.stackKey === stackKey);
    if (!stack) {
      return;
    }
    if (stack.isStack) {
      this.setCustomTabBarHidden(true);
      this.setData({
        sheetVisible: true,
        sheetMode: "stack",
        sheetTitle: "重叠安排",
        sheetItems: stack.items,
        activeCard: null,
        actionMenuVisible: false
      });
      return;
    }
    this.openScheduleCard(stack);
  },

  selectSheetItem(event) {
    const key = event.currentTarget.dataset.key;
    const card = this.data.sheetItems.find((item) => item.key === key);
    if (card) {
      this.openScheduleCard(card);
    }
  },

  openScheduleCard(card) {
    if (!card) {
      return;
    }
    if (card.type === "event") {
      if (!this.data.canManageEvents) {
        this.openDetailSheet(card);
        return;
      }
      this.openEventSheet(card);
      return;
    }
    if (this.data.canManageCourses) {
      this.openCourseSheet(card);
      return;
    }
    this.openDetailSheet(card);
  },

  openDetailSheet(card) {
    this.setCustomTabBarHidden(true);
    this.setData({
      sheetVisible: true,
      sheetMode: "detail",
      sheetTitle: card.title,
      activeCard: card,
      sheetItems: []
    });
  },

  closeSheet() {
    this.setCustomTabBarHidden(false);
    this.setData({
      sheetVisible: false,
      sheetMode: "",
      sheetTitle: "",
      sheetItems: [],
      activeCard: null,
      eventSaving: false,
      courseSaving: false
    });
  },

  openEventSheet(card) {
    const selectedDate = (card && card.date) || this.data.selectedDate || todayString();
    const baseForm = {
      isEdit: false,
      eventId: null,
      version: null,
      title: "",
      date: selectedDate,
      startTime: "09:00",
      endTime: "10:00",
      location: "",
      note: ""
    };
    this.setCustomTabBarHidden(true);
    this.setData({
      sheetVisible: true,
      sheetMode: "event-form",
      sheetTitle: card ? "编辑日程" : "新增日程",
      activeCard: card || null,
      sheetItems: [],
      eventForm: baseForm
    });
    if (card && card.id) {
      this.loadEventIntoSheet(card.id);
    }
  },

  async loadEventIntoSheet(eventId) {
    const groupId = getApp().globalData.currentGroupId;
    if (!groupId) {
      return;
    }
    try {
      const event = await request(`/groups/${groupId}/events/${eventId}`);
      this.setData({
        eventForm: {
          isEdit: true,
          eventId: event.id,
          version: event.version,
          title: event.title || "",
          date: isoDate(event.start_time),
          startTime: isoTime(event.start_time),
          endTime: isoTime(event.end_time),
          location: event.location || "",
          note: event.note || ""
        },
        sheetTitle: "编辑日程"
      });
    } catch (error) {
      console.error("load event into sheet failed", error);
      wx.showToast({ title: "加载日程失败", icon: "none" });
    }
  },

  onEventTitleInput(event) {
    this.setData({ "eventForm.title": event.detail.value });
  },

  onEventDateChange(event) {
    this.setData({ "eventForm.date": event.detail.value });
  },

  onEventStartTimeChange(event) {
    this.setData({ "eventForm.startTime": event.detail.value });
  },

  onEventEndTimeChange(event) {
    this.setData({ "eventForm.endTime": event.detail.value });
  },

  onEventLocationInput(event) {
    this.setData({ "eventForm.location": event.detail.value });
  },

  onEventNoteInput(event) {
    this.setData({ "eventForm.note": event.detail.value });
  },

  async submitEventInSheet() {
    const groupId = getApp().globalData.currentGroupId;
    const form = this.data.eventForm;
    if (!groupId || this.data.eventSaving) {
      return;
    }
    if (!this.data.canManageEvents) {
      wx.showToast({ title: "没有日程管理权限", icon: "none" });
      return;
    }
    if (!form.title.trim()) {
      wx.showToast({ title: "请输入标题", icon: "none" });
      return;
    }
    const start = new Date(toIsoLocal(form.date, form.startTime));
    const end = new Date(toIsoLocal(form.date, form.endTime));
    if (end <= start) {
      wx.showToast({ title: "结束时间需晚于开始时间", icon: "none" });
      return;
    }
    const data = {
      title: form.title.trim(),
      location: form.location.trim() || null,
      note: form.note.trim() || null,
      start_time: toIsoLocal(form.date, form.startTime),
      end_time: toIsoLocal(form.date, form.endTime),
      is_all_day: false
    };
    if (form.isEdit) {
      data.version = form.version;
    }
    this.setData({ eventSaving: true });
    try {
      await request(
        form.isEdit ? `/groups/${groupId}/events/${form.eventId}` : `/groups/${groupId}/events`,
        { method: form.isEdit ? "PATCH" : "POST", data }
      );
      wx.showToast({ title: "已保存", icon: "success" });
      this.closeSheet();
      this.selectDateByValue(form.date);
    } catch (error) {
      console.error("save event in sheet failed", error);
      wx.showToast({ title: toastTitle(error, "保存失败"), icon: "none" });
    } finally {
      this.setData({ eventSaving: false });
    }
  },

  deleteEventInSheet() {
    const groupId = getApp().globalData.currentGroupId;
    const form = this.data.eventForm;
    if (!groupId || !form.eventId) {
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
        try {
          await request(`/groups/${groupId}/events/${form.eventId}`, { method: "DELETE" });
          wx.showToast({ title: "已删除", icon: "success" });
          this.closeSheet();
          this.loadWeekSchedule();
        } catch (error) {
          console.error("delete event in sheet failed", error);
          wx.showToast({ title: toastTitle(error, "删除失败"), icon: "none" });
        }
      }
    });
  },

  async openCourseSheet(card) {
    const groupId = getApp().globalData.currentGroupId;
    if (!groupId || !card || !card.id) {
      return;
    }
    this.setCustomTabBarHidden(true);
    this.setData({
      sheetVisible: true,
      sheetMode: "course-form",
      sheetTitle: "编辑课程",
      activeCard: card,
      sheetItems: []
    });
    try {
      const periods = this.data.periods.length ? this.data.periods : await request(`/groups/${groupId}/periods`);
      const semester = await request(`/groups/${groupId}/semesters/current`);
      const course = await request(`/groups/${groupId}/courses/${card.id}`);
      const startPeriodIndex = Math.max(
        0,
        periods.findIndex((period) => period.period_index === course.start_period)
      );
      const endPeriodIndex = Math.max(
        startPeriodIndex,
        periods.findIndex((period) => period.period_index === course.end_period)
      );
      this.setData({
        periods,
        coursePeriodLabels: periods.map((period) => `${period.period_index}节`),
        courseForm: {
          isEdit: true,
          courseId: course.id,
          version: course.version,
          semesterId: semester.id,
          name: course.name || "",
          teacher: course.teacher || "",
          location: course.location || "",
          weekdayIndex: Math.max(0, (course.day_of_week || 1) - 1),
          startPeriodIndex,
          endPeriodIndex,
          weekStart: String(course.week_start || 1),
          weekEnd: String(course.week_end || 16)
        }
      });
    } catch (error) {
      console.error("load course into sheet failed", error);
      wx.showToast({ title: toastTitle(error, "加载课程失败"), icon: "none" });
      this.openDetailSheet(card);
    }
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
      week_end: weekEnd,
      version: form.version
    };
    this.setData({ courseSaving: true });
    try {
      await request(`/groups/${groupId}/courses/${form.courseId}`, { method: "PATCH", data });
      wx.showToast({ title: "已保存", icon: "success" });
      this.closeSheet();
      this.loadWeekSchedule();
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
          this.loadWeekSchedule();
        } catch (error) {
          console.error("delete course in sheet failed", error);
          wx.showToast({ title: toastTitle(error, "删除失败"), icon: "none" });
        }
      }
    });
  },

  openNlp() {
    this.setData({ actionMenuVisible: false });
    if (!getApp().globalData.currentGroupId) {
      wx.showToast({ title: "请先选择群组", icon: "none" });
      return;
    }
    if (!this.data.canManageEvents) {
      wx.showToast({ title: "没有日程管理权限", icon: "none" });
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
      confirmText: "确认创建",
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
      confirmText: "确认创建",
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
            current_date: this.data.selectedDate || todayString(),
            timezone: "Asia/Shanghai"
          }
        }
      });
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
      console.error("parse nlp failed", error);
      wx.showToast({ title: toastTitle(error, "解析失败"), icon: "none" });
    } finally {
      this.setData({ nlpParsing: false });
    }
  },

  async confirmNlp() {
    const groupId = getApp().globalData.currentGroupId;
    const result = this.data.parseResult;
    if (!groupId || !result || result.intent === "unknown") {
      wx.showToast({ title: "没有可执行的操作", icon: "none" });
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
      const created = await request("/nlp/confirm", {
        method: "POST",
        data: {
          group_id: groupId,
          intent: result.intent,
          draft: result.draft,
          missing_fields: this.data.missingFields
        }
      });
      if (created.action === "select_target") {
        this.setData({
          nlpCandidates: created.candidates || [],
          selectedCandidateId: null,
          warnings: [created.message || "请选择要操作的目标"]
        });
        wx.showToast({ title: "请选择目标", icon: "none" });
        return;
      }
      wx.showToast({ title: "已完成", icon: "success" });
      if (created.type === "event" && result.draft.start_time) {
        this.selectDateByValue(String(result.draft.start_time).slice(0, 10));
      } else if (created.type === "event" && result.draft.changes && result.draft.changes.start_time) {
        this.selectDateByValue(String(result.draft.changes.start_time).slice(0, 10));
      } else if (created.type === "event" && result.draft.changes && result.draft.changes.date) {
        this.selectDateByValue(result.draft.changes.date);
      } else {
        this.refresh();
      }
      this.closeNlp();
    } catch (error) {
      console.error("confirm nlp failed", error);
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
        title: "确认自然语言操作",
        content: notice,
        confirmText: result.intent.indexOf("delete_") === 0 ? "确认删除" : "继续",
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

