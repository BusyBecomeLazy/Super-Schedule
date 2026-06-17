from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course
from app.models.event import Event


def _raise_conflict(message: str) -> None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)


async def ensure_course_has_no_conflict(
    db: AsyncSession,
    *,
    group_id: int,
    semester_id: int,
    day_of_week: int,
    start_period: int,
    end_period: int,
    week_start: int,
    week_end: int,
    exclude_course_id: int | None = None,
) -> None:
    course_query = select(Course).where(
        Course.group_id == group_id,
        Course.semester_id == semester_id,
        Course.deleted_at.is_(None),
        Course.day_of_week == day_of_week,
        Course.week_start <= week_end,
        Course.week_end >= week_start,
        Course.start_period <= end_period,
        Course.end_period >= start_period,
    )
    if exclude_course_id is not None:
        course_query = course_query.where(Course.id != exclude_course_id)
    course_conflict = (await db.execute(course_query.limit(1))).scalar_one_or_none()
    if course_conflict is not None:
        _raise_conflict(
            f"课程冲突：{course_conflict.name} 已占用周{day_of_week}第"
            f"{course_conflict.start_period}-{course_conflict.end_period}节"
        )


async def ensure_event_has_no_conflict(
    db: AsyncSession,
    *,
    group_id: int,
    start_time: datetime,
    end_time: datetime,
    is_all_day: bool = False,
    exclude_event_id: int | None = None,
) -> None:
    event_query = select(Event).where(
        Event.group_id == group_id,
        Event.deleted_at.is_(None),
        Event.start_time < end_time,
        Event.end_time > start_time,
    )
    if exclude_event_id is not None:
        event_query = event_query.where(Event.id != exclude_event_id)
    event_conflict = (await db.execute(event_query.limit(1))).scalar_one_or_none()
    if event_conflict is not None:
        _raise_conflict(f"日程冲突：{event_conflict.title} 时间重叠")
