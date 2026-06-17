export interface Group {
  id: number;
  name: string;
  creator_id: number;
  invite_code: string;
}

export interface EventItem {
  id: number;
  title: string;
  location?: string;
  start_time: string;
  end_time: string;
  color_tag?: string;
}

export interface Course {
  id: number;
  name: string;
  teacher?: string;
  location?: string;
  day_of_week: number;
  start_period: number;
  end_period: number;
  week_start: number;
  week_end: number;
  color_tag?: string;
}

