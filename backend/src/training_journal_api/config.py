from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str
    api_bearer_token: str
    cors_allowed_origins: str = ""
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def origins(self) -> list[str]:
        return [value.strip().rstrip("/") for value in self.cors_allowed_origins.split(",") if value.strip()]

@lru_cache
def get_settings() -> Settings:
    return Settings()
