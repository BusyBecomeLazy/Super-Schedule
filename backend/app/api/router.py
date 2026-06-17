from fastapi import APIRouter

from app.api.routes import auth, courses, events, groups, health, nlp, users

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(groups.router, prefix="/groups", tags=["groups"])
api_router.include_router(events.router, prefix="/groups/{group_id}/events", tags=["events"])
api_router.include_router(courses.router, prefix="/groups/{group_id}", tags=["courses"])
api_router.include_router(nlp.router, prefix="/nlp", tags=["nlp"])

