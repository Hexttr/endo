import React, { useState, useEffect } from 'react'
import { useSchemaContext } from '../schema-context'
import {
  createSchema, updateSchema, deleteSchema, cloneSchema,
  fetchBot, upsertBot, toggleBotEnabled, deleteBot,
  fetchNodesFor,
} from '../api'
import {
  GitBranch, Copy, Trash2, Plus, Edit3, Check, X,
  Bot as BotIcon, Eye, EyeOff, AlertCircle, Power, Layers, HelpCircle,
  Play,
} from 'lucide-react'
import { PageHeader } from '../components/PageHeader'

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,49}$/

export default function SchemasList() {
  const { schemas, schemaId, switchSchema, reload } = useSchemaContext()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', description: '' })
  const [cloneTarget, setCloneTarget] = useState(null)  // {fromId, new_id, new_name}
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({ name: '', description: '', root_node_id: '' })
  const [editNodes, setEditNodes] = useState([])  // nodes of the schema currently being edited
  const [editNodesLoading, setEditNodesLoading] = useState(false)
  const [error, setError] = useState('')
  const [botGuideOpen, setBotGuideOpen] = useState(false)

  useEffect(() => {
    if (!botGuideOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') setBotGuideOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [botGuideOpen])

  async function handleCreate() {
    setError('')
    if (!SLUG_RE.test(form.id)) {
      setError('ID: латиница/цифры/-/_ , 2–50 символов, первый — буква или цифра')
      return
    }
    if (!form.name.trim()) {
      setError('Имя обязательно')
      return
    }
    try {
      const created = await createSchema({ id: form.id.trim(), name: form.name.trim(), description: form.description || null })
      setCreating(false)
      setForm({ id: '', name: '', description: '' })
      await reload()
      // Switch to the freshly-created schema so the user can immediately add nodes.
      switchSchema(created.id)
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleClone() {
    if (!cloneTarget) return
    setError('')
    if (!SLUG_RE.test(cloneTarget.new_id)) {
      setError('ID копии: латиница/цифры/-/_ , 2–50 символов')
      return
    }
    if (!cloneTarget.new_name.trim()) {
      setError('Имя копии обязательно')
      return
    }
    try {
      const created = await cloneSchema(cloneTarget.fromId, {
        new_id: cloneTarget.new_id.trim(),
        new_name: cloneTarget.new_name.trim(),
        description: cloneTarget.description || null,
      })
      setCloneTarget(null)
      await reload()
      switchSchema(created.id)
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleDelete(id) {
    if (id === 'endo-bot') {
      alert('Базовую схему endo-bot удалить нельзя.')
      return
    }
    if (!confirm(`Удалить схему "${id}"? Будут безвозвратно удалены все её узлы, опции, диагнозы и связи. Это действие необратимо!`)) return
    try {
      await deleteSchema(id)
      await reload()
      // If we were looking at the one we deleted, reload switches us.
    } catch (e) {
      alert(`Ошибка: ${e.message}`)
    }
  }

  async function startEdit(s) {
    setEditingId(s.id)
    setEditDraft({
      name: s.name,
      description: s.description || '',
      root_node_id: s.root_node_id || '',
    })
    // Lazy-load this schema's nodes so the root-node <select> is populated
    // without forcing the user to switch the active schema first.
    setEditNodes([])
    setEditNodesLoading(true)
    try {
      const nodes = await fetchNodesFor(s.id)
      setEditNodes(nodes || [])
    } catch (e) {
      console.warn('Failed to load nodes for schema', s.id, e)
    } finally {
      setEditNodesLoading(false)
    }
  }

  async function saveEdit() {
    try {
      // Trim + coerce empty string to null so the server clears the column
      // instead of treating "" as a (non-existent) node id.
      const payload = {
        name: editDraft.name,
        description: editDraft.description,
        root_node_id: editDraft.root_node_id?.trim() || '',
      }
      await updateSchema(editingId, payload)
      setEditingId(null)
      await reload()
    } catch (e) {
      alert(`Ошибка: ${e.message}`)
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader
        icon={Layers}
        title="Схемы диагностики"
        subtitle="Каждая схема — независимое дерево узлов и диагнозов. Можно привязать отдельного Telegram-бота к каждой схеме."
      >
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <button
            type="button"
            onClick={() => setBotGuideOpen(true)}
            className="flex items-center gap-2 border border-slate-300 bg-white text-slate-800 px-4 py-2 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition shrink-0 text-sm font-medium shadow-sm"
          >
            <HelpCircle size={18} className="text-blue-600" strokeWidth={2} />
            Как создать бота?
          </button>
          <button
            type="button"
            onClick={() => { setCreating(true); setError('') }}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 shrink-0 text-sm font-medium"
          >
            <Plus size={18} /> Новая схема
          </button>
        </div>
      </PageHeader>

      {botGuideOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-900/55 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bot-guide-title"
          onClick={() => setBotGuideOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-[0_25px_80px_-12px_rgba(15,23,42,0.45)] max-w-xl w-full border border-slate-200/80 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative overflow-hidden px-6 pt-6 pb-5 bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 text-white">
              <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-blue-500/20 blur-3xl" aria-hidden />
              <div className="pointer-events-none absolute -bottom-8 -left-8 h-40 w-40 rounded-full bg-indigo-500/15 blur-2xl" aria-hidden />
              <div className="relative flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 shadow-inner backdrop-blur-sm">
                    <BotIcon className="h-7 w-7 text-white" strokeWidth={2} />
                  </span>
                  <div>
                    <h2 id="bot-guide-title" className="text-xl font-semibold tracking-tight text-white">
                      Как создать бота в Telegram
                    </h2>
                    <p className="mt-1.5 text-sm text-blue-100/90 leading-snug">
                      Пошагово: от @BotFather до привязки к схеме в МедЛогике
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setBotGuideOpen(false)}
                  className="shrink-0 rounded-xl p-2 text-blue-100/90 hover:bg-white/10 hover:text-white transition"
                  aria-label="Закрыть"
                >
                  <X className="h-5 w-5" strokeWidth={2} />
                </button>
              </div>
            </div>

            <div className="px-5 py-5 max-h-[min(70vh,520px)] overflow-y-auto bg-gradient-to-b from-slate-50/80 to-white">
              <ol className="space-y-4 list-none">
                {[
                  {
                    n: 1,
                    title: 'Откройте BotFather',
                    body: (
                      <>
                        В Telegram найдите официального бота{' '}
                        <a
                          href="https://t.me/BotFather"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-blue-700 hover:underline"
                        >
                          @BotFather
                        </a>
                        {' '}и нажмите «Запустить» (или отправьте команду <kbd className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 text-xs font-mono">/start</kbd>).
                      </>
                    ),
                  },
                  {
                    n: 2,
                    title: 'Создайте нового бота',
                    body: (
                      <>
                        Отправьте команду <kbd className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 text-xs font-mono">/newbot</kbd>
                        . Укажите отображаемое имя бота и уникальный username — он должен заканчиваться на <span className="font-mono text-slate-800">bot</span> (например, <span className="font-mono">my_clinic_algo_bot</span>).
                      </>
                    ),
                  },
                  {
                    n: 3,
                    title: 'Сохраните токен',
                    body: 'После успешного создания BotFather пришлёт токен вида 123456789:AAH… — это секретный ключ. Не публикуйте его в открытых чатах и храните только для настройки МедЛогики.',
                  },
                  {
                    n: 4,
                    title: 'Привяжите бота к схеме',
                    body: 'На этой странице выберите нужную схему диагностики. В блоке «Telegram-бот» вставьте токен в поле и сохраните. Одна схема — один бот: при необходимости создайте отдельных ботов через BotFather для других схем.',
                  },
                  {
                    n: 5,
                    title: 'Проверьте работу',
                    body: 'Дождитесь статуса «работает» (или аналогичного в интерфейсе), затем откройте бота по ссылке t.me/ваш_username и пройдите диалог — логика совпадает с выбранной схемой.',
                  },
                ].map(({ n, title, body }) => (
                  <li key={n} className="flex gap-3.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-sm font-bold shadow-md shadow-blue-600/25">
                      {n}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <div className="text-sm font-semibold text-slate-900">{title}</div>
                      <div className="mt-1 text-sm text-slate-600 leading-relaxed">{body}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200/90 bg-slate-50/90">
              <button
                type="button"
                onClick={() => setBotGuideOpen(false)}
                className="inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200/60 transition"
              >
                Закрыть
              </button>
              <button
                type="button"
                onClick={() => setBotGuideOpen(false)}
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 hover:from-blue-500 hover:to-indigo-600 transition"
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {schemas.map(s => {
          const isActive = s.id === schemaId
          const isEndo = s.id === 'endo-bot'
          const isEditing = editingId === s.id
          return (
            <div key={s.id}
              className={`bg-white rounded-xl border-2 p-4 ${isActive ? 'border-blue-500 shadow-md' : 'border-gray-200'}`}
            >
              <div className="flex items-start gap-3">
                <GitBranch className="text-gray-400 mt-1" size={22} />
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        className="w-full border rounded-lg px-3 py-1.5 text-sm"
                        value={editDraft.name}
                        onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                        placeholder="Имя схемы"
                      />
                      <textarea
                        className="w-full border rounded-lg px-3 py-1.5 text-sm"
                        value={editDraft.description}
                        onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                        placeholder="Описание (опционально)"
                        rows={2}
                      />
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-gray-600 mb-1">
                          <Play size={12} className="text-blue-600" />
                          <span>Стартовый узел</span>
                          <span className="text-gray-400 font-normal">
                            — с него бот начинает диалог после /start
                          </span>
                        </label>
                        <select
                          className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white"
                          value={editDraft.root_node_id}
                          onChange={(e) => setEditDraft({ ...editDraft, root_node_id: e.target.value })}
                          disabled={editNodesLoading}
                        >
                          <option value="">
                            {editNodesLoading
                              ? 'Загрузка узлов...'
                              : editNodes.length === 0
                                ? '— нет узлов в схеме —'
                                : '— не задан (бот будет молчать) —'}
                          </option>
                          {editNodes.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.id} — {truncate(n.text, 80)}
                            </option>
                          ))}
                        </select>
                        {!editNodesLoading && editNodes.length === 0 && (
                          <p className="text-[11px] text-orange-700 mt-1">
                            В схеме пока нет узлов. Добавьте их на странице «Узлы», затем вернитесь сюда и укажите стартовый.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-lg">{s.name}</span>
                        <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{s.id}</span>
                        {isActive && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-semibold">активна</span>}
                        {isEndo && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-semibold">базовая</span>}
                        {s.root_node_id ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded font-mono">
                            <Play size={10} /> старт: {s.root_node_id}
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-xs bg-orange-50 text-orange-800 border border-orange-200 px-2 py-0.5 rounded font-semibold"
                            title="Бот не сможет начать диалог, пока вы не укажете стартовый узел"
                          >
                            <AlertCircle size={11} /> стартовый узел не задан
                          </span>
                        )}
                      </div>
                      {s.description && <p className="text-sm text-gray-600 mt-1">{s.description}</p>}
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isEditing ? (
                    <>
                      <button onClick={saveEdit} className="p-2 text-green-600 hover:bg-green-50 rounded-lg" title="Сохранить">
                        <Check size={18} />
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg" title="Отмена">
                        <X size={18} />
                      </button>
                    </>
                  ) : (
                    <>
                      {!isActive && (
                        <button
                          onClick={() => switchSchema(s.id)}
                          className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg"
                        >
                          Открыть
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(s)}
                        className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                        title="Переименовать"
                      >
                        <Edit3 size={18} />
                      </button>
                      <button
                        onClick={() => setCloneTarget({ fromId: s.id, new_id: '', new_name: s.name + ' (копия)', description: '' })}
                        className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                        title="Клонировать"
                      >
                        <Copy size={18} />
                      </button>
                      {!isEndo && (
                        <button
                          onClick={() => handleDelete(s.id)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                          title="Удалить"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {!isEditing && <BotBindingSection schemaId={s.id} />}
            </div>
          )
        })}
      </div>

      {/* Create modal */}
      {creating && (
        <Modal onClose={() => setCreating(false)} title="Новая схема">
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">ID (латиницей, без пробелов)</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase() })}
                placeholder="my-schema"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Имя</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Моя схема"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Описание (опционально)</label>
              <textarea
                className="w-full border rounded-lg px-3 py-2"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
              />
            </div>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            <p className="text-xs text-gray-500">Новая схема будет пустой. После создания добавьте узлы через страницу "Узлы".</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCreating(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                Отмена
              </button>
              <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Создать
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Clone modal */}
      {cloneTarget && (
        <Modal onClose={() => setCloneTarget(null)} title={`Клонировать "${cloneTarget.fromId}"`}>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">ID копии</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={cloneTarget.new_id}
                onChange={(e) => setCloneTarget({ ...cloneTarget, new_id: e.target.value.toLowerCase() })}
                placeholder="my-schema-v2"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Имя копии</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={cloneTarget.new_name}
                onChange={(e) => setCloneTarget({ ...cloneTarget, new_name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Описание</label>
              <textarea
                className="w-full border rounded-lg px-3 py-2"
                value={cloneTarget.description}
                onChange={(e) => setCloneTarget({ ...cloneTarget, description: e.target.value })}
                rows={2}
              />
            </div>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            <p className="text-xs text-gray-500">Все узлы, опции, диагнозы и связи будут скопированы. Правки копии не затронут оригинал.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCloneTarget(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                Отмена
              </button>
              <button onClick={handleClone} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Клонировать
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function Modal({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-[32rem] max-w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">{title}</h3>
        {children}
      </div>
    </div>
  )
}

const STATUS_META = {
  running: { label: 'работает', color: 'bg-green-100 text-green-700 border-green-300', dot: 'bg-green-500' },
  starting: { label: 'запускается', color: 'bg-yellow-100 text-yellow-700 border-yellow-300', dot: 'bg-yellow-500 animate-pulse' },
  stopped: { label: 'остановлен', color: 'bg-gray-100 text-gray-600 border-gray-300', dot: 'bg-gray-400' },
  error: { label: 'ошибка', color: 'bg-red-100 text-red-700 border-red-300', dot: 'bg-red-500' },
  token_conflict: { label: 'конфликт токена', color: 'bg-orange-100 text-orange-700 border-orange-300', dot: 'bg-orange-500' },
}

function StatusPill({ status, enabled }) {
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-semibold bg-gray-50 text-gray-500 border-gray-300">
        <span className="w-2 h-2 rounded-full bg-gray-400" /> отключён
      </span>
    )
  }
  const m = STATUS_META[status] || STATUS_META.stopped
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-semibold ${m.color}`}>
      <span className={`w-2 h-2 rounded-full ${m.dot}`} /> {m.label}
    </span>
  )
}

function BotBindingSection({ schemaId }) {
  const [bot, setBot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [tokenDraft, setTokenDraft] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function reload() {
    setLoading(true)
    try {
      const data = await fetchBot(schemaId)
      setBot(data)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [schemaId])  // eslint-disable-line
  // Poll status while the section is visible — orchestrator updates it async.
  useEffect(() => {
    const t = setInterval(() => { fetchBot(schemaId).then(setBot).catch(() => {}) }, 5000)
    return () => clearInterval(t)
  }, [schemaId])

  async function handleSave() {
    setSaving(true); setErr('')
    try {
      await upsertBot(schemaId, { token: tokenDraft.trim(), enabled: true })
      setEditing(false)
      setTokenDraft('')
      await reload()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle() {
    if (!bot) return
    try {
      const updated = await toggleBotEnabled(schemaId, !bot.enabled)
      setBot(updated)
    } catch (e) {
      alert(`Ошибка: ${e.message}`)
    }
  }

  async function handleUnbind() {
    if (!confirm('Отвязать бота от схемы? Токен будет удалён, бот остановится в течение нескольких секунд.')) return
    try {
      await deleteBot(schemaId)
      setBot(null)
    } catch (e) {
      alert(`Ошибка: ${e.message}`)
    }
  }

  if (loading) {
    return <div className="mt-4 pt-4 border-t text-xs text-gray-400">Загрузка бота...</div>
  }

  return (
    <div className="mt-4 pt-4 border-t">
      <div className="flex items-center gap-2 mb-2">
        <BotIcon size={16} className="text-gray-500" />
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Telegram-бот</span>
        {bot && <StatusPill status={bot.status} enabled={bot.enabled} />}
        {bot?.username && (
          <a
            href={`https://t.me/${bot.username}`}
            target="_blank" rel="noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            @{bot.username}
          </a>
        )}
      </div>

      {bot?.last_error && (
        <div className="flex items-start gap-2 p-2 mb-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div className="break-all">{bot.last_error}</div>
        </div>
      )}

      {!bot && !editing && (
        <button
          onClick={() => { setEditing(true); setTokenDraft(''); setErr('') }}
          className="text-sm text-blue-600 hover:underline"
        >
          + Привязать бота
        </button>
      )}

      {editing && (
        <div className="space-y-2 bg-gray-50 p-3 rounded-lg border">
          <label className="text-xs text-gray-500">Токен от @BotFather</label>
          <div className="flex gap-2">
            <input
              type={showToken ? 'text' : 'password'}
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="1234567890:AA..."
              className="flex-1 border rounded-lg px-3 py-1.5 text-sm font-mono"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowToken(s => !s)}
              className="p-2 text-gray-500 hover:bg-gray-200 rounded-lg"
              title={showToken ? 'Скрыть' : 'Показать'}
            >
              {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {err && <div className="text-xs text-red-600">{err}</div>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setEditing(false); setErr('') }}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded-lg"
            >
              Отмена
            </button>
            <button
              onClick={handleSave}
              disabled={saving || tokenDraft.trim().length < 20}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
          <p className="text-[11px] text-gray-500">
            Бот запустится автоматически в течение 5–10 секунд после сохранения.
          </p>
        </div>
      )}

      {bot && !editing && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setEditing(true); setTokenDraft(''); setErr('') }}
            className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
          >
            Сменить токен
          </button>
          <button
            onClick={handleToggle}
            className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
              bot.enabled
                ? 'bg-yellow-100 hover:bg-yellow-200 text-yellow-800'
                : 'bg-green-100 hover:bg-green-200 text-green-800'
            }`}
          >
            <Power size={12} />
            {bot.enabled ? 'Отключить' : 'Включить'}
          </button>
          <button
            onClick={handleUnbind}
            className="text-xs px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded"
          >
            Отвязать
          </button>
        </div>
      )}
    </div>
  )
}
