import React, { useState, useEffect, useMemo } from 'react'
import { fetchAuditLog, fetchMe } from '../api'
import {
  History, Filter, ChevronLeft, ChevronRight, ShieldCheck, User as UserIcon,
  Plus, Edit3, Trash2, Copy, Layers, FileText, GitBranch, List, Settings, UserCog,
} from 'lucide-react'
import { PageHeader } from '../components/PageHeader'

const PAGE_SIZE = 50

const ACTION_META = {
  create: { icon: Plus,   color: 'text-emerald-700 bg-emerald-50', label: 'Создание' },
  update: { icon: Edit3,  color: 'text-blue-700 bg-blue-50',       label: 'Изменение' },
  delete: { icon: Trash2, color: 'text-red-700 bg-red-50',         label: 'Удаление' },
  clone:  { icon: Copy,   color: 'text-indigo-700 bg-indigo-50',   label: 'Клонирование' },
}

const ENTITY_META = {
  schema:  { icon: Layers,   label: 'Схема' },
  node:    { icon: List,     label: 'Узел' },
  option:  { icon: GitBranch, label: 'Вариант' },
  edge:    { icon: GitBranch, label: 'Связь' },
  final:   { icon: FileText, label: 'Диагноз' },
  section: { icon: Layers,   label: 'Секция' },
  user:    { icon: UserCog,  label: 'Пользователь' },
  bot:     { icon: Settings, label: 'Бот' },
}

function formatDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return iso }
}

function valueChunk(label, value) {
  if (value == null) return null
  let display
  if (typeof value === 'object') {
    try { display = JSON.stringify(value, null, 2) } catch { display = String(value) }
  } else {
    display = String(value)
  }
  if (!display || display === '{}' || display === 'null') return null
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-0.5">{label}</div>
      <pre className="text-[11px] bg-gray-50 border border-gray-200 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-40 font-mono">
        {display}
      </pre>
    </div>
  )
}

function AuditRow({ item }) {
  const [open, setOpen] = useState(false)
  const action = ACTION_META[item.action] || { icon: History, color: 'text-gray-700 bg-gray-100', label: item.action }
  const entity = ENTITY_META[item.entity_type] || { icon: History, label: item.entity_type }
  const ActionIcon = action.icon
  const EntityIcon = entity.icon
  const hasDetails = item.old_value || item.new_value

  const author = item.user
    ? (item.user.fio || item.user.username)
    : 'Система'

  return (
    <div
      className={`border rounded-lg bg-white hover:shadow-sm transition ${hasDetails ? 'cursor-pointer' : ''}`}
      onClick={hasDetails ? () => setOpen(o => !o) : undefined}
    >
      <div className="flex items-center gap-3 p-3">
        <div className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center ${action.color}`}>
          <ActionIcon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-semibold text-gray-900">{author}</span>
            <span className="text-gray-500">{action.label.toLowerCase()}</span>
            <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded px-2 py-0.5">
              <EntityIcon size={11} /> {entity.label}
            </span>
            <span className="font-mono text-xs text-gray-500 truncate max-w-[280px]">{item.entity_id}</span>
            {item.schema_id && (
              <span className="text-[10px] uppercase tracking-wide text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">
                {item.schema_id}
              </span>
            )}
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5">{formatDate(item.created_at)}</div>
        </div>
        {hasDetails && (
          <span className={`text-xs text-gray-400 shrink-0 ${open ? 'rotate-90' : ''} transition`}>▶</span>
        )}
      </div>
      {open && hasDetails && (
        <div className="border-t bg-gray-50/50 p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {valueChunk('Было', item.old_value)}
          {valueChunk('Стало', item.new_value)}
        </div>
      )}
    </div>
  )
}

export default function AuditLog() {
  const [me, setMe] = useState(null)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ entity_type: '', schema_id: '' })

  useEffect(() => { fetchMe().then(setMe).catch(() => {}) }, [])

  const load = async (nextOffset, nextFilters) => {
    setLoading(true); setError('')
    try {
      const params = {
        limit: PAGE_SIZE,
        offset: nextOffset,
        ...Object.fromEntries(Object.entries(nextFilters).filter(([, v]) => v)),
      }
      const r = await fetchAuditLog(params)
      setItems(r.items)
      setTotal(r.total)
      setOffset(nextOffset)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load(0, filters) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isAdmin = me?.role === 'admin'

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const filtersActive = useMemo(
    () => Object.values(filters).some(v => v),
    [filters],
  )

  if (!me) {
    return (
      <div className="p-8 text-sm text-gray-500">Проверка прав доступа...</div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="p-8">
        <PageHeader icon={History} title="Журнал изменений" />
        <div className="bg-white border rounded-xl p-8 text-center">
          <ShieldCheck size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-600 font-semibold">Доступ только для администраторов</p>
          <p className="text-sm text-gray-500 mt-1">
            Журнал изменений содержит аудит действий пользователей.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <PageHeader
        icon={History}
        title="Журнал изменений"
        subtitle="Кто и когда менял узлы, диагнозы, секции, схемы и пользователей."
      />

      <div className="bg-white rounded-xl shadow-sm border p-4 mb-4 flex flex-wrap items-center gap-3">
        <Filter size={16} className="text-gray-400" />
        <select
          value={filters.entity_type}
          onChange={(e) => { const f = { ...filters, entity_type: e.target.value }; setFilters(f); load(0, f) }}
          className="border rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">Все сущности</option>
          {Object.entries(ENTITY_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <input
          placeholder="ID схемы (например endo-bot)"
          value={filters.schema_id}
          onChange={(e) => setFilters(f => ({ ...f, schema_id: e.target.value }))}
          onBlur={() => load(0, filters)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(0, filters) }}
          className="border rounded-lg px-3 py-1.5 text-sm font-mono w-56"
        />
        {filtersActive && (
          <button
            onClick={() => { const f = { entity_type: '', schema_id: '' }; setFilters(f); load(0, f) }}
            className="text-xs text-blue-600 hover:underline"
          >
            Сбросить
          </button>
        )}
        <div className="flex-1" />
        <div className="text-xs text-gray-500">
          Всего записей: <span className="font-semibold text-gray-900">{total}</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading && !items.length ? (
        <div className="text-sm text-gray-500 p-4">Загрузка...</div>
      ) : items.length === 0 ? (
        <div className="bg-white border rounded-xl p-10 text-center">
          <UserIcon size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-600 font-semibold">События не найдены</p>
          <p className="text-sm text-gray-500 mt-1">
            {filtersActive ? 'Попробуйте изменить фильтры.' : 'Журнал пуст.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => <AuditRow key={item.id} item={item} />)}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={() => load(Math.max(0, offset - PAGE_SIZE), filters)}
            disabled={offset === 0 || loading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronLeft size={14} /> Назад
          </button>
          <span className="text-sm text-gray-600">
            Страница {page} из {totalPages}
          </span>
          <button
            onClick={() => load(offset + PAGE_SIZE, filters)}
            disabled={offset + PAGE_SIZE >= total || loading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            Вперёд <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
