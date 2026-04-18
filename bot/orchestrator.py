"""Multi-bot orchestrator.

Runs as a single long-lived process (one systemd service) and supervises
one `telegram.ext.Application` per row in the `bots` table.

Design rationale:
    - Telegram long-polling blocks one connection per token, so each bot
      needs its own independent event-loop task.
    - We pull the authoritative state from Postgres every POLL_INTERVAL
      seconds instead of reacting to admin-panel events: that way the
      orchestrator is stateless w.r.t. the API and survives DB reconnects.
    - Per-bot failures are isolated: a crashed Application is caught,
      its `status`/`last_error` written back to the DB, and a retry is
      scheduled. A `Conflict 409` from Telegram halts auto-retry (requires
      a manual token change by the admin).
    - Shutdown is cooperative: on SIGTERM we stop all Applications cleanly
      so Telegram's webhook/polling state is released.
"""
from __future__ import annotations

import asyncio
import datetime
import logging
import os
import signal
import sys
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from telegram.error import Conflict, InvalidToken, Forbidden
from telegram.ext import ApplicationBuilder, Application

# Reuse conversation handler from the existing handlers module — same bot
# behavior, just scoped to a specific schema via bot_data.
from handlers import get_conversation_handler

logging.basicConfig(
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("orchestrator")

POLL_INTERVAL = float(os.environ.get("ORCHESTRATOR_POLL_INTERVAL", "5"))
ERROR_RETRY_DELAY = float(os.environ.get("ORCHESTRATOR_RETRY_DELAY", "30"))

# We talk directly to Postgres instead of the REST API for bot config:
# 1) lower latency for the 5-second reconcile loop,
# 2) avoids a circular dependency between the API and the bot service,
# 3) the orchestrator needs write access to status/last_error anyway.
#
# We use raw SQL (sqlalchemy.text) rather than the backend's ORM models on
# purpose — importing app.models transitively instantiates app.config.Settings,
# which validates all process env vars. Since systemd also loads the bot's
# .env (TELEGRAM_TOKEN, API_BASE_URL), Settings rejects them as extras. Raw
# SQL sidesteps this entirely and decouples orchestrator from backend layout.


def _load_db_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    for candidate in (
        os.path.join(os.path.dirname(__file__), "..", "backend", ".env"),
        "/opt/endo-bot2/backend/.env",
    ):
        if os.path.exists(candidate):
            with open(candidate, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    if k.strip() == "DATABASE_URL":
                        return v.strip().strip('"').strip("'")
    return "postgresql+asyncpg://endo:endo@localhost:5432/endo_bot"


DB_URL = _load_db_url()
# If someone dropped a psycopg2 URL in .env, swap to asyncpg transparently.
if DB_URL.startswith("postgresql://"):
    DB_URL = DB_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
elif DB_URL.startswith("postgresql+psycopg2://"):
    DB_URL = DB_URL.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)


engine = create_async_engine(DB_URL, pool_pre_ping=True, pool_recycle=300)


@dataclass
class BotRow:
    id: int
    schema_id: str
    token: str
    enabled: bool
    status: str


async def _load_bots() -> list[BotRow]:
    async with engine.begin() as conn:
        rows = await conn.execute(text(
            "SELECT id, schema_id, token, enabled, status FROM bots"
        ))
        return [BotRow(r.id, r.schema_id, r.token, r.enabled, r.status) for r in rows]


async def _update_status(
    bot_id: int,
    *,
    status: Optional[str] = None,
    last_error: Optional[str] = None,
    username: Optional[str] = None,
    clear_error: bool = False,
    mark_started: bool = False,
) -> None:
    sets: list[str] = ["updated_at = NOW()"]
    params: dict = {"id": bot_id}
    if status is not None:
        sets.append("status = :status")
        params["status"] = status
    if last_error is not None:
        sets.append("last_error = :last_error")
        params["last_error"] = last_error
    elif clear_error:
        sets.append("last_error = NULL")
    if username is not None:
        sets.append("username = :username")
        params["username"] = username
    if mark_started:
        sets.append("started_at = NOW()")
    sql = f"UPDATE bots SET {', '.join(sets)} WHERE id = :id"
    async with engine.begin() as conn:
        await conn.execute(text(sql), params)


class BotSupervisor:
    """Owns the lifecycle of exactly one Telegram Application."""

    def __init__(self, row: BotRow):
        self.row = row
        self.task: Optional[asyncio.Task] = None
        self.app: Optional[Application] = None
        self._stop = asyncio.Event()
        self._token_conflict = False

    def update_row(self, row: BotRow) -> None:
        """Update cached row data (token, enabled) without restarting yet.
        The main loop decides whether a restart is needed."""
        self.row = row

    async def start(self) -> None:
        self._stop.clear()
        self._token_conflict = False
        self.task = asyncio.create_task(self._run(), name=f"bot-{self.row.schema_id}")

    async def stop(self) -> None:
        self._stop.set()
        if self.app is not None:
            try:
                if self.app.updater and self.app.updater.running:
                    await self.app.updater.stop()
                if self.app.running:
                    await self.app.stop()
                await self.app.shutdown()
            except Exception:
                log.exception("Error during Application shutdown for %s", self.row.schema_id)
            self.app = None
        if self.task and not self.task.done():
            try:
                await asyncio.wait_for(self.task, timeout=10)
            except asyncio.TimeoutError:
                self.task.cancel()
            except Exception:
                log.exception("Supervisor task for %s finished with error", self.row.schema_id)
        self.task = None

    async def _run(self) -> None:
        """Main per-bot loop: build Application, poll, handle errors, retry."""
        schema_id = self.row.schema_id
        log.info("[%s] supervisor starting", schema_id)
        while not self._stop.is_set():
            try:
                await _update_status(self.row.id, status="starting", clear_error=True)
                self.app = (
                    ApplicationBuilder()
                    .token(self.row.token)
                    .concurrent_updates(True)
                    .build()
                )
                # The schema_id is the key piece of context — handlers read it
                # via `context.application.bot_data["schema_id"]`.
                self.app.bot_data["schema_id"] = schema_id
                self.app.add_handler(get_conversation_handler())
                self.app.add_error_handler(self._on_error)

                await self.app.initialize()
                try:
                    me = await self.app.bot.get_me()
                    await _update_status(self.row.id, username=me.username)
                    log.info("[%s] connected as @%s", schema_id, me.username)
                except Exception as e:
                    log.warning("[%s] getMe failed: %s", schema_id, e)

                await self.app.start()
                await self.app.updater.start_polling(
                    allowed_updates=["message", "callback_query"],
                    drop_pending_updates=False,
                )
                await _update_status(self.row.id, status="running", mark_started=True, clear_error=True)

                # Block until the supervisor is asked to stop.
                await self._stop.wait()

            except Conflict as e:
                # Another process is already polling this token.
                # Set an explicit `token_conflict` status and DO NOT auto-retry
                # until the admin changes the token (which resets status=stopped).
                log.error("[%s] Telegram Conflict — another poller is active: %s", schema_id, e)
                await _update_status(
                    self.row.id, status="token_conflict",
                    last_error=f"Токен уже используется другим процессом: {e}",
                )
                self._token_conflict = True
                return
            except (InvalidToken, Forbidden) as e:
                log.error("[%s] Invalid token: %s", schema_id, e)
                await _update_status(self.row.id, status="error", last_error=f"Неверный токен: {e}")
                return
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log.exception("[%s] supervisor crashed: %s", schema_id, e)
                await _update_status(self.row.id, status="error", last_error=str(e)[:500])
            finally:
                # Clean up Application regardless of how the loop exited.
                if self.app is not None:
                    try:
                        if self.app.updater and self.app.updater.running:
                            await self.app.updater.stop()
                        if self.app.running:
                            await self.app.stop()
                        await self.app.shutdown()
                    except Exception:
                        log.exception("[%s] cleanup error", schema_id)
                    self.app = None

            if self._stop.is_set() or self._token_conflict:
                break
            # Transient error — back off and retry.
            log.info("[%s] retry in %ss", schema_id, ERROR_RETRY_DELAY)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=ERROR_RETRY_DELAY)
            except asyncio.TimeoutError:
                pass

        await _update_status(self.row.id, status="stopped")
        log.info("[%s] supervisor stopped", schema_id)

    async def _on_error(self, update_obj, context) -> None:
        err = context.error
        if isinstance(err, Conflict):
            # Raised from within an update handler — surface it to the run loop
            # by stopping the Application; the main try/except above catches it.
            log.warning("[%s] Conflict inside handler", self.row.schema_id)
            self._stop.set()
            self._token_conflict = True
            await _update_status(
                self.row.id, status="token_conflict",
                last_error=f"Конфликт токена: {err}",
            )
            return
        log.warning("[%s] handler error: %s", self.row.schema_id, err)


class Orchestrator:
    def __init__(self):
        # Keyed by bot row id so token rotations within the same schema still
        # trigger a restart (token change → same id, new value).
        self.supervisors: dict[int, BotSupervisor] = {}
        self._stop = asyncio.Event()

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, self._request_stop)
            except NotImplementedError:
                # Windows — signal handlers not supported in asyncio loop.
                pass

        log.info("Orchestrator started; polling every %ss", POLL_INTERVAL)
        while not self._stop.is_set():
            try:
                await self._reconcile()
            except Exception:
                log.exception("reconcile loop error")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=POLL_INTERVAL)
            except asyncio.TimeoutError:
                pass

        log.info("Shutting down all supervisors...")
        await asyncio.gather(
            *[sup.stop() for sup in self.supervisors.values()],
            return_exceptions=True,
        )
        self.supervisors.clear()
        log.info("Orchestrator exited cleanly.")

    def _request_stop(self) -> None:
        log.info("Stop requested")
        self._stop.set()

    async def _reconcile(self) -> None:
        """Compare desired state (DB) with actual state (running supervisors)
        and spawn/stop/restart as needed."""
        try:
            rows = await _load_bots()
        except Exception:
            log.exception("Cannot load bots from DB")
            return

        desired: dict[int, BotRow] = {r.id: r for r in rows if r.enabled and r.status != "token_conflict"}
        current_ids = set(self.supervisors.keys())
        desired_ids = set(desired.keys())

        # Stop supervisors for bots removed / disabled / in conflict.
        for rid in current_ids - desired_ids:
            sup = self.supervisors.pop(rid)
            log.info("Stopping supervisor for bot id=%s schema=%s", rid, sup.row.schema_id)
            await sup.stop()

        # Handle existing supervisors: if token changed, restart.
        for rid in current_ids & desired_ids:
            sup = self.supervisors[rid]
            new_row = desired[rid]
            if new_row.token != sup.row.token:
                log.info("Token rotated for schema=%s, restarting", new_row.schema_id)
                await sup.stop()
                sup = BotSupervisor(new_row)
                self.supervisors[rid] = sup
                await sup.start()
            else:
                sup.update_row(new_row)

        # Start new supervisors for newly-enabled bots.
        for rid in desired_ids - current_ids:
            new_row = desired[rid]
            log.info("Starting supervisor for schema=%s", new_row.schema_id)
            sup = BotSupervisor(new_row)
            self.supervisors[rid] = sup
            await sup.start()


def main() -> None:
    orch = Orchestrator()
    try:
        asyncio.run(orch.run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
