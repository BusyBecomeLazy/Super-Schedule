from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    openid: str
    nickname: str | None = None
    avatar_url: str | None = None
    created_at: datetime
    updated_at: datetime


class UserUpdate(BaseModel):
    nickname: str | None = None
    avatar_url: str | None = None

