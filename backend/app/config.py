from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:postgres@localhost:5432/soulsim"
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    cors_allow_origin_regex: str = r"http://(localhost|127\.0\.0\.1|0\.0\.0\.0|10\..+|172\.(1[6-9]|2[0-9]|3[0-1])\..+|192\.168\..+)(:[0-9]+)?"


settings = Settings()
