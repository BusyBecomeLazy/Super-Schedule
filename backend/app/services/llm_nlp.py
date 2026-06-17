import json
from datetime import date
from typing import Any

import httpx
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.nlp import NlpParseResponse

VALID_INTENTS = {
    "create_event",
    "create_course",
    "update_event",
    "update_course",
    "delete_event",
    "delete_course",
    "unknown",
}

MISSING_FIELD_LABELS = {
    "title": "日程标题",
    "name": "课程名",
    "start_time": "开始时间",
    "end_time": "结束时间",
    "date": "日期",
    "location": "地点",
    "day_of_week": "星期",
    "start_period": "开始节次",
    "end_period": "结束节次",
    "week_start": "开始周次",
    "week_end": "结束周次",
    "target": "操作目标",
    "changes": "修改内容",
}


class LlmNlpError(Exception):
    """Raised when the LLM parser cannot produce a safe structured result."""


class LlmNlpNotConfigured(LlmNlpError):
    """Raised when DeepSeek NLP is disabled or no API key is configured."""


async def parse_text_with_deepseek(
    text: str,
    *,
    current_date: date,
    timezone: str,
) -> NlpParseResponse:
    if not settings.deepseek_nlp_enabled or not settings.deepseek_api_key:
        raise LlmNlpNotConfigured("DeepSeek NLP is not configured")

    payload = _build_payload(text=text, current_date=current_date, timezone=timezone)
    response_data = await _request_deepseek(payload)
    content = _extract_content(response_data)
    raw = _loads_json(content)
    return _normalize_response(raw)


async def _request_deepseek(payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=settings.deepseek_timeout_seconds) as client:
            response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as error:
        raise LlmNlpError("DeepSeek request failed") from error
    except json.JSONDecodeError as error:
        raise LlmNlpError("DeepSeek returned invalid JSON response") from error


def _build_payload(*, text: str, current_date: date, timezone: str) -> dict[str, Any]:
    return {
        "model": settings.deepseek_model,
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "text": text,
                        "current_date": current_date.isoformat(),
                        "timezone": timezone,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0,
        "max_tokens": 1200,
        "stream": False,
        "thinking": {"type": "disabled"},
    }


def _system_prompt() -> str:
    return """
你是一个小程序的自然语言解析器。你只负责把用户中文输入解析成严格 json，不执行数据库操作。

业务对象：
1. event(日程)：按日期、开始时间、结束时间管理。
2. course(课程)：按星期、节次、周次管理。day_of_week 用 1-7 表示周一到周日。

允许的 intent：
create_event, update_event, delete_event, create_course, update_course, delete_course, unknown

输出必须是一个 json object，且只能使用这些顶层字段：
{
  "intent": "create_event | create_course | update_event | update_course | delete_event | delete_course | unknown",
  "confidence": 0.0,
  "draft": {},
  "warnings": [],
  "missing_fields": []
}

draft 结构：
- create_event:
  {
    "title": "日程标题",
    "start_time": "YYYY-MM-DDTHH:MM:SS",
    "end_time": "YYYY-MM-DDTHH:MM:SS",
    "location": "地点或 null",
    "is_all_day": false
  }
- update_event:
  {
    "target": {"title": "...", "date": "YYYY-MM-DD", "start_time": "YYYY-MM-DDTHH:MM:SS", "location": "..."},
    "changes": {"title": "...", "date": "YYYY-MM-DD", "start_time": "YYYY-MM-DDTHH:MM:SS", "end_time": "YYYY-MM-DDTHH:MM:SS", "duration_hours": 1, "location": "..."},
    "target_summary": "...",
    "change_summary": "..."
  }
- delete_event:
  {
    "target": {"title": "...", "date": "YYYY-MM-DD", "start_time": "YYYY-MM-DDTHH:MM:SS", "location": "..."},
    "target_summary": "..."
  }
- create_course:
  {
    "name": "课程名",
    "location": "地点或 null",
    "day_of_week": 1,
    "start_period": 1,
    "end_period": 2,
    "week_start": 1,
    "week_end": 16
  }
- update_course:
  {
    "target": {"name": "...", "location": "...", "day_of_week": 1, "start_period": 1, "end_period": 2, "week_start": 1, "week_end": 16},
    "changes": {"name": "...", "location": "...", "day_of_week": 2, "start_period": 3, "end_period": 4, "week_start": 1, "week_end": 16},
    "target_summary": "...",
    "change_summary": "..."
  }
- delete_course:
  {
    "target": {"name": "...", "location": "...", "day_of_week": 1, "start_period": 1, "end_period": 2, "week_start": 1, "week_end": 16},
    "target_summary": "..."
  }

规则：
- 只输出 json，不要 markdown。
- 不确定或缺少关键字段时，intent 使用 unknown，在 warnings 说明原因，并在 missing_fields 写出缺失项。
- “明天/后天/本周/下周/周三”等必须结合 user JSON 里的 current_date 推算。
- “下午3点改到4点”这类后半句没有上午/下午时，应沿用前半句的下午语境。
- “1到16周”“第3周”解析为 week_start/week_end。
- “1到2节”“三四节”“第5节”解析为 start_period/end_period。
- 课程和日程不互相冲突；不要在解析阶段做冲突判断。
""".strip()


def _extract_content(response_data: dict[str, Any]) -> str:
    try:
        content = response_data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise LlmNlpError("DeepSeek response is missing message content") from error
    if not isinstance(content, str) or not content.strip():
        raise LlmNlpError("DeepSeek returned empty content")
    return content


def _loads_json(content: str) -> dict[str, Any]:
    try:
        value = json.loads(content)
    except json.JSONDecodeError as error:
        raise LlmNlpError("DeepSeek returned non-JSON content") from error
    if not isinstance(value, dict):
        raise LlmNlpError("DeepSeek JSON output must be an object")
    return value


def _normalize_response(raw: dict[str, Any]) -> NlpParseResponse:
    intent = raw.get("intent")
    if intent not in VALID_INTENTS:
        intent = "unknown"

    draft = raw.get("draft")
    if not isinstance(draft, dict):
        draft = {}

    warnings = raw.get("warnings")
    if not isinstance(warnings, list):
        warnings = []
    warnings = [str(item) for item in warnings if str(item).strip()]

    missing_fields = raw.get("missing_fields")
    if not isinstance(missing_fields, list):
        missing_fields = []
    missing_fields = [_missing_field_label(item) for item in missing_fields if str(item).strip()]

    confidence = raw.get("confidence", 0.0)
    try:
        confidence = max(0.0, min(1.0, float(confidence)))
    except (TypeError, ValueError):
        confidence = 0.0

    intent, draft, warnings, missing_fields = _guard_critical_fields(
        intent,
        draft,
        warnings,
        missing_fields,
    )
    try:
        return NlpParseResponse(
            intent=intent,
            confidence=confidence,
            draft=draft,
            warnings=warnings,
            missing_fields=missing_fields,
            parser_source="deepseek",
        )
    except ValidationError as error:
        raise LlmNlpError("DeepSeek output failed schema validation") from error


def _guard_critical_fields(
    intent: str,
    draft: dict[str, Any],
    warnings: list[str],
    missing_fields: list[str],
) -> tuple[str, dict[str, Any], list[str], list[str]]:
    if intent == "create_event":
        missing = _missing_create_event_fields(draft)
        if missing:
            return "unknown", {}, _with_warning(warnings, "缺少日程标题或时间"), _merge_missing(
                missing_fields,
                missing,
            )
        draft.setdefault("location", None)
        draft.setdefault("is_all_day", False)
        return intent, draft, warnings, missing_fields

    if intent == "create_course":
        missing = _missing_create_course_fields(draft)
        if missing:
            return "unknown", {}, _with_warning(warnings, "缺少课程名、星期或节次"), _merge_missing(
                missing_fields,
                missing,
            )
        draft.setdefault("location", None)
        draft.setdefault("week_start", 1)
        draft.setdefault("week_end", 16)
        return intent, draft, warnings, missing_fields

    if intent in {"update_event", "delete_event", "update_course", "delete_course"}:
        target = draft.get("target")
        if not isinstance(target, dict) or not target:
            return (
                "unknown",
                {},
                _with_warning(warnings, "缺少要操作的目标"),
                _merge_missing(missing_fields, ["操作目标"]),
            )
        if intent.startswith("update_"):
            changes = draft.get("changes")
            if not isinstance(changes, dict) or not changes:
                return (
                    "unknown",
                    {},
                    _with_warning(warnings, "缺少要修改的内容"),
                    _merge_missing(missing_fields, ["修改内容"]),
                )
            draft.setdefault("change_summary", _summarize(changes))
        draft.setdefault("target_summary", _summarize(target))
        return intent, draft, warnings, missing_fields

    return intent, draft, warnings, missing_fields


def _missing_create_event_fields(draft: dict[str, Any]) -> list[str]:
    missing = []
    if draft.get("title") in {None, ""}:
        missing.append("日程标题")
    if draft.get("start_time") in {None, ""}:
        missing.append("开始时间")
    if draft.get("end_time") in {None, ""}:
        missing.append("结束时间")
    return missing


def _missing_create_course_fields(draft: dict[str, Any]) -> list[str]:
    missing = []
    if draft.get("name") in {None, ""}:
        missing.append("课程名")
    if draft.get("day_of_week") in {None, ""}:
        missing.append("星期")
    if draft.get("start_period") in {None, ""}:
        missing.append("开始节次")
    if draft.get("end_period") in {None, ""}:
        missing.append("结束节次")
    return missing


def _with_warning(warnings: list[str], message: str) -> list[str]:
    if message not in warnings:
        return [*warnings, message]
    return warnings


def _merge_missing(existing: list[str], values: list[str]) -> list[str]:
    merged = [*existing]
    for value in values:
        if value not in merged:
            merged.append(value)
    return merged


def _missing_field_label(value: Any) -> str:
    text = str(value).strip()
    return MISSING_FIELD_LABELS.get(text, text)


def _summarize(value: dict[str, Any]) -> str:
    parts = []
    for key in ("title", "name", "date", "start_time", "day_of_week", "start_period", "end_period", "location"):
        if value.get(key) is not None and value.get(key) != "":
            parts.append(str(value[key]))
    return " / ".join(parts) or "未识别"
