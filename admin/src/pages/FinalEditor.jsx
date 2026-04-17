import React, { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { fetchFinal, updateFinal } from '../api'
import { ArrowLeft, Save, Map } from 'lucide-react'

export default function FinalEditor() {
  const { finalId } = useParams()
  const navigate = useNavigate()
  const [final_, setFinal] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchFinal(finalId).then(f => {
      setFinal(f)
      setForm({
        diagnosis: f.diagnosis,
        endo_picture: f.endo_picture || '',
        equipment: (f.equipment || []).join(', '),
        algorithm: f.algorithm || '',
        routing: f.routing || '',
        followup: f.followup || '',
      })
    })
  }, [finalId])

  const handleSave = async () => {
    setSaving(true)
    const updates = {
      diagnosis: form.diagnosis,
      endo_picture: form.endo_picture || null,
      equipment: form.equipment ? form.equipment.split(',').map(s => s.trim()).filter(Boolean) : null,
      algorithm: form.algorithm || null,
      routing: form.routing || null,
      followup: form.followup || null,
    }
    const updated = await updateFinal(finalId, updates)
    setFinal(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    setSaving(false)
  }

  if (!final_) return <div className="p-8 text-gray-500">Загрузка...</div>

  const fields = [
    { key: 'diagnosis', label: 'Диагноз', rows: 2, help: 'Полное название диагноза для отображения в боте' },
    { key: 'endo_picture', label: 'Эндоскопическая картина', rows: 3, help: 'Описание визуальных находок' },
    { key: 'equipment', label: 'Оборудование (через запятую)', rows: 2, help: 'Список необходимого оборудования' },
    { key: 'algorithm', label: 'Алгоритм манипуляции', rows: 4, help: 'Пошаговый алгоритм действий врача' },
    { key: 'routing', label: 'Маршрутизация к специалисту', rows: 2, help: 'К каким специалистам направить пациента' },
    { key: 'followup', label: 'Сроки наблюдения', rows: 2, help: 'Рекомендации по контрольным обследованиям' },
  ]

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <Link to="/finals" className="text-gray-500 hover:text-gray-700"><ArrowLeft size={20} /></Link>
        <h1 className="text-2xl font-bold">Диагноз: <span className="text-green-700">{final_.id}</span></h1>
        <button
          onClick={() => {
            try { sessionStorage.setItem('tree-highlight-target', finalId) } catch {}
            navigate('/tree')
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-sm hover:bg-indigo-100 transition ml-auto"
        >
          <Map size={15} />
          Показать на схеме
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
        {fields.map((f) => (
          <div key={f.key}>
            <label className="block text-sm font-semibold text-gray-700 mb-1">{f.label}</label>
            <textarea
              value={form[f.key]}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              rows={f.rows}
              className="w-full border rounded-lg px-4 py-3 focus:ring-2 focus:ring-green-500 outline-none"
            />
            <p className="text-xs text-gray-400 mt-1">{f.help}</p>
          </div>
        ))}

        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-green-600 text-white px-6 py-2.5 rounded-lg hover:bg-green-700 disabled:opacity-50 font-semibold"
          >
            <Save size={18} />
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          {saved && <span className="text-green-600 text-sm font-semibold">Сохранено!</span>}
        </div>
      </div>
    </div>
  )
}
