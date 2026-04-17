import React, { useState, useEffect } from 'react'
import { fetchSessions } from '../api'

const STATUS_COLORS = {
  active: 'bg-blue-100 text-blue-700',
  pending: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  abandoned: 'bg-gray-100 text-gray-500',
}

export default function SessionsList() {
  const [sessions, setSessions] = useState([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    const params = filter ? { status: filter } : {}
    fetchSessions(params).then(setSessions).catch(() => {})
  }, [filter])

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Сессии бота ({sessions.length})</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Все статусы</option>
          <option value="active">Активные</option>
          <option value="pending">Ожидающие</option>
          <option value="completed">Завершённые</option>
          <option value="abandoned">Прерванные</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-6 py-3 text-sm font-semibold text-gray-600">ID</th>
              <th className="text-left px-6 py-3 text-sm font-semibold text-gray-600">Пользователь</th>
              <th className="text-left px-6 py-3 text-sm font-semibold text-gray-600">Текущий узел</th>
              <th className="text-left px-6 py-3 text-sm font-semibold text-gray-600">Статус</th>
              <th className="text-left px-6 py-3 text-sm font-semibold text-gray-600">Обновлено</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-t hover:bg-gray-50">
                <td className="px-6 py-4 font-mono text-sm">{s.id}</td>
                <td className="px-6 py-4 text-sm">{s.user_id}</td>
                <td className="px-6 py-4 font-mono text-sm text-blue-600">{s.current_node_id || '—'}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[s.status] || ''}`}>
                    {s.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {new Date(s.updated_at).toLocaleString('ru-RU')}
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                  Нет сессий
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
