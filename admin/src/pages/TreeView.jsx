import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import {
  ReactFlow, Controls, Background, MiniMap,
  useReactFlow, ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { fetchNodes, fetchEdgesGraph, fetchSections, fetchFinals, createEdge, deleteEdge, updateEdge } from '../api'

const SECTION_COLORS = {
  branch_a: { bg: '#fef2f2', border: '#f87171', badge: '#dc2626' },
  branch_a_vrvp: { bg: '#fdf2f8', border: '#f472b6', badge: '#db2777' },
  branch_a_egds: { bg: '#fff1f2', border: '#fb7185', badge: '#e11d48' },
  branch_b: { bg: '#fff7ed', border: '#fb923c', badge: '#ea580c' },
  branch_b_complaints: { bg: '#fefce8', border: '#facc15', badge: '#ca8a04' },
  branch_b_polyps: { bg: '#faf5ff', border: '#c084fc', badge: '#9333ea' },
  branch_b_vrvp: { bg: '#fdf4ff', border: '#e879f9', badge: '#c026d3' },
  branch_b_erosions: { bg: '#fef2f2', border: '#fca5a5', badge: '#dc2626' },
  branch_b_ulcers: { bg: '#fff7ed', border: '#fdba74', badge: '#ea580c' },
  branch_b_ere: { bg: '#f0fdf4', border: '#86efac', badge: '#16a34a' },
  branch_b_burn: { bg: '#fef2f2', border: '#f87171', badge: '#b91c1c' },
  branch_b_history: { bg: '#fffbeb', border: '#fcd34d', badge: '#b45309' },
  branch_c: { bg: '#eff6ff', border: '#93c5fd', badge: '#2563eb' },
  overview: { bg: '#f0fdf4', border: '#86efac', badge: '#15803d' },
}

const NODE_W = 240
const NODE_H = 70

function layoutGraph(rawNodes, rawEdges) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80, edgesep: 20 })
  rawNodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  rawEdges.forEach(e => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  })
  dagre.layout(g)
  return rawNodes.map(n => {
    const pos = g.node(n.id)
    if (!pos) return { ...n, position: { x: 0, y: 0 } }
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } }
  })
}

function deduplicateEdges(edges) {
  const seen = new Map()
  edges.forEach(e => {
    const key = `${e.source}||${e.target}`
    if (!seen.has(key)) seen.set(key, e)
  })
  return Array.from(seen.values())
}

const VIEWPORT_KEY = 'tree-viewport'
const HIGHLIGHT_KEY = 'tree-highlight-target'

function TreeViewInner() {
  const [searchParams] = useSearchParams()
  const [nodes, setNodes] = useState([])
  const [finals, setFinals] = useState([])
  const [allEdges, setAllEdges] = useState([])
  const [sections, setSections] = useState([])
  const [selectedSection, setSelectedSection] = useState(searchParams.get('section') || '')
  const [search, setSearch] = useState('')
  const [showFinals, setShowFinals] = useState(true)
  const [showLabels, setShowLabels] = useState(false)
  const [toast, setToast] = useState('')
  const [contextMenu, setContextMenu] = useState(null)
  const [editingEdgeLabel, setEditingEdgeLabel] = useState(null)
  // One-shot highlight target is consumed once on mount (e.g. when navigating
  // from NodeEditor/FinalEditor via "Show on tree"). URL ?highlight= still works
  // as a fallback for bookmarking/sharing.
  const [highlightId] = useState(() => {
    let fromSession = null
    try {
      fromSession = sessionStorage.getItem(HIGHLIGHT_KEY)
      if (fromSession) sessionStorage.removeItem(HIGHLIGHT_KEY)
    } catch {}
    return fromSession || searchParams.get('highlight') || null
  })
  const initDone = useRef(false)
  const paneRef = useRef(null)
  const [rfReady, setRfReady] = useState(false)
  // Each of these flips true once the corresponding fetch RESOLVES (even when
  // it returns an empty array). We wait for ALL three before running the
  // initial viewport logic, otherwise dagre can re-layout on a partial graph
  // and we'd centre on stale coordinates.
  const [nodesFetched, setNodesFetched] = useState(false)
  const [edgesFetched, setEdgesFetched] = useState(false)
  const [finalsFetched, setFinalsFetched] = useState(false)

  const { setViewport, getNode } = useReactFlow()

  // Predictable zoom level for the "focus" action. Same value every time.
  const FOCUS_ZOOM = 1.5

  // Deterministic centering. Computes the viewport transform directly from:
  //   - the pane's own DOM bounding box (not ReactFlow's internal store which
  //     can be stale on first render),
  //   - the target node's dagre-computed position,
  //   - the node's actual measured DOM size if available, falling back to
  //     (NODE_W, NODE_H) so dagre math stays consistent.
  // Screen pixel = flowCoord * zoom + translate  =>  translate = paneCenter - center * zoom
  const focusOnNode = useCallback((nodeId) => {
    if (!nodeId) return false
    const pane = paneRef.current
    if (!pane) return false
    const rect = pane.getBoundingClientRect()
    if (!rect.width || !rect.height) return false
    const rfNode = getNode(nodeId)
    if (!rfNode || !rfNode.position) return false

    const w = rfNode.measured?.width || rfNode.width || NODE_W
    const h = rfNode.measured?.height || rfNode.height || NODE_H
    const cx = rfNode.position.x + w / 2
    const cy = rfNode.position.y + h / 2

    const zoom = FOCUS_ZOOM
    const x = rect.width / 2 - cx * zoom
    const y = rect.height / 2 - cy * zoom
    setViewport({ x, y, zoom }, { duration: 650 })
    return true
  }, [getNode, setViewport])

  const loadEdges = () => fetchEdgesGraph()
    .then(d => { setAllEdges(d); setEdgesFetched(true) })
    .catch(() => setEdgesFetched(true))

  useEffect(() => {
    fetchSections().then(setSections).catch(() => {})
    loadEdges()
    fetchFinals()
      .then(d => { setFinals(d); setFinalsFetched(true) })
      .catch(() => setFinalsFetched(true))
  }, [])

  useEffect(() => {
    fetchNodes(selectedSection || undefined)
      .then(d => { setNodes(d); setNodesFetched(true) })
      .catch(() => setNodesFetched(true))
  }, [selectedSection])

  // Fired by ReactFlow when its internal instance is ready to receive commands.
  const onInit = useCallback(() => setRfReady(true), [])

  const onMoveEnd = useCallback((_, viewport) => {
    if (!initDone.current) return
    try { sessionStorage.setItem(VIEWPORT_KEY, JSON.stringify(viewport)) } catch {}
  }, [])

  const filteredNodes = useMemo(() => {
    if (!search) return nodes
    const q = search.toLowerCase()
    return nodes.filter(n => n.id.toLowerCase().includes(q) || n.text.toLowerCase().includes(q))
  }, [nodes, search])

  const finalIds = useMemo(() => new Set(finals.map(f => f.id)), [finals])

  const flowEdges = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map(n => n.id))
    const allVisible = new Set(nodeIds)
    if (showFinals) finalIds.forEach(id => allVisible.add(id))

    const raw = []
    filteredNodes.forEach(n => {
      (n.options || []).forEach(opt => {
        if (!opt.next_node_id || !allVisible.has(opt.next_node_id)) return
        raw.push({
          id: `opt-${n.id}-${opt.next_node_id}-${opt.option_id}`,
          source: n.id,
          target: opt.next_node_id,
          label: showLabels ? opt.label.substring(0, 25) : '',
          style: { stroke: '#c4b5fd', strokeWidth: 1 },
          labelStyle: { fontSize: 8, fill: '#6b7280' },
          labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
          labelBgPadding: [2, 1],
          type: 'smoothstep',
          data: { kind: 'option' },
        })
      })
    })

    allEdges.forEach(e => {
      if (!allVisible.has(e.from_node_id) || !allVisible.has(e.to_node_id)) return
      raw.push({
        id: `edge-${e.id}`,
        source: e.from_node_id,
        target: e.to_node_id,
        label: showLabels && e.label ? e.label.substring(0, 25) : '',
        style: { stroke: '#6366f1', strokeWidth: 2 },
        animated: true,
        type: 'smoothstep',
        data: { kind: 'db_edge', dbId: e.id, dbLabel: e.label },
      })
    })

    return deduplicateEdges(raw)
  }, [filteredNodes, allEdges, finalIds, showFinals, showLabels])

  const navigate = useNavigate()

  const onNodeDoubleClick = useCallback((event, node) => {
    if (node.data?.isFinal) navigate(`/finals/${node.id}`)
    else navigate(`/nodes/${node.id}`)
  }, [navigate])

  const onConnect = useCallback(async (params) => {
    try {
      await createEdge({ from_node_id: params.source, to_node_id: params.target })
      await loadEdges()
      setToast(`Связь ${params.source} → ${params.target} создана`)
      setTimeout(() => setToast(''), 3000)
    } catch (e) {
      setToast(`Ошибка: ${e.message}`)
      setTimeout(() => setToast(''), 4000)
    }
  }, [])

  const onEdgeContextMenu = useCallback((event, edge) => {
    event.preventDefault()
    if (edge.data?.kind !== 'db_edge') return
    setContextMenu({
      x: event.clientX, y: event.clientY,
      edgeId: edge.data.dbId,
      label: edge.data.dbLabel || '',
      source: edge.source,
      target: edge.target,
    })
  }, [])

  const handleEdgeDelete = async () => {
    if (!contextMenu) return
    if (!confirm(`Удалить связь ${contextMenu.source} → ${contextMenu.target}?`)) {
      setContextMenu(null)
      return
    }
    try {
      await deleteEdge(contextMenu.edgeId)
      await loadEdges()
      setToast('Связь удалена')
      setTimeout(() => setToast(''), 3000)
    } catch (e) {
      setToast(`Ошибка: ${e.message}`)
      setTimeout(() => setToast(''), 4000)
    }
    setContextMenu(null)
  }

  const handleEdgeEditLabel = () => {
    setEditingEdgeLabel({ edgeId: contextMenu.edgeId, label: contextMenu.label })
    setContextMenu(null)
  }

  const handleEdgeLabelSave = async () => {
    if (!editingEdgeLabel) return
    try {
      await updateEdge(editingEdgeLabel.edgeId, { label: editingEdgeLabel.label || null })
      await loadEdges()
      setToast('Подпись обновлена')
      setTimeout(() => setToast(''), 3000)
    } catch (e) {
      setToast(`Ошибка: ${e.message}`)
      setTimeout(() => setToast(''), 4000)
    }
    setEditingEdgeLabel(null)
  }

  const flowNodes = useMemo(() => {
    const raw = filteredNodes.map(n => {
      const colors = SECTION_COLORS[n.section] || { bg: '#f3f4f6', border: '#d1d5db', badge: '#6b7280' }
      const shortText = n.text.length > 45 ? n.text.substring(0, 43) + '...' : n.text
      const isHighlighted = n.id === highlightId
      return {
        id: n.id,
        position: { x: 0, y: 0 },
        data: { label: `${n.id} ${shortText}`, section: n.section, isFinal: false },
        style: {
          background: isHighlighted ? '#fef08a' : colors.bg,
          border: `${isHighlighted ? 3 : 2}px solid ${isHighlighted ? '#eab308' : colors.border}`,
          borderRadius: '10px',
          padding: '6px 10px',
          fontSize: '10px',
          width: NODE_W,
          lineHeight: '1.3',
          cursor: 'pointer',
          boxShadow: isHighlighted ? '0 0 12px rgba(234, 179, 8, 0.5)' : 'none',
        },
      }
    })

    if (showFinals) {
      finals.forEach(f => {
        const isHighlighted = f.id === highlightId
        raw.push({
          id: f.id,
          position: { x: 0, y: 0 },
          data: { label: `${f.id} ${f.diagnosis || ''}`, isFinal: true },
          style: {
            background: isHighlighted ? '#fef08a' : '#dcfce7',
            border: `${isHighlighted ? 3 : 2}px solid ${isHighlighted ? '#eab308' : '#22c55e'}`,
            borderRadius: '14px',
            padding: '6px 10px',
            fontSize: '10px',
            fontWeight: '600',
            width: NODE_W,
            cursor: 'pointer',
            boxShadow: isHighlighted ? '0 0 12px rgba(234, 179, 8, 0.5)' : 'none',
          },
        })
      })
    }

    if (raw.length === 0) return raw
    if (flowEdges.length === 0) {
      return raw.map((n, i) => ({
        ...n,
        position: { x: (i % 6) * (NODE_W + 40), y: Math.floor(i / 6) * 100 },
      }))
    }
    return layoutGraph(raw, flowEdges)
  }, [filteredNodes, finals, flowEdges, showFinals, highlightId])

  // Default fitView fallback: centres the whole graph at whatever zoom fits
  // with 15% padding. Uses the same manual projection as focusOnNode so we
  // never depend on ReactFlow's internal measurement timing.
  const fitAllNodes = useCallback(() => {
    const pane = paneRef.current
    if (!pane || flowNodes.length === 0) return false
    const rect = pane.getBoundingClientRect()
    if (!rect.width || !rect.height) return false

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    flowNodes.forEach(n => {
      const rfn = getNode(n.id)
      const w = rfn?.measured?.width || n.style?.width || NODE_W
      const h = rfn?.measured?.height || NODE_H
      const x = n.position.x
      const y = n.position.y
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x + w > maxX) maxX = x + w
      if (y + h > maxY) maxY = y + h
    })
    const graphW = maxX - minX
    const graphH = maxY - minY
    if (graphW <= 0 || graphH <= 0) return false

    const padding = 0.15
    const zoomX = (rect.width * (1 - padding * 2)) / graphW
    const zoomY = (rect.height * (1 - padding * 2)) / graphH
    const zoom = Math.max(0.05, Math.min(zoomX, zoomY, 1.5))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const x = rect.width / 2 - cx * zoom
    const y = rect.height / 2 - cy * zoom
    setViewport({ x, y, zoom }, { duration: 0 })
    return true
  }, [flowNodes, getNode, setViewport])

  // One-time viewport initialization. We wait for:
  //   1. The ReactFlow instance to be ready (onInit fired)
  //   2. All three fetches to have RESOLVED (nodes, edges, finals) so the
  //      graph we're measuring is the final one — otherwise dagre re-lays
  //      everything after partial data arrives and we centre on stale coords.
  //   3. flowNodes to contain at least one item.
  //   4. The pane's DOM bounding box to have real width/height (browser
  //      layout pass completed).
  //
  // Then we either focus on the highlight target, restore the saved viewport,
  // or run the default fit. Double rAF lets React Flow finish its internal
  // measurement pass so getNode(id).measured is populated.
  useEffect(() => {
    if (initDone.current) return
    if (!rfReady) return
    if (!nodesFetched || !edgesFetched || !finalsFetched) return
    if (flowNodes.length === 0) return
    if (highlightId && !getNode(highlightId)) return
    const rect = paneRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return

    initDone.current = true

    const runInit = () => {
      if (highlightId && focusOnNode(highlightId)) return

      try {
        const saved = sessionStorage.getItem(VIEWPORT_KEY)
        if (saved) {
          const vp = JSON.parse(saved)
          if (vp && typeof vp.x === 'number' && typeof vp.y === 'number' && typeof vp.zoom === 'number') {
            setViewport(vp, { duration: 0 })
            return
          }
        }
      } catch {}

      fitAllNodes()
    }

    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(runInit)
    })
    return () => cancelAnimationFrame(raf1)
  }, [rfReady, nodesFetched, edgesFetched, finalsFetched, flowNodes.length, highlightId, focusOnNode, fitAllNodes, setViewport, getNode])

  return (
    <div className="h-screen flex flex-col" onClick={() => setContextMenu(null)}>
      {/* Toolbar */}
      <div className="bg-white border-b px-4 py-3 flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-bold whitespace-nowrap">Дерево</h1>
        <select
          value={selectedSection}
          onChange={(e) => setSelectedSection(e.target.value)}
          className="border rounded-lg px-2 py-1.5 text-sm"
        >
          <option value="">Все секции</option>
          {sections.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          type="text"
          placeholder="Поиск..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded-lg px-2 py-1.5 text-sm w-48"
        />
        <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
          <input type="checkbox" checked={showFinals} onChange={(e) => setShowFinals(e.target.checked)} className="rounded" />
          Диагнозы
        </label>
        <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} className="rounded" />
          Подписи рёбер
        </label>
        <span className="text-gray-400 text-xs ml-auto">
          {flowNodes.length} узлов &middot; {flowEdges.length} связей
          {highlightId && <span className="ml-2 text-yellow-600 font-semibold">Выделен: {highlightId}</span>}
        </span>
      </div>

      {/* Toast */}
      {toast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      <div className="flex-1 flex">
        {/* Sidebar */}
        <div className="w-72 bg-white border-r overflow-y-auto text-xs">
          {filteredNodes.map(n => (
            <Link key={n.id} to={`/nodes/${n.id}`}
              className={`block px-3 py-2 border-b hover:bg-gray-50 transition ${n.id === highlightId ? 'bg-yellow-50 border-l-4 border-l-yellow-500' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-blue-600">{n.id}</span>
                <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px]">{n.input_type}</span>
              </div>
              <p className="text-gray-600 mt-0.5 line-clamp-1">{n.text}</p>
            </Link>
          ))}
          {showFinals && finals.map(f => (
            <Link key={f.id} to={`/finals/${f.id}`}
              className={`block px-3 py-2 border-b hover:bg-green-50 transition ${f.id === highlightId ? 'bg-yellow-50 border-l-4 border-l-yellow-500' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-green-700">{f.id}</span>
                <span className="px-1.5 py-0.5 bg-green-100 text-green-800 rounded text-[10px]">final</span>
              </div>
              <p className="text-gray-600 mt-0.5 line-clamp-1">{f.diagnosis}</p>
            </Link>
          ))}
        </div>

        {/* Graph */}
        <div ref={paneRef} className="flex-1 relative">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodesConnectable={true}
            nodesDraggable={true}
            onInit={onInit}
            onNodeDoubleClick={onNodeDoubleClick}
            onConnect={onConnect}
            onEdgeContextMenu={onEdgeContextMenu}
            onMoveEnd={onMoveEnd}
            minZoom={0.02}
            maxZoom={3}
            defaultEdgeOptions={{ type: 'smoothstep' }}
          >
            <Background gap={20} size={1} color="#e5e7eb" />
            <Controls position="bottom-right" />
            <MiniMap
              zoomable pannable
              nodeColor={(n) => SECTION_COLORS[n.data?.section]?.border || '#d1d5db'}
              style={{ width: 160, height: 100 }}
            />
          </ReactFlow>

          {/* Edge context menu */}
          {contextMenu && (
            <div
              className="fixed z-50 bg-white border rounded-lg shadow-xl py-1 min-w-[180px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-1.5 text-xs text-gray-400 border-b">
                {contextMenu.source} → {contextMenu.target}
              </div>
              <button
                onClick={handleEdgeEditLabel}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
              >
                Редактировать подпись
              </button>
              <button
                onClick={handleEdgeDelete}
                className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                Удалить связь
              </button>
            </div>
          )}

          {/* Edge label edit modal */}
          {editingEdgeLabel && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setEditingEdgeLabel(null)}>
              <div className="bg-white rounded-xl shadow-2xl p-6 w-96" onClick={(e) => e.stopPropagation()}>
                <h3 className="font-semibold mb-3">Подпись связи</h3>
                <input
                  type="text"
                  value={editingEdgeLabel.label}
                  onChange={(e) => setEditingEdgeLabel({ ...editingEdgeLabel, label: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 mb-4"
                  placeholder="Подпись (или оставить пустым)"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleEdgeLabelSave()}
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditingEdgeLabel(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                    Отмена
                  </button>
                  <button onClick={handleEdgeLabelSave} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    Сохранить
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Help hint */}
          <div className="absolute bottom-3 left-3 bg-white/90 rounded-lg px-3 py-2 text-xs text-gray-500 shadow border">
            2x клик — редактировать &bull; Перетяните от узла к узлу — новая связь &bull; ПКМ на связи — меню
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TreeView() {
  return (
    <ReactFlowProvider>
      <TreeViewInner />
    </ReactFlowProvider>
  )
}
