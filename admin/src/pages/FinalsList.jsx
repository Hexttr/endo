import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchFinals, createFinal, deleteFinal } from '../api'
import { FileText, Plus, Trash2, X } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'

export default function FinalsList() {
  const [finals, setFinals] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [newFinal, setNewFinal] = useState({ id: '', diagnosis: '' })
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const load = () => fetchFinals().then(setFinals).catch(() => {})

  useEffect(() => { load() }, [])

  const flash = (msg, ms = 3000) => {
    setToast(msg); setTimeout(() => setToast(''), ms)
  }

  const handleCreate = async () => {
    setError('')
    if (!newFinal.id.trim() || !newFinal.diagnosis.trim()) {
      setError('ID и диагноз обязательны'); return
    }
    try {
      await createFinal({ id: newFinal.id.trim(), diagnosis: newFinal.diagnosis.trim() })
      setShowCreate(false)
      setNewFinal({ id: '', diagnosis: '' })
      load()
      flash(`Диагноз ${newFinal.id} создан`)
    } catch (e) { setError(e.message) }
  }

  const handleDelete = async (final, ev) => {
    ev.preventDefault(); ev.stopPropagation()
    if (!confirm(`Удалить диагноз "${final.id} — ${final.diagnosis}"?`)) return
    try {
      await deleteFinal(final.id)
      load()
      flash(`Диагноз ${final.id} удалён`)
    } catch (e) {
      flash(`Ошибка: ${e.message}`, 4000)
    }
  }

  return (
    <div className="p-8">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      <PageHeader icon={FileText} title={`Финальные диагнозы (${finals.length})`}>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-semibold"
        >
          <Plus size={16} />
          Новый диагноз
        </button>
      </PageHeader>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[500px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Новый диагноз</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-3 text-sm">{error}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ID (короткий)</label>
                <input
                  value={newFinal.id}
                  onChange={(e) => setNewFinal({ ...newFinal, id: e.target.value })}
                  placeholder="напр. F100"
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Остальные поля (эндо-картина, оборудование, маршрут) можно заполнить на странице диагноза.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Название диагноза</label>
                <textarea
                  value={newFinal.diagnosis}
                  onChange={(e) => setNewFinal({ ...newFinal, diagnosis: e.target.value })}
                  rows={3}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                Отмена
              </button>
              <button onClick={handleCreate} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold">
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {finals.map((f) => (
          <Link
            key={f.id}
            to={`/finals/${f.id}`}
            className="relative bg-white rounded-xl shadow-sm border p-5 hover:shadow-md transition group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono font-bold text-green-700">{f.id}</span>
              <div className="flex items-center gap-2">
                {f.equipment && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                    {f.equipment.length} инстр.
                  </span>
                )}
                <button
                  onClick={(ev) => handleDelete(f, ev)}
                  className="opacity-0 group-hover:opacity-100 transition p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                  title="Удалить"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <h3 className="font-semibold text-gray-800">{f.diagnosis}</h3>
            {f.routing && <p className="text-sm text-gray-500 mt-2">→ {f.routing}</p>}
            {f.followup && <p className="text-xs text-gray-400 mt-1">{f.followup}</p>}
          </Link>
        ))}
        {finals.length === 0 && (
          <div className="col-span-full text-center text-gray-400 py-10">
            Нет диагнозов. Создайте первый кнопкой «Новый диагноз».
          </div>
        )}
      </div>
    </div>
  )
}
