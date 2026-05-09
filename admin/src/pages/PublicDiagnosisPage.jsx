import React from 'react'
import { Stethoscope, ShieldAlert, RefreshCcw } from 'lucide-react'

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
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 sm:py-5 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 text-blue-700 px-3 py-1 text-xs font-semibold">
                <Stethoscope size={14} />
                Публичный диагностический инструмент
              </div>
              <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">
                МедЛогика: эндоскопическая маршрутизация
              </h1>
              <p className="mt-2 max-w-3xl text-sm sm:text-base text-slate-600">
                Открытая страница для пошаговой диагностики по рабочему дереву. Логика ответа
                идентична Playground и использует тот же backend session flow.
              </p>
            </div>
            <button
              onClick={session.startSession}
              disabled={session.loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCcw size={16} />
              Начать заново
            </button>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-3">
            <ShieldAlert size={18} className="mt-0.5 shrink-0" />
            <div>
              Сервис помогает структурировать диагностику и маршрутизацию, но не заменяет клиническое
              решение врача. Используйте результаты как вспомогательную опору.
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-4 sm:py-6">
        <section className="min-w-0">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-50 via-white to-indigo-50">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Stethoscope size={18} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">Диалог с алгоритмом</div>
                  <div className="text-xs text-slate-500">
                    Отвечайте на вопросы последовательно. Все шаги и результаты сохраняются в истории ниже.
                  </div>
                </div>
              </div>
            </div>

            <div className="px-4 sm:px-6 py-4 sm:py-5 min-h-[42vh]">
              <DiagnosticTranscript
                transcript={session.transcript}
                error={session.error}
                finalResult={session.finalResult}
                scrollRef={session.scrollRef}
                compactNodeMeta
              />
            </div>

            {session.currentNode && !session.finalResult && (
              <div className="sticky bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur px-4 sm:px-6 py-4">
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
