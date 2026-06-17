interface IAppOption {
  globalData: {
    token: string | null;
    currentGroupId: number | null;
    user: ApiUser | null;
    groupAccess: GroupAccess | null;
    permissions: GroupPermissions;
  };
}

interface ApiUser {
  id: number;
  openid: string;
  nickname?: string;
  avatar_url?: string;
}

interface GroupPermissions {
  can_view_courses: boolean;
  can_manage_courses: boolean;
  can_view_events: boolean;
  can_manage_events: boolean;
  can_manage_members: boolean;
  can_view_management: boolean;
}

interface GroupAccess {
  group_id: number;
  user_id: number;
  role: string;
  permissions: GroupPermissions;
}
