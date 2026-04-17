import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchNodes, fetchFinals, fetchSessions, fetchSections } from '../api'
import { GitBranch, FileText, Users, Layers } from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState({ nodes: 0, finals: 0, sessions: 0, sections: [] })

  useEffect(() => {
    Promise.all([
      fetchNodes().catch(() => []),
      fetchFinals().catch(() => []),
      fetchSessions().catch(() => []),
      fetchSections().catch(() => []),
    ]).then(([nodes, finals, sessions, sections]) => {
      setStats({
        nodes: nodes.length,
        finals: finals.length,
        sessions: sessions.length,
        sections,
      })
    })
  }, [])

  const cards = [
    { icon: <GitBranch size={24} />, label: 'Узлы дерева', value: stats.nodes, color: 'bg-blue-500', to: '/tree' },
    { icon: <FileText size={24} />, label: 'Финальные диагнозы', value: stats.finals, color: 'bg-green-500', to: '/finals' },
    { icon: <Users size={24} />, label: 'Сессии бота', value: stats.sessions, color: 'bg-purple-500', to: '/sessions' },
    { icon: <Layers size={24} />, label: 'Секции', value: stats.sections.length, color: 'bg-orange-500', to: '/tree' },
  ]

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Обзор системы</h1>
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
        <h2 className="text-lg font-semibold mb-4">Секции дерева решений</h2>
        <div className="flex flex-wrap gap-2">
          {stats.sections.map((s) => (
            <Link key={s} to={`/tree?section=${s}`}
              className="px-3 py-1 bg-gray-100 rounded-full text-sm hover:bg-blue-100 transition">
              {s}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
