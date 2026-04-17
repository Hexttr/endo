import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { ReactFlow, Controls, Background, MiniMap } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { fetchNodes, fetchEdges, fetchSections, fetchFinals } from '../api'

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
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target)
    }
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

export default function TreeView() {
  const [searchParams] = useSearchParams()
  const [nodes, setNodes] = useState([])
  const [finals, setFinals] = useState([])
  const [allEdges, setAllEdges] = useState([])
  const [sections, setSections] = useState([])
  const [selectedSection, setSelectedSection] = useState(searchParams.get('section') || '')
  const [search, setSearch] = useState('')
  const [showFinals, setShowFinals] = useState(true)
  const [showLabels, setShowLabels] = useState(false)

  useEffect(() => {
    fetchSections().then(setSections).catch(() => {})
    fetchEdges().then(setAllEdges).catch(() => {})
    fetchFinals().then(setFinals).catch(() => {})
  }, [])

  useEffect(() => {
    fetchNodes(selectedSection || undefined).then(setNodes).catch(() => {})
  }, [selectedSection])

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
        })
      })
    })

    allEdges.forEach(e => {
      if (!allVisible.has(e.from_node_id) || !allVisible.has(e.to_node_id)) return
      raw.push({
        id: `edge-${e.id}`,
        source: e.from_node_id,
        target: e.to_node_id,
        style: { stroke: '#6366f1', strokeWidth: 2 },
        animated: true,
        type: 'smoothstep',
      })
    })

    return deduplicateEdges(raw)
  }, [filteredNodes, allEdges, finalIds, showFinals, showLabels])

  const navigate = useNavigate()

  const onNodeDoubleClick = useCallback((event, node) => {
    if (node.data?.isFinal) {
      navigate(`/finals/${node.id}`)
    } else {
      navigate(`/nodes/${node.id}`)
    }
  }, [navigate])

  const flowNodes = useMemo(() => {
    const raw = filteredNodes.map(n => {
      const colors = SECTION_COLORS[n.section] || { bg: '#f3f4f6', border: '#d1d5db', badge: '#6b7280' }
      const shortText = n.text.length > 45 ? n.text.substring(0, 43) + '...' : n.text
      return {
        id: n.id,
        position: { x: 0, y: 0 },
        data: { label: `${n.id} ${shortText}`, section: n.section, isFinal: false },
        style: {
          background: colors.bg,
          border: `2px solid ${colors.border}`,
          borderRadius: '10px',
          padding: '6px 10px',
          fontSize: '10px',
          width: NODE_W,
          lineHeight: '1.3',
          cursor: 'pointer',
        },
      }
    })

    if (showFinals) {
      finals.forEach(f => {
        raw.push({
          id: f.id,
          position: { x: 0, y: 0 },
          data: { label: `${f.id} ${f.diagnosis || ''}`, isFinal: true },
          style: {
            background: '#dcfce7',
            border: '2px solid #22c55e',
            borderRadius: '14px',
            padding: '6px 10px',
            fontSize: '10px',
            fontWeight: '600',
            width: NODE_W,
            cursor: 'pointer',
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
  }, [filteredNodes, finals, flowEdges, showFinals])

  return (
    <div className="h-screen flex flex-col">
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
        </span>
      </div>

      <div className="flex-1 flex">
        <div className="w-72 bg-white border-r overflow-y-auto text-xs">
          {filteredNodes.map(n => (
            <Link key={n.id} to={`/nodes/${n.id}`} className="block px-3 py-2 border-b hover:bg-gray-50 transition">
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-blue-600">{n.id}</span>
                <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px]">{n.input_type}</span>
              </div>
              <p className="text-gray-600 mt-0.5 line-clamp-1">{n.text}</p>
            </Link>
          ))}
          {showFinals && finals.map(f => (
            <Link key={f.id} to={`/finals/${f.id}`} className="block px-3 py-2 border-b hover:bg-green-50 transition">
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-green-700">{f.id}</span>
                <span className="px-1.5 py-0.5 bg-green-100 text-green-800 rounded text-[10px]">final</span>
              </div>
              <p className="text-gray-600 mt-0.5 line-clamp-1">{f.diagnosis}</p>
            </Link>
          ))}
        </div>

        <div className="flex-1">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodesConnectable={false}
            nodesDraggable={true}
            onNodeDoubleClick={onNodeDoubleClick}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.02}
            maxZoom={3}
            defaultEdgeOptions={{ type: 'smoothstep' }}
          >
            <Background gap={20} size={1} color="#e5e7eb" />
            <Controls position="bottom-right" />
            <MiniMap
              zoomable
              pannable
              nodeColor={(n) => {
                const sec = n.data?.section
                return SECTION_COLORS[sec]?.border || '#d1d5db'
              }}
              style={{ width: 160, height: 100 }}
            />
          </ReactFlow>
        </div>
      </div>
    </div>
  )
}
