import httpx
from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import DbSession
from app.core.config import settings
from app.core.security import create_access_token
from app.models.user import User
from app.schemas.auth import TokenResponse, WechatLoginRequest

router = APIRouter()


@router.post("/wechat-login", response_model=TokenResponse)
async def wechat_login(payload: WechatLoginRequest, db: DbSession) -> TokenResponse:
    openid = payload.dev_openid if settings.is_development else None
    unionid: str | None = None
    if openid is None:
        if not payload.code:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing code")
        session_data = await _fetch_wechat_session(payload.code)
        openid = session_data.get("openid")
        unionid = session_data.get("unionid")
        if not openid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid WeChat code")

    result = await db.execute(select(User).where(User.openid == openid))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(
            openid=openid,
            unionid=unionid,
            nickname=payload.nickname,
            avatar_url=payload.avatar_url,
        )
        db.add(user)
    else:
        if payload.nickname is not None:
            user.nickname = payload.nickname
        if payload.avatar_url is not None:
            user.avatar_url = payload.avatar_url
    await db.commit()
    await db.refresh(user)
    return TokenResponse(access_token=create_access_token(str(user.id)), user=user)


async def _fetch_wechat_session(code: str) -> dict:
    if not settings.wechat_app_id or not settings.wechat_app_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="WeChat credentials are not configured",
        )
    params = {
        "appid": settings.wechat_app_id,
        "secret": settings.wechat_app_secret,
        "js_code": code,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get("https://api.weixin.qq.com/sns/jscode2session", params=params)
    response.raise_for_status()
    data = response.json()
    if data.get("errcode"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=data.get("errmsg"))
    return data

