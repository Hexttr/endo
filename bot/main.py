"""Telegram bot entry point."""
import logging

from telegram.ext import ApplicationBuilder

from config import bot_settings
from handlers import get_conversation_handler

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


def main():
    if bot_settings.TELEGRAM_TOKEN == "YOUR_BOT_TOKEN_HERE":
        logger.error("Set TELEGRAM_TOKEN in .env or environment variables")
        return

    app = ApplicationBuilder().token(bot_settings.TELEGRAM_TOKEN).build()
    app.add_handler(get_conversation_handler())

    logger.info("Bot started")
    app.run_polling()


if __name__ == "__main__":
    main()
