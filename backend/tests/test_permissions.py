from collections.abc import AsyncGenerator
from datetime import datetime
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as value:
        yield value
    await engine.dispose()


async def login(client: AsyncClient, name: str) -> dict:
    response = await client.post(
        "/api/auth/wechat-login",
        json={"dev_openid": f"{name}_{uuid4().hex}", "nickname": name},
    )
    assert response.status_code == 200
    payload = response.json()
    return {"headers": {"Authorization": f"Bearer {payload['access_token']}"}, "user": payload["user"]}


async def create_group(client: AsyncClient, headers: dict) -> dict:
    response = await client.post("/api/groups", headers=headers, json={"name": "权限回归群"})
    assert response.status_code == 200
    return response.json()


async def join_group(client: AsyncClient, headers: dict, invite_code: str) -> dict:
    response = await client.post(
        "/api/groups/join",
        headers=headers,
        json={"invite_code": invite_code},
    )
    assert response.status_code == 200
    return response.json()


async def list_members(client: AsyncClient, headers: dict, group_id: int) -> list[dict]:
    response = await client.get(f"/api/groups/{group_id}/members", headers=headers)
    assert response.status_code == 200
    return response.json()


async def set_role(client: AsyncClient, headers: dict, group_id: int, user_id: int, role: str) -> dict:
    members = await list_members(client, headers, group_id)
    member = next(item for item in members if item["user_id"] == user_id)
    response = await client.patch(
        f"/api/groups/{group_id}/members/{member['id']}/role",
        headers=headers,
        json={"role": role},
    )
    assert response.status_code == 200
    return response.json()


async def create_semester(client: AsyncClient, headers: dict, group_id: int) -> dict:
    response = await client.post(
        f"/api/groups/{group_id}/semesters",
        headers=headers,
        json={
            "name": "默认学期",
            "start_date": "2026-06-15",
            "end_date": "2026-09-30",
        },
    )
    assert response.status_code == 200
    return response.json()


def course_payload(semester_id: int, day: int = 1, period: int = 1) -> dict:
    return {
        "semester_id": semester_id,
        "name": f"权限课程{day}{period}",
        "teacher": "T",
        "location": f"教{day}-{period}",
        "day_of_week": day,
        "start_period": period,
        "end_period": period,
        "week_start": 1,
        "week_end": 16,
    }


def event_payload(hour: int) -> dict:
    return {
        "title": f"权限日程{hour}",
        "location": "会议室",
        "start_time": datetime(2026, 6, 16, hour, 0).isoformat(),
        "end_time": datetime(2026, 6, 16, hour, 30).isoformat(),
    }


@pytest.mark.asyncio
async def test_role_permission_matrix(client: AsyncClient) -> None:
    owner = await login(client, "owner")
    student = await login(client, "student")
    staff = await login(client, "staff")
    manager = await login(client, "manager")

    group = await create_group(client, owner["headers"])
    group_id = group["id"]
    await join_group(client, student["headers"], group["invite_code"])
    await join_group(client, staff["headers"], group["invite_code"])
    await join_group(client, manager["headers"], group["invite_code"])
    semester = await create_semester(client, owner["headers"], group_id)

    student_access = await client.get(f"/api/groups/{group_id}/me", headers=student["headers"])
    assert student_access.status_code == 200
    assert student_access.json()["role"] == "student"
    assert student_access.json()["permissions"]["can_view_courses"] is True
    assert student_access.json()["permissions"]["can_manage_events"] is False

    await set_role(client, owner["headers"], group_id, staff["user"]["id"], "staff")
    await set_role(client, owner["headers"], group_id, manager["user"]["id"], "course_manager")

    student_event = await client.post(
        f"/api/groups/{group_id}/events",
        headers=student["headers"],
        json=event_payload(9),
    )
    assert student_event.status_code == 403

    student_course = await client.post(
        f"/api/groups/{group_id}/courses",
        headers=student["headers"],
        json=course_payload(semester["id"], 1, 1),
    )
    assert student_course.status_code == 403

    staff_event = await client.post(
        f"/api/groups/{group_id}/events",
        headers=staff["headers"],
        json=event_payload(10),
    )
    assert staff_event.status_code == 200

    staff_course = await client.post(
        f"/api/groups/{group_id}/courses",
        headers=staff["headers"],
        json=course_payload(semester["id"], 2, 1),
    )
    assert staff_course.status_code == 403

    manager_course = await client.post(
        f"/api/groups/{group_id}/courses",
        headers=manager["headers"],
        json=course_payload(semester["id"], 3, 1),
    )
    assert manager_course.status_code == 200

    manager_event = await client.post(
        f"/api/groups/{group_id}/events",
        headers=manager["headers"],
        json=event_payload(11),
    )
    assert manager_event.status_code == 200

    for actor in (student, staff, manager):
        members_response = await client.get(f"/api/groups/{group_id}/members", headers=actor["headers"])
        assert members_response.status_code == 403

    members_response = await client.get(f"/api/groups/{group_id}/members", headers=owner["headers"])
    assert members_response.status_code == 200


@pytest.mark.asyncio
async def test_last_super_admin_cannot_be_demoted(client: AsyncClient) -> None:
    owner = await login(client, "owner")
    group = await create_group(client, owner["headers"])
    group_id = group["id"]
    members = await list_members(client, owner["headers"], group_id)
    owner_member = next(item for item in members if item["user_id"] == owner["user"]["id"])

    response = await client.patch(
        f"/api/groups/{group_id}/members/{owner_member['id']}/role",
        headers=owner["headers"],
        json={"role": "staff"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "至少需要保留一名超级管理员"


@pytest.mark.asyncio
async def test_nlp_course_candidates_can_be_selected(client: AsyncClient) -> None:
    owner = await login(client, "owner")
    group = await create_group(client, owner["headers"])
    group_id = group["id"]
    semester = await create_semester(client, owner["headers"], group_id)
    for day in (1, 2):
        payload = course_payload(semester["id"], day, 1)
        payload["name"] = "数据库"
        response = await client.post(
            f"/api/groups/{group_id}/courses",
            headers=owner["headers"],
            json=payload,
        )
        assert response.status_code == 200

    parse_response = await client.post(
        "/api/nlp/parse",
        headers=owner["headers"],
        json={
            "group_id": group_id,
            "text": "删除数据库课",
            "context": {"current_date": "2026-06-16", "timezone": "Asia/Shanghai"},
        },
    )
    assert parse_response.status_code == 200
    parsed = parse_response.json()
    confirm_response = await client.post(
        "/api/nlp/confirm",
        headers=owner["headers"],
        json={"group_id": group_id, "intent": parsed["intent"], "draft": parsed["draft"]},
    )

    assert confirm_response.status_code == 200
    selection = confirm_response.json()
    assert selection["action"] == "select_target"
    assert len(selection["candidates"]) == 2

    parsed["draft"]["target"]["id"] = selection["candidates"][0]["id"]
    selected_response = await client.post(
        "/api/nlp/confirm",
        headers=owner["headers"],
        json={"group_id": group_id, "intent": parsed["intent"], "draft": parsed["draft"]},
    )
    assert selected_response.status_code == 200
    assert selected_response.json()["action"] == "deleted"

    courses_response = await client.get(
        f"/api/groups/{group_id}/courses?week=1",
        headers=owner["headers"],
    )
    assert courses_response.status_code == 200
    assert len(courses_response.json()) == 1


@pytest.mark.asyncio
async def test_nlp_event_candidates_can_be_selected(client: AsyncClient) -> None:
    owner = await login(client, "owner")
    group = await create_group(client, owner["headers"])
    group_id = group["id"]
    for hour in (15, 17):
        response = await client.post(
            f"/api/groups/{group_id}/events",
            headers=owner["headers"],
            json={
                "title": "开会",
                "location": f"会议室{hour}",
                "start_time": datetime(2026, 6, 17, hour, 0).isoformat(),
                "end_time": datetime(2026, 6, 17, hour, 30).isoformat(),
            },
        )
        assert response.status_code == 200

    parse_response = await client.post(
        "/api/nlp/parse",
        headers=owner["headers"],
        json={
            "group_id": group_id,
            "text": "删除明天开会",
            "context": {"current_date": "2026-06-16", "timezone": "Asia/Shanghai"},
        },
    )
    assert parse_response.status_code == 200
    parsed = parse_response.json()
    confirm_response = await client.post(
        "/api/nlp/confirm",
        headers=owner["headers"],
        json={"group_id": group_id, "intent": parsed["intent"], "draft": parsed["draft"]},
    )

    assert confirm_response.status_code == 200
    selection = confirm_response.json()
    assert selection["action"] == "select_target"
    assert len(selection["candidates"]) == 2

    parsed["draft"]["target"]["id"] = selection["candidates"][1]["id"]
    selected_response = await client.post(
        "/api/nlp/confirm",
        headers=owner["headers"],
        json={"group_id": group_id, "intent": parsed["intent"], "draft": parsed["draft"]},
    )
    assert selected_response.status_code == 200
    assert selected_response.json()["action"] == "deleted"

    events_response = await client.get(
        f"/api/groups/{group_id}/events",
        headers=owner["headers"],
        params={"start": "2026-06-17T00:00:00", "end": "2026-06-18T00:00:00"},
    )
    assert events_response.status_code == 200
    assert len(events_response.json()) == 1
