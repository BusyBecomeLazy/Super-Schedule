from pydantic import BaseModel


class ErrorBody(BaseModel):
    code: str
    message: str


class ApiResponse(BaseModel):
    data: object | None
    error: ErrorBody | None = None

