from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select, update

from app.api.deps import CurrentUser, DbSession, require_group_member, require_group_permission
from app.models.course import Course
from app.models.period import Period
from app.models.semester import Semester
from app.schemas.course import (
    CourseCreate,
    CourseRead,
    CourseUpdate,
    PeriodRead,
    SemesterCreate,
    SemesterRead,
)
from app.services.conflicts import ensure_course_has_no_conflict
from app.ws.manager import connection_manager

router = APIRouter()


@router.get("/semesters/current", response_model=SemesterRead)
async def get_current_semester(
    group_id: int, current_user: CurrentUser, db: DbSession
) -> SemesterRead:
    await require_group_member(db, group_id, current_user.id)
    semester = await _get_current_semester(db, group_id)
    if semester is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Current semester not found")
    return semester


@router.post("/semesters", response_model=SemesterRead)
async def create_semester(
    group_id: int,
    payload: SemesterCreate,
    current_user: CurrentUser,
    db: DbSession,
) -> SemesterRead:
    await require_group_permission(db, group_id, current_user.id, "can_manage_courses")
    await db.execute(
        update(Semester).where(Semester.group_id == group_id).values(is_current=False)
    )
    semester = Semester(group_id=group_id, is_current=True, **payload.model_dump())
    db.add(semester)
    await db.commit()
    await db.refresh(semester)
    return semester


@router.get("/periods", response_model=list[PeriodRead])
async def list_periods(
    group_id: int, current_user: CurrentUser, db: DbSession
) -> list[PeriodRead]:
    await require_group_member(db, group_id, current_user.id)
    result = await db.execute(
        select(Period).where(Period.group_id == group_id).order_by(Period.period_index.asc())
    )
    return list(result.scalars().all())


@router.get("/courses", response_model=list[CourseRead])
async def list_courses(
    group_id: int,
    current_user: CurrentUser,
    db: DbSession,
    semester_id: int | None = Query(default=None),
    week: int | None = Query(default=None, ge=1, le=30),
) -> list[CourseRead]:
    await require_group_member(db, group_id, current_user.id)
    semester = await _resolve_semester(db, group_id, semester_id)
    if semester is None:
        return []
    query = select(Course).where(
        Course.group_id == group_id,
        Course.semester_id == semester.id,
        Course.deleted_at.is_(None),
    )
    if week is not None:
        query = query.where(Course.week_start <= week, Course.week_end >= week)
    result = await db.execute(query.order_by(Course.day_of_week.asc(), Course.start_period.asc()))
    return list(result.scalars().all())


@router.post("/courses", response_model=CourseRead)
async def create_course(
    group_id: int,
    payload: CourseCreate,
    current_user: CurrentUser,
    db: DbSession,
) -> CourseRead:
    await require_group_permission(db, group_id, current_user.id, "can_manage_courses")
    await _ensure_semester_belongs_to_group(db, group_id, payload.semester_id)
    await ensure_course_has_no_conflict(
        db,
        group_id=group_id,
        semester_id=payload.semester_id,
        day_of_week=payload.day_of_week,
        start_period=payload.start_period,
        end_period=payload.end_period,
        week_start=payload.week_start,
        week_end=payload.week_end,
    )
    course = Course(group_id=group_id, creator_id=current_user.id, source="manual", **payload.model_dump())
    db.add(course)
    await db.commit()
    await db.refresh(course)
    await _broadcast_course(group_id, "course.created", course, current_user.id)
    return course


@router.get("/courses/{course_id}", response_model=CourseRead)
async def get_course(
    group_id: int,
    course_id: int,
    current_user: CurrentUser,
    db: DbSession,
) -> CourseRead:
    await require_group_permission(db, group_id, current_user.id, "can_manage_courses")
    return await _get_course_or_404(db, group_id, course_id)


@router.patch("/courses/{course_id}", response_model=CourseRead)
async def update_course(
    group_id: int,
    course_id: int,
    payload: CourseUpdate,
    current_user: CurrentUser,
    db: DbSession,
) -> CourseRead:
    await require_group_permission(db, group_id, current_user.id, "can_manage_courses")
    course = await _get_course_or_404(db, group_id, course_id)
    if payload.version is not None and payload.version != course.version:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Course version conflict")
    changes = payload.model_dump(exclude_unset=True, exclude={"version"})
    start_period = changes.get("start_period", course.start_period)
    end_period = changes.get("end_period", course.end_period)
    week_start = changes.get("week_start", course.week_start)
    week_end = changes.get("week_end", course.week_end)
    if end_period < start_period:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结束节次不能早于开始节次")
    if week_end < week_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="结束周次不能早于开始周次")
    await ensure_course_has_no_conflict(
        db,
        group_id=group_id,
        semester_id=course.semester_id,
        day_of_week=changes.get("day_of_week", course.day_of_week),
        start_period=start_period,
        end_period=end_period,
        week_start=week_start,
        week_end=week_end,
        exclude_course_id=course.id,
    )
    for field, value in changes.items():
        setattr(course, field, value)
    course.version += 1
    await db.commit()
    await db.refresh(course)
    await _broadcast_course(group_id, "course.updated", course, current_user.id)
    return course


@router.delete("/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_course(
    group_id: int,
    course_id: int,
    current_user: CurrentUser,
    db: DbSession,
) -> None:
    await require_group_permission(db, group_id, current_user.id, "can_manage_courses")
    course = await _get_course_or_404(db, group_id, course_id)
    course.deleted_at = datetime.now(UTC)
    course.version += 1
    await db.commit()
    await _broadcast_course(group_id, "course.deleted", course, current_user.id)


async def _get_current_semester(db: DbSession, group_id: int) -> Semester | None:
    result = await db.execute(
        select(Semester).where(Semester.group_id == group_id, Semester.is_current.is_(True))
    )
    return result.scalar_one_or_none()


async def _resolve_semester(db: DbSession, group_id: int, semester_id: int | None) -> Semester | None:
    if semester_id is None:
        return await _get_current_semester(db, group_id)
    result = await db.execute(
        select(Semester).where(Semester.id == semester_id, Semester.group_id == group_id)
    )
    return result.scalar_one_or_none()


async def _ensure_semester_belongs_to_group(db: DbSession, group_id: int, semester_id: int) -> None:
    semester = await _resolve_semester(db, group_id, semester_id)
    if semester is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Semester not found")


async def _get_course_or_404(db: DbSession, group_id: int, course_id: int) -> Course:
    result = await db.execute(
        select(Course).where(Course.id == course_id, Course.group_id == group_id, Course.deleted_at.is_(None))
    )
    course = result.scalar_one_or_none()
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


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
