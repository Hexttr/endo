import React from 'react'
import { Sparkles, ShieldAlert, RefreshCcw, Stethoscope, MessageSquareText } from 'lucide-react'

import { startPlaygroundSession, submitPlaygroundAnswer, setActiveSchemaId } from '../api'
import { useDiagnosticSession } from '../hooks/useDiagnosticSession'
import { DiagnosticAnswerControls, DiagnosticTranscript } from '../components/DiagnosticSessionUI'

const PUBLIC_SCHEMA_ID = 'endo-bot'

export default function PublicDiagnosisPage() {
  const session = useDiagnosticSession({
    schemaId: PUBLIC_SCHEMA_ID,
    userIdPrefix: 'public',
    startSessionApi: (userId) => {
      setActiveSchemaId(PUBLIC_SCHEMA_ID)
      return startPlaygroundSession(userId)
    },
    submitAnswerApi: (sessionId, nodeId, answer) => {
      setActiveSchemaId(PUBLIC_SCHEMA_ID)
      return submitPlaygroundAnswer(sessionId, nodeId, answer)
    },
  })

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#dbeafe_0%,#eff6ff_22%,#f8fafc_48%,#f8fafc_100%)] text-slate-900">
      <header className="relative overflow-hidden border-b border-slate-200/80 bg-gradient-to-br from-slate-950 via-blue-950 to-emerald-900 text-white shadow-[0_20px_60px_rgba(15,23,42,0.28)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.16),transparent_28%),radial-gradient(circle_at_left,rgba(59,130,246,0.25),transparent_22%)]" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-5 sm:py-7 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-blue-50 backdrop-blur">
                <Sparkles size={14} />
                Публичный диагностический инструмент
              </div>
              <h1 className="mt-3 flex items-center gap-3 text-2xl sm:text-4xl font-bold tracking-tight text-white">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/20 backdrop-blur">
                  <Stethoscope size={22} />
                </span>
                <span>МедЛогика: эндоскопическая маршрутизация</span>
              </h1>
            </div>
            <button
              onClick={session.startSession}
              disabled={session.loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-300/60 bg-gradient-to-r from-emerald-500 via-green-500 to-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(34,197,94,0.35)] transition hover:from-emerald-400 hover:via-green-500 hover:to-emerald-500 disabled:opacity-50"
            >
              <RefreshCcw size={16} />
              Начать заново
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-2xl border border-white/12 bg-white/10 px-4 py-3 text-sm text-slate-100 backdrop-blur">
              <div className="flex items-start gap-3">
                <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-300" />
                <div>
                  Сервис помогает структурировать диагностику и маршрутизацию, но не заменяет
                  клиническое решение врача. Используйте результаты как вспомогательную опору.
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-white/12 bg-white/10 px-4 py-3 text-sm text-slate-100 backdrop-blur">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/15">
                  <MessageSquareText size={18} className="text-cyan-100" />
                </div>
                <div>
                  <div className="font-semibold text-white">Интерактивный сценарий</div>
                  <div className="text-xs text-slate-200/90">Оптимизировано для десктопа, планшета и телефона</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-4 sm:py-6">
        <section className="min-w-0">
          <div className="overflow-hidden rounded-[28px] border border-white/70 bg-white/90 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur">
            <div className="border-b border-slate-200/80 bg-gradient-to-r from-slate-900 via-blue-900 to-indigo-900 px-4 py-4 text-white sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/12 text-cyan-100 ring-1 ring-white/15">
                  <MessageSquareText size={19} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">ЧатБОТ - эндоскопическая маршрутизация</div>
                  <div className="text-xs text-slate-200/90">
                    Отвечайте на вопросы последовательно. Все шаги и результаты сохраняются в истории ниже.
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-[50vh] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-4 py-4 sm:px-6 sm:py-6">
              <DiagnosticTranscript
                transcript={session.transcript}
                error={session.error}
                finalResult={session.finalResult}
                scrollRef={session.scrollRef}
                compactNodeMeta
              />
            </div>

            {session.currentNode && !session.finalResult && (
              <div className="sticky bottom-0 border-t border-slate-200 bg-white/96 px-4 py-4 backdrop-blur sm:px-6">
                <DiagnosticAnswerControls
                  node={session.currentNode}
                  loading={session.loading}
                  onChoice={session.handleChoice}
                  onUnknown={session.handleUnknown}
                  onNext={session.handleNext}
                  onMultiDone={session.handleMultiDone}
                  onMultiUnknown={session.handleMultiUnknown}
                  onToggleMulti={session.toggleMulti}
                  multiSelected={session.multiSelected}
                  fieldInputs={session.fieldInputs}
                  onFieldChange={session.handleFieldChange}
                  onNumericSubmit={session.handleNumericSubmit}
                  mobileFriendly
                />
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
