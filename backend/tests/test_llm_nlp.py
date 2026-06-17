import json
from datetime import date

import pytest

from app.services import llm_nlp
from app.services.llm_nlp import LlmNlpNotConfigured, parse_text_with_deepseek


@pytest.mark.asyncio
async def test_parse_text_with_deepseek_normalizes_structured_json(monkeypatch) -> None:
    async def fake_request(payload: dict):
        assert payload["response_format"] == {"type": "json_object"}
        assert payload["model"] == "deepseek-v4-flash"
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "intent": "update_course",
                                "confidence": 0.91,
                                "draft": {
                                    "target": {
                                        "name": "数据库",
                                        "day_of_week": 3,
                                        "start_period": 1,
                                        "end_period": 2,
                                    },
                                    "changes": {
                                        "day_of_week": 4,
                                        "start_period": 3,
                                        "end_period": 4,
                                    },
                                },
                                "warnings": [],
                            }
                        )
                    }
                }
            ]
        }

    monkeypatch.setattr(llm_nlp.settings, "deepseek_api_key", "test-key")
    monkeypatch.setattr(llm_nlp.settings, "deepseek_nlp_enabled", True)
    monkeypatch.setattr(llm_nlp.settings, "deepseek_model", "deepseek-v4-flash")
    monkeypatch.setattr(llm_nlp, "_request_deepseek", fake_request)

    result = await parse_text_with_deepseek(
        "把周三1到2节数据库课改到周四3到4节",
        current_date=date(2026, 6, 16),
        timezone="Asia/Shanghai",
    )

    assert result.intent == "update_course"
    assert result.parser_source == "deepseek"
    assert result.confidence == 0.91
    assert result.draft["target"]["name"] == "数据库"
    assert result.draft["changes"]["day_of_week"] == 4
    assert result.draft["target_summary"] == "数据库 / 3 / 1 / 2"
    assert result.draft["change_summary"] == "4 / 3 / 4"


@pytest.mark.asyncio
async def test_parse_text_with_deepseek_guards_missing_create_fields(monkeypatch) -> None:
    async def fake_request(payload: dict):
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "intent": "create_event",
                                "confidence": 0.88,
                                "draft": {"title": "开会"},
                                "warnings": [],
                            }
                        )
                    }
                }
            ]
        }

    monkeypatch.setattr(llm_nlp.settings, "deepseek_api_key", "test-key")
    monkeypatch.setattr(llm_nlp.settings, "deepseek_nlp_enabled", True)
    monkeypatch.setattr(llm_nlp, "_request_deepseek", fake_request)

    result = await parse_text_with_deepseek(
        "明天开会",
        current_date=date(2026, 6, 16),
        timezone="Asia/Shanghai",
    )

    assert result.intent == "unknown"
    assert result.draft == {}
    assert "缺少日程标题或时间" in result.warnings


@pytest.mark.asyncio
async def test_parse_text_with_deepseek_requires_configuration(monkeypatch) -> None:
    monkeypatch.setattr(llm_nlp.settings, "deepseek_api_key", None)
    monkeypatch.setattr(llm_nlp.settings, "deepseek_nlp_enabled", True)

    with pytest.raises(LlmNlpNotConfigured):
        await parse_text_with_deepseek(
            "明天下午3点开会",
            current_date=date(2026, 6, 16),
            timezone="Asia/Shanghai",
        )
