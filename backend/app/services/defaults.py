from datetime import time

DEFAULT_PERIODS: list[tuple[int, time, time]] = [
    (1, time(8, 0), time(8, 45)),
    (2, time(8, 55), time(9, 40)),
    (3, time(10, 0), time(10, 45)),
    (4, time(10, 55), time(11, 40)),
    (5, time(14, 0), time(14, 45)),
    (6, time(14, 55), time(15, 40)),
    (7, time(16, 0), time(16, 45)),
    (8, time(16, 55), time(17, 40)),
    (9, time(19, 0), time(19, 45)),
    (10, time(19, 55), time(20, 40)),
    (11, time(20, 50), time(21, 35)),
    (12, time(21, 45), time(22, 30)),
]

