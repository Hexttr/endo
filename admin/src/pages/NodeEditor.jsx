import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchNode, updateNode } from '../api'
import { ArrowLeft, Save } from 'lucide-react'

export default function NodeEditor() {
  const { nodeId } = useParams()
  const [node, setNode] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchNode(nodeId).then(n => {
      setNode(n)
      setForm({ text: n.text, description: n.description || '', input_type: n.input_type, unknown_action: n.unknown_action || '' })
    })
  }, [nodeId])

  const handleSave = async () => {
    setSaving(true)
    const updates = {}
    if (form.text !== node.text) updates.text = form.text
    if (form.description !== (node.description || '')) updates.description = form.description || null
    if (form.input_type !== node.input_type) updates.input_type = form.input_type
    if (form.unknown_action !== (node.unknown_action || '')) updates.unknown_action = form.unknown_action || null

    if (Object.keys(updates).length > 0) {
      const updated = await updateNode(nodeId, updates)
      setNode(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  if (!node) return <div className="p-8">Загрузка...</div>

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-4 mb-6">
        <Link to="/tree" className="text-gray-500 hover:text-gray-700"><ArrowLeft size={20} /></Link>
        <h1 className="text-2xl font-bold">Узел: <span className="text-blue-600">{node.id}</span></h1>
        <span className="px-3 py-1 bg-gray-100 rounded-full text-sm">{node.section}</span>
      </div>

      <div className="bg-white rounded-xl shadow-sm border p-6 space-y-6">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Текст вопроса</label>
          <textarea
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            rows={4}
            className="w-full border rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Описание (опционально)</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full border rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Тип ввода</label>
            <select
              value={form.input_type}
              onChange={(e) => setForm({ ...form, input_type: e.target.value })}
              className="w-full border rounded-lg px-4 py-3"
            >
              <option value="info">info</option>
              <option value="action">action</option>
              <option value="single_choice">single_choice</option>
              <option value="multi_choice">multi_choice</option>
              <option value="yes_no">yes_no</option>
              <option value="numeric">numeric</option>
              <option value="auto">auto</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Действие при «Не знаю»</label>
            <select
              value={form.unknown_action}
              onChange={(e) => setForm({ ...form, unknown_action: e.target.value })}
              className="w-full border rounded-lg px-4 py-3"
            >
              <option value="">Не задано</option>
              <option value="safe_default">safe_default</option>
              <option value="branch_c">branch_c</option>
              <option value="skip_with_flag">skip_with_flag</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold"
          >
            <Save size={18} />
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          {saved && <span className="text-green-600 text-sm font-semibold">Сохранено!</span>}
        </div>
      </div>

      {node.options && node.options.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-6 mt-6">
          <h2 className="text-lg font-semibold mb-4">Варианты ответов ({node.options.length})</h2>
          <div className="space-y-3">
            {node.options.map((opt) => (
              <div key={opt.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <span className="font-mono text-sm text-purple-600">{opt.option_id}</span>
                  <p className="text-sm text-gray-700">{opt.label}</p>
                </div>
                {opt.next_node_id && (
                  <Link to={`/nodes/${opt.next_node_id}`} className="text-blue-600 text-sm hover:underline">
                    → {opt.next_node_id}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
