import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useSchemaContext } from '../schema-context'
import { startPlaygroundSession, submitPlaygroundAnswer } from '../api'
import {
  Play, RefreshCcw, User, Bot as BotIcon, AlertCircle, CheckCircle2,
  HelpCircle, ChevronRight, Loader2,
} from 'lucide-react'
import { PageHeader } from '../components/PageHeader'

/**
 * In-browser simulation of the Telegram bot, scoped to the currently active
 * schema. Uses the same /sessions endpoints the bot hits, so it exercises
 * exactly the same decision engine — no drift possible.
 */
export default function Playground() {
  const { schemaId, schemas } = useSchemaContext()
  const activeSchema = schemas.find(s => s.id === schemaId)

  const [sessionId, setSessionId] = useState(null)
  const [currentNode, setCurrentNode] = useState(null)
  const [transcript, setTranscript] = useState([])  // {role, node, text, choices?}
  const [numericInput, setNumericInput] = useState('')
  const [multiSelected, setMultiSelected] = useState(new Set())
  const [finalResult, setFinalResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [collectedData, setCollectedData] = useState({})
  const [unknownFlags, setUnknownFlags] = useState([])
  const scrollRef = useRef(null)

  const addQuestionToTranscript = useCallback((node) => {
    setTranscript(t => [...t, { role: 'bot', kind: 'question', node }])
  }, [])

  const startSession = useCallback(async () => {
    setError('')
    setLoading(true)
    setFinalResult(null)
    setTranscript([])
    setCollectedData({})
    setUnknownFlags([])
    setMultiSelected(new Set())
    setNumericInput('')
    try {
      // Unique per session so the backend doesn't merge with stale sessions.
      const data = await startPlaygroundSession(`playground-${Date.now()}`)
      setSessionId(data.session_id)
      if (data.current_node) {
        setCurrentNode(data.current_node)
        addQuestionToTranscript(data.current_node)
      }
      setCollectedData(data.collected_data || {})
      setUnknownFlags(data.unknown_flags || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [addQuestionToTranscript])

  // Restart whenever the active schema changes (topbar switcher).
  useEffect(() => { startSession() }, [schemaId])  // eslint-disable-line

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [transcript, finalResult])

  async function submitAnswer(answer, displayLabel) {
    if (!sessionId || !currentNode) return
    setLoading(true)
    setError('')
    setTranscript(t => {
      const last = t[t.length - 1]
      // Convert the last "question" into an "answered" row so it stays visible
      // with the user's choice attached, rather than being replaced.
      const updated = t.slice()
      if (last && last.kind === 'question') {
        updated[updated.length - 1] = { ...last, kind: 'answered', answerLabel: displayLabel }
      }
      updated.push({ role: 'user', kind: 'answer', text: displayLabel })
      return updated
    })
    try {
      const data = await submitPlaygroundAnswer(sessionId, currentNode.id, answer)
      setCollectedData(data.collected_data || {})
      setUnknownFlags(data.unknown_flags || [])
      setMultiSelected(new Set())
      setNumericInput('')

      if (data.final) {
        setFinalResult({ type: 'final', payload: data.final, flags: data.unknown_flags || [] })
        setCurrentNode(null)
        return
      }
      const nextNode = data.current_node
      if (nextNode?.is_pending) {
        setFinalResult({ type: 'pending', node: nextNode, flags: data.unknown_flags || [] })
        setCurrentNode(null)
        return
      }
      if (nextNode?.is_terminal) {
        setFinalResult({ type: 'terminal', node: nextNode, flags: data.unknown_flags || [] })
        setCurrentNode(null)
        return
      }
      if (nextNode) {
        setCurrentNode(nextNode)
        addQuestionToTranscript(nextNode)
      } else if (data.status === 'completed') {
        setFinalResult({ type: 'completed', flags: data.unknown_flags || [] })
        setCurrentNode(null)
      } else {
        setError('Алгоритм не смог определить следующий шаг.')
        setCurrentNode(null)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleChoice(option) {
    submitAnswer(option.option_id, option.label)
  }

  function handleUnknown() {
    submitAnswer('unknown', 'Данные отсутствуют')
  }

  function handleNext() {
    submitAnswer('next', 'Далее')
  }

  function handleMultiDone() {
    const selected = Array.from(multiSelected)
    if (selected.length === 0) {
      submitAnswer('unknown', 'Ничего не выбрано')
      return
    }
    const labels = currentNode.options
      .filter(o => selected.includes(o.option_id))
      .map(o => o.label)
    submitAnswer(selected, labels.join(' + '))
  }

  function toggleMulti(optionId) {
    setMultiSelected(s => {
      const next = new Set(s)
      if (next.has(optionId)) next.delete(optionId)
      else next.add(optionId)
      return next
    })
  }

  function handleNumericSubmit() {
    const val = numericInput.trim()
    if (!val) return
    const values = {}
    val.replace(',', ' ').split(/\s+/).forEach(pair => {
      if (pair.includes('=')) {
        const [k, v] = pair.split('=')
        const num = parseFloat(v)
        if (!Number.isNaN(num)) values[k.trim()] = num
      }
    })
    const answer = Object.keys(values).length > 0 ? values : val
    submitAnswer(answer, val)
  }

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

        <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-4 space-y-3">
          {transcript.map((msg, i) => (
            <TranscriptRow key={i} msg={msg} />
          ))}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {finalResult && <FinalCard result={finalResult} />}
        </div>

        {currentNode && !finalResult && (
          <div className="border-t bg-gray-50 p-4">
            <AnswerControls
              node={currentNode}
              loading={loading}
              onChoice={handleChoice}
              onUnknown={handleUnknown}
              onNext={handleNext}
              onMultiDone={handleMultiDone}
              onToggleMulti={toggleMulti}
              multiSelected={multiSelected}
              numericInput={numericInput}
              onNumericChange={setNumericInput}
              onNumericSubmit={handleNumericSubmit}
            />
          </div>
        )}
      </div>

      <aside className="w-72 border-l bg-gray-50 p-4 overflow-auto hidden lg:block">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Собрано
        </h3>
        {Object.keys(collectedData).length === 0 ? (
          <p className="text-sm text-gray-400">Пока ничего.</p>
        ) : (
          <div className="space-y-1.5 text-xs">
            {Object.entries(collectedData).map(([k, v]) => (
              <div key={k} className="bg-white border rounded p-2">
                <div className="font-mono text-[11px] text-gray-500">{k}</div>
                <div className="mt-0.5 break-all">{formatValue(v)}</div>
              </div>
            ))}
          </div>
        )}

        {unknownFlags.length > 0 && (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-yellow-700 mt-4 mb-2">
              Пропущенные данные
            </h3>
            <ul className="text-xs space-y-1">
              {unknownFlags.map((f, i) => (
                <li key={i} className="bg-yellow-50 border border-yellow-200 rounded p-2">
                  <span className="font-mono text-[11px]">{f.node}</span>
                  <div>{f.reason}</div>
                </li>
              ))}
            </ul>
          </>
        )}

        {sessionId && (
          <p className="text-[11px] text-gray-400 mt-6">
            session_id = {sessionId}
          </p>
        )}
      </aside>
    </div>
  )
}

function TranscriptRow({ msg }) {
  if (msg.role === 'bot' && msg.kind === 'question') {
    return (
      <div className="flex gap-2 items-start">
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
          <BotIcon size={16} className="text-blue-600" />
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-xl rounded-tl-sm px-4 py-3 max-w-[80%]">
          <div className="text-[11px] font-mono text-blue-700 mb-1">{msg.node.id}</div>
          <div className="text-sm whitespace-pre-wrap">{msg.node.text}</div>
          {msg.node.description && (
            <div className="text-xs italic text-gray-600 mt-1">{msg.node.description}</div>
          )}
        </div>
      </div>
    )
  }
  if (msg.role === 'bot' && msg.kind === 'answered') {
    return (
      <div className="flex gap-2 items-start">
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
          <BotIcon size={16} className="text-blue-600" />
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-xl rounded-tl-sm px-4 py-3 max-w-[80%]">
          <div className="text-[11px] font-mono text-blue-700 mb-1">{msg.node.id}</div>
          <div className="text-sm whitespace-pre-wrap">{msg.node.text}</div>
          <div className="mt-2 pt-2 border-t border-blue-200 flex items-center gap-1 text-xs text-blue-800">
            <CheckCircle2 size={12} /> <span className="italic">Ответ:</span>
            <b>{msg.answerLabel}</b>
          </div>
        </div>
      </div>
    )
  }
  if (msg.role === 'user') {
    return (
      <div className="flex gap-2 items-start justify-end">
        <div className="bg-gray-200 rounded-xl rounded-tr-sm px-4 py-2 max-w-[70%]">
          <div className="text-sm">{msg.text}</div>
        </div>
        <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center shrink-0">
          <User size={16} className="text-gray-700" />
        </div>
      </div>
    )
  }
  return null
}

function AnswerControls({
  node, loading, onChoice, onUnknown, onNext, onMultiDone, onToggleMulti,
  multiSelected, numericInput, onNumericChange, onNumericSubmit,
}) {
  const type = node.input_type || 'info'
  const options = node.options || []
  const spin = loading && <Loader2 size={12} className="animate-spin inline ml-1" />

  if (type === 'single_choice' || type === 'yes_no') {
    return (
      <div className="flex flex-wrap gap-2">
        {options.map(o => (
          <button
            key={o.option_id}
            disabled={loading}
            onClick={() => onChoice(o)}
            className="px-3 py-2 bg-white border-2 border-blue-500 text-blue-700 hover:bg-blue-50 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {o.label}
          </button>
        ))}
        {node.unknown_action && (
          <button
            disabled={loading}
            onClick={onUnknown}
            className="px-3 py-2 bg-white border border-dashed border-gray-400 text-gray-600 hover:bg-gray-100 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"
          >
            <HelpCircle size={14} /> Данные отсутствуют
          </button>
        )}
        {spin}
      </div>
    )
  }

  if (type === 'multi_choice') {
    return (
      <div>
        <div className="flex flex-wrap gap-2 mb-3">
          {options.map(o => {
            const active = multiSelected.has(o.option_id)
            return (
              <button
                key={o.option_id}
                disabled={loading}
                onClick={() => onToggleMulti(o.option_id)}
                className={`px-3 py-2 border-2 rounded-lg text-sm font-medium transition ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-blue-700 border-blue-500 hover:bg-blue-50'
                } disabled:opacity-50`}
              >
                {active ? '☑' : '☐'} {o.label}
              </button>
            )
          })}
        </div>
        <button
          disabled={loading}
          onClick={onMultiDone}
          className="px-4 py-2 bg-green-600 text-white hover:bg-green-700 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
        >
          Готово ({multiSelected.size}) <ChevronRight size={14} /> {spin}
        </button>
      </div>
    )
  }

  if (type === 'numeric') {
    const fields = node.extra?.fields || []
    return (
      <div>
        {fields.length > 0 && (
          <div className="mb-2 text-xs text-gray-600">
            Поля: {fields.map(f => f.label).join(', ')}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={numericInput}
            onChange={(e) => onNumericChange(e.target.value)}
            placeholder="Hb=120 PLT=200"
            className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
            onKeyDown={(e) => { if (e.key === 'Enter') onNumericSubmit() }}
          />
          <button
            disabled={loading || !numericInput.trim()}
            onClick={onNumericSubmit}
            className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm disabled:opacity-50"
          >
            Отправить {spin}
          </button>
        </div>
      </div>
    )
  }

  // info / action / auto — just a "next" button
  return (
    <button
      disabled={loading}
      onClick={onNext}
      className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"
    >
      <ChevronRight size={14} /> Далее {spin}
    </button>
  )
}

function FinalCard({ result }) {
  if (result.type === 'final') {
    const f = result.payload
    return (
      <div className="bg-green-50 border-2 border-green-300 rounded-xl p-4">
        <h3 className="text-lg font-bold text-green-900 mb-2">
          Диагноз: {f.diagnosis}
        </h3>
        {f.endo_picture && <Section title="Эндоскопическая картина" text={f.endo_picture} />}
        {f.equipment && <Section title="Оборудование" text={Array.isArray(f.equipment) ? f.equipment.join(', ') : f.equipment} />}
        {f.algorithm && <Section title="Алгоритм" text={f.algorithm} />}
        {f.routing && <Section title="Маршрутизация" text={f.routing} />}
        {f.followup && <Section title="Наблюдение" text={f.followup} />}
        <Flags flags={result.flags} />
      </div>
    )
  }
  if (result.type === 'pending') {
    return (
      <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4">
        <h3 className="text-lg font-bold text-yellow-900 mb-2">
          Требуется дообследование
        </h3>
        <div className="text-sm">
          <span className="font-mono text-xs">{result.node.id}</span> — {result.node.text}
        </div>
        {result.node.return_node && (
          <p className="text-xs text-yellow-700 mt-2">
            После получения данных вернуться к узлу <b>{result.node.return_node}</b>
          </p>
        )}
        <Flags flags={result.flags} />
      </div>
    )
  }
  if (result.type === 'terminal') {
    return (
      <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4">
        <h3 className="text-lg font-bold text-blue-900 mb-2">Итог</h3>
        <div className="text-sm">
          <span className="font-mono text-xs">{result.node.id}</span> — {result.node.text}
        </div>
        <Flags flags={result.flags} />
      </div>
    )
  }
  return (
    <div className="bg-gray-50 border-2 border-gray-300 rounded-xl p-4">
      <h3 className="text-lg font-bold">Диагностика завершена</h3>
      <Flags flags={result.flags} />
    </div>
  )
}

function Section({ title, text }) {
  return (
    <div className="mt-2">
      <div className="text-xs font-semibold text-gray-700">{title}</div>
      <div className="text-sm whitespace-pre-wrap">{text}</div>
    </div>
  )
}

function Flags({ flags }) {
  if (!flags || flags.length === 0) return null
  return (
    <div className="mt-3 pt-3 border-t">
      <div className="text-xs font-semibold text-yellow-800 mb-1">Пропущенные данные:</div>
      <ul className="text-xs">
        {flags.map((f, i) => (
          <li key={i}>• <span className="font-mono">{f.node}</span>: {f.reason}</li>
        ))}
      </ul>
    </div>
  )
}

function formatValue(v) {
  if (Array.isArray(v)) return v.join(', ') || '—'
  if (v && typeof v === 'object') {
    return Object.entries(v).map(([k, vv]) => `${k}=${vv}`).join(', ')
  }
  return String(v)
}
