from typing import Any, Literal

from pydantic import BaseModel, Field


class NlpContext(BaseModel):
    current_date: str | None = None
    timezone: str = "Asia/Shanghai"


class NlpParseRequest(BaseModel):
    group_id: int
    text: str = Field(min_length=1, max_length=500)
    context: NlpContext = Field(default_factory=NlpContext)


class NlpParseResponse(BaseModel):
    intent: Literal[
        "create_event",
        "create_course",
        "update_event",
        "update_course",
        "delete_event",
        "delete_course",
        "unknown",
    ]
    confidence: float
    draft: dict[str, Any]
    warnings: list[str] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)
    parser_source: Literal["deepseek", "local"] = "local"


class NlpConfirmRequest(BaseModel):
    group_id: int
    intent: Literal[
        "create_event",
        "create_course",
        "update_event",
        "update_course",
        "delete_event",
        "delete_course",
    ]
    draft: dict[str, Any]
    missing_fields: list[str] = Field(default_factory=list)
