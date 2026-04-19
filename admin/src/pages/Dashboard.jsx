import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchNodes, fetchFinals, fetchSessions,
  fetchSections, createSection, updateSection, deleteSection,
  validateSchema,
} from '../api'
import {
  GitBranch, FileText, Users, Layers, LayoutDashboard,
  Plus, Pencil, Trash2, Save, X,
  ShieldCheck, ShieldAlert, AlertTriangle, AlertCircle, RefreshCw, ChevronDown,
} from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { PRESET_KEYS, SWATCH_PRESETS } from '../utils/sections-ui'

function SectionRow({ section, allSections, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    slug: section.slug, label: section.label,
    description: section.description || '', color: section.color || '',
    order: section.order,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setSaving(true); setError('')
    try {
      const updated = await updateSection(section.slug, {
        slug: form.slug !== section.slug ? form.slug : undefined,
        label: form.label !== section.label ? form.label : undefined,
        description: form.description !== (section.description || '') ? form.description : undefined,
        color: form.color !== (section.color || '') ? (form.color || null) : undefined,
        order: parseInt(form.order) !== section.order ? parseInt(form.order) : undefined,
      })
      onSaved(section.slug, updated)
      setEditing(false)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (section.node_count > 0) {
      // Ask for a reassignment target.
      const targets = allSections.filter(s => s.slug !== section.slug)
      if (targets.length === 0) {
        alert('Нельзя удалить единственную секцию, в ней есть узлы.')
        return
      }
      const list = targets.map((s, i) => `${i + 1}. ${s.slug} — ${s.label}`).join('\n')
      const ans = prompt(
        `В секции "${section.slug}" ${section.node_count} узл(ов). ` +
        `Введите slug секции, куда их переместить:\n\n${list}`,
        targets[0].slug,
      )
      if (!ans) return
      const target = targets.find(s => s.slug === ans.trim())
      if (!target) { alert(`Секция "${ans}" не найдена`); return }
      try {
        await deleteSection(section.slug, target.slug)
        onDeleted(section.slug)
      } catch (e) { alert(e.message) }
      return
    }
    if (!confirm(`Удалить секцию "${section.slug}"?`)) return
    try {
      await deleteSection(section.slug)
      onDeleted(section.slug)
    } catch (e) { alert(e.message) }
  }

  if (editing) {
    return (
      <div className="border rounded-xl p-4 bg-gray-50 space-y-3">
        {error && <div className="text-sm text-red-700 bg-red-50 p-2 rounded">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-600 font-semibold block mb-1">Slug (ID)</label>
            <input
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              title="Используется в базе. Переименование каскадно обновит все узлы."
            />
          </div>
          <div>
            <label className="text-xs text-gray-600 font-semibold block mb-1">Порядок</label>
            <input
              type="number"
              value={form.order}
              onChange={(e) => setForm({ ...form, order: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-600 font-semibold block mb-1">Название</label>
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-600 font-semibold block mb-1">Описание</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-600 font-semibold block mb-2">Цвет</label>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setForm({ ...form, color: '' })}
              className={`h-7 w-7 rounded-full border-2 bg-white ${form.color === '' ? 'border-gray-800' : 'border-gray-300'}`}
              title="По умолчанию"
            >
              <X size={14} className="mx-auto text-gray-400" />
            </button>
            {PRESET_KEYS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setForm({ ...form, color: c })}
                className={`h-7 w-7 rounded-full ${SWATCH_PRESETS[c]} ${form.color === c ? 'ring-2 ring-offset-2 ring-gray-800' : ''}`}
                title={c}
              />
            ))}
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={14} /> Сохранить
          </button>
          <button
            onClick={() => setEditing(false)}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Отмена
          </button>
        </div>
      </div>
    )
  }

  const swatch = SWATCH_PRESETS[section.color] || 'bg-gray-200'

  return (
    <div className="border rounded-xl p-4 bg-white hover:shadow-sm transition flex items-start gap-3">
      <div className={`h-8 w-8 rounded-lg ${swatch} shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900">{section.label}</span>
          <span className="text-xs font-mono text-gray-400">{section.slug}</span>
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
            {section.node_count} узл(ов)
          </span>
        </div>
        {section.description && (
          <p className="text-sm text-gray-600 mt-1 leading-relaxed">{section.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Link
          to={`/tree?section=${section.slug}`}
          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
          title="Открыть в дереве"
        >
          <GitBranch size={16} />
        </Link>
        <button
          onClick={() => setEditing(true)}
          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
          title="Редактировать"
        >
          <Pencil size={16} />
        </button>
        <button
          onClick={handleDelete}
          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
          title="Удалить"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  )
}

function NewSectionForm({ onCreated, onCancel, existingSlugs }) {
  const [form, setForm] = useState({
    slug: '', label: '', description: '', color: '', order: 0,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setSaving(true); setError('')
    if (!form.slug.trim() || !form.label.trim()) {
      setError('slug и название обязательны')
      setSaving(false); return
    }
    if (existingSlugs.includes(form.slug.trim())) {
      setError('Секция с таким slug уже существует')
      setSaving(false); return
    }
    try {
      const created = await createSection({
        slug: form.slug.trim(), label: form.label.trim(),
        description: form.description || null,
        color: form.color || null,
        order: parseInt(form.order) || 0,
      })
      onCreated(created)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  return (
    <div className="border-2 border-dashed border-blue-300 rounded-xl p-4 bg-blue-50/40 space-y-3">
      {error && <div className="text-sm text-red-700 bg-red-50 p-2 rounded">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <input
          placeholder="slug (напр. branch_d)"
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
          className="border rounded-lg px-3 py-2 text-sm font-mono"
        />
        <input
          placeholder="Название"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          className="border rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <textarea
        placeholder="Описание (опционально)"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        rows={2}
        className="w-full border rounded-lg px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap gap-1.5">
        {PRESET_KEYS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setForm({ ...form, color: c })}
            className={`h-7 w-7 rounded-full ${SWATCH_PRESETS[c]} ${form.color === c ? 'ring-2 ring-offset-2 ring-gray-800' : ''}`}
            title={c}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          Создать
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
          Отмена
        </button>
      </div>
    </div>
  )
}

function ValidationPanel() {
  // Runs the backend structural linter for the active schema and shows a
  // collapsible issue list. We intentionally don't block any action on the
  // result — the user decides whether warnings matter.
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await validateSchema()
      setReport(r)
      // Auto-open only when there's something to act on.
      setExpanded(r.counts.error > 0 || r.counts.warning > 0)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { run() }, [run])

  if (!report && !error && loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border p-5 mb-6 text-sm text-gray-500">
        Проверка схемы...
      </div>
    )
  }
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-6 text-sm text-red-800">
        Не удалось выполнить проверку: {error}
      </div>
    )
  }
  if (!report) return null

  const { is_valid, counts, totals, issues } = report
  const headline = is_valid
    ? (counts.warning > 0
      ? { icon: <ShieldAlert size={22} className="text-amber-600" />, bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900',
          title: 'Схема работоспособна, есть предупреждения',
          sub: `${counts.warning} предупреждени${counts.warning === 1 ? 'е' : 'я/й'} — бот запустится, но что-то может идти не так.` }
      : { icon: <ShieldCheck size={22} className="text-emerald-600" />, bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900',
          title: 'Схема валидна',
          sub: `Проблем не найдено. Узлов: ${totals.nodes}, диагнозов: ${totals.finals}, достижимо от старта: ${totals.reachable_nodes}.` })
    : { icon: <ShieldAlert size={22} className="text-red-600" />, bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-900',
        title: 'Схема содержит ошибки',
        sub: `${counts.error} ошиб${counts.error === 1 ? 'ка' : counts.error < 5 ? 'ки' : 'ок'}${counts.warning ? ` и ${counts.warning} предупреждений` : ''} — бот может вести себя неожиданно.` }

  return (
    <div className={`rounded-xl border ${headline.border} ${headline.bg} mb-6`}>
      <div className="flex items-center gap-3 p-4">
        {headline.icon}
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${headline.text}`}>{headline.title}</div>
          <div className={`text-xs ${headline.text} opacity-80 leading-relaxed`}>{headline.sub}</div>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className={`p-2 rounded-lg hover:bg-white/60 ${headline.text} disabled:opacity-50`}
          title="Запустить проверку заново"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
        {issues.length > 0 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className={`px-3 py-1.5 rounded-lg hover:bg-white/60 text-xs font-semibold ${headline.text} flex items-center gap-1`}
          >
            {expanded ? 'Скрыть' : 'Подробнее'}
            <ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />
          </button>
        )}
      </div>
      {expanded && issues.length > 0 && (
        <div className="border-t border-white/30 p-3 space-y-1.5 max-h-80 overflow-auto bg-white/40">
          {issues.map((iss, i) => (
            <IssueRow key={i} issue={iss} />
          ))}
        </div>
      )}
    </div>
  )
}

function IssueRow({ issue }) {
  const s = issue.severity
  const Icon = s === 'error' ? AlertCircle : s === 'warning' ? AlertTriangle : AlertCircle
  const clr = s === 'error' ? 'text-red-700' : s === 'warning' ? 'text-amber-700' : 'text-blue-700'
  const link = (() => {
    if (issue.entity_type === 'node' && issue.entity_id) return `/nodes/${issue.entity_id}`
    if (issue.entity_type === 'schema') return '/schemas'
    return null
  })()
  return (
    <div className="flex items-start gap-2.5 p-2 rounded-lg bg-white hover:bg-gray-50 border border-gray-100">
      <Icon size={16} className={`${clr} mt-0.5 shrink-0`} />
      <div className="flex-1 min-w-0 text-sm">
        <div className="text-gray-900">{issue.message}</div>
        {issue.hint && (
          <div className="text-xs text-gray-500 mt-0.5 leading-snug">{issue.hint}</div>
        )}
      </div>
      {link && (
        <Link to={link} className="text-xs text-blue-600 hover:underline shrink-0 px-2 py-0.5">
          Перейти →
        </Link>
      )}
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState({ nodes: 0, finals: 0, sessions: 0 })
  const [sections, setSections] = useState([])
  const [adding, setAdding] = useState(false)

  const loadSections = () => fetchSections().then(setSections).catch(() => setSections([]))

  useEffect(() => {
    Promise.all([
      fetchNodes().catch(() => []),
      fetchFinals().catch(() => []),
      fetchSessions().catch(() => []),
    ]).then(([nodes, finals, sessions]) => {
      setStats({ nodes: nodes.length, finals: finals.length, sessions: sessions.length })
    })
    loadSections()
  }, [])

  const cards = [
    { icon: <GitBranch size={24} />, label: 'Узлы дерева', value: stats.nodes, color: 'bg-blue-500', to: '/tree' },
    { icon: <FileText size={24} />, label: 'Финальные диагнозы', value: stats.finals, color: 'bg-green-500', to: '/finals' },
    { icon: <Users size={24} />, label: 'Сессии бота', value: stats.sessions, color: 'bg-purple-500', to: '/sessions' },
    { icon: <Layers size={24} />, label: 'Секции', value: sections.length, color: 'bg-orange-500', to: '/' },
  ]

  const existingSlugs = useMemo(() => sections.map(s => s.slug), [sections])

  return (
    <div className="p-8">
      <PageHeader icon={LayoutDashboard} title="Обзор системы" />
      <ValidationPanel />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {cards.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className="bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition flex items-center gap-4"
          >
            <div className={`${c.color} text-white p-3 rounded-lg`}>{c.icon}</div>
            <div>
              <div className="text-2xl font-bold">{c.value}</div>
              <div className="text-gray-500 text-sm">{c.label}</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Секции дерева решений</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Группировка узлов по смыслу. Переименование слага каскадно обновит все узлы,
              которые на него ссылаются.
            </p>
          </div>
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-semibold"
            >
              <Plus size={15} /> Новая секция
            </button>
          )}
        </div>

        <div className="space-y-2">
          {adding && (
            <NewSectionForm
              existingSlugs={existingSlugs}
              onCreated={(s) => { setAdding(false); setSections(prev => [...prev, s]) }}
              onCancel={() => setAdding(false)}
            />
          )}
          {sections.length === 0 && !adding && (
            <p className="text-sm text-gray-400">Пока нет секций. Создайте первую.</p>
          )}
          {sections.map(s => (
            <SectionRow
              key={s.slug}
              section={s}
              allSections={sections}
              onSaved={(oldSlug, updated) => {
                setSections(prev => prev.map(p => p.slug === oldSlug ? updated : p))
              }}
              onDeleted={(slug) => setSections(prev => prev.filter(p => p.slug !== slug))}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
