from datetime import UTC, date, datetime, time, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, require_group_member, require_group_permission
from app.models.course import Course
from app.models.event import Event
from app.models.semester import Semester
from app.schemas.nlp import NlpConfirmRequest, NlpParseRequest, NlpParseResponse
from app.services.conflicts import ensure_course_has_no_conflict, ensure_event_has_no_conflict
from app.services.llm_nlp import LlmNlpError, LlmNlpNotConfigured, parse_text_with_deepseek
from app.services.nlp_parser import parse_text
from app.services.permissions import require_permission
from app.ws.manager import connection_manager

router = APIRouter()

INTENT_PERMISSIONS = {
    "create_event": "can_manage_events",
    "update_event": "can_manage_events",
    "delete_event": "can_manage_events",
    "create_course": "can_manage_courses",
    "update_course": "can_manage_courses",
    "delete_course": "can_manage_courses",
}


class CandidateSelectionRequired(Exception):
    def __init__(self, *, entity: str, candidates: list[dict]):
        self.entity = entity
        self.candidates = candidates


@router.post("/parse", response_model=NlpParseResponse)
async def parse_nlp(payload: NlpParseRequest, current_user: CurrentUser, db: DbSession) -> NlpParseResponse:
    membership = await require_group_member(db, payload.group_id, current_user.id)
    current_date = None
    if payload.context.current_date:
        current_date = date.fromisoformat(payload.context.current_date)
    current_date = current_date or date.today()
    result = await _parse_text_with_fallback(
        payload.text,
        current_date=current_date,
        timezone=payload.context.timezone,
    )
    permission = INTENT_PERMISSIONS.get(result.intent)
    if permission:
        require_permission(membership.role, permission)
    return result


@router.post("/confirm")
async def confirm_nlp(payload: NlpConfirmRequest, current_user: CurrentUser, db: DbSession) -> dict:
    if payload.missing_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"请先补充缺失信息：{'、'.join(payload.missing_fields)}",
        )
    try:
        if payload.intent == "create_event":
            return await _create_event_from_draft(payload, current_user, db)
        if payload.intent == "update_event":
            return await _update_event_from_draft(payload, current_user, db)
        if payload.intent == "delete_event":
            return await _delete_event_from_draft(payload, current_user, db)
        if payload.intent == "create_course":
            return await _create_course_from_draft(payload, current_user, db)
        if payload.intent == "update_course":
            return await _update_course_from_draft(payload, current_user, db)
        return await _delete_course_from_draft(payload, current_user, db)
    except CandidateSelectionRequired as error:
        return {
            "type": error.entity,
            "action": "select_target",
            "message": f"匹配到多个{'日程' if error.entity == 'event' else '课程'}，请选择一个",
            "candidates": error.candidates,
        }


async def _parse_text_with_fallback(text: str, *, current_date: date, timezone: str) -> NlpParseResponse:
    try:
        return await parse_text_with_deepseek(text, current_date=current_date, timezone=timezone)
    except LlmNlpNotConfigured:
        return parse_text(text, current_date=current_date)
    except LlmNlpError:
        result = parse_text(text, current_date=current_date)
        if "AI解析失败，已使用本地解析" not in result.warnings:
            result.warnings.append("AI解析失败，已使用本地解析")
        return result


async def _create_event_from_draft(payload: NlpConfirmRequest, current_user: CurrentUser, db: DbSession) -> dict:
    await require_group_permission(db, payload.group_id, current_user.id, "can_manage_events")
    start_time = datetime.fromisoformat(payload.draft["start_time"])
    end_time = datetime.fromisoformat(payload.draft["end_time"])
    is_all_day = payload.draft.get("is_all_day", False)
    await ensure_event_has_no_conflict(
        db,
        group_id=payload.group_id,
        start_time=start_time,
        end_time=end_time,
        is_all_day=is_all_day,
    )
    event = Event(
        group_id=payload.group_id,
        creator_id=current_user.id,
        title=payload.draft["title"],
        start_time=start_time,
        end_time=end_time,
        location=payload.draft.get("location"),
        is_all_day=is_all_day,
        color_tag=payload.draft.get("color_tag"),
        source="nlp",
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    await _broadcast_event(payload.group_id, "event.created", event, current_user.id)
    return {"type": "event", "action": "created", "id": event.id}


async def _update_event_from_draft(payload: NlpConfirmRequest, current_user: CurrentUser, db: DbSession) -> dict:
    await require_group_permission(db, payload.group_id, current_user.id, "can_manage_events")
    event = await _find_event_target(db, payload.group_id, payload.draft.get("target") or {})
    changes = payload.draft.get("changes") or {}
    start_time, end_time = _resolve_event_times(event, changes)
    await ensure_event_has_no_conflict(
        db,
        group_id=payload.group_id,
        start_time=start_time,
        end_time=end_time,
        is_all_day=changes.get("is_all_day", event.is_all_day),
        exclude_event_id=event.id,
    )
    if changes.get("title"):
        event.title = changes["title"]
    if "location" in changes:
        event.location = changes.get("location")
    event.start_time = start_time
    event.end_time = end_time
    event.version += 1
    await db.commit()
    await db.refresh(event)
    await _broadcast_event(payload.group_id, "event.updated", event, current_user.id)
    return {"type": "event", "action": "updated", "id": event.id}


async def _delete_event_from_draft(payload: NlpConfirmRequest, current_user: CurrentUser, db: DbSession) -> dict:
    await require_group_permission(db, payload.group_id, current_user.id, "can_manage_events")
    event = await _find_event_target(db, payload.group_id, payload.draft.get("target") or {})
    event.deleted_at = datetime.now(UTC)
    event.version += 1
    await db.commit()
    await _broadcast_event(payload.group_id, "event.deleted", event, current_user.id)
    return {"type": "event", "action": "deleted", "id": event.id}


async def _create_course_from_draft(payload: NlpConfirmRequest, current_user: CurrentUser, db: DbSession) -> dict:
    await require_group_permission(db, payload.group_id, current_user.id, "can_manage_courses")
    semester = await _get_current_semester(db, payload.group_id)
    if semester is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current semester is required")
    semester_id = payload.draft.get("semester_id", semester.id)
    await ensure_course_has_no_conflict(
        db,
        group_id=payload.group_id,
        semester_id=semester_id,
        day_of_week=payload.draft["day_of_week"],
        start_period=payload.draft["start_period"],
        end_period=payload.draft["end_period"],
        week_start=payload.draft.get("week_start", 1),
        week_end=payload.draft.get("week_end", 16),
    )
    course = Course(
        group_id=payload.group_id,
        semester_id=semester_id,
        creator_id=current_user.id,
        name=payload.draft["name"],
        teacher=payload.draft.get("teacher"),
        location=payload.draft.get("location"),
        day_of_week=payload.draft["day_of_week"],
        start_period=payload.draft["start_period"],
        end_period=payload.draft["end_period"],
        week_start=payload.draft.get("week_start", 1),
        week_end=payload.draft.get("week_end", 16),
        color_tag=payload.draft.get("color_tag"),
        source="nlp",
    )
    db.add(course)
    await db.commit()
    await db.refresh(course)
    await _broadcast_course(payload.group_id, "course.created", course, current_user.id)
    return {"type": "course", "action": "created", "id": course.id}


async def _update_course_from_draft(payload: NlpConfirmRequest, current_user: CurrentUser, db: DbSession) -> dict:
    await require_group_permission(db, payload.group_id, current_user.id, "can_manage_courses")
    course = await _find_course_target(db, payload.group_id, payload.draft.get("target") or {})
    changes = payload.draft.get("changes") or {}
    next_values = {
        "name": changes.get("name", course.name),
        "teacher": changes.get("teacher", course.teacher),
        "location": changes.get("location", course.location),
        "day_of_week": changes.get("day_of_week", course.day_of_week),
        "start_period": changes.get("start_period", course.start_period),
        "end_period": changes.get("end_period", course.end_period),
        "week_start": changes.get("week_start", course.week_start),
        "week_end": changes.get("week_end", course.week_end),
        "color_tag": changes.get("color_tag", course.color_tag),
    }
    if next_values["end_period"] < next_values["start_period"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结束节次不能早于开始节次")
    if next_values["week_end"] < next_values["week_start"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结束周次不能早于开始周次")
    await ensure_course_has_no_conflict(
        db,
        group_id=payload.group_id,
        semester_id=course.semester_id,
        day_of_week=next_values["day_of_week"],
        start_period=next_values["start_period"],
        end_period=next_values["end_period"],
        week_start=next_values["week_start"],
        week_end=next_values["week_end"],
        exclude_course_id=course.id,
    )
    for field, value in next_values.items():
        setattr(course, field, value)
    course.version += 1
    await db.commit()
    await db.refresh(course)
    await _broadcast_course(payload.group_id, "course.updated", course, current_user.id)
    return {"type": "course", "action": "updated", "id": course.id}


async def _delete_course_from_draft(payload: NlpConfirmRequest, current_user: CurrentUser, db: DbSession) -> dict:
    await require_group_permission(db, payload.group_id, current_user.id, "can_manage_courses")
    course = await _find_course_target(db, payload.group_id, payload.draft.get("target") or {})
    course.deleted_at = datetime.now(UTC)
    course.version += 1
    await db.commit()
    await _broadcast_course(payload.group_id, "course.deleted", course, current_user.id)
    return {"type": "course", "action": "deleted", "id": course.id}


async def _find_event_target(db: DbSession, group_id: int, target: dict) -> Event:
    if not target:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未识别要操作的日程")
    if target.get("id"):
        event = await db.get(Event, int(target["id"]))
        if event is None or event.group_id != group_id or event.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="没有找到匹配的日程")
        return event
    query = select(Event).where(Event.group_id == group_id, Event.deleted_at.is_(None))
    has_filter = False
    if target.get("title"):
        has_filter = True
    if target.get("location"):
        has_filter = True
    if target.get("start_time"):
        start_time = datetime.fromisoformat(target["start_time"])
        query = query.where(
            Event.start_time >= start_time - timedelta(minutes=30),
            Event.start_time <= start_time + timedelta(minutes=30),
        )
        has_filter = True
    elif target.get("date"):
        day = date.fromisoformat(target["date"])
        day_start = datetime.combine(day, time.min)
        day_end = day_start + timedelta(days=1)
        query = query.where(Event.start_time < day_end, Event.end_time > day_start)
        has_filter = True
    if not has_filter:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未识别要操作的日程")
    result = await db.execute(query.order_by(Event.start_time.asc()).limit(50))
    events = _filter_event_text_matches(list(result.scalars().all()), target)
    if not events:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="没有找到匹配的日程")
    if len(events) > 1:
        raise CandidateSelectionRequired(
            entity="event",
            candidates=[_event_candidate(event) for event in events[:5]],
        )
    return events[0]


async def _find_course_target(db: DbSession, group_id: int, target: dict) -> Course:
    if not target:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未识别要操作的课程")
    if target.get("id"):
        course = await db.get(Course, int(target["id"]))
        if course is None or course.group_id != group_id or course.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="没有找到匹配的课程")
        return course
    semester = await _get_current_semester(db, group_id)
    if semester is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current semester is required")
    query = select(Course).where(
        Course.group_id == group_id,
        Course.semester_id == semester.id,
        Course.deleted_at.is_(None),
    )
    has_filter = False
    if target.get("name"):
        has_filter = True
    if target.get("location"):
        has_filter = True
    if target.get("day_of_week"):
        query = query.where(Course.day_of_week == target["day_of_week"])
        has_filter = True
    if target.get("start_period"):
        query = query.where(Course.start_period == target["start_period"])
        has_filter = True
    if target.get("end_period"):
        query = query.where(Course.end_period == target["end_period"])
        has_filter = True
    if target.get("week_start") and target.get("week_end"):
        query = query.where(
            Course.week_start <= target["week_end"],
            Course.week_end >= target["week_start"],
        )
        has_filter = True
    if not has_filter:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未识别要操作的课程")
    result = await db.execute(query.order_by(Course.day_of_week.asc(), Course.start_period.asc()).limit(50))
    courses = _filter_course_text_matches(list(result.scalars().all()), target)
    if not courses:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="没有找到匹配的课程")
    if len(courses) > 1:
        raise CandidateSelectionRequired(
            entity="course",
            candidates=[_course_candidate(course) for course in courses[:5]],
        )
    return courses[0]


def _filter_event_text_matches(events: list[Event], target: dict) -> list[Event]:
    title = str(target.get("title") or "")
    location = str(target.get("location") or "")
    return [
        event
        for event in events
        if (not title or title in event.title)
        and (not location or (event.location is not None and location in event.location))
    ]


def _filter_course_text_matches(courses: list[Course], target: dict) -> list[Course]:
    name = str(target.get("name") or "")
    location = str(target.get("location") or "")
    return [
        course
        for course in courses
        if (not name or name in course.name)
        and (not location or (course.location is not None and location in course.location))
    ]


def _event_candidate(event: Event) -> dict:
    return {
        "id": event.id,
        "title": event.title,
        "subtitle": f"{event.start_time:%Y-%m-%d} {event.start_time:%H:%M}-{event.end_time:%H:%M}",
        "meta": event.location or "无地点",
        "target": {"id": event.id},
    }


def _course_candidate(course: Course) -> dict:
    return {
        "id": course.id,
        "title": course.name,
        "subtitle": (
            f"周{_weekday_label(course.day_of_week)} "
            f"第{course.start_period}-{course.end_period}节 "
            f"第{course.week_start}-{course.week_end}周"
        ),
        "meta": course.location or "无地点",
        "target": {"id": course.id},
    }


def _resolve_event_times(event: Event, changes: dict) -> tuple[datetime, datetime]:
    current_duration = event.end_time - event.start_time
    start_time = event.start_time
    end_time = event.end_time
    if changes.get("date") and not changes.get("start_time"):
        next_date = date.fromisoformat(changes["date"])
        start_time = datetime.combine(next_date, event.start_time.time())
        end_time = start_time + current_duration
    if changes.get("start_time"):
        start_time = datetime.fromisoformat(changes["start_time"])
        end_time = start_time + current_duration
    if changes.get("end_time"):
        end_time = datetime.fromisoformat(changes["end_time"])
    if changes.get("duration_hours") is not None:
        end_time = start_time + timedelta(hours=float(changes["duration_hours"]))
    if end_time <= start_time:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结束时间需晚于开始时间")
    return start_time, end_time


def _weekday_label(day_of_week: int) -> str:
    labels = ["一", "二", "三", "四", "五", "六", "日"]
    return labels[max(1, min(7, day_of_week)) - 1]


async def _get_current_semester(db: DbSession, group_id: int) -> Semester | None:
    result = await db.execute(
        select(Semester).where(Semester.group_id == group_id, Semester.is_current.is_(True))
    )
    return result.scalar_one_or_none()


async def _broadcast_event(group_id: int, event_type: str, event: Event, operator_id: int) -> None:
    await connection_manager.broadcast(
        group_id,
        {
            "type": event_type,
            "group_id": group_id,
            "entity": "event",
            "entity_id": event.id,
            "version": event.version,
            "operator_id": operator_id,
            "occurred_at": datetime.now(UTC).isoformat(),
        },
        required_permission="can_view_events",
    )


async def _broadcast_course(group_id: int, event_type: str, course: Course, operator_id: int) -> None:
    await connection_manager.broadcast(
        group_id,
        {
            "type": event_type,
            "group_id": group_id,
            "entity": "course",
            "entity_id": course.id,
            "version": course.version,
            "operator_id": operator_id,
            "occurred_at": datetime.now(UTC).isoformat(),
        },
        required_permission="can_view_courses",
    )
