from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class EventBase(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    location: str | None = Field(default=None, max_length=100)
    note: str | None = None
    start_time: datetime
    end_time: datetime
    is_all_day: bool = False
    color_tag: str | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def check_time_range(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=100)
    location: str | None = Field(default=None, max_length=100)
    note: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_all_day: bool | None = None
    color_tag: str | None = Field(default=None, max_length=32)
    version: int | None = None


class EventRead(EventBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    group_id: int
    creator_id: int
    source: str
    version: int
    created_at: datetime
    updated_at: datetime


class CalendarMark(BaseModel):
    date: str
    count: int


class DailyScheduleItem(BaseModel):
    id: int
    type: str
    title: str
    location: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    start_period: int | None = None
    end_period: int | None = None
    color_tag: str | None = None

