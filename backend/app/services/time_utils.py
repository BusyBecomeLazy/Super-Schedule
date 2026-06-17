from datetime import date


def calculate_teaching_week(target_date: date, semester_start: date) -> int:
    days = (target_date - semester_start).days
    if days < 0:
        return 1
    return days // 7 + 1

