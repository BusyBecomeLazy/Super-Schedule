from datetime import date, time

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SemesterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def check_date_range(self):
        if self.end_date <= self.start_date:
            raise ValueError("end_date must be after start_date")
        return self


class SemesterRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    group_id: int
    name: str
    start_date: date
    end_date: date
    is_current: bool


class PeriodRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    group_id: int
    period_index: int
    start_time: time
    end_time: time


class CourseBase(BaseModel):
    semester_id: int
    name: str = Field(min_length=1, max_length=100)
    teacher: str | None = Field(default=None, max_length=64)
    location: str | None = Field(default=None, max_length=100)
    day_of_week: int = Field(ge=1, le=7)
    start_period: int = Field(ge=1, le=20)
    end_period: int = Field(ge=1, le=20)
    week_start: int = Field(ge=1, le=30)
    week_end: int = Field(ge=1, le=30)
    color_tag: str | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def check_ranges(self):
        if self.end_period < self.start_period:
            raise ValueError("end_period must be greater than or equal to start_period")
        if self.week_end < self.week_start:
            raise ValueError("week_end must be greater than or equal to week_start")
        return self


class CourseCreate(CourseBase):
    pass


class CourseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    teacher: str | None = Field(default=None, max_length=64)
    location: str | None = Field(default=None, max_length=100)
    day_of_week: int | None = Field(default=None, ge=1, le=7)
    start_period: int | None = Field(default=None, ge=1, le=20)
    end_period: int | None = Field(default=None, ge=1, le=20)
    week_start: int | None = Field(default=None, ge=1, le=30)
    week_end: int | None = Field(default=None, ge=1, le=30)
    color_tag: str | None = Field(default=None, max_length=32)
    version: int | None = None


class CourseRead(CourseBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    group_id: int
    creator_id: int
    source: str
    version: int

