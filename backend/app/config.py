from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://finasist:finasist@db:5432/finasist"

    # Auth
    secret_key: str = "CHANGE_ME_super_secret_key_for_profit_divider_2025"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 1 day

    # Bootstrap super admin
    superadmin_email: str = "admin@profitdivider.uz"
    superadmin_password: str = "Admin12345!"
    superadmin_name: str = "Super Admin"

    # App
    company_name: str = 'ООО "PROFIT DIVIDER"'
    cors_origins: str = "*"


settings = Settings()
