from pydantic import AnyHttpUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Zhiqun Schedule API"
    app_env: str = "development"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60 * 24 * 7

    database_url: str = "sqlite+aiosqlite:///./dev.db"
    redis_url: str = "redis://localhost:6379/0"
    auto_create_tables: bool = True

    wechat_app_id: str | None = None
    wechat_app_secret: str | None = None

    deepseek_nlp_enabled: bool = True
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_timeout_seconds: float = 10.0

    cors_origins: list[str | AnyHttpUrl] = Field(default_factory=lambda: ["*"])

    @property
    def is_development(self) -> bool:
        return self.app_env.lower() in {"dev", "development", "local", "test"}


settings = Settings()
