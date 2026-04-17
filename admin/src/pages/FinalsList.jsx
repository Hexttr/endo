import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchFinals } from '../api'

export default function FinalsList() {
  const [finals, setFinals] = useState([])

  useEffect(() => {
    fetchFinals().then(setFinals).catch(() => {})
  }, [])

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Финальные диагнозы ({finals.length})</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {finals.map((f) => (
          <Link
            key={f.id}
            to={`/finals/${f.id}`}
            className="bg-white rounded-xl shadow-sm border p-5 hover:shadow-md transition"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono font-bold text-green-700">{f.id}</span>
              {f.equipment && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                  {f.equipment.length} инстр.
                </span>
              )}
            </div>
            <h3 className="font-semibold text-gray-800">{f.diagnosis}</h3>
            {f.routing && <p className="text-sm text-gray-500 mt-2">→ {f.routing}</p>}
            {f.followup && <p className="text-xs text-gray-400 mt-1">{f.followup}</p>}
          </Link>
        ))}
      </div>
    </div>
  )
}
