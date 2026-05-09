import React from 'react'
import { ShieldAlert, RefreshCcw, MessageSquareText } from 'lucide-react'

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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-[#005f9f] bg-[rgb(0_100_170)] text-white shadow-[0_16px_40px_rgba(0,100,170,0.22)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-blue-50">
                Публичный диагностический инструмент
              </div>
              <h1 className="mt-3 flex items-start gap-3 text-2xl font-bold tracking-tight text-white sm:items-center sm:text-4xl">
                <img
                  src="/logo-w.png"
                  alt="МедЛогика"
                  className="h-20 w-auto shrink-0 object-contain sm:h-12"
                />
                <span>МедЛогика: эндоскопическая маршрутизация</span>
              </h1>
            </div>
            <button
              onClick={session.startSession}
              disabled={session.loading}
              className="mx-auto inline-flex items-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(16,185,129,0.28)] transition hover:bg-emerald-600 disabled:opacity-50 sm:mx-0"
            >
              <RefreshCcw size={16} />
              Начать заново
            </button>
          </div>

          <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-slate-100">
            <div className="flex items-start gap-3">
              <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-300" />
              <div>
                Сервис помогает структурировать диагностику, но не заменяет клиническое решение врача.
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-6">
        <section className="min-w-0">
          <div className="overflow-hidden rounded-[28px] border border-blue-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
            <div className="border-b border-[#005f9f] bg-[rgb(0_100_170)] px-4 py-4 text-white sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-white">
                  <MessageSquareText size={19} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">ЧатБОТ - эндоскопическая маршрутизация</div>
                  <div className="text-xs text-blue-100">
                    Отвечайте на вопросы последовательно. Все шаги и результаты сохраняются в истории ниже.
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-[42vh] bg-white px-4 py-4 sm:px-6 sm:py-4 lg:min-h-[34vh]">
              <DiagnosticTranscript
                transcript={session.transcript}
                error={session.error}
                finalResult={session.finalResult}
                scrollRef={session.scrollRef}
                compactNodeMeta
              />
            </div>

            {session.currentNode && !session.finalResult && (
              <div className="sticky bottom-0 border-t border-blue-200 bg-white px-4 py-4 sm:px-6">
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
