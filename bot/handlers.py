"""Telegram bot handlers for the diagnostic conversation.

Key UX principles:
- Keep the full dialog history visible. Every answered question is "frozen"
  in chat (keyboard removed, chosen answer appended), and the next question
  arrives as a NEW message below. The Telegram scroll-back becomes a natural
  transcript of the whole session.
- Never end a session with a vague "end reached" message. Terminal nodes,
  pending nodes (awaiting external data) and final diagnoses are always
  presented as a complete conclusion block with next-step guidance.
"""
from __future__ import annotations
import logging

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

logger = logging.getLogger(__name__)

CONVERSING = 1
NUMERIC_INPUT = 2
MULTI_SELECT = 3


# ──────────────────────────────────────────────────────────────────────────
# Commands
# ──────────────────────────────────────────────────────────────────────────
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    user_id = str(update.effective_user.id)
    data = await api_client.start_session(user_id)

    context.user_data["session_id"] = data["session_id"]
    context.user_data["multi_selected"] = set()

    await update.message.reply_text(
        "🏥 *Диагностика ЖКК у детей*\n\n"
        "Я помогу провести диагностику по алгоритму.\n"
        "На каждом шаге выбирайте ответ из предложенных вариантов.\n\n"
        "ℹ Вся история диалога остаётся в чате — вы можете прокрутить вверх "
        "и перечитать предыдущие вопросы и свои ответы.\n\n"
        "Для перезапуска: /start\nДля отмены: /cancel",
        parse_mode="Markdown",
    )

    node = data.get("current_node")
    if node:
        return await _present_node_as_new_message(update.message, context, node)
    return CONVERSING


async def cancel_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.clear()
    await update.message.reply_text("Диагностика отменена. Для нового сеанса: /start")
    return ConversationHandler.END


# ──────────────────────────────────────────────────────────────────────────
# Callback (button) handler
# ──────────────────────────────────────────────────────────────────────────
async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    callback_data = query.data
    session_id = context.user_data.get("session_id")
    if not session_id:
        await query.edit_message_text("Сессия не найдена. Начните заново: /start")
        return ConversationHandler.END

    # Multi-choice toggling — does not advance the conversation, just re-renders
    # the same message with updated checkboxes.
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

    node = context.user_data.get("current_node") or {}
    node_id = context.user_data.get("current_node_id")

    # Build the answer payload for the API + a human-readable label for the archive
    if callback_data == "multi_done":
        selected_ids = list(context.user_data.get("multi_selected", set()))
        answer = selected_ids if selected_ids else "unknown"
        display_label = _multi_display(node, selected_ids)
    else:
        answer = callback_data
        display_label = _find_option_label(node, callback_data)

    # Freeze the current question in chat history (remove keyboard, show answer)
    await _freeze_question(query, node, display_label)

    return await _submit_and_advance(query.message, context, session_id, node_id, answer)


# ──────────────────────────────────────────────────────────────────────────
# Text handler (numeric input)
# ──────────────────────────────────────────────────────────────────────────
async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
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

    # Strip the keyboard from the previous question so the user can't click
    # stale buttons after typing their answer.
    msg_id = context.user_data.get("last_question_msg_id")
    chat_id = context.user_data.get("last_question_chat_id")
    if msg_id and chat_id:
        try:
            await context.bot.edit_message_reply_markup(
                chat_id=chat_id, message_id=msg_id, reply_markup=None,
            )
        except Exception:
            pass

    # For numeric input the user has already typed the answer into the chat,
    # so the history is naturally preserved. We just send the next step below.
    return await _submit_and_advance(update.message, context, session_id, node_id, answer)


# ──────────────────────────────────────────────────────────────────────────
# Advance: submit answer and present whatever comes next (node / pending / final)
# ──────────────────────────────────────────────────────────────────────────
async def _submit_and_advance(message, context, session_id, node_id, answer) -> int:
    try:
        data = await api_client.submit_answer(session_id, node_id, answer)
    except Exception as e:
        logger.exception("submit_answer failed")
        await message.reply_text(f"❌ Ошибка связи с сервером: {e}")
        return CONVERSING

    context.user_data["multi_selected"] = set()

    # Final diagnosis reached
    if data.get("final"):
        await _send_final(message, data)
        context.user_data.clear()
        return ConversationHandler.END

    node = data.get("current_node")
    status = data.get("status")

    # Pending = waiting for external data (ЭГДС, биопсия, дообследование и т.д.)
    if node and node.get("is_pending"):
        await _send_pending(message, node, data)
        context.user_data.clear()
        return ConversationHandler.END

    # Terminal without a specific final diagnosis — still a legitimate conclusion
    if node and node.get("is_terminal"):
        await _send_terminal(message, node, data)
        context.user_data.clear()
        return ConversationHandler.END

    # Regular next question
    if node:
        return await _present_node_as_new_message(message, context, node)

    # Completed status without final/node → rare; treat as graceful end
    if status == "completed":
        await _send_graceful_end(message, data)
        context.user_data.clear()
        return ConversationHandler.END

    # Genuine dead end — should not happen on a well-formed tree
    await message.reply_text(
        "⚠ Алгоритм не смог определить следующий шаг.\n"
        "Это могло произойти из-за неполных данных. /start для перезапуска.",
    )
    context.user_data.clear()
    return ConversationHandler.END


# ──────────────────────────────────────────────────────────────────────────
# Presenting nodes
# ──────────────────────────────────────────────────────────────────────────
async def _present_node_as_new_message(message, context, node: dict) -> int:
    """Always send the next node as a new message (preserves chat history)."""
    context.user_data["current_node_id"] = node["id"]
    context.user_data["current_node"] = node
    input_type = node.get("input_type", "info")
    text = _format_node_header(node)

    if input_type in ("single_choice", "yes_no"):
        kb = build_keyboard(node.get("options", []), unknown_action=node.get("unknown_action"))
        sent = await message.reply_text(text, reply_markup=kb, parse_mode="Markdown")
    elif input_type == "multi_choice":
        context.user_data["multi_selected"] = set()
        kb = build_multi_choice_keyboard(node.get("options", []), set())
        sent = await message.reply_text(
            text + "\n\n_Выберите все подходящие варианты и нажмите «Готово»._",
            reply_markup=kb,
            parse_mode="Markdown",
        )
    elif input_type == "numeric":
        fields_desc = ""
        if node.get("extra") and node["extra"].get("fields"):
            for f in node["extra"]["fields"]:
                fields_desc += f"\n  • {f['label']}"
        kb = build_numeric_keyboard()
        sent = await message.reply_text(
            text + f"\n\nВведите значения в формате: `Hb=120 PLT=200`{fields_desc}",
            reply_markup=kb,
            parse_mode="Markdown",
        )
    else:
        # info / action / anything else — show with single "Далее" button
        kb = InlineKeyboardMarkup([[InlineKeyboardButton("▶ Далее", callback_data="next")]])
        sent = await message.reply_text(text, reply_markup=kb, parse_mode="Markdown")

    # Track the last question so we can strip its keyboard when the user
    # advances via text input (prevents clicking stale buttons).
    context.user_data["last_question_msg_id"] = sent.message_id
    context.user_data["last_question_chat_id"] = sent.chat_id

    if input_type == "multi_choice":
        return MULTI_SELECT
    if input_type == "numeric":
        return NUMERIC_INPUT
    return CONVERSING


def _format_node_header(node: dict) -> str:
    text = f"📋 *{node['id']}*\n\n{node['text']}"
    if node.get("description"):
        text += f"\n\n_{node['description']}_"
    return text


# ──────────────────────────────────────────────────────────────────────────
# Freezing answered questions in the chat history
# ──────────────────────────────────────────────────────────────────────────
async def _freeze_question(query, node: dict, answer_label: str) -> None:
    """Edit the current question message: strip keyboard, append the chosen answer.
    The result stays in chat forever as a transcript entry."""
    node_id = node.get("id", "?")
    text = node.get("text", "")
    safe_label = _escape_md(answer_label)
    frozen = f"📋 *{node_id}*\n\n{text}\n\n✅ _Ответ:_ *{safe_label}*"
    try:
        await query.edit_message_text(frozen, parse_mode="Markdown")
    except Exception:
        # Ignore edit-not-allowed / message-not-modified errors — don't block the flow.
        try:
            await query.edit_message_reply_markup(reply_markup=None)
        except Exception:
            pass


def _find_option_label(node: dict, option_id: str) -> str:
    if option_id == "next":
        return "▶ Далее"
    if option_id == "unknown":
        return "❓ Данные отсутствуют"
    for opt in node.get("options", []) or []:
        if opt.get("option_id") == option_id:
            return opt.get("label", option_id)
    return option_id


def _multi_display(node: dict, selected_ids: list) -> str:
    if not selected_ids:
        return "❓ Ничего не выбрано"
    labels = []
    for opt in node.get("options", []) or []:
        if opt.get("option_id") in selected_ids:
            labels.append(opt.get("label", opt.get("option_id", "?")))
    return " + ".join(labels) if labels else ", ".join(selected_ids)


def _escape_md(text: str) -> str:
    """Escape Markdown v1 special characters to avoid parse errors."""
    if not text:
        return text
    return text.replace("*", "∗").replace("_", "‿").replace("[", "(").replace("]", ")").replace("`", "'")


# ──────────────────────────────────────────────────────────────────────────
# Final / pending / terminal presentation
# ──────────────────────────────────────────────────────────────────────────
async def _send_final(message, data: dict) -> None:
    final = data.get("final") or {}
    flags = data.get("unknown_flags", [])
    collected = data.get("collected_data", {})

    lines = [f"🏁 *ДИАГНОЗ: {final.get('diagnosis', '—')}*"]

    if final.get("endo_picture"):
        lines.append(f"\n🔬 *Эндоскопическая картина:*\n{final['endo_picture']}")
    if final.get("equipment"):
        equip = final["equipment"]
        if isinstance(equip, list):
            equip = ", ".join(equip)
        lines.append(f"\n🔧 *Оборудование:*\n{equip}")
    if final.get("algorithm"):
        lines.append(f"\n📋 *Алгоритм:*\n{final['algorithm']}")
    if final.get("routing"):
        lines.append(f"\n👨‍⚕ *Маршрутизация:*\n{final['routing']}")
    if final.get("followup"):
        lines.append(f"\n📅 *Наблюдение:*\n{final['followup']}")

    if flags:
        lines.append("\n⚠ *Данные требуют уточнения:*")
        for f in flags:
            lines.append(f"  • {f.get('node', '?')}: {f.get('reason', '?')}")

    summary = _collected_summary(collected)
    if summary:
        lines.append(f"\n📝 *Собранные данные:*\n{summary}")

    lines.append("\n\nДля нового сеанса: /start")

    await message.reply_text("\n".join(lines), parse_mode="Markdown")


async def _send_pending(message, node: dict, data: dict) -> None:
    """Pending node = all data captured, awaiting external workup."""
    lines = [f"⏳ *Этап завершён — требуется дообследование*"]
    lines.append(f"\n📋 *{node['id']}* — {node.get('section', '')}")
    lines.append(f"\n{node.get('text', '')}")

    if node.get("return_node"):
        lines.append(f"\n🔁 После получения данных: вернуться к узлу *{node['return_node']}*")

    flags = data.get("unknown_flags", [])
    if flags:
        lines.append("\n⚠ *Пропущенные данные:*")
        for f in flags:
            lines.append(f"  • {f.get('node', '?')}: {f.get('reason', '?')}")

    summary = _collected_summary(data.get("collected_data", {}))
    if summary:
        lines.append(f"\n📝 *Уже собрано:*\n{summary}")

    lines.append("\n\nДля нового сеанса: /start")

    await message.reply_text("\n".join(lines), parse_mode="Markdown")


async def _send_terminal(message, node: dict, data: dict) -> None:
    """Terminal info/action node without a specific final diagnosis."""
    lines = [f"🏁 *Итог*"]
    lines.append(f"\n📋 *{node['id']}*")
    lines.append(f"\n{node.get('text', '')}")
    if node.get("description"):
        lines.append(f"\n_{node['description']}_")

    flags = data.get("unknown_flags", [])
    if flags:
        lines.append("\n⚠ *Пропущенные данные:*")
        for f in flags:
            lines.append(f"  • {f.get('node', '?')}: {f.get('reason', '?')}")

    summary = _collected_summary(data.get("collected_data", {}))
    if summary:
        lines.append(f"\n📝 *Собранные данные:*\n{summary}")

    lines.append("\n\nДля нового сеанса: /start")

    await message.reply_text("\n".join(lines), parse_mode="Markdown")


async def _send_graceful_end(message, data: dict) -> None:
    lines = ["🏁 *Диагностика завершена*"]
    summary = _collected_summary(data.get("collected_data", {}))
    if summary:
        lines.append(f"\n📝 *Собранные данные:*\n{summary}")
    flags = data.get("unknown_flags", [])
    if flags:
        lines.append("\n⚠ *Пропущенные данные:*")
        for f in flags:
            lines.append(f"  • {f.get('node', '?')}: {f.get('reason', '?')}")
    lines.append("\n\nДля нового сеанса: /start")
    await message.reply_text("\n".join(lines), parse_mode="Markdown")


def _collected_summary(collected: dict) -> str:
    """Render a compact summary of all collected answers."""
    if not collected:
        return ""
    lines = []
    for k, v in collected.items():
        if isinstance(v, list):
            pretty = ", ".join(str(x) for x in v) or "—"
        elif isinstance(v, dict):
            pretty = ", ".join(f"{kk}={vv}" for kk, vv in v.items()) or "—"
        else:
            pretty = str(v)
        if len(pretty) > 120:
            pretty = pretty[:117] + "..."
        lines.append(f"  • `{k}`: {pretty}")
    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────
# Conversation handler factory
# ──────────────────────────────────────────────────────────────────────────
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
