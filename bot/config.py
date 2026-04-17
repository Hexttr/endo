from pydantic_settings import BaseSettings


class BotSettings(BaseSettings):
    TELEGRAM_TOKEN: str = "YOUR_BOT_TOKEN_HERE"
    API_BASE_URL: str = "http://localhost:8000/api"

    class Config:
        env_file = ".env"


bot_settings = BotSettings()
