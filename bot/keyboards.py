"""Build Telegram keyboards from node options."""
from __future__ import annotations
from typing import Optional

from telegram import InlineKeyboardButton, InlineKeyboardMarkup


def build_keyboard(options: list[dict], allow_multiple: bool = False, unknown_action: Optional[str] = None) -> InlineKeyboardMarkup:
    buttons = []
    for opt in options:
        label = opt["label"]
        if len(label) > 60:
            label = label[:57] + "..."
        callback = opt["option_id"]
        buttons.append([InlineKeyboardButton(label, callback_data=callback)])

    if unknown_action and not any(o["option_id"] == "unknown" for o in options):
        buttons.append([InlineKeyboardButton("❓ Данные отсутствуют", callback_data="unknown")])

    return InlineKeyboardMarkup(buttons)


def build_multi_choice_keyboard(options: list[dict], selected: set[str]) -> InlineKeyboardMarkup:
    buttons = []
    for opt in options:
        label = opt["label"]
        if len(label) > 55:
            label = label[:52] + "..."
        check = "✅ " if opt["option_id"] in selected else "⬜ "
        buttons.append([InlineKeyboardButton(check + label, callback_data=f"toggle_{opt['option_id']}")])

    buttons.append([InlineKeyboardButton("✔ Готово", callback_data="multi_done")])
    buttons.append([InlineKeyboardButton("❓ Данные отсутствуют", callback_data="unknown")])
    return InlineKeyboardMarkup(buttons)


def build_numeric_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("❓ Нет данных", callback_data="unknown")],
    ])
