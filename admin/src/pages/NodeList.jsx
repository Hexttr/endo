import React, { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchNodes, fetchSections, createNode, deleteNode } from '../api'
import { Plus, Trash2, Search, X, List } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'

export default function NodeList() {
  const navigate = useNavigate()
  const [nodes, setNodes] = useState([])
  const [sections, setSections] = useState([])
  const [selectedSection, setSelectedSection] = useState('')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newNode, setNewNode] = useState({ id: '', section: '', text: '', input_type: 'info' })
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const loadNodes = () => {
    fetchNodes(selectedSection || undefined).then(setNodes).catch(() => {})
  }

  useEffect(() => {
    fetchSections().then((s) => {
      setSections(s)
      // Pre-fill the new-node form with the first available section so user
      // doesn't have to guess a slug.
      if (s?.length && !newNode.section) {
        setNewNode(n => ({ ...n, section: typeof s[0] === 'string' ? s[0] : s[0].slug }))
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { loadNodes() }, [selectedSection])

  const filtered = useMemo(() => {
    if (!search) return nodes
    const q = search.toLowerCase()
    return nodes.filter(n =>
      n.id.toLowerCase().includes(q) ||
      n.text.toLowerCase().includes(q) ||
      n.section.toLowerCase().includes(q)
    )
  }, [nodes, search])

  const handleCreate = async () => {
    setError('')
    if (!newNode.id || !newNode.section || !newNode.text) {
      setError('ID, секция и текст обязательны')
      return
    }
    try {
      await createNode(newNode)
      setShowCreate(false)
      setNewNode({ id: '', section: '', text: '', input_type: 'info' })
      loadNodes()
      fetchSections().then(setSections)
      setToast(`Узел ${newNode.id} создан`)
      setTimeout(() => setToast(''), 3000)
    } catch (e) {
      setError(e.message)
    }
  }

  const handleDelete = async (nodeId) => {
    if (!confirm(`Удалить узел "${nodeId}"? Связанные варианты и рёбра будут удалены.`)) return
    try {
      await deleteNode(nodeId)
      loadNodes()
      setToast(`Узел ${nodeId} удалён`)
      setTimeout(() => setToast(''), 3000)
    } catch (e) {
      setToast(`Ошибка: ${e.message}`)
      setTimeout(() => setToast(''), 4000)
    }
  }

  return (
    <div className="p-8">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      <PageHeader icon={List} title={`Узлы дерева (${nodes.length})`}>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <select
            value={selectedSection}
            onChange={(e) => setSelectedSection(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Все секции</option>
            {sections.map(s => {
              const slug = typeof s === 'string' ? s : s.slug
              const label = typeof s === 'string' ? s : (s.label || s.slug)
              return <option key={slug} value={slug}>{label}</option>
            })}
          </select>
          <div className="relative">
            <Search size={16} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input
              type="text"
              placeholder="Поиск..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border rounded-lg pl-8 pr-3 py-2 text-sm w-56"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-semibold"
          >
            <Plus size={16} />
            Создать узел
          </button>
        </div>
      </PageHeader>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[500px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Новый узел</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-3 text-sm">{error}</div>}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ID узла</label>
                  <input
                    type="text"
                    value={newNode.id}
                    onChange={(e) => setNewNode({ ...newNode, id: e.target.value })}
                    placeholder="напр. B200"
                    className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Секция</label>
                  <select
                    value={newNode.section}
                    onChange={(e) => setNewNode({ ...newNode, section: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    {sections.length === 0 && <option value="">— сначала создайте секцию —</option>}
                    {sections.map(s => {
                      const slug = typeof s === 'string' ? s : s.slug
                      const label = typeof s === 'string' ? s : (s.label || s.slug)
                      return <option key={slug} value={slug}>{label}</option>
                    })}
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Список секций редактируется на вкладке «Обзор».
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Текст вопроса</label>
                <textarea
                  value={newNode.text}
                  onChange={(e) => setNewNode({ ...newNode, text: e.target.value })}
                  rows={3}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Тип ввода</label>
                <select
                  value={newNode.input_type}
                  onChange={(e) => setNewNode({ ...newNode, input_type: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
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

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600 w-28">ID</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600 w-36">Секция</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Текст</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600 w-28">Тип</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600 w-20">Опции</th>
              <th className="w-20"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(n => (
              <tr key={n.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/nodes/${n.id}`)}>
                <td className="px-4 py-3 font-mono text-sm text-blue-600 font-semibold">{n.id}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{n.section}</td>
                <td className="px-4 py-3 text-sm text-gray-700 truncate max-w-[400px]">{n.text}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{n.input_type}</span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500 text-center">{n.options?.length || 0}</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handleDelete(n.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                    title="Удалить узел"
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Нет узлов</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
