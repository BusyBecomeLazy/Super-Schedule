from datetime import time

from sqlalchemy import ForeignKey, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Period(Base):
    __tablename__ = "periods"
    __table_args__ = (UniqueConstraint("group_id", "period_index", name="uq_group_period"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), index=True)
    period_index: Mapped[int] = mapped_column()
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)

