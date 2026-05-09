import React from 'react'
import { useSchemaContext } from '../schema-context'
import { startPlaygroundSession, submitPlaygroundAnswer } from '../api'
import { Play, RefreshCcw } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { useDiagnosticSession } from '../hooks/useDiagnosticSession'
import {
  DiagnosticAnswerControls,
  DiagnosticSummary,
  DiagnosticTranscript,
} from '../components/DiagnosticSessionUI'

/**
 * In-browser simulation of the Telegram bot, scoped to the currently active
 * schema. Uses the same /sessions endpoints the bot hits, so it exercises
 * exactly the same decision engine — no drift possible.
 */
export default function Playground() {
  const { schemaId, schemas } = useSchemaContext()
  const activeSchema = schemas.find(s => s.id === schemaId)
  const {
    sessionId,
    currentNode,
    transcript,
    fieldInputs,
    multiSelected,
    finalResult,
    loading,
    error,
    collectedData,
    unknownFlags,
    scrollRef,
    startSession,
    handleChoice,
    handleUnknown,
    handleNext,
    handleMultiDone,
    handleMultiUnknown,
    toggleMulti,
    handleFieldChange,
    handleNumericSubmit,
  } = useDiagnosticSession({
    schemaId,
    userIdPrefix: 'playground',
    startSessionApi: (userId) => startPlaygroundSession(userId),
    submitAnswerApi: (sessionIdArg, nodeId, answer) => submitPlaygroundAnswer(sessionIdArg, nodeId, answer),
  })

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col bg-white">
        <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <PageHeader
              className="mb-0 flex-1 min-w-0"
              icon={Play}
              title="Playground — симуляция бота"
              subtitle={`Схема: ${activeSchema?.name || schemaId}. Те же эндпоинты, что у Telegram-бота — реальное поведение.`}
            />
            <button
              onClick={startSession}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-white border hover:bg-gray-50 rounded-lg shadow-sm text-sm shrink-0"
            >
              <RefreshCcw size={14} /> Начать заново
            </button>
          </div>
        </div>

        <div className="px-6 py-4">
          <DiagnosticTranscript
            transcript={transcript}
            error={error}
            finalResult={finalResult}
            scrollRef={scrollRef}
          />
        </div>

        {currentNode && !finalResult && (
          <div className="border-t bg-gray-50 p-4">
            <DiagnosticAnswerControls
              node={currentNode}
              loading={loading}
              onChoice={handleChoice}
              onUnknown={handleUnknown}
              onNext={handleNext}
              onMultiDone={handleMultiDone}
              onMultiUnknown={handleMultiUnknown}
              onToggleMulti={toggleMulti}
              multiSelected={multiSelected}
              fieldInputs={fieldInputs}
              onFieldChange={handleFieldChange}
              onNumericSubmit={handleNumericSubmit}
            />
          </div>
        )}
      </div>

      <aside className="w-72 border-l bg-gray-50 p-4 overflow-auto hidden lg:block">
        <DiagnosticSummary
          collectedData={collectedData}
          unknownFlags={unknownFlags}
          sessionId={sessionId}
        />
      </aside>
    </div>
  )
}
