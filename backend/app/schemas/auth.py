from pydantic import BaseModel

from app.schemas.user import UserRead


class WechatLoginRequest(BaseModel):
    code: str | None = None
    dev_openid: str | None = None
    nickname: str | None = None
    avatar_url: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead

