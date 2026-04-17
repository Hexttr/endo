"""Telegram bot handlers for the diagnostic conversation."""
from __future__ import annotations

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ConversationHandler,
    filters,
)

import api_client
from keyboards import build_keyboard, build_multi_choice_keyboard, build_numeric_keyboard

CONVERSING = 1
NUMERIC_INPUT = 2
MULTI_SELECT = 3


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    user_id = str(update.effective_user.id)
    data = await api_client.start_session(user_id)

    context.user_data["session_id"] = data["session_id"]
    context.user_data["multi_selected"] = set()

    await update.message.reply_text(
        "🏥 *Диагностика ЖКК у детей*\n\n"
        "Я помогу провести диагностику по алгоритму.\n"
        "На каждом шаге выбирайте ответ из предложенных вариантов.\n\n"
        "Для перезапуска: /start\nДля отмены: /cancel",
        parse_mode="Markdown",
    )

    node = data.get("current_node")
    if node:
        return await _present_node(update, context, node)
    return CONVERSING


async def cancel_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.clear()
    await update.message.reply_text("Диагностика отменена. Для нового сеанса: /start")
    return ConversationHandler.END


async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    callback_data = query.data
    session_id = context.user_data.get("session_id")
    if not session_id:
        await query.edit_message_text("Сессия не найдена. Начните заново: /start")
        return ConversationHandler.END

    if callback_data.startswith("toggle_"):
        option_id = callback_data[7:]
        selected = context.user_data.get("multi_selected", set())
        if option_id in selected:
            selected.discard(option_id)
        else:
            selected.add(option_id)
        context.user_data["multi_selected"] = selected

        node = context.user_data.get("current_node")
        if node:
            kb = build_multi_choice_keyboard(node.get("options", []), selected)
            await query.edit_message_reply_markup(reply_markup=kb)
        return MULTI_SELECT

    if callback_data == "multi_done":
        selected = list(context.user_data.get("multi_selected", set()))
        node_id = context.user_data.get("current_node_id")
        answer = selected if selected else "unknown"
        return await _submit_and_advance(query, context, session_id, node_id, answer)

    node_id = context.user_data.get("current_node_id")
    return await _submit_and_advance(query, context, session_id, node_id, callback_data)


async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle free text input for numeric fields."""
    session_id = context.user_data.get("session_id")
    node_id = context.user_data.get("current_node_id")
    if not session_id or not node_id:
        await update.message.reply_text("Сессия не найдена. Начните заново: /start")
        return ConversationHandler.END

    text = update.message.text.strip()
    try:
        values = {}
        for part in text.replace(",", " ").split():
            if "=" in part:
                k, v = part.split("=", 1)
                values[k.strip()] = float(v.strip())
            else:
                try:
                    float(part)
                except ValueError:
                    pass
        answer = values if values else text
    except Exception:
        answer = text

    return await _submit_and_advance_msg(update, context, session_id, node_id, answer)


async def _submit_and_advance(query, context, session_id, node_id, answer) -> int:
    try:
        data = await api_client.submit_answer(session_id, node_id, answer)
    except Exception as e:
        await query.edit_message_text(f"Ошибка: {e}")
        return CONVERSING

    context.user_data["multi_selected"] = set()

    if data.get("status") == "completed":
        return await _show_final(query, context, data)

    node = data.get("current_node")
    if node:
        return await _present_node_from_query(query, context, node)

    await query.edit_message_text("Достигнут конец алгоритма. Для нового сеанса: /start")
    return ConversationHandler.END


async def _submit_and_advance_msg(update, context, session_id, node_id, answer) -> int:
    try:
        data = await api_client.submit_answer(session_id, node_id, answer)
    except Exception as e:
        await update.message.reply_text(f"Ошибка: {e}")
        return CONVERSING

    context.user_data["multi_selected"] = set()

    if data.get("status") == "completed":
        return await _show_final_msg(update, context, data)

    node = data.get("current_node")
    if node:
        return await _present_node(update, context, node)

    await update.message.reply_text("Достигнут конец алгоритма. Для нового сеанса: /start")
    return ConversationHandler.END


async def _present_node(update, context, node: dict) -> int:
    context.user_data["current_node_id"] = node["id"]
    context.user_data["current_node"] = node
    input_type = node.get("input_type", "info")
    text = f"📋 *{node['id']}*\n\n{node['text']}"

    if node.get("description"):
        text += f"\n\n_{node['description']}_"

    if input_type in ("single_choice", "yes_no"):
        kb = build_keyboard(node.get("options", []), unknown_action=node.get("unknown_action"))
        await update.message.reply_text(text, reply_markup=kb, parse_mode="Markdown")
        return CONVERSING

    elif input_type == "multi_choice":
        context.user_data["multi_selected"] = set()
        kb = build_multi_choice_keyboard(node.get("options", []), set())
        await update.message.reply_text(text + "\n\n_Выберите все подходящие варианты:_", reply_markup=kb, parse_mode="Markdown")
        return MULTI_SELECT

    elif input_type == "numeric":
        fields_desc = ""
        if node.get("extra") and node["extra"].get("fields"):
            for f in node["extra"]["fields"]:
                fields_desc += f"\n  • {f['label']}"
        kb = build_numeric_keyboard()
        await update.message.reply_text(
            text + f"\n\nВведите значения в формате: Hb=120 PLT=200\nИли поля:{fields_desc}",
            reply_markup=kb,
            parse_mode="Markdown",
        )
        return NUMERIC_INPUT

    elif input_type in ("info", "action"):
        kb = InlineKeyboardMarkup([[InlineKeyboardButton("Далее ➡", callback_data="next")]])
        await update.message.reply_text(text, reply_markup=kb, parse_mode="Markdown")
        return CONVERSING

    else:
        kb = InlineKeyboardMarkup([[InlineKeyboardButton("Далее ➡", callback_data="next")]])
        await update.message.reply_text(text, reply_markup=kb, parse_mode="Markdown")
        return CONVERSING


async def _present_node_from_query(query, context, node: dict) -> int:
    context.user_data["current_node_id"] = node["id"]
    context.user_data["current_node"] = node
    input_type = node.get("input_type", "info")
    text = f"📋 *{node['id']}*\n\n{node['text']}"

    if node.get("description"):
        text += f"\n\n_{node['description']}_"

    if input_type in ("single_choice", "yes_no"):
        kb = build_keyboard(node.get("options", []), unknown_action=node.get("unknown_action"))
        await query.edit_message_text(text, reply_markup=kb, parse_mode="Markdown")
        return CONVERSING

    elif input_type == "multi_choice":
        context.user_data["multi_selected"] = set()
        kb = build_multi_choice_keyboard(node.get("options", []), set())
        await query.edit_message_text(text + "\n\n_Выберите все подходящие варианты:_", reply_markup=kb, parse_mode="Markdown")
        return MULTI_SELECT

    elif input_type == "numeric":
        kb = build_numeric_keyboard()
        await query.edit_message_text(
            text + "\n\nВведите значения в формате: Hb=120 PLT=200",
            reply_markup=kb,
            parse_mode="Markdown",
        )
        return NUMERIC_INPUT

    else:
        kb = InlineKeyboardMarkup([[InlineKeyboardButton("Далее ➡", callback_data="next")]])
        await query.edit_message_text(text, reply_markup=kb, parse_mode="Markdown")
        return CONVERSING


async def _show_final(query, context, data: dict) -> int:
    final = data.get("final")
    flags = data.get("unknown_flags", [])
    text = _format_final(final, flags)
    await query.edit_message_text(text, parse_mode="Markdown")
    context.user_data.clear()
    return ConversationHandler.END


async def _show_final_msg(update, context, data: dict) -> int:
    final = data.get("final")
    flags = data.get("unknown_flags", [])
    text = _format_final(final, flags)
    await update.message.reply_text(text, parse_mode="Markdown")
    context.user_data.clear()
    return ConversationHandler.END


def _format_final(final: dict | None, flags: list) -> str:
    if not final:
        return "🏁 Диагностика завершена.\nДля нового сеанса: /start"

    text = f"🏁 *ДИАГНОЗ: {final['diagnosis']}*\n\n"
    if final.get("endo_picture"):
        text += f"🔬 *Эндоскопическая картина:*\n{final['endo_picture']}\n\n"
    if final.get("equipment"):
        equip = ", ".join(final["equipment"]) if isinstance(final["equipment"], list) else final["equipment"]
        text += f"🔧 *Оборудование:*\n{equip}\n\n"
    if final.get("algorithm"):
        text += f"📋 *Алгоритм:*\n{final['algorithm']}\n\n"
    if final.get("routing"):
        text += f"👨‍⚕ *Маршрутизация:*\n{final['routing']}\n\n"
    if final.get("followup"):
        text += f"📅 *Наблюдение:*\n{final['followup']}\n\n"

    if flags:
        text += "⚠ *Данные требуют уточнения:*\n"
        for f in flags:
            text += f"  • {f.get('node', '?')}: {f.get('reason', '?')}\n"

    text += "\nДля нового сеанса: /start"
    return text


def get_conversation_handler() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[CommandHandler("start", start_command)],
        states={
            CONVERSING: [
                CallbackQueryHandler(callback_handler),
            ],
            MULTI_SELECT: [
                CallbackQueryHandler(callback_handler),
            ],
            NUMERIC_INPUT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler),
                CallbackQueryHandler(callback_handler),
            ],
        },
        fallbacks=[CommandHandler("cancel", cancel_command)],
        per_user=True,
        per_chat=True,
    )
