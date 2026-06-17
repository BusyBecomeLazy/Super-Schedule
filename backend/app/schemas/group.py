from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserRead


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class GroupJoin(BaseModel):
    invite_code: str = Field(min_length=4, max_length=12)


class GroupRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    creator_id: int
    invite_code: str
    created_at: datetime
    updated_at: datetime


class GroupMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    group_id: int
    user_id: int
    role: str
    joined_at: datetime
    user: UserRead | None = None


class GroupPermissions(BaseModel):
    can_view_courses: bool
    can_manage_courses: bool
    can_view_events: bool
    can_manage_events: bool
    can_manage_members: bool
    can_view_management: bool


class GroupAccessRead(BaseModel):
    group_id: int
    user_id: int
    role: str
    role_label: str
    permissions: GroupPermissions


class GroupMemberRoleUpdate(BaseModel):
    role: str
