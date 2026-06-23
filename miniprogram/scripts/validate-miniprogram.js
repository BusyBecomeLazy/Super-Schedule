const fs = require("fs");
const path = require("path");
const { buildTimeBandCardGroups } = require("../utils/schedule-segments");

const root = process.cwd();
const expectedAppId = "wx2066bdebb597e32c";

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`OK   ${message}`);
}

function read(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    fail(`Missing ${relativePath}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function mustContain(relativePath, pattern, label) {
  const content = read(relativePath);
  const found = typeof pattern === "string" ? content.includes(pattern) : pattern.test(content);
  if (found) {
    pass(label || `${relativePath} contains ${pattern}`);
  } else {
    fail(`${relativePath} is missing ${label || pattern}`);
  }
}

function mustNotContain(relativePath, pattern, label) {
  const content = read(relativePath);
  const found = typeof pattern === "string" ? content.includes(pattern) : pattern.test(content);
  if (found) {
    fail(`${relativePath} still contains ${label || pattern}`);
  } else {
    pass(`${relativePath} does not contain ${label || pattern}`);
  }
}

function checkJson(relativePath, check) {
  try {
    const parsed = JSON.parse(read(relativePath));
    check(parsed);
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`);
  }
}

function checkSyntax(relativePath) {
  try {
    new Function(read(relativePath));
    pass(`${relativePath} parses`);
  } catch (error) {
    fail(`${relativePath} has a syntax error: ${error.message}`);
  }
}

function checkWxssBraces(relativePath) {
  const content = read(relativePath);
  let depth = 0;
  for (const character of content) {
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth < 0) {
        fail(`${relativePath} has an extra closing brace`);
        return;
      }
    }
  }
  if (depth === 0) {
    pass(`${relativePath} braces are balanced`);
  } else {
    fail(`${relativePath} has ${depth} unclosed brace(s)`);
  }
}

function readConstString(relativePath, constName) {
  const content = read(relativePath);
  const match = content.match(new RegExp(`const\\s+${constName}\\s*=\\s*["']([^"']+)["']\\s*;`));
  if (!match) {
    fail(`${relativePath} is missing const ${constName}`);
    return null;
  }
  return match[1];
}

function checkLanHostSync() {
  const tsLanHost = readConstString("utils/config.ts", "LAN_HOST");
  const jsLanHost = readConstString("utils/config.js", "LAN_HOST");
  if (!tsLanHost || !jsLanHost) {
    return;
  }
  if (tsLanHost === jsLanHost) {
    pass("utils/config.ts and utils/config.js LAN_HOST are in sync");
  } else {
    fail(`LAN_HOST mismatch: utils/config.ts=${tsLanHost}, utils/config.js=${jsLanHost}`);
  }
}

function checkPageFiles(pages) {
  pages.forEach((page) => {
    ["js", "wxml", "json", "wxss"].forEach((extension) => {
      const relativePath = `${page}.${extension}`;
      if (fs.existsSync(path.join(root, relativePath))) {
        pass(`${relativePath} exists`);
      } else {
        fail(`${relativePath} is missing`);
      }
    });
  });
}

function checkTimeBandCardGrouping() {
  const groups = buildTimeBandCardGroups([
    { key: "first", segmentKey: "morning", dayIndex: 0, sortOrder: 540, startMinute: 540, endMinute: 600, background: "#111" },
    { key: "overlap", segmentKey: "morning", dayIndex: 0, sortOrder: 570, startMinute: 570, endMinute: 630, background: "#222" },
    { key: "adjacent", segmentKey: "morning", dayIndex: 0, sortOrder: 630, startMinute: 630, endMinute: 690, background: "#333" }
  ]);
  if (groups.length === 2 && groups[0].isStack && groups[0].items.length === 2 && !groups[1].isStack) {
    pass("time band grouping stacks overlaps but leaves adjacent cards separate");
  } else {
    fail("time band grouping should stack overlaps but leave adjacent cards separate");
  }
  const prioritizedGroups = buildTimeBandCardGroups([
    { key: "course", type: "course", segmentKey: "morning", dayIndex: 0, sortOrder: 480, startMinute: 480, endMinute: 580, background: "#111" },
    { key: "event", type: "event", segmentKey: "morning", dayIndex: 0, sortOrder: 540, startMinute: 540, endMinute: 600, background: "#222" }
  ], { priorityTypes: ["event"] });
  if (prioritizedGroups.length === 1 && prioritizedGroups[0].main.type === "event" && prioritizedGroups[0].items[1].type === "course") {
    pass("time band grouping can keep event cards above overlapping courses");
  } else {
    fail("time band grouping should keep event cards above overlapping courses when prioritized");
  }
}

checkJson("project.config.json", (config) => {
  if (config.appid === expectedAppId && config.compileType === "miniprogram") {
    pass("project.config.json points at the expected mini program");
  } else {
    fail("Run this from the active miniprogram directory opened in WeChat DevTools");
  }
});

checkJson("app.json", (config) => {
  const pages = config.pages || [];
  [
    "pages/calendar/index",
    "pages/course/index",
    "pages/manage/index"
  ].forEach((page) => {
    if (pages.includes(page)) {
      pass(`app.json includes ${page}`);
    } else {
      fail(`app.json is missing ${page}`);
    }
  });
  ["pages/manage/groups/index", "pages/manage/members/index", "pages/manage/dev/index"].forEach((page) => {
    if (pages.includes(page)) {
      fail(`app.json should not include obsolete ${page}`);
    } else {
      pass(`app.json does not include obsolete ${page}`);
    }
  });
  checkPageFiles(pages);
});

[
  "app.js",
  "utils/config.js",
  "custom-tab-bar/index.js",
  "pages/calendar/index.js",
  "pages/calendar/index.ts",
  "pages/course/index.js",
  "pages/manage/index.js"
].forEach(checkSyntax);

[
  "app.wxss",
  "custom-tab-bar/index.wxss",
  "pages/calendar/index.wxss",
  "pages/course/index.wxss",
  "pages/manage/index.wxss"
].forEach(checkWxssBraces);

checkLanHostSync();
checkTimeBandCardGrouping();

mustContain("custom-tab-bar/index.js", "setHidden(hidden)", "custom tab bar hide API");
mustContain("custom-tab-bar/index.wxml", "hidden ? 'hidden' : ''", "custom tab bar hidden class binding");
mustContain("custom-tab-bar/index.wxss", ".tabbar.hidden", "custom tab bar hidden style");

mustContain("pages/calendar/index.js", "setCustomTabBarHidden", "calendar sheet hides tab bar");
mustContain("pages/calendar/index.js", "buildTimeBands", "calendar builds horizontal time bands");
mustContain("pages/calendar/index.js", "buildTimeBandCardGroups", "calendar groups true overlaps");
mustContain("pages/calendar/index.js", "priorityTypes: [\"event\"]", "calendar keeps events above overlapping courses");
mustContain("pages/calendar/index.js", "scheduleWeekStart", "calendar publishes the selected week for tab sync");
mustContain("pages/calendar/index.js", "scheduleSelectedDate", "calendar publishes the selected date for tab sync");
mustContain("pages/calendar/index.js", "formatClock(period.start_time)", "calendar period times use clock formatting");
mustContain("pages/calendar/index.wxml", "form-control title-input", "calendar title input styling");
mustContain("pages/calendar/index.wxml", "picker-value has-arrow", "calendar picker arrow affordance");
mustContain("pages/calendar/index.wxml", "form-control textarea-control nlp-textarea", "calendar NLP textarea styling");
mustContain("pages/calendar/index.wxml", "wx:if=\"{{nlpVisible}}\" class=\"sheet-host\"", "calendar NLP uses bottom sheet");
mustContain("pages/calendar/index.wxml", "<view class=\"sheet-title\">AI 录入</view>", "calendar NLP sheet title");
mustNotContain("pages/calendar/index.wxml", "class=\"panel section nlp-panel\"", "old calendar inline NLP panel");
mustContain("pages/calendar/index.wxml", "class=\"menu-item primary\" bindtap=\"openNlpFromMenu\"", "calendar AI menu item matches create style");
mustContain("pages/calendar/index.js", "this.setCustomTabBarHidden(true);\n    this.setData({ nlpVisible: true })", "calendar NLP hides tab bar");
mustContain("pages/calendar/index.js", "parseResult: null,\n      parseTitle: \"\"", "calendar NLP input clears stale parse result");
mustContain("pages/calendar/index.wxml", "bindtap=\"goManage\"", "calendar empty state manage action");
mustContain("pages/calendar/index.wxml", "bindtap=\"goCreateEvent\"", "calendar empty week create action");
mustContain("pages/calendar/index.wxml", "class=\"time-band", "calendar renders horizontal time bands");
mustContain("pages/calendar/index.wxml", "class=\"schedule-stack", "calendar renders overlap stack containers");
mustContain("pages/calendar/index.wxml", "hover-class=\"schedule-stack-press\"", "calendar stack cards have press feedback");
mustContain("pages/calendar/index.js", "goManage()", "calendar manage navigation");
mustContain("pages/calendar/index.wxss", "z-index: 2147483647", "calendar sheet high z-index");
mustContain("pages/calendar/index.wxss", ".time-band-day", "calendar flex day columns");
mustContain("pages/calendar/index.wxss", ".time-band-day .schedule-stack", "calendar keeps overlap stacks inside flex cells");
mustContain("pages/calendar/index.wxss", "gap: 10rpx;", "calendar cards have stack spacing");
mustContain("pages/calendar/index.wxss", "height: calc(100vh - 132rpx);", "calendar reserves the visible area above the tab bar");
mustContain("pages/calendar/index.wxss", "flex: 1 1 0;", "calendar time bands share the available height");
mustContain("pages/calendar/index.wxss", "height: 100%;", "calendar cards stretch to fill their cells");
mustNotContain("pages/calendar/index.wxml", "scheduleStacks", "calendar no longer renders absolute schedule stacks");
mustNotContain("pages/calendar/index.wxml", "box-shadow: {{item.shadow}}", "inline single-card shadow");
mustContain("pages/calendar/index.wxss", "box-shadow: none !important", "calendar single cards force no shadow");
mustNotContain("pages/calendar/index.wxss", "border-left: 8rpx", "thick single event edge");
mustContain("pages/calendar/index.wxss", "box-shadow: 0 10rpx 24rpx rgba(21, 91, 212, 0.07)", "calendar parse result confirmation panel");
mustContain("pages/calendar/index.wxss", ".draft-row + .draft-row", "calendar parse rows are grouped");
mustContain("pages/calendar/index.wxss", ".grid-empty-content", "calendar grid empty content layout");
mustNotContain("pages/calendar/index.wxml", "stack-count", "old overlap count badge");
mustNotContain("pages/calendar/index.js", "个安排重叠", "old merged overlap title");
mustNotContain("pages/calendar/index.js", "点击展开", "old merged overlap label");

mustContain("pages/course/index.js", "setCustomTabBarHidden", "course sheet hides tab bar");
mustContain("pages/course/index.js", "scheduleWeekStart", "course follows the selected calendar week");
mustContain("pages/course/index.js", "currentSyncedWeekStart", "course uses the natural week as display source");
mustContain("pages/course/index.js", "scheduleSelectedDate", "course can return to the real selected date");
mustNotContain("pages/course/index.js", "weekStartForTeachingWeek", "course no longer derives display week from teaching week");
mustContain("pages/course/index.wxml", "form-control title-input", "course title input styling");
mustContain("pages/course/index.wxml", "form-control textarea-control nlp-textarea", "course NLP textarea styling");
mustContain("pages/course/index.wxml", "wx:if=\"{{nlpVisible}}\" class=\"sheet-host\"", "course NLP uses bottom sheet");
mustContain("pages/course/index.wxml", "<view class=\"sheet-title\">AI 录入</view>", "course NLP sheet title");
mustNotContain("pages/course/index.wxml", "class=\"panel section nlp-panel\"", "old course inline NLP panel");
mustContain("pages/course/index.wxml", "class=\"menu-item primary\" bindtap=\"openNlpFromMenu\"", "course AI menu item matches create style");
mustContain("pages/course/index.js", "this.setCustomTabBarHidden(true);\n    this.setData({ nlpVisible: true })", "course NLP hides tab bar");
mustContain("pages/course/index.js", "parseResult: null,\n      parseTitle: \"\"", "course NLP input clears stale parse result");
mustContain("pages/course/index.wxml", "bindtap=\"goManage\"", "course empty state manage action");
mustContain("pages/course/index.wxml", "bindtap=\"goCreateCourse\"", "course empty week create action");
mustContain("pages/course/index.js", "buildTimeBands", "course builds horizontal time bands");
mustContain("pages/course/index.js", "buildTimeBandCardGroups", "course groups true overlaps");
mustContain("pages/course/index.wxml", "class=\"time-band", "course renders horizontal time bands");
mustContain("pages/course/index.wxml", "class=\"course-stack", "course renders overlap stack containers");
mustContain("pages/course/index.wxml", "hover-class=\"course-stack-press\"", "course stack cards have press feedback");
mustContain("pages/course/index.js", "goManage()", "course manage navigation");
mustContain("pages/course/index.wxss", "z-index: 2147483647", "course sheet high z-index");
mustContain("pages/course/index.wxss", ".course-stack-press", "course stack press feedback style");
mustContain("pages/course/index.wxss", ".time-band-day", "course flex day columns");
mustContain("pages/course/index.wxss", ".time-band-day .course-stack", "course keeps overlap stacks inside flex cells");
mustContain("pages/course/index.wxss", "gap: 10rpx;", "course cards have stack spacing");
mustContain("pages/course/index.wxss", "height: calc(100vh - 132rpx);", "course reserves the visible area above the tab bar");
mustContain("pages/course/index.wxss", "flex: 1 1 0;", "course time bands share the available height");
mustContain("pages/course/index.wxss", "height: 100%;", "course cards stretch to fill their cells");
mustNotContain("pages/course/index.wxml", "box-shadow: {{item.shadow}}", "inline course-card shadow");
mustContain("pages/course/index.wxss", "box-shadow: none !important", "course cards force no shadow");
mustContain("pages/course/index.wxss", "box-shadow: 0 10rpx 24rpx rgba(21, 91, 212, 0.07)", "course parse result confirmation panel");
mustContain("pages/course/index.wxss", ".draft-row + .draft-row", "course parse rows are grouped");
mustContain("pages/course/index.wxss", ".grid-empty-content", "course grid empty content layout");

mustContain("pages/manage/index.wxml", "class=\"profile-card section\"", "manage home profile card");
mustContain("pages/manage/index.wxml", "当前身份：{{roleText}}", "manage home role summary");
mustContain("pages/manage/index.wxml", "bindtap=\"goGroups\"", "manage home group entry");
mustContain("pages/manage/index.wxml", "bindtap=\"goMembers\"", "manage home member entry");
mustContain("pages/manage/index.wxml", "bindtap=\"goDevOptions\"", "manage home dev entry");
mustNotContain("pages/manage/index.js", "wx.navigateTo", "manage home page navigation");
mustContain("pages/manage/index.js", "openManageSheet(\"groups\")", "manage group entry opens bottom sheet");
mustContain("pages/manage/index.js", "openManageSheet(\"members\")", "manage member entry opens bottom sheet");
mustContain("pages/manage/index.js", "openManageSheet(\"dev\")", "manage dev entry opens bottom sheet");
mustContain("pages/manage/index.js", "setCustomTabBarHidden", "manage sheet hides tab bar");
mustContain("pages/manage/index.wxss", ".settings-cell", "manage home settings cells");
mustContain("pages/manage/index.wxml", "wx:if=\"{{activeSheet}}\" class=\"sheet-host\"", "manage entries use bottom sheet");
mustContain("pages/manage/index.wxml", "compact-sheet", "manage dev sheet compact class");
mustContain("pages/manage/index.wxml", "hover-class=\"settings-cell-press\"", "manage settings cells native press feedback");
mustContain("pages/manage/index.wxml", "hover-class=\"button-press\"", "manage sheet buttons native press feedback");
mustContain("pages/manage/index.wxml", "activeSheet === 'groups'", "manage groups sheet");
mustContain("pages/manage/index.wxml", "activeSheet === 'members'", "manage members sheet");
mustContain("pages/manage/index.wxml", "activeSheet === 'dev'", "manage dev sheet");
mustContain("pages/manage/index.wxml", "manage-form", "manage groups sheet form");
mustContain("pages/manage/index.wxml", "select-chip", "manage members sheet picker");
mustNotContain("pages/manage/index.wxml", "permission-grid", "old manage permission grid");
mustNotContain("pages/manage/index.wxml", "permission-tags", "manage home permission tags");
mustContain("pages/manage/index.wxml", "placeholder-class=\"input-placeholder\"", "manage groups sheet light placeholder style");
mustContain("pages/manage/index.wxml", "class=\"form-block\"", "manage groups sheet create and join blocks");
mustContain("pages/manage/index.wxml", "class=\"cell group-cell", "manage groups sheet cell list");
mustContain("pages/manage/index.wxml", "class=\"member-avatar\"", "manage members sheet avatar");
mustContain("pages/manage/index.wxml", "切换开发账号", "manage dev sheet switch entry");
mustContain("pages/manage/index.wxml", "groupsLoading", "manage groups sheet loading state");
mustContain("pages/manage/index.wxml", "membersLoading", "manage members sheet loading state");
mustContain("pages/manage/index.wxss", "z-index: 2147483647", "manage sheet high z-index");
mustContain("pages/manage/index.wxss", ".bottom-sheet.compact-sheet", "manage dev sheet compact height");
mustContain("pages/manage/index.wxss", "overflow: hidden", "manage sheet clipped rounded corners");
mustContain("pages/manage/index.wxss", "flex-shrink: 0", "manage sheet fixed header layout");
mustContain("pages/manage/index.wxss", ".settings-cell-press", "manage settings press style");
mustContain("pages/manage/index.wxss", ".button-press", "manage button press style");
mustContain("pages/manage/index.wxss", ".manage-page .button.secondary.form-submit", "manage groups sheet secondary submit is neutral");
mustContain("pages/manage/index.wxss", ".text-action", "manage groups sheet list actions are text-like");
mustContain("pages/manage/index.wxss", ".member-cell picker", "manage member role picker fixed layout");
mustContain("pages/manage/index.wxss", ".select-chip::after", "manage members sheet role picker arrow style");
mustContain("pages/manage/index.js", "groupCreating", "manage groups create loading guard");
mustContain("pages/manage/index.js", "groupJoining", "manage groups join loading guard");
mustContain("pages/manage/index.js", "groupsLoading", "manage groups request loading guard");
mustContain("pages/manage/index.js", "membersLoading", "manage members request loading guard");
mustContain("pages/manage/index.js", "avatarInitial", "manage members avatar initial");
mustContain("pages/manage/index.js", "updatingMemberId", "manage members role update loading guard");
mustContain("pages/manage/index.js", "切换开发账号", "manage dev account switch confirmation");
mustContain("pages/manage/index.js", "clearStoredToken", "manage dev clears login token");

if (!process.exitCode) {
  console.log("Mini program validation passed.");
}
