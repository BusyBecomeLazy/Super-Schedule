from dataclasses import dataclass

from fastapi import HTTPException, status

ROLE_STUDENT = "student"
ROLE_STAFF = "staff"
ROLE_COURSE_MANAGER = "course_manager"
ROLE_SUPER_ADMIN = "super_admin"

ROLE_LABELS = {
    ROLE_STUDENT: "学员",
    ROLE_STAFF: "员工",
    ROLE_COURSE_MANAGER: "课程管理员",
    ROLE_SUPER_ADMIN: "超级管理员",
}

ASSIGNABLE_ROLES = tuple(ROLE_LABELS.keys())
LEGACY_ROLE_MAP = {
    "creator": ROLE_SUPER_ADMIN,
    "admin": ROLE_SUPER_ADMIN,
    "member": ROLE_STAFF,
}

PERMISSION_DENIED_MESSAGES = {
    "can_view_courses": "没有查看课程权限",
    "can_manage_courses": "没有课程管理权限",
    "can_view_events": "没有查看日程权限",
    "can_manage_events": "没有日程管理权限",
    "can_manage_members": "没有成员管理权限",
    "can_view_management": "没有管理入口权限",
}


@dataclass(frozen=True)
class PermissionSet:
    can_view_courses: bool
    can_manage_courses: bool
    can_view_events: bool
    can_manage_events: bool
    can_manage_members: bool
    can_view_management: bool

    def model_dump(self) -> dict[str, bool]:
        return {
            "can_view_courses": self.can_view_courses,
            "can_manage_courses": self.can_manage_courses,
            "can_view_events": self.can_view_events,
            "can_manage_events": self.can_manage_events,
            "can_manage_members": self.can_manage_members,
            "can_view_management": self.can_view_management,
        }


def normalize_role(role: str | None) -> str:
    if role in ASSIGNABLE_ROLES:
        return role
    return LEGACY_ROLE_MAP.get(role or "", ROLE_STUDENT)


def permissions_for_role(role: str | None) -> PermissionSet:
    normalized = normalize_role(role)
    return PermissionSet(
        can_view_courses=True,
        can_manage_courses=normalized in {ROLE_COURSE_MANAGER, ROLE_SUPER_ADMIN},
        can_view_events=normalized in {ROLE_STAFF, ROLE_COURSE_MANAGER, ROLE_SUPER_ADMIN},
        can_manage_events=normalized in {ROLE_STAFF, ROLE_COURSE_MANAGER, ROLE_SUPER_ADMIN},
        can_manage_members=normalized == ROLE_SUPER_ADMIN,
        can_view_management=normalized == ROLE_SUPER_ADMIN,
    )


def ensure_assignable_role(role: str) -> str:
    normalized = normalize_role(role)
    if normalized not in ASSIGNABLE_ROLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效角色")
    return normalized


def require_permission(role: str | None, permission: str) -> None:
    permissions = permissions_for_role(role)
    if not getattr(permissions, permission):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=PERMISSION_DENIED_MESSAGES.get(permission, "没有操作权限"),
        )
