from pydantic_settings import BaseSettings, SettingsConfigDict


class BotSettings(BaseSettings):
    TELEGRAM_TOKEN: str = "YOUR_BOT_TOKEN_HERE"
    API_BASE_URL: str = "http://localhost:8000/api"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


bot_settings = BotSettings()
