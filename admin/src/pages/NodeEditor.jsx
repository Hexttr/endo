import React, { useState, useEffect, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  fetchNode, updateNode, fetchNodes, fetchFinals, fetchEdges, fetchSections,
  createOption, updateOption, deleteOption,
} from '../api'
import { Save, Map, Plus, Trash2, ExternalLink, Info, CircleDot, HelpCircle } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'

const INPUT_TYPES = [
  { value: 'info',          label: 'Информация',        help: 'Информационный блок. Пользователь видит текст и нажимает «Далее».' },
  { value: 'action',        label: 'Действие',          help: 'Действие / назначение. Показывается инструкция, пользователь её подтверждает.' },
  { value: 'single_choice', label: 'Один вариант',      help: 'Выбор одного варианта из нескольких.' },
  { value: 'multi_choice',  label: 'Несколько вариантов', help: 'Можно выбрать несколько пунктов (чекбоксы) и нажать «Готово».' },
  { value: 'yes_no',        label: 'Да / Нет',          help: 'Вопрос с ответами Да / Нет / Не знаю.' },
  { value: 'numeric',       label: 'Число',             help: 'Ввод числового значения (например, лабораторные данные Hb, PLT).' },
  { value: 'auto',          label: 'Авто-маршрут',      help: 'Автоматический переход к следующему узлу по правилам. Пользователю не показывается.' },
]
const INPUT_TYPE_HELP = Object.fromEntries(INPUT_TYPES.map(t => [t.value, t.help]))

const UNKNOWN_ACTIONS = [
  { value: '',               label: 'Не задано',                help: 'Кнопка «Не знаю» не будет показана пользователю.' },
  { value: 'safe_default',   label: 'Безопасный по умолчанию',  help: 'Если пользователь не знает ответ — выбирается безопасный вариант (обычно последний в списке или «Нет»).' },
  { value: 'branch_c',       label: 'Ветка «Не определено»',    help: 'Перенаправляет пользователя в ветку для неопределённых ситуаций, требующих дообследования.' },
  { value: 'skip_with_flag', label: 'Пропустить с пометкой',    help: 'Пропускает вопрос и ставит флаг «данные отсутствуют» в итоговом отчёте.' },
]
const UNKNOWN_ACTION_HELP = Object.fromEntries(UNKNOWN_ACTIONS.map(a => [a.value, a.help]))

// Reusable popover used by the "?" icons next to Terminal / Pending / Return.
// Kept inside this file to avoid a tiny new component.
function InlineHelp({ title, children }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="text-gray-400 hover:text-blue-600 cursor-help"
        aria-label="Подсказка"
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        <span className="absolute z-20 left-full ml-2 top-1/2 -translate-y-1/2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg leading-relaxed">
          {title && <div className="font-semibold mb-1">{title}</div>}
          {children}
          <span className="absolute right-full top-1/2 -translate-y-1/2 border-[6px] border-transparent border-r-gray-900" />
        </span>
      )}
    </span>
  )
}

const SECTION_LABELS = {
  overview: 'Начало — маршрутизация по типу ситуации',
  branch_a: 'Ветка A — Острая ситуация',
  branch_a_vrvp: 'Ветка A — ВРВП при острой ситуации',
  branch_a_egds: 'Ветка A — Результаты ЭГДС',
  branch_b: 'Ветка B — Хроническая ситуация',
  branch_b_complaints: 'Ветка B — Жалобы',
  branch_b_history: 'Ветка B — Анамнез',
  branch_b_polyps: 'Ветка B — Полипы',
  branch_b_vrvp: 'Ветка B — ВРВП (профилактика)',
  branch_b_erosions: 'Ветка B — Эрозии',
  branch_b_ulcers: 'Ветка B — Язвенная болезнь',
  branch_b_ere: 'Ветка B — Эрозивный рефлюкс-эзофагит',
  branch_b_burn: 'Ветка B — Ожоговое поражение',
  branch_c: 'Ветка C — Неопределённая ситуация',
}

export default function NodeEditor() {
  const { nodeId } = useParams()
  const navigate = useNavigate()
  const [node, setNode] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [allNodes, setAllNodes] = useState([])
  const [allFinals, setAllFinals] = useState([])
  const [allEdges, setAllEdges] = useState([])
  const [sections, setSections] = useState([])

  const [optionEdits, setOptionEdits] = useState({})
  const [newOption, setNewOption] = useState(null)

  useEffect(() => {
    fetchNode(nodeId).then(n => {
      setNode(n)
      setForm({
        section: n.section,
        text: n.text,
        description: n.description || '',
        input_type: n.input_type,
        unknown_action: n.unknown_action || '',
        is_terminal: n.is_terminal || false,
        is_pending: n.is_pending || false,
        return_node: n.return_node || '',
      })
    })
    fetchNodes().then(setAllNodes).catch(() => {})
    fetchFinals().then(setAllFinals).catch(() => {})
    fetchEdges().then(setAllEdges).catch(() => {})
    fetchSections().then(setSections).catch(() => {})
  }, [nodeId])

  const currentSection = useMemo(
    () => sections.find(s => (typeof s === 'object' ? s.slug : s) === node?.section),
    [sections, node],
  )
  const sectionLabel = currentSection?.label || SECTION_LABELS[node?.section] || null
  const sectionDescription = currentSection?.description || null

  const targetOptions = useMemo(() => {
    const items = []
    allNodes.forEach(n => items.push({ id: n.id, label: `${n.id} — ${n.text.substring(0, 40)}` }))
    allFinals.forEach(f => items.push({ id: f.id, label: `${f.id} — ${f.diagnosis.substring(0, 40)}` }))
    return items
  }, [allNodes, allFinals])

  const incomingConnections = useMemo(() => {
    const conns = []
    allNodes.forEach(n => {
      (n.options || []).forEach(opt => {
        if (opt.next_node_id === nodeId) {
          conns.push({ fromId: n.id, type: 'option', label: opt.label })
        }
      })
    })
    allEdges.forEach(e => {
      if (e.to_node_id === nodeId) {
        conns.push({ fromId: e.from_node_id, type: 'edge', label: e.label || '' })
      }
    })
    return conns
  }, [allNodes, allEdges, nodeId])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const updates = {}
      if (form.section !== node.section) updates.section = form.section
      if (form.text !== node.text) updates.text = form.text
      if (form.description !== (node.description || '')) updates.description = form.description || null
      if (form.input_type !== node.input_type) updates.input_type = form.input_type
      if (form.unknown_action !== (node.unknown_action || '')) updates.unknown_action = form.unknown_action || null
      if (form.is_terminal !== (node.is_terminal || false)) updates.is_terminal = form.is_terminal
      if (form.is_pending !== (node.is_pending || false)) updates.is_pending = form.is_pending
      if (form.return_node !== (node.return_node || '')) updates.return_node = form.return_node || null

      if (Object.keys(updates).length > 0) {
        const updated = await updateNode(nodeId, updates)
        setNode(updated)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const handleOptionSave = async (opt) => {
    const edits = optionEdits[opt.id]
    if (!edits) return
    try {
      const updated = await updateOption(nodeId, opt.id, edits)
      setNode(prev => ({
        ...prev,
        options: prev.options.map(o => o.id === opt.id ? updated : o),
      }))
      setOptionEdits(prev => { const n = { ...prev }; delete n[opt.id]; return n })
    } catch (e) {
      setError(e.message)
    }
  }

  const handleOptionDelete = async (opt) => {
    if (!confirm(`Удалить вариант "${opt.option_id}"?`)) return
    try {
      await deleteOption(nodeId, opt.id)
      setNode(prev => ({ ...prev, options: prev.options.filter(o => o.id !== opt.id) }))
    } catch (e) {
      setError(e.message)
    }
  }

  const handleAddOption = async () => {
    if (!newOption || !newOption.option_id || !newOption.label) return
    try {
      const created = await createOption(nodeId, newOption)
      setNode(prev => ({ ...prev, options: [...prev.options, created] }))
      setNewOption(null)
    } catch (e) {
      setError(e.message)
    }
  }

  const getOptEdit = (opt, field) => {
    return optionEdits[opt.id]?.[field] ?? opt[field]
  }

  const setOptEdit = (opt, field, value) => {
    setOptionEdits(prev => ({
      ...prev,
      [opt.id]: { ...(prev[opt.id] || {}), [field]: value },
    }))
  }

  if (!node) return <div className="p-8 text-gray-500">Загрузка...</div>

  return (
    <div className="p-8 max-w-5xl">
      <PageHeader
        backTo="/tree"
        icon={CircleDot}
        title={<>Узел: <span className="text-blue-600">{node.id}</span></>}
      >
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <span className="px-3 py-1 bg-gray-100 rounded-full text-sm" title={sectionLabel || ''}>
            {sectionLabel || node.section}
          </span>
          <button
            type="button"
            onClick={() => {
              try { sessionStorage.setItem('tree-highlight-target', nodeId) } catch {}
              navigate('/tree')
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-sm hover:bg-indigo-100 transition"
          >
            <Map size={15} />
            Показать на схеме
          </button>
        </div>
      </PageHeader>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}

      {/* Section description */}
      {(sectionLabel || sectionDescription) && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
          <Info size={16} className="mt-0.5 shrink-0" />
          <div>
            {sectionLabel && <div className="font-semibold">{sectionLabel}</div>}
            {sectionDescription && <div className="mt-0.5">{sectionDescription}</div>}
          </div>
        </div>
      )}

      {/* Main form */}
      <div className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
        <div>
          <label className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 mb-1">
            Секция
            <InlineHelp title="К какой секции относится узел">
              Группировка узлов по смыслу. Списком секций, их названиями,
              цветами и описаниями управляет вкладка «Обзор». Смена секции
              просто перемещает узел в другую группу — ни связи, ни варианты
              при этом не меняются.
            </InlineHelp>
          </label>
          <select
            value={form.section || ''}
            onChange={(e) => setForm({ ...form, section: e.target.value })}
            className="w-full border rounded-lg px-4 py-2.5 bg-white"
          >
            {/* Fallback option so the current slug is always selectable even
                if /api/sections didn't load yet or the slug is obsolete. */}
            {!sections.some(s => (typeof s === 'object' ? s.slug : s) === form.section) && form.section && (
              <option value={form.section}>{form.section} (вне списка)</option>
            )}
            {sections.map(s => {
              const slug = typeof s === 'string' ? s : s.slug
              const label = typeof s === 'string' ? s : (s.label || s.slug)
              return <option key={slug} value={slug}>{label}</option>
            })}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Текст вопроса</label>
          <textarea
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            rows={4}
            className="w-full border rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Описание (опционально)</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full border rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Тип ввода</label>
            <select
              value={form.input_type}
              onChange={(e) => setForm({ ...form, input_type: e.target.value })}
              className="w-full border rounded-lg px-4 py-2.5"
            >
              {INPUT_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
              {INPUT_TYPE_HELP[form.input_type]}
            </p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Действие при «Не знаю»
            </label>
            <select
              value={form.unknown_action}
              onChange={(e) => setForm({ ...form, unknown_action: e.target.value })}
              className="w-full border rounded-lg px-4 py-2.5"
            >
              {UNKNOWN_ACTIONS.map(a => (
                <option key={a.value || 'empty'} value={a.value}>{a.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
              {UNKNOWN_ACTION_HELP[form.unknown_action]}
            </p>
          </div>
        </div>

        {/* Node metadata */}
        <div className="grid grid-cols-3 gap-4 pt-2 border-t">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_terminal}
              onChange={(e) => setForm({ ...form, is_terminal: e.target.checked })}
              className="rounded"
            />
            <span>Терминальный</span>
            <InlineHelp title="Терминальный узел">
              На этом узле диалог с пользователем завершается. Бот больше
              не задаёт вопросов и показывает итоговое заключение или диагноз.
              Используется для финальных веток и отказа в обследовании.
            </InlineHelp>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_pending}
              onChange={(e) => setForm({ ...form, is_pending: e.target.checked })}
              className="rounded"
            />
            <span>Ожидание</span>
            <InlineHelp title="Узел ожидания">
              Диалог приостанавливается: бот сообщает, что нужно получить
              дополнительные данные (например, сдать анализы). Пользователь
              вернётся позже, и сессия продолжится с узла, указанного в поле
              «Узел возврата».
            </InlineHelp>
          </label>
          <div>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
              Узел возврата
              <InlineHelp title="Куда вернуться после ожидания">
                Короткий ID узла (например, <span className="font-mono">A020</span>),
                на который бот вернёт пользователя, когда тот возобновит сессию.
                Используется совместно с флагом «Ожидание». Оставьте пустым,
                если возврат не нужен.
              </InlineHelp>
            </label>
            <input
              type="text"
              value={form.return_node}
              onChange={(e) => setForm({ ...form, return_node: e.target.value })}
              placeholder="Нет"
              className="w-full border rounded px-3 py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-4 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold"
          >
            <Save size={18} />
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          {saved && <span className="text-green-600 text-sm font-semibold">Сохранено!</span>}
        </div>
      </div>

      {/* Options CRUD */}
      <div className="bg-white rounded-xl shadow-sm border p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Варианты ответов ({node.options?.length || 0})</h2>
          <button
            onClick={() => setNewOption({ option_id: '', label: '', next_node_id: '', priority: null })}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm hover:bg-green-100 transition"
          >
            <Plus size={15} />
            Добавить вариант
          </button>
        </div>

        {(!node.options || node.options.length === 0) && !newOption && (
          <p className="text-gray-400 text-sm">Нет вариантов ответов. Для info/action узлов обычно используется одно ребро (edge) для перехода.</p>
        )}

        <div className="space-y-2">
          {(node.options || []).map(opt => (
            <div key={opt.id} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <input
                type="text"
                value={getOptEdit(opt, 'option_id')}
                onChange={(e) => setOptEdit(opt, 'option_id', e.target.value)}
                className="w-28 border rounded px-2 py-1.5 text-sm font-mono"
                title="ID варианта"
              />
              <input
                type="text"
                value={getOptEdit(opt, 'label')}
                onChange={(e) => setOptEdit(opt, 'label', e.target.value)}
                className="flex-1 border rounded px-2 py-1.5 text-sm"
                title="Текст кнопки"
              />
              <select
                value={getOptEdit(opt, 'next_node_id') || ''}
                onChange={(e) => setOptEdit(opt, 'next_node_id', e.target.value || null)}
                className="w-48 border rounded px-2 py-1.5 text-sm"
                title="Следующий узел"
              >
                <option value="">— нет —</option>
                {targetOptions.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
              <input
                type="number"
                value={getOptEdit(opt, 'priority') ?? ''}
                onChange={(e) => setOptEdit(opt, 'priority', e.target.value ? parseInt(e.target.value) : null)}
                className="w-16 border rounded px-2 py-1.5 text-sm text-center"
                placeholder="Пр."
                title="Приоритет (для сортировки)"
              />
              {optionEdits[opt.id] && (
                <button
                  onClick={() => handleOptionSave(opt)}
                  className="px-2 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                >
                  <Save size={13} />
                </button>
              )}
              <button
                onClick={() => handleOptionDelete(opt)}
                className="px-2 py-1.5 text-red-500 hover:bg-red-50 rounded"
              >
                <Trash2 size={14} />
              </button>
              {opt.next_node_id && (
                <Link to={`/nodes/${opt.next_node_id}`} className="text-blue-500 hover:text-blue-700" title="Перейти">
                  <ExternalLink size={14} />
                </Link>
              )}
            </div>
          ))}

          {/* New option row */}
          {newOption && (
            <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg border-2 border-dashed border-green-300">
              <input
                type="text"
                value={newOption.option_id}
                onChange={(e) => setNewOption({ ...newOption, option_id: e.target.value })}
                placeholder="ID (напр. yes)"
                className="w-28 border rounded px-2 py-1.5 text-sm font-mono"
              />
              <input
                type="text"
                value={newOption.label}
                onChange={(e) => setNewOption({ ...newOption, label: e.target.value })}
                placeholder="Текст кнопки"
                className="flex-1 border rounded px-2 py-1.5 text-sm"
              />
              <select
                value={newOption.next_node_id || ''}
                onChange={(e) => setNewOption({ ...newOption, next_node_id: e.target.value || null })}
                className="w-48 border rounded px-2 py-1.5 text-sm"
              >
                <option value="">— нет —</option>
                {targetOptions.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
              <button
                onClick={handleAddOption}
                disabled={!newOption.option_id || !newOption.label}
                className="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
              >
                Создать
              </button>
              <button
                onClick={() => setNewOption(null)}
                className="px-2 py-1.5 text-gray-500 hover:bg-gray-100 rounded text-sm"
              >
                Отмена
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Incoming connections */}
      {incomingConnections.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-6 mt-6">
          <h2 className="text-lg font-semibold mb-4">Откуда ведут сюда ({incomingConnections.length})</h2>
          <div className="space-y-2">
            {incomingConnections.map((c, i) => (
              <div key={i} className="flex items-center gap-3 p-2 bg-gray-50 rounded text-sm">
                <Link to={`/nodes/${c.fromId}`} className="font-mono text-blue-600 hover:underline">{c.fromId}</Link>
                <span className={`px-1.5 py-0.5 rounded text-xs ${c.type === 'option' ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700'}`}>
                  {c.type === 'option' ? 'вариант' : 'ребро'}
                </span>
                {c.label && <span className="text-gray-500 truncate">{c.label.substring(0, 60)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
