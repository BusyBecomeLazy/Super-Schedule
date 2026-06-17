from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession, require_group_member, require_group_permission
from app.models.group import Group, GroupMember
from app.models.period import Period
from app.schemas.group import (
    GroupAccessRead,
    GroupCreate,
    GroupJoin,
    GroupMemberRead,
    GroupMemberRoleUpdate,
    GroupRead,
)
from app.services.defaults import DEFAULT_PERIODS
from app.services.invite import generate_invite_code
from app.services.permissions import ROLE_LABELS, ROLE_STUDENT, ROLE_SUPER_ADMIN, ensure_assignable_role, normalize_role, permissions_for_role
from app.ws.manager import connection_manager

router = APIRouter()


@router.post("", response_model=GroupRead)
async def create_group(payload: GroupCreate, current_user: CurrentUser, db: DbSession) -> GroupRead:
    invite_code = await _create_unique_invite_code(db)
    group = Group(name=payload.name, creator_id=current_user.id, invite_code=invite_code)
    db.add(group)
    await db.flush()
    db.add(GroupMember(group_id=group.id, user_id=current_user.id, role=ROLE_SUPER_ADMIN))
    for period_index, start_time, end_time in DEFAULT_PERIODS:
        db.add(
            Period(
                group_id=group.id,
                period_index=period_index,
                start_time=start_time,
                end_time=end_time,
            )
        )
    await db.commit()
    await db.refresh(group)
    return group


@router.get("", response_model=list[GroupRead])
async def list_groups(current_user: CurrentUser, db: DbSession) -> list[GroupRead]:
    result = await db.execute(
        select(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(
            GroupMember.user_id == current_user.id,
            GroupMember.left_at.is_(None),
            Group.deleted_at.is_(None),
        )
        .order_by(Group.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("/join", response_model=GroupRead)
async def join_group(payload: GroupJoin, current_user: CurrentUser, db: DbSession) -> GroupRead:
    result = await db.execute(
        select(Group).where(Group.invite_code == payload.invite_code.upper(), Group.deleted_at.is_(None))
    )
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    existing = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group.id,
            GroupMember.user_id == current_user.id,
            GroupMember.left_at.is_(None),
        )
    )
    if existing.scalar_one_or_none() is None:
        db.add(GroupMember(group_id=group.id, user_id=current_user.id, role=ROLE_STUDENT))
        await db.commit()
        await connection_manager.broadcast(
            group.id,
            {
                "type": "group.member_joined",
                "group_id": group.id,
                "entity": "group_member",
                "entity_id": current_user.id,
                "operator_id": current_user.id,
            },
            required_permission="can_manage_members",
        )
    return group


@router.get("/{group_id}/me", response_model=GroupAccessRead)
async def get_group_access(group_id: int, current_user: CurrentUser, db: DbSession) -> GroupAccessRead:
    membership = await require_group_member(db, group_id, current_user.id)
    role = normalize_role(membership.role)
    permissions = permissions_for_role(role)
    return GroupAccessRead(
        group_id=group_id,
        user_id=current_user.id,
        role=role,
        role_label=ROLE_LABELS[role],
        permissions=permissions.model_dump(),
    )


@router.get("/{group_id}", response_model=GroupRead)
async def get_group(group_id: int, current_user: CurrentUser, db: DbSession) -> GroupRead:
    await require_group_member(db, group_id, current_user.id)
    group = await db.get(Group, group_id)
    if group is None or group.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return group


@router.get("/{group_id}/members", response_model=list[GroupMemberRead])
async def list_group_members(
    group_id: int, current_user: CurrentUser, db: DbSession
) -> list[GroupMemberRead]:
    await require_group_permission(db, group_id, current_user.id, "can_manage_members")
    result = await db.execute(
        select(GroupMember)
        .options(selectinload(GroupMember.user))
        .where(GroupMember.group_id == group_id, GroupMember.left_at.is_(None))
        .order_by(GroupMember.joined_at.asc())
    )
    return list(result.scalars().all())


@router.patch("/{group_id}/members/{member_id}/role", response_model=GroupMemberRead)
async def update_group_member_role(
    group_id: int,
    member_id: int,
    payload: GroupMemberRoleUpdate,
    current_user: CurrentUser,
    db: DbSession,
) -> GroupMemberRead:
    await require_group_permission(db, group_id, current_user.id, "can_manage_members")
    role = ensure_assignable_role(payload.role)
    result = await db.execute(
        select(GroupMember)
        .options(selectinload(GroupMember.user))
        .where(
            GroupMember.id == member_id,
            GroupMember.group_id == group_id,
            GroupMember.left_at.is_(None),
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    if normalize_role(membership.role) == ROLE_SUPER_ADMIN and role != ROLE_SUPER_ADMIN:
        await _ensure_another_super_admin(db, group_id, membership.id)
    membership.role = role
    await db.commit()
    await db.refresh(membership, attribute_names=["user"])
    await connection_manager.broadcast(
        group_id,
        {
            "type": "permissions.updated",
            "group_id": group_id,
            "entity": "group_member",
            "entity_id": membership.id,
            "operator_id": current_user.id,
        },
    )
    return membership


async def _create_unique_invite_code(db: DbSession) -> str:
    for _ in range(10):
        invite_code = generate_invite_code()
        result = await db.execute(select(Group.id).where(Group.invite_code == invite_code))
        if result.scalar_one_or_none() is None:
            return invite_code
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Could not generate invite code",
    )


async def _ensure_another_super_admin(db: DbSession, group_id: int, current_member_id: int) -> None:
    result = await db.execute(
        select(func.count())
        .select_from(GroupMember)
        .where(
            GroupMember.group_id == group_id,
            GroupMember.left_at.is_(None),
            GroupMember.id != current_member_id,
            GroupMember.role.in_([ROLE_SUPER_ADMIN, "creator", "admin"]),
        )
    )
    if result.scalar_one() == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="至少需要保留一名超级管理员")
