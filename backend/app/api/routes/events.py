from collections import Counter
from datetime import UTC, date, datetime, time, timedelta

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, require_group_member, require_group_permission
from app.models.course import Course
from app.models.event import Event
from app.models.semester import Semester
from app.schemas.event import CalendarMark, DailyScheduleItem, EventCreate, EventRead, EventUpdate
from app.services.conflicts import ensure_event_has_no_conflict
from app.services.permissions import permissions_for_role
from app.services.time_utils import calculate_teaching_week
from app.ws.manager import connection_manager

router = APIRouter()


@router.get("", response_model=list[EventRead])
async def list_events(
    group_id: int,
    current_user: CurrentUser,
    db: DbSession,
    start: datetime = Query(),
    end: datetime = Query(),
) -> list[EventRead]:
    await require_group_permission(db, group_id, current_user.id, "can_view_events")
    result = await db.execute(
        select(Event)
        .where(
            Event.group_id == group_id,
            Event.deleted_at.is_(None),
            Event.start_time < end,
            Event.end_time > start,
        )
        .order_by(Event.start_time.asc())
    )
    return list(result.scalars().all())


@router.get("/daily", response_model=list[DailyScheduleItem])
async def get_daily_schedule(
    group_id: int,
    target_date: date,
    current_user: CurrentUser,
    db: DbSession,
) -> list[DailyScheduleItem]:
    membership = await require_group_member(db, group_id, current_user.id)
    permissions = permissions_for_role(membership.role)
    items: list[DailyScheduleItem] = []
    if permissions.can_view_events:
        day_start = datetime.combine(target_date, time.min)
        day_end = day_start + timedelta(days=1)
        result = await db.execute(
            select(Event)
            .where(
                Event.group_id == group_id,
                Event.deleted_at.is_(None),
                Event.start_time < day_end,
                Event.end_time > day_start,
            )
            .order_by(Event.start_time.asc())
        )
        items = [
            DailyScheduleItem(
                id=event.id,
                type="event",
                title=event.title,
                location=event.location,
                start_time=event.start_time,
                end_time=event.end_time,
                color_tag=event.color_tag,
            )
            for event in result.scalars().all()
        ]

    semester = await _get_current_semester(db, group_id)
    if semester is not None:
        teaching_week = calculate_teaching_week(target_date, semester.start_date)
        courses = await db.execute(
            select(Course).where(
                Course.group_id == group_id,
                Course.semester_id == semester.id,
                Course.deleted_at.is_(None),
                Course.day_of_week == target_date.isoweekday(),
                Course.week_start <= teaching_week,
                Course.week_end >= teaching_week,
            )
        )
        for course in courses.scalars().all():
            items.append(
                DailyScheduleItem(
                    id=course.id,
                    type="course",
                    title=course.name,
                    location=course.location,
                    start_period=course.start_period,
                    end_period=course.end_period,
                    color_tag=course.color_tag,
                )
            )
    return items


@router.get("/marks", response_model=list[CalendarMark])
async def get_calendar_marks(
    group_id: int,
    current_user: CurrentUser,
    db: DbSession,
    start: datetime = Query(),
    end: datetime = Query(),
) -> list[CalendarMark]:
    await require_group_permission(db, group_id, current_user.id, "can_view_events")
    result = await db.execute(
        select(Event).where(
            Event.group_id == group_id,
            Event.deleted_at.is_(None),
            Event.start_time < end,
            Event.end_time > start,
        )
    )
    counter = Counter(event.start_time.date().isoformat() for event in result.scalars().all())
    return [CalendarMark(date=day, count=count) for day, count in sorted(counter.items())]


@router.post("", response_model=EventRead)
async def create_event(
    group_id: int,
    payload: EventCreate,
    current_user: CurrentUser,
    db: DbSession,
) -> EventRead:
    await require_group_permission(db, group_id, current_user.id, "can_manage_events")
    await ensure_event_has_no_conflict(
        db,
        group_id=group_id,
        start_time=payload.start_time,
        end_time=payload.end_time,
        is_all_day=payload.is_all_day,
    )
    event = Event(group_id=group_id, creator_id=current_user.id, source="manual", **payload.model_dump())
    db.add(event)
    await db.commit()
    await db.refresh(event)
    await _broadcast_event(group_id, "event.created", event, current_user.id)
    return event


@router.get("/{event_id}", response_model=EventRead)
async def get_event(
    group_id: int,
    event_id: int,
    current_user: CurrentUser,
    db: DbSession,
) -> EventRead:
    await require_group_permission(db, group_id, current_user.id, "can_view_events")
    event = await _get_event_or_404(db, group_id, event_id)
    return event


@router.patch("/{event_id}", response_model=EventRead)
async def update_event(
    group_id: int,
    event_id: int,
    payload: EventUpdate,
    current_user: CurrentUser,
    db: DbSession,
) -> EventRead:
    await require_group_permission(db, group_id, current_user.id, "can_manage_events")
    event = await _get_event_or_404(db, group_id, event_id)
    if payload.version is not None and payload.version != event.version:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Event version conflict")
    changes = payload.model_dump(exclude_unset=True, exclude={"version"})
    start_time = changes.get("start_time", event.start_time)
    end_time = changes.get("end_time", event.end_time)
    if end_time <= start_time:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结束时间需晚于开始时间")
    await ensure_event_has_no_conflict(
        db,
        group_id=group_id,
        start_time=start_time,
        end_time=end_time,
        is_all_day=changes.get("is_all_day", event.is_all_day),
        exclude_event_id=event.id,
    )
    for field, value in changes.items():
        setattr(event, field, value)
    event.version += 1
    await db.commit()
    await db.refresh(event)
    await _broadcast_event(group_id, "event.updated", event, current_user.id)
    return event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    group_id: int,
    event_id: int,
    current_user: CurrentUser,
    db: DbSession,
) -> None:
    await require_group_permission(db, group_id, current_user.id, "can_manage_events")
    event = await _get_event_or_404(db, group_id, event_id)
    event.deleted_at = datetime.now(UTC)
    event.version += 1
    await db.commit()
    await _broadcast_event(group_id, "event.deleted", event, current_user.id)


async def _get_event_or_404(db: DbSession, group_id: int, event_id: int) -> Event:
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.group_id == group_id, Event.deleted_at.is_(None))
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


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
