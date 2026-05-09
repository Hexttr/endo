import React from 'react'
import {
  User,
  Bot as BotIcon,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  ChevronRight,
  Loader2,
} from 'lucide-react'

export function DiagnosticTranscript({ transcript, error, finalResult, scrollRef, compactNodeMeta = false }) {
  return (
    <div ref={scrollRef} className="flex-1 overflow-auto space-y-4">
      {transcript.map((msg, i) => (
        <TranscriptRow key={i} msg={msg} compactNodeMeta={compactNodeMeta} />
      ))}

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {finalResult && <FinalCard result={finalResult} compactNodeMeta={compactNodeMeta} />}
    </div>
  )
}

export function DiagnosticAnswerControls({
  node,
  loading,
  onChoice,
  onUnknown,
  onNext,
  onMultiDone,
  onMultiUnknown,
  onToggleMulti,
  multiSelected,
  fieldInputs,
  onFieldChange,
  onNumericSubmit,
  className = '',
  mobileFriendly = false,
}) {
  const type = node.input_type || 'info'
  const options = node.options || []
  const hasUnknownOption = options.some(o => o.option_id === 'unknown')
  const spin = loading && <Loader2 size={12} className="animate-spin inline ml-1" />
  const baseBtn = mobileFriendly ? 'px-4 py-3 text-sm' : 'px-3 py-2 text-sm'
  const primaryBtn = `${baseBtn} rounded-2xl border border-blue-200 bg-white text-blue-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-50 hover:shadow-md disabled:opacity-50`
  const unknownBtn = `${baseBtn} rounded-2xl border border-red-200 bg-red-50 text-red-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-red-100 hover:shadow-md disabled:opacity-50`
  const subtleUnknownBtn = `${mobileFriendly ? 'px-4 py-3' : 'px-4 py-2'} rounded-2xl border border-red-200 bg-red-50 text-red-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-red-100 hover:shadow-md text-sm font-medium disabled:opacity-50`

  if (type === 'single_choice' || type === 'yes_no') {
    return (
      <div className={`flex flex-wrap gap-2.5 ${className}`}>
        {options.map(o => (
          <button
            key={o.option_id}
            disabled={loading}
            onClick={() => onChoice(o)}
            className={
              o.option_id === 'unknown'
                ? unknownBtn
                : `${primaryBtn} font-medium`
            }
          >
            {o.label}
          </button>
        ))}
        {node.unknown_action && !hasUnknownOption && (
          <button
            disabled={loading}
            onClick={onUnknown}
            className={`${unknownBtn} flex items-center gap-1`}
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
      <div className={className}>
        <div className="mb-3 flex flex-wrap gap-2.5">
          {options.map(o => {
            const active = multiSelected.has(o.option_id)
            return (
              <button
                key={o.option_id}
                disabled={loading}
                onClick={() => onToggleMulti(o.option_id)}
                className={`${baseBtn} rounded-2xl border font-medium shadow-sm transition ${
                  active
                    ? 'border-blue-600 bg-blue-600 text-white shadow-blue-200'
                    : 'border-blue-200 bg-white text-blue-700 hover:-translate-y-0.5 hover:bg-blue-50 hover:shadow-md'
                } disabled:opacity-50`}
              >
                {active ? '☑' : '☐'} {o.label}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={loading}
            onClick={onMultiDone}
            className={`${mobileFriendly ? 'px-4 py-3' : 'px-4 py-2'} flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(34,197,94,0.25)] transition hover:-translate-y-0.5 hover:from-emerald-400 hover:to-green-500 disabled:opacity-50`}
          >
            Готово ({multiSelected.size}) <ChevronRight size={14} /> {spin}
          </button>
          <button
            disabled={loading}
            onClick={onMultiUnknown}
            className={subtleUnknownBtn}
          >
            Данные отсутствуют
          </button>
        </div>
      </div>
    )
  }

  if (type === 'numeric') {
    const fields = node.extra?.fields || []
    return (
      <div className={className}>
        {fields.length > 0 ? (
          <>
            <div className="mb-3 text-xs text-gray-600">
              Каждый показатель вводится в отдельной строке. Если какого-то значения нет, оставьте поле пустым.
            </div>
            <div className={`grid gap-3 ${mobileFriendly ? 'grid-cols-1' : 'md:grid-cols-2'}`}>
              {fields.map(field => (
                <label key={field.id} className="block">
                  <div className="text-xs font-medium text-gray-700 mb-1">
                    {field.label}
                    {field.unit ? `, ${field.unit}` : ''}
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={fieldInputs[field.id] || ''}
                    onChange={(e) => onFieldChange(field.id, e.target.value)}
                    placeholder={field.range ? `${field.range[0]} - ${field.range[1]}` : 'Введите значение'}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                disabled={loading || !Object.values(fieldInputs).some(v => String(v || '').trim())}
                onClick={onNumericSubmit}
                className={`${mobileFriendly ? 'px-4 py-3' : 'px-4 py-2'} rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-sm text-white shadow-[0_10px_25px_rgba(59,130,246,0.25)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50`}
              >
                Отправить {spin}
              </button>
              <button
                disabled={loading}
                onClick={onUnknown}
                className={subtleUnknownBtn}
              >
                Данные отсутствуют
              </button>
            </div>
          </>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={fieldInputs.__raw || ''}
              onChange={(e) => onFieldChange('__raw', e.target.value)}
              placeholder="Hb=120 PLT=200"
              className="flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-mono shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              onKeyDown={(e) => { if (e.key === 'Enter') onNumericSubmit() }}
            />
            <button
              disabled={loading || !String(fieldInputs.__raw || '').trim()}
              onClick={onNumericSubmit}
              className={`${mobileFriendly ? 'px-4 py-3' : 'px-4 py-2'} rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-sm text-white shadow-[0_10px_25px_rgba(59,130,246,0.25)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50`}
            >
              Отправить {spin}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      disabled={loading}
      onClick={onNext}
      className={`${mobileFriendly ? 'px-4 py-3' : 'px-4 py-2'} flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-sm text-white shadow-[0_10px_25px_rgba(59,130,246,0.25)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 ${className}`}
    >
      <ChevronRight size={14} /> Далее {spin}
    </button>
  )
}

export function DiagnosticSummary({ collectedData, unknownFlags, sessionId, compact = false }) {
  return (
    <div className="space-y-4">
      <div>
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
      </div>

      {unknownFlags.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-yellow-700 mb-2">
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
        </div>
      )}

      {sessionId && !compact && (
        <p className="text-[11px] text-gray-400">
          session_id = {sessionId}
        </p>
      )}
    </div>
  )
}

function TranscriptRow({ msg, compactNodeMeta }) {
  const nodeMetaClass = compactNodeMeta ? 'hidden' : 'text-[11px] font-mono text-blue-700 mb-1'

  if (msg.role === 'bot' && msg.kind === 'question') {
    return (
      <div className="flex gap-2 items-start">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 shadow-sm">
          <BotIcon size={16} className="text-blue-700" />
        </div>
        <div className="max-w-[84%] rounded-3xl rounded-tl-sm border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 px-4 py-3 shadow-sm">
          <div className={nodeMetaClass}>{msg.node.id}</div>
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
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 shadow-sm">
          <BotIcon size={16} className="text-blue-700" />
        </div>
        <div className="max-w-[84%] rounded-3xl rounded-tl-sm border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 px-4 py-3 shadow-sm">
          <div className={nodeMetaClass}>{msg.node.id}</div>
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
        <div className="max-w-[76%] rounded-3xl rounded-tr-sm bg-slate-100 px-4 py-2.5 text-slate-800 shadow-sm ring-1 ring-slate-200">
          <div className="text-sm">{msg.text}</div>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-200 shadow-sm">
          <User size={16} className="text-slate-700" />
        </div>
      </div>
    )
  }

  return null
}

function FinalCard({ result, compactNodeMeta }) {
  const nodeMetaClass = compactNodeMeta ? 'hidden' : 'font-mono text-xs'

  if (result.type === 'final') {
    const f = result.payload
    return (
      <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
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
      <div className="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm">
        <h3 className="text-lg font-bold text-yellow-900 mb-2">
          Требуется дообследование
        </h3>
        <div className="text-sm">
          <span className={nodeMetaClass}>{result.node.id}</span>{compactNodeMeta ? null : ' — '} {result.node.text}
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
      <div className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm">
        <h3 className="text-lg font-bold text-blue-900 mb-2">Итог</h3>
        <div className="text-sm">
          <span className={nodeMetaClass}>{result.node.id}</span>{compactNodeMeta ? null : ' — '} {result.node.text}
        </div>
        <Flags flags={result.flags} />
      </div>
    )
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 shadow-sm">
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
