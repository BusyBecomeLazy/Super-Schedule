import re
from datetime import date, datetime, time, timedelta

from app.schemas.nlp import NlpParseResponse

WEEKDAY_MAP = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7}
UPDATE_WORDS = ("改到", "改成", "改为", "调整到", "修改为", "变更为", "换到", "调整", "修改", "变更")
DELETE_WORDS = ("删除", "取消", "移除")


def parse_text(text: str, current_date: date | None = None) -> NlpParseResponse:
    current_date = current_date or date.today()
    normalized = text.strip()
    if not normalized:
        return NlpParseResponse(
            intent="unknown",
            confidence=0.1,
            draft={},
            warnings=["请输入内容"],
            missing_fields=["输入内容"],
        )

    if _has_delete_word(normalized):
        if _looks_like_course(normalized):
            return _parse_delete_course(normalized)
        return _parse_delete_event(normalized, current_date)

    if _has_update_word(normalized):
        if _looks_like_course(normalized):
            return _parse_update_course(normalized)
        return _parse_update_event(normalized, current_date)

    if _looks_like_course(normalized):
        return _parse_course(normalized)
    return _parse_event(normalized, current_date)


def _has_delete_word(text: str) -> bool:
    return any(word in text for word in DELETE_WORDS)


def _has_update_word(text: str) -> bool:
    return any(word in text for word in UPDATE_WORDS)


def _looks_like_course(text: str) -> bool:
    return "节" in text or "课程" in text or "课" in text


def _parse_event(text: str, current_date: date) -> NlpParseResponse:
    warnings: list[str] = []
    target_date = _parse_date(text, current_date)
    start_clock = _parse_clock(text)
    if start_clock is None:
        return NlpParseResponse(
            intent="unknown",
            confidence=0.2,
            draft={},
            warnings=["缺少开始时间"],
            missing_fields=["开始时间"],
        )

    duration_hours = _parse_duration_hours(text)
    start_time = datetime.combine(target_date, start_clock)
    end_time = start_time + timedelta(hours=duration_hours or 1)
    if duration_hours is None:
        warnings.append("未识别持续时间，默认 1 小时")

    location = _parse_location(text)
    title = _guess_title(text, location)
    if not title:
        warnings.append("未识别标题")

    confidence = 0.85 if title and location else 0.72
    return NlpParseResponse(
        intent="create_event",
        confidence=confidence,
        draft={
            "title": title or "未命名日程",
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "location": location,
            "is_all_day": False,
        },
        warnings=warnings,
    )


def _parse_course(text: str) -> NlpParseResponse:
    warnings: list[str] = []
    fields = _parse_course_fields(text)

    if not fields.get("name"):
        warnings.append("未识别课程名")
    if fields.get("day_of_week") is None:
        warnings.append("未识别星期")
    if fields.get("start_period") is None or fields.get("end_period") is None:
        warnings.append("未识别节次")
    if fields.get("week_start") is None or fields.get("week_end") is None:
        warnings.append("未识别周次范围，默认 1-16 周")

    if fields.get("day_of_week") is None or fields.get("start_period") is None:
        return NlpParseResponse(
            intent="unknown",
            confidence=0.3,
            draft={},
            warnings=warnings,
            missing_fields=_course_missing_fields(fields),
        )

    return NlpParseResponse(
        intent="create_course",
        confidence=0.8 if fields.get("name") and fields.get("location") else 0.68,
        draft={
            "name": fields.get("name") or "未命名课程",
            "location": fields.get("location"),
            "day_of_week": fields["day_of_week"],
            "start_period": fields["start_period"],
            "end_period": fields["end_period"],
            "week_start": fields.get("week_start") or 1,
            "week_end": fields.get("week_end") or 16,
        },
        warnings=warnings,
    )


def _parse_delete_event(text: str, current_date: date) -> NlpParseResponse:
    subject = _strip_delete_text(text)
    target = _parse_event_selector(subject, current_date)
    warnings = _target_warnings(target, "日程")
    return NlpParseResponse(
        intent="delete_event",
        confidence=0.82 if not warnings else 0.55,
        draft={"target": target, "target_summary": _summarize_event_target(target)},
        warnings=warnings,
        missing_fields=["操作目标"] if not target else [],
    )


def _parse_delete_course(text: str) -> NlpParseResponse:
    subject = _strip_delete_text(text)
    target = _parse_course_selector(subject)
    warnings = _target_warnings(target, "课程")
    return NlpParseResponse(
        intent="delete_course",
        confidence=0.84 if not warnings else 0.56,
        draft={"target": target, "target_summary": _summarize_course_target(target)},
        warnings=warnings,
        missing_fields=["操作目标"] if not target else [],
    )


def _parse_update_event(text: str, current_date: date) -> NlpParseResponse:
    target_text, change_text = _split_update_text(text)
    target = _parse_event_selector(target_text, current_date)
    fallback_date = _date_from_target(target)
    fallback_start = _datetime_from_target(target)
    changes = _parse_event_changes(change_text, current_date, fallback_date, fallback_start)
    warnings = _target_warnings(target, "日程")
    if not changes:
        warnings.append("未识别要修改的日程内容")
    return NlpParseResponse(
        intent="update_event",
        confidence=0.78 if target and changes else 0.48,
        draft={
            "target": target,
            "changes": changes,
            "target_summary": _summarize_event_target(target),
            "change_summary": _summarize_event_changes(changes),
        },
        warnings=warnings,
        missing_fields=_update_missing_fields(target, changes),
    )


def _parse_update_course(text: str) -> NlpParseResponse:
    target_text, change_text = _split_update_text(text)
    target = _parse_course_selector(target_text)
    changes = _parse_course_fields(change_text)
    changes = {key: value for key, value in changes.items() if value is not None and value != ""}
    warnings = _target_warnings(target, "课程")
    if not changes:
        warnings.append("未识别要修改的课程内容")
    return NlpParseResponse(
        intent="update_course",
        confidence=0.8 if target and changes else 0.5,
        draft={
            "target": target,
            "changes": changes,
            "target_summary": _summarize_course_target(target),
            "change_summary": _summarize_course_changes(changes),
        },
        warnings=warnings,
        missing_fields=_update_missing_fields(target, changes),
    )


def _split_update_text(text: str) -> tuple[str, str]:
    for word in UPDATE_WORDS:
        match = re.search(rf"^把?(.+?){word}(.+)$", text)
        if match:
            return _clean_phrase(match.group(1)), _clean_phrase(match.group(2))
    for word in UPDATE_WORDS:
        index = text.find(word)
        if index > 0:
            return _clean_phrase(text[:index]), _clean_phrase(text[index + len(word) :])
    return _clean_phrase(text), ""


def _strip_delete_text(text: str) -> str:
    value = text
    for word in DELETE_WORDS:
        value = value.replace(word, "")
    return _clean_phrase(value)


def _clean_phrase(text: str) -> str:
    return re.sub(r"^[把将要请帮我\s，,。；;：:]+|[\s，,。；;：:]+$", "", text)


def _parse_event_selector(text: str, current_date: date) -> dict:
    location = _parse_location(text)
    title = _guess_title(text, location)
    target_date = _parse_optional_date(text, current_date)
    start_clock = _parse_clock(text)
    target: dict = {}
    if title:
        target["title"] = title
    if target_date:
        target["date"] = target_date.isoformat()
    if start_clock:
        target["start_time"] = datetime.combine(target_date or current_date, start_clock).isoformat()
    if location:
        target["location"] = location
    return target


def _parse_event_changes(
    text: str,
    current_date: date,
    fallback_date: date | None,
    fallback_start: datetime | None,
) -> dict:
    location = _parse_location(text)
    target_date = _parse_optional_date(text, current_date)
    start_clock = _parse_clock(text)
    duration_hours = _parse_duration_hours(text)
    title = _guess_title(text, location)
    changes: dict = {}
    if title:
        changes["title"] = title
    if location:
        changes["location"] = location
    if start_clock:
        if (
            not _has_meridiem(text)
            and fallback_start is not None
            and fallback_start.hour >= 12
            and start_clock.hour < 12
        ):
            start_clock = time(hour=start_clock.hour + 12, minute=start_clock.minute)
        start_date = target_date or fallback_date or current_date
        start_time = datetime.combine(start_date, start_clock)
        changes["start_time"] = start_time.isoformat()
        if duration_hours is not None:
            changes["end_time"] = (start_time + timedelta(hours=duration_hours)).isoformat()
    elif target_date:
        changes["date"] = target_date.isoformat()
    if duration_hours is not None:
        changes["duration_hours"] = duration_hours
    return changes


def _parse_course_selector(text: str) -> dict:
    fields = _parse_course_fields(text)
    return {key: value for key, value in fields.items() if value is not None and value != ""}


def _parse_course_fields(text: str) -> dict:
    weekday_match = re.search(r"周([一二三四五六日天])", text)
    period_range = _parse_period_range(text)
    week_range = _parse_week_range(text)
    location = _parse_location(text)
    name = _parse_course_name(text, location)
    fields = {
        "name": name,
        "location": location,
        "day_of_week": WEEKDAY_MAP[weekday_match.group(1)] if weekday_match else None,
        "start_period": period_range[0] if period_range else None,
        "end_period": period_range[1] if period_range else None,
        "week_start": week_range[0] if week_range else None,
        "week_end": week_range[1] if week_range else None,
    }
    return fields


def _course_missing_fields(fields: dict) -> list[str]:
    missing = []
    if not fields.get("name"):
        missing.append("课程名")
    if fields.get("day_of_week") is None:
        missing.append("星期")
    if fields.get("start_period") is None:
        missing.append("开始节次")
    if fields.get("end_period") is None:
        missing.append("结束节次")
    return missing


def _update_missing_fields(target: dict, changes: dict) -> list[str]:
    missing = []
    if not target:
        missing.append("操作目标")
    if not changes:
        missing.append("修改内容")
    return missing


def _parse_period_range(text: str) -> tuple[int, int] | None:
    match = re.search(r"第?\s*(\d{1,2})\s*[-到至~]\s*(\d{1,2})\s*节", text)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = re.search(r"第?\s*(\d{1,2})\s*节", text)
    if match:
        value = int(match.group(1))
        return value, value
    return None


def _parse_week_range(text: str) -> tuple[int, int] | None:
    match = re.search(r"(\d{1,2})\s*[-到至~]\s*(\d{1,2})\s*周", text)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = re.search(r"第?\s*(\d{1,2})\s*周", text)
    if match:
        value = int(match.group(1))
        return value, value
    return None


def _parse_date(text: str, current_date: date) -> date:
    optional_date = _parse_optional_date(text, current_date)
    return optional_date or current_date


def _parse_optional_date(text: str, current_date: date) -> date | None:
    if "后天" in text:
        return current_date + timedelta(days=2)
    if "明天" in text:
        return current_date + timedelta(days=1)
    if "今天" in text:
        return current_date
    weekday_match = re.search(r"周([一二三四五六日天])", text)
    if weekday_match:
        target_weekday = WEEKDAY_MAP[weekday_match.group(1)]
        current_weekday = current_date.isoweekday()
        delta = (target_weekday - current_weekday) % 7
        return current_date + timedelta(days=delta)
    return None


def _parse_clock(text: str) -> time | None:
    colon_match = re.search(r"(上午|下午|晚上|早上|中午)?\s*(\d{1,2})\s*[:：]\s*(\d{2})", text)
    if colon_match:
        meridiem, hour_raw, minute_raw = colon_match.groups()
        return _clock_from_parts(meridiem, int(hour_raw), int(minute_raw))

    match = re.search(r"(上午|下午|晚上|早上|中午)?\s*(\d{1,2})\s*点\s*(半|(\d{1,2})\s*分?)?", text)
    if not match:
        return None
    meridiem, hour_raw, half_or_minute, minute_raw = match.groups()
    minute = 30 if half_or_minute == "半" else int(minute_raw or 0)
    return _clock_from_parts(meridiem, int(hour_raw), minute)


def _clock_from_parts(meridiem: str | None, hour: int, minute: int) -> time:
    if meridiem in {"下午", "晚上"} and hour < 12:
        hour += 12
    if meridiem == "中午" and hour < 11:
        hour += 12
    return time(hour=hour, minute=minute)


def _has_meridiem(text: str) -> bool:
    return any(token in text for token in ("上午", "下午", "晚上", "早上", "中午"))


def _parse_duration_hours(text: str) -> float | None:
    hour_match = re.search(r"持续\s*(\d+(?:\.\d+)?)\s*小时", text)
    if hour_match:
        return float(hour_match.group(1))
    minute_match = re.search(r"持续\s*(\d+)\s*分钟", text)
    if minute_match:
        return int(minute_match.group(1)) / 60
    if "半小时" in text:
        return 0.5
    return None


def _parse_location(text: str) -> str | None:
    patterns = (
        r"教?\d+-\d+",
        r"(?<![A-Za-z0-9])[A-Za-z]\d{2,4}(?![A-Za-z0-9])",
        r"[A-Za-z0-9一-龥]+(?:会议室|教室|楼\d*|室|厅)",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(0)
    return None


def _parse_course_name(text: str, location: str | None) -> str:
    name = text
    for word in DELETE_WORDS + UPDATE_WORDS:
        name = name.replace(word, "")
    name = re.sub(r"^(添加|创建|新增)?课程[:：]?", "", name).strip()
    name = re.sub(r"每?周[一二三四五六日天]", "", name)
    name = re.sub(r"第?\s*\d{1,2}\s*[-到至~]\s*\d{1,2}\s*节", "", name)
    name = re.sub(r"第?\s*\d{1,2}\s*节", "", name)
    name = re.sub(r"\d{1,2}\s*[-到至~]\s*\d{1,2}\s*周", "", name)
    name = re.sub(r"第?\s*\d{1,2}\s*周", "", name)
    if location:
        name = name.replace(location, "")
    name = re.sub(r"^(上|安排|添加|创建|新增|删除|取消|移除|把|将)", "", name)
    name = re.sub(r"(地点|教室|时间|节次)$", "", name)
    name = re.sub(r"[，,。；;：: ]+", "", name)
    name = re.sub(r"(课程|课)$", "", name)
    return name


def _guess_title(text: str, location: str | None) -> str:
    title = text
    for token in ["今天", "明天", "后天", "上午", "下午", "晚上", "早上", "中午"]:
        title = title.replace(token, "")
    for word in DELETE_WORDS + UPDATE_WORDS:
        title = title.replace(word, "")
    title = re.sub(r"周[一二三四五六日天]", "", title)
    title = re.sub(r"\d{1,2}\s*[:：]\s*\d{2}", "", title)
    title = re.sub(r"\d{1,2}\s*点\s*(半|(\d{1,2})\s*分?)?", "", title)
    title = re.sub(r"持续\s*\d+(?:\.\d+)?\s*小时", "", title)
    title = re.sub(r"持续\s*\d+\s*分钟", "", title)
    title = title.replace("半小时", "")
    if location:
        title = title.replace(location, "")
    title = re.sub(r"^(添加|创建|新增|删除|取消|移除|把|将)", "", title)
    title = re.sub(r"[，,。；;：: ]+", "", title)
    return title


def _date_from_target(target: dict) -> date | None:
    value = target.get("date") or str(target.get("start_time", ""))[:10]
    if not value:
        return None
    return date.fromisoformat(value)


def _datetime_from_target(target: dict) -> datetime | None:
    if not target.get("start_time"):
        return None
    return datetime.fromisoformat(target["start_time"])


def _target_warnings(target: dict, label: str) -> list[str]:
    if target:
        return []
    return [f"未识别要操作的{label}"]


def _summarize_event_target(target: dict) -> str:
    parts = []
    if target.get("date"):
        parts.append(target["date"])
    if target.get("start_time"):
        parts.append(str(target["start_time"])[11:16])
    if target.get("title"):
        parts.append(target["title"])
    if target.get("location"):
        parts.append(target["location"])
    return " / ".join(parts) or "未识别"


def _summarize_event_changes(changes: dict) -> str:
    parts = []
    if changes.get("title"):
        parts.append(f"标题={changes['title']}")
    if changes.get("start_time"):
        parts.append(f"开始={str(changes['start_time'])[:16]}")
    if changes.get("date") and not changes.get("start_time"):
        parts.append(f"日期={changes['date']}")
    if changes.get("duration_hours") is not None and not changes.get("end_time"):
        parts.append(f"时长={changes['duration_hours']}小时")
    if changes.get("location"):
        parts.append(f"地点={changes['location']}")
    return " / ".join(parts) or "未识别"


def _summarize_course_target(target: dict) -> str:
    parts = []
    if target.get("name"):
        parts.append(target["name"])
    if target.get("day_of_week"):
        parts.append(f"周{_weekday_label(target['day_of_week'])}")
    if target.get("start_period"):
        parts.append(f"{target['start_period']}-{target.get('end_period', target['start_period'])}节")
    if target.get("location"):
        parts.append(target["location"])
    return " / ".join(parts) or "未识别"


def _summarize_course_changes(changes: dict) -> str:
    parts = []
    if changes.get("name"):
        parts.append(f"课程={changes['name']}")
    if changes.get("day_of_week"):
        parts.append(f"周{_weekday_label(changes['day_of_week'])}")
    if changes.get("start_period"):
        parts.append(f"{changes['start_period']}-{changes.get('end_period', changes['start_period'])}节")
    if changes.get("week_start"):
        parts.append(f"{changes['week_start']}-{changes.get('week_end', changes['week_start'])}周")
    if changes.get("location"):
        parts.append(f"地点={changes['location']}")
    return " / ".join(parts) or "未识别"


def _weekday_label(day_of_week: int) -> str:
    labels = ["一", "二", "三", "四", "五", "六", "日"]
    return labels[max(1, min(7, day_of_week)) - 1]
