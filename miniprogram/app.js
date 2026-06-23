const { getStoredToken, getStoredGroupId } = require("./utils/session");

function pad(value) {
  return `${value}`.padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayString() {
  return formatDate(new Date());
}

function getWeekStart(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() - weekday + 1);
  return formatDate(date);
}

const initialSelectedDate = todayString();

App({
  globalData: {
    token: getStoredToken(),
    currentGroupId: getStoredGroupId(),
    scheduleSelectedDate: initialSelectedDate,
    scheduleWeekStart: getWeekStart(initialSelectedDate),
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
