from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://endo:endo@localhost:5432/endo_bot"
    DATABASE_URL_SYNC: str = "postgresql+psycopg2://endo:endo@localhost:5432/endo_bot"
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    ALGORITHM: str = "HS256"

    class Config:
        env_file = ".env"


settings = Settings()
