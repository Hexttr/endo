import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import {
  ReactFlow, Controls, Background, MiniMap,
  useReactFlow, ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { fetchNodes, fetchEdgesGraph, fetchSections, fetchFinals, createEdge, deleteEdge, updateEdge, batchUpdatePositions, resetLayout, createOption, updateOption, deleteOption, createNode, deleteNode } from '../api'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'

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

function layoutGraph(rawNodes, rawEdges, pinned) {
  // pinned is a Map<nodeId, {x, y}> of user-dragged positions that override dagre.
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80, edgesep: 20 })
  rawNodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  rawEdges.forEach(e => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  })
  dagre.layout(g)
  return rawNodes.map(n => {
    const p = pinned?.get(n.id)
    if (p) return { ...n, position: { x: p.x, y: p.y } }
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
  // Queue of positions waiting to be flushed to the backend (debounced).
  const pendingPositionsRef = useRef(new Map())
  const positionFlushTimerRef = useRef(null)
  const [rfReady, setRfReady] = useState(false)
  // When true, the graph pane gets the `rf-animating` class which enables a
  // short CSS transition on node `transform`. We flip it on for ~320ms around
  // explicit programmatic layout changes (reset, create node, schema reload)
  // and keep it off during drag — transitions during drag cause the node to
  // visibly lag behind the cursor.
  const [layoutAnimating, setLayoutAnimating] = useState(false)
  const layoutAnimTimerRef = useRef(null)
  const triggerLayoutAnim = useCallback(() => {
    setLayoutAnimating(true)
    if (layoutAnimTimerRef.current) clearTimeout(layoutAnimTimerRef.current)
    layoutAnimTimerRef.current = setTimeout(() => setLayoutAnimating(false), 320)
  }, [])
  // Force "fit all" on genuine page reloads (F5 / Ctrl+R). SPA navigation
  // within the admin keeps the saved viewport so returning from an editor
  // lands the user exactly where they were.
  const [isPageReload] = useState(() => {
    try {
      const entries = performance.getEntriesByType('navigation')
      const type = entries && entries[0] && entries[0].type
      const legacy = performance.navigation && performance.navigation.type === 1
      const reload = type === 'reload' || legacy
      if (reload) {
        sessionStorage.removeItem(VIEWPORT_KEY)
      }
      return reload
    } catch { return false }
  })
  // Each of these flips true once the corresponding fetch RESOLVES (even when
  // it returns an empty array). We wait for ALL three before running the
  // initial viewport logic, otherwise dagre can re-layout on a partial graph
  // and we'd centre on stale coordinates.
  const [nodesFetched, setNodesFetched] = useState(false)
  const [edgesFetched, setEdgesFetched] = useState(false)
  const [finalsFetched, setFinalsFetched] = useState(false)

  const { fitView, setCenter, getNode, setViewport } = useReactFlow()

  // Fixed zoom level for the "focus" action. Every click lands at the same
  // scale so the experience is predictable.
  const FOCUS_ZOOM = 1.2

  // Focus = ReactFlow's native setCenter. It handles animation + clamping
  // internally; we just hand it the node's centre in flow coords.
  const focusOnNode = useCallback((nodeId) => {
    if (!nodeId) return false
    const node = getNode(nodeId)
    if (!node) return false
    const w = node.measured?.width ?? node.width ?? NODE_W
    const h = node.measured?.height ?? node.height ?? NODE_H
    const cx = node.position.x + w / 2
    const cy = node.position.y + h / 2
    console.log('[TreeView/focus]', { nodeId, cx, cy, zoom: FOCUS_ZOOM })
    setCenter(cx, cy, { zoom: FOCUS_ZOOM, duration: 600 })
    return true
  }, [getNode, setCenter])

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
  const onInit = useCallback(() => {
    console.log('[TreeView] onInit fired')
    setRfReady(true)
  }, [])

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
        const isPlaceholder = opt.label?.startsWith('\u2192 ') && opt.label?.includes('(переименуйте)')
        raw.push({
          id: `opt-${n.id}-${opt.next_node_id}-${opt.option_id}`,
          source: n.id,
          target: opt.next_node_id,
          label: showLabels ? opt.label.substring(0, 25) : '',
          style: {
            stroke: isPlaceholder ? '#9ca3af' : '#c4b5fd',
            strokeWidth: 1,
            strokeDasharray: isPlaceholder ? '4 4' : undefined,
          },
          labelStyle: { fontSize: 8, fill: '#6b7280' },
          labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
          labelBgPadding: [2, 1],
          type: 'smoothstep',
          data: {
            kind: 'option',
            nodeId: n.id,
            optionDbId: opt.id,
            optionId: opt.option_id,
            label: opt.label,
            nextNodeId: opt.next_node_id,
            placeholder: isPlaceholder,
          },
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
    if (node.data?.isBounds) return
    if (node.data?.isFinal) navigate(`/finals/${node.id}`)
    else navigate(`/nodes/${node.id}`)
  }, [navigate])

  const onConnect = useCallback(async (params) => {
    // On drag-connect we do TWO things:
    //   1. Create the visualisation edge (graph structure).
    //   2. Create a placeholder Option on the source node — without this the
    //      bot will never let users reach the target.
    // Finals (green nodes) can't have outgoing options, so we skip step 2 for
    // them. Same if source doesn't exist in `filteredNodes` (e.g. a final).
    const sourceNode = filteredNodes.find(n => n.id === params.source)
    const isSourceFinal = !sourceNode // final diagnoses live in a separate list
    try {
      await createEdge({ from_node_id: params.source, to_node_id: params.target })
      if (!isSourceFinal) {
        // Generate a unique option_id by appending a numeric suffix to avoid
        // clashing with existing options.
        const existing = (sourceNode?.options || []).map(o => o.option_id)
        let suffix = existing.length + 1
        let optId = `auto_${suffix}`
        while (existing.includes(optId)) {
          suffix += 1
          optId = `auto_${suffix}`
        }
        try {
          await createOption(params.source, {
            option_id: optId,
            label: `\u2192 ${params.target} (переименуйте)`,
            next_node_id: params.target,
          })
        } catch (optErr) {
          console.warn('Failed to create placeholder option:', optErr)
        }
      }
      await loadEdges()
      // Reload nodes so the new option appears in sourceNode.options for
      // subsequent connects / counters.
      fetchNodes(selectedSection || undefined).then(setNodes).catch(() => {})
      setToast(
        isSourceFinal
          ? `Связь создана (${params.source} — диагноз, опция не добавлена)`
          : `Связь + опция созданы. Откройте узел ${params.source} чтобы переименовать кнопку`,
      )
      setTimeout(() => setToast(''), 5000)
    } catch (e) {
      setToast(`Ошибка: ${e.message}`)
      setTimeout(() => setToast(''), 4000)
    }
  }, [filteredNodes, selectedSection])

  // Drag & drop node positioning: on each drag-stop we queue the new position
  // and flush the whole queue after a short quiet period. Debounce prevents
  // one PATCH per dragged node when the user re-arranges many in a row.
  const flushPositionsNow = useCallback(async () => {
    if (pendingPositionsRef.current.size === 0) return
    const payload = Array.from(pendingPositionsRef.current.values())
    pendingPositionsRef.current.clear()
    try {
      await batchUpdatePositions(payload)
      // Refresh local `nodes` so the next dagre pass sees these as pinned.
      // (We only patch the ones we just sent — no full re-fetch needed.)
      setNodes(prev => prev.map(n => {
        const p = payload.find(q => q.id === n.id)
        if (!p) return n
        return { ...n, position_x: p.position_x, position_y: p.position_y, layout_manual: true }
      }))
    } catch (e) {
      console.warn('Failed to save positions:', e)
      setToast(`Ошибка сохранения позиций: ${e.message}`)
      setTimeout(() => setToast(''), 4000)
    }
  }, [])

  const onNodeDragStop = useCallback((_, node) => {
    // Skip the red bounds frame and any non-interactive helpers.
    if (node?.data?.isBounds) return
    if (!node?.id) return
    // Reject positions for finals — finals aren't in the nodes table.
    // (Optional: later could add position to finals too; for now regular nodes only.)
    const isRegular = !node?.data?.isFinal
    if (!isRegular) return
    // Commit the position to local state IMMEDIATELY so the next render hands
    // the same coordinates to ReactFlow. Without this, any unrelated re-render
    // (e.g. `toast` change, highlight, edge refetch) before the debounced save
    // completes would make RF re-sync from the STALE `position_x/y` props and
    // visibly snap the node back to its pre-drag spot.
    setNodes(prev => prev.map(n =>
      n.id === node.id
        ? { ...n, position_x: node.position.x, position_y: node.position.y, layout_manual: true }
        : n
    ))
    pendingPositionsRef.current.set(node.id, {
      id: node.id,
      position_x: node.position.x,
      position_y: node.position.y,
      layout_manual: true,
    })
    if (positionFlushTimerRef.current) clearTimeout(positionFlushTimerRef.current)
    positionFlushTimerRef.current = setTimeout(flushPositionsNow, 400)
  }, [flushPositionsNow])

  // Schema audit — purely front-end analysis of the currently loaded data.
  // Runs on every change so the panel updates live while the user edits.
  const audit = useMemo(() => {
    const nodeIds = new Set(nodes.map(n => n.id))
    const finalIdSet = new Set(finals.map(f => f.id))
    const valid = new Set([...nodeIds, ...finalIdSet])

    const deadEnds = []     // non-terminal nodes with no options and no edges
    const brokenRefs = []   // options / edges pointing to a non-existent target
    const reachable = new Set()

    // BFS from conventional root(s): N000 if present, else nodes with no incoming refs.
    const inbound = new Map()   // id -> count of incoming pointers
    nodes.forEach(n => inbound.set(n.id, 0))
    finals.forEach(f => inbound.set(f.id, 0))
    nodes.forEach(n => {
      let outgoing = 0
      ;(n.options || []).forEach(opt => {
        if (!opt.next_node_id) return
        outgoing += 1
        if (!valid.has(opt.next_node_id)) {
          brokenRefs.push({ from: n.id, to: opt.next_node_id, kind: 'option', label: opt.label })
        } else {
          inbound.set(opt.next_node_id, (inbound.get(opt.next_node_id) || 0) + 1)
        }
      })
      allEdges.forEach(e => {
        if (e.from_node_id === n.id) outgoing += 1
      })
      if (!n.is_terminal && !n.is_pending && outgoing === 0) {
        deadEnds.push(n.id)
      }
    })
    allEdges.forEach(e => {
      if (!valid.has(e.to_node_id)) {
        brokenRefs.push({ from: e.from_node_id, to: e.to_node_id, kind: 'edge', label: e.label })
      } else {
        inbound.set(e.to_node_id, (inbound.get(e.to_node_id) || 0) + 1)
      }
    })

    const roots = nodeIds.has('N000') ? ['N000']
      : nodes.filter(n => (inbound.get(n.id) || 0) === 0).map(n => n.id)
    const adj = new Map()
    nodes.forEach(n => {
      const targets = new Set()
      ;(n.options || []).forEach(opt => {
        if (opt.next_node_id) targets.add(opt.next_node_id)
      })
      allEdges.forEach(e => { if (e.from_node_id === n.id) targets.add(e.to_node_id) })
      adj.set(n.id, targets)
    })
    const queue = [...roots]
    roots.forEach(r => reachable.add(r))
    while (queue.length) {
      const id = queue.shift()
      const targets = adj.get(id) || new Set()
      targets.forEach(t => {
        if (!reachable.has(t)) {
          reachable.add(t)
          if (!finalIdSet.has(t)) queue.push(t)
        }
      })
    }
    const unreachableNodes = nodes.filter(n => !reachable.has(n.id) && !roots.includes(n.id)).map(n => n.id)
    const orphanFinals = finals.filter(f => !reachable.has(f.id)).map(f => f.id)

    return {
      ok: deadEnds.length === 0 && brokenRefs.length === 0 && unreachableNodes.length === 0 && orphanFinals.length === 0,
      deadEnds, brokenRefs, unreachableNodes, orphanFinals,
      totals: { nodes: nodes.length, finals: finals.length },
    }
  }, [nodes, finals, allEdges])

  const handleResetLayout = useCallback(async () => {
    if (!confirm('Сбросить ручную раскладку всех узлов? Авто-раскладка dagre вернётся.')) return
    try {
      await resetLayout()
      triggerLayoutAnim()
      setNodes(prev => prev.map(n => ({
        ...n, position_x: null, position_y: null, layout_manual: false,
      })))
      setToast('Раскладка сброшена')
      setTimeout(() => setToast(''), 3000)
    } catch (e) {
      setToast(`Ошибка: ${e.message}`)
      setTimeout(() => setToast(''), 4000)
    }
  }, [triggerLayoutAnim])

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
    setEditingEdgeLabel({ kind: 'db_edge', edgeId: contextMenu.edgeId, label: contextMenu.label })
    setContextMenu(null)
  }

  const onEdgeDoubleClick = useCallback((event, edge) => {
    event?.stopPropagation?.()
    if (edge.data?.kind === 'option') {
      setEditingEdgeLabel({
        kind: 'option',
        nodeId: edge.data.nodeId,
        optionDbId: edge.data.optionDbId,
        label: edge.data.label || '',
        nextNodeId: edge.data.nextNodeId || '',
      })
    } else if (edge.data?.kind === 'db_edge') {
      setEditingEdgeLabel({
        kind: 'db_edge',
        edgeId: edge.data.dbId,
        label: edge.data.dbLabel || '',
      })
    }
  }, [])

  const handleEdgeLabelSave = async () => {
    if (!editingEdgeLabel) return
    try {
      if (editingEdgeLabel.kind === 'option') {
        await updateOption(editingEdgeLabel.nodeId, editingEdgeLabel.optionDbId, {
          label: editingEdgeLabel.label || '',
        })
        fetchNodes(selectedSection || undefined).then(setNodes).catch(() => {})
        setToast('Текст кнопки обновлён')
      } else {
        await updateEdge(editingEdgeLabel.edgeId, { label: editingEdgeLabel.label || null })
        await loadEdges()
        setToast('Подпись обновлена')
      }
      setTimeout(() => setToast(''), 3000)
    } catch (e) {
      setToast(`Ошибка: ${e.message}`)
      setTimeout(() => setToast(''), 4000)
    }
    setEditingEdgeLabel(null)
  }

  // Keyboard-triggered deletions via ReactFlow's built-in Delete key binding.
  // Plain delete of a DB edge (blue arrow) → deleteEdge API.
  // Delete of an option edge (purple arrow) → deleteOption API, since that's
  // what actually drives the bot's navigation.
  const onEdgesDelete = useCallback(async (edgesToDelete) => {
    for (const edge of edgesToDelete) {
      if (!edge.data) continue
      try {
        if (edge.data.kind === 'option') {
          await deleteOption(edge.data.nodeId, edge.data.optionDbId)
        } else if (edge.data.kind === 'db_edge') {
          await deleteEdge(edge.data.dbId)
        }
      } catch (e) {
        console.warn('Delete edge failed:', e)
        setToast(`Ошибка: ${e.message}`)
      }
    }
    await loadEdges()
    fetchNodes(selectedSection || undefined).then(setNodes).catch(() => {})
    setToast('Удалено')
    setTimeout(() => setToast(''), 2500)
  }, [selectedSection])

  const onNodesDelete = useCallback(async (nodesToDelete) => {
    for (const node of nodesToDelete) {
      if (node.data?.isBounds || node.data?.isFinal) continue
      try {
        await deleteNode(node.id)
      } catch (e) {
        console.warn('Delete node failed:', e)
        setToast(`Ошибка: ${e.message}`)
      }
    }
    await loadEdges()
    fetchNodes(selectedSection || undefined).then(setNodes).catch(() => {})
    setToast('Узел удалён')
    setTimeout(() => setToast(''), 2500)
  }, [selectedSection])

  const handleEdgeItemDelete = async () => {
    if (!editingEdgeLabel) return
    const msg = editingEdgeLabel.kind === 'option'
      ? 'Удалить вариант ответа? Пользователи больше не смогут выбрать этот путь в боте.'
      : 'Удалить связь?'
    if (!confirm(msg)) return
    try {
      if (editingEdgeLabel.kind === 'option') {
        await deleteOption(editingEdgeLabel.nodeId, editingEdgeLabel.optionDbId)
        fetchNodes(selectedSection || undefined).then(setNodes).catch(() => {})
        setToast('Вариант удалён')
      } else {
        await deleteEdge(editingEdgeLabel.edgeId)
        await loadEdges()
        setToast('Связь удалена')
      }
      setTimeout(() => setToast(''), 3000)
    } catch (e) {
      setToast(`Ошибка: ${e.message}`)
      setTimeout(() => setToast(''), 4000)
    }
    setEditingEdgeLabel(null)
  }

  // laidOutNodes — real graph nodes (regular + finals) after dagre layout or
  // the grid fallback. graphBounds are computed off of these. The bounds frame
  // is then appended as a non-interactive pseudo-node in flowNodes.
  const laidOutNodes = useMemo(() => {
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
    // Build pinned-positions map from source data — any node that the user
    // has manually positioned takes precedence over dagre.
    const pinned = new Map()
    filteredNodes.forEach(n => {
      if (n.layout_manual && n.position_x != null && n.position_y != null) {
        pinned.set(n.id, { x: n.position_x, y: n.position_y })
      }
    })
    if (flowEdges.length === 0) {
      return raw.map((n, i) => {
        const p = pinned.get(n.id)
        if (p) return { ...n, position: { x: p.x, y: p.y } }
        return { ...n, position: { x: (i % 6) * (NODE_W + 40), y: Math.floor(i / 6) * 100 } }
      })
    }
    return layoutGraph(raw, flowEdges, pinned)
  }, [filteredNodes, finals, flowEdges, showFinals, highlightId])

  // Bounding box of the real graph in flow coords. Uses each node's actual
  // measured height (if React Flow has already observed it) and falls back to
  // NODE_H / node.style.width otherwise.
  const graphBounds = useMemo(() => {
    if (laidOutNodes.length === 0) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    laidOutNodes.forEach(n => {
      const rfn = getNode(n.id)
      const w = rfn?.measured?.width || n.style?.width || NODE_W
      const h = rfn?.measured?.height || NODE_H
      if (n.position.x < minX) minX = n.position.x
      if (n.position.y < minY) minY = n.position.y
      if (n.position.x + w > maxX) maxX = n.position.x + w
      if (n.position.y + h > maxY) maxY = n.position.y + h
    })
    if (!Number.isFinite(minX)) return null
    const pad = 60
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
  }, [laidOutNodes, getNode])

  // Pan bounds: graph box + 50% of graph size on every side. This keeps the
  // graph reachable (user can pan around freely) but prevents the infinite
  // drag-into-the-void that happens when translateExtent is undefined.
  const translateExtent = useMemo(() => {
    if (!graphBounds) return undefined
    const gw = graphBounds.maxX - graphBounds.minX
    const gh = graphBounds.maxY - graphBounds.minY
    const bx = gw * 0.5
    const by = gh * 0.5
    return [
      [graphBounds.minX - bx, graphBounds.minY - by],
      [graphBounds.maxX + bx, graphBounds.maxY + by],
    ]
  }, [graphBounds])

  // N-key creates a fresh node at a sensible default position. Users can then
  // drag it and connect it visually. Declared AFTER graphBounds to keep
  // useCallback deps out of the temporal dead zone during render.
  const handleCreateNewNode = useCallback(async () => {
    const idPrompt = window.prompt('ID нового узла (латиницей, напр. B200):')
    if (!idPrompt) return
    const textPrompt = window.prompt('Текст вопроса:') || 'Новый узел'
    let x = 0, y = 0
    if (graphBounds) {
      x = (graphBounds.minX + graphBounds.maxX) / 2
      y = (graphBounds.minY + graphBounds.maxY) / 2
    }
    try {
      await createNode({
        id: idPrompt.trim(),
        section: selectedSection || (nodes[0]?.section ?? 'overview'),
        text: textPrompt,
        input_type: 'single_choice',
        position_x: x, position_y: y, layout_manual: true,
      })
      triggerLayoutAnim()
      await fetchNodes(selectedSection || undefined).then(setNodes)
      setToast(`Создан узел ${idPrompt.trim()}. Перетащите его и свяжите с другими.`)
      setTimeout(() => setToast(''), 4000)
    } catch (e) {
      setToast(`Ошибка: ${e.message}`)
      setTimeout(() => setToast(''), 4000)
    }
  }, [graphBounds, selectedSection, nodes, triggerLayoutAnim])

  useEffect(() => {
    const handler = (e) => {
      const target = e.target
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        handleCreateNewNode()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleCreateNewNode])

  // Dynamic minimum zoom: the user cannot zoom out past "whole graph
  // visible with a small padding". The red frame plus translateExtent
  // above give the user a clear boundary.
  const [dynMinZoom, setDynMinZoom] = useState(0.02)
  useEffect(() => {
    if (!graphBounds) return
    const compute = () => {
      const pane = paneRef.current?.getBoundingClientRect()
      if (!pane || !pane.width || !pane.height) return
      const gw = graphBounds.maxX - graphBounds.minX
      const gh = graphBounds.maxY - graphBounds.minY
      if (gw <= 0 || gh <= 0) return
      // Padding = 0.1 so there's always a small margin around the graph
      // at min zoom (looks calmer than a wall-to-wall fit).
      const fit = Math.min(pane.width / gw, pane.height / gh) * 0.9
      const minZ = Math.max(0.02, Math.min(fit, 2))
      setDynMinZoom(minZ)
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [graphBounds])

  // flowNodes = real nodes + a non-interactive red frame that outlines the
  // graph bounds. The frame is intentionally drawn as a node so it follows
  // the viewport transform automatically.
  const flowNodes = useMemo(() => {
    if (!graphBounds) return laidOutNodes
    const frame = {
      id: '__graph_bounds__',
      position: { x: graphBounds.minX, y: graphBounds.minY },
      data: { isBounds: true, label: '' },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      zIndex: -1,
      style: {
        width: graphBounds.maxX - graphBounds.minX,
        height: graphBounds.maxY - graphBounds.minY,
        border: '3px solid #ef4444',
        borderRadius: 14,
        background: 'transparent',
        pointerEvents: 'none',
        boxSizing: 'border-box',
      },
    }
    return [frame, ...laidOutNodes]
  }, [laidOutNodes, graphBounds])

  // Fit-all = ReactFlow's native fitView constrained to real nodes only
  // (excluding the red bounds frame). Using the built-in API avoids the
  // timing / clamping issues the manual setViewport path kept hitting.
  const fitAllNodes = useCallback(() => {
    console.log('[TreeView/fit] called, flowNodes.length=', flowNodes.length)
    const realNodes = flowNodes.filter(n => !n.data?.isBounds).map(n => ({ id: n.id }))
    console.log('[TreeView/fit] realNodes=', realNodes.length)
    if (realNodes.length === 0) {
      console.warn('[TreeView/fit] no real nodes, aborting')
      return false
    }
    try {
      fitView({ nodes: realNodes, padding: 0.1, duration: 0, minZoom: 0.02, maxZoom: 2 })
      console.log('[TreeView/fit] fitView DONE')
    } catch (err) {
      console.error('[TreeView/fit] fitView threw', err)
    }
    return true
  }, [flowNodes, fitView])

  // Saved-viewport validator (used only for SPA nav back from an editor).
  const isSavedViewportValid = useCallback((vp) => {
    if (!vp || typeof vp.x !== 'number' || typeof vp.y !== 'number' || typeof vp.zoom !== 'number') return false
    if (!Number.isFinite(vp.x) || !Number.isFinite(vp.y) || !Number.isFinite(vp.zoom)) return false
    const lowerZoom = Math.max(0.02, dynMinZoom)
    if (vp.zoom < lowerZoom || vp.zoom > 3) return false
    if (!graphBounds) return false
    const pane = paneRef.current?.getBoundingClientRect()
    if (!pane || !pane.width || !pane.height) return false
    const centerFlowX = (pane.width / 2 - vp.x) / vp.zoom
    const centerFlowY = (pane.height / 2 - vp.y) / vp.zoom
    return (
      centerFlowX >= graphBounds.minX && centerFlowX <= graphBounds.maxX &&
      centerFlowY >= graphBounds.minY && centerFlowY <= graphBounds.maxY
    )
  }, [dynMinZoom, graphBounds])

  const doInitialCenter = useCallback(() => {
    console.log('[TreeView/init] doInitialCenter fired', {
      highlightId, isPageReload, flowNodesLen: flowNodes.length,
    })
    if (highlightId) {
      const node = getNode(highlightId)
      console.log('[TreeView/init] highlight node lookup', { highlightId, found: !!node })
      if (node) {
        focusOnNode(highlightId)
        return true
      }
      // Node not in store yet — fall through to fit
      console.warn('[TreeView/init] highlight node NOT in store, falling back to fit')
    }
    if (isPageReload) {
      return fitAllNodes()
    }
    try {
      const saved = sessionStorage.getItem(VIEWPORT_KEY)
      if (saved) {
        const vp = JSON.parse(saved)
        if (isSavedViewportValid(vp)) {
          console.log('[TreeView/init] restoring saved viewport', vp)
          setViewport(vp, { duration: 0 })
          return true
        }
        try { sessionStorage.removeItem(VIEWPORT_KEY) } catch {}
      }
    } catch {
      try { sessionStorage.removeItem(VIEWPORT_KEY) } catch {}
    }
    return fitAllNodes()
  }, [highlightId, isPageReload, flowNodes.length, getNode, focusOnNode, fitAllNodes, isSavedViewportValid, setViewport])

  // Primary init path. As soon as we have at least one real node AND the
  // pane has a non-zero rect, schedule a single-shot initial centre after
  // a short delay so ReactFlow has a chance to measure the nodes it just
  // received.
  useEffect(() => {
    if (initDone.current) return
    if (flowNodes.length <= 1) return // only the bounds frame, no real data
    const rect = paneRef.current?.getBoundingClientRect()
    console.log('[TreeView/init] scheduling init', {
      flowNodesLen: flowNodes.length,
      rect: rect ? { w: rect.width, h: rect.height } : null,
      rfReady, nodesFetched, edgesFetched, finalsFetched,
    })
    if (!rect || !rect.width || !rect.height) return

    const t = setTimeout(() => {
      if (initDone.current) return
      initDone.current = true
      doInitialCenter()
    }, 250)
    return () => clearTimeout(t)
  }, [flowNodes.length, rfReady, nodesFetched, edgesFetched, finalsFetched, doInitialCenter])

  // Safety net: if for any reason the primary path hasn't run within 3 s,
  // force a fit so the user is never stuck with a random default viewport.
  useEffect(() => {
    const t = setTimeout(() => {
      if (initDone.current) return
      console.warn('[TreeView/init] SAFETY TIMER — forcing fitAllNodes')
      initDone.current = true
      doInitialCenter()
    }, 3000)
    return () => clearTimeout(t)
  }, [doInitialCenter])

  return (
    <div className="h-screen flex flex-col overflow-hidden" onClick={() => setContextMenu(null)}>
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
        <button
          onClick={handleResetLayout}
          className="px-2 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700"
          title="Сбросить ручную раскладку и вернуть авто-layout"
        >
          Сбросить раскладку
        </button>
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

      <div className="flex-1 flex min-h-0">
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
        <div ref={paneRef} className={`flex-1 relative ${layoutAnimating ? 'rf-animating' : ''}`}>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodesConnectable={true}
            nodesDraggable={true}
            onInit={onInit}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onEdgeDoubleClick={onEdgeDoubleClick}
            onEdgeContextMenu={onEdgeContextMenu}
            onMoveEnd={onMoveEnd}
            onEdgesDelete={onEdgesDelete}
            onNodesDelete={onNodesDelete}
            deleteKeyCode={['Delete', 'Backspace']}
            minZoom={dynMinZoom}
            maxZoom={3}
            translateExtent={translateExtent}
            defaultEdgeOptions={{ type: 'smoothstep' }}
          >
            <Background gap={20} size={1} color="#e5e7eb" />
            <Controls position="bottom-right" />
            <MiniMap
              zoomable pannable
              nodeColor={(n) => n.data?.isBounds ? 'transparent' : (SECTION_COLORS[n.data?.section]?.border || '#d1d5db')}
              nodeStrokeColor={(n) => n.data?.isBounds ? 'transparent' : '#9ca3af'}
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

          {/* Edge / option label edit modal */}
          {editingEdgeLabel && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setEditingEdgeLabel(null)}>
              <div className="bg-white rounded-xl shadow-2xl p-6 w-[28rem]" onClick={(e) => e.stopPropagation()}>
                <h3 className="font-semibold mb-1">
                  {editingEdgeLabel.kind === 'option' ? 'Текст кнопки (вариант ответа в боте)' : 'Подпись связи'}
                </h3>
                {editingEdgeLabel.kind === 'option' && (
                  <p className="text-xs text-gray-500 mb-3">
                    Узел {editingEdgeLabel.nodeId} &rarr; {editingEdgeLabel.nextNodeId}. Этот текст пользователь увидит на кнопке в Telegram-боте.
                  </p>
                )}
                <input
                  type="text"
                  value={editingEdgeLabel.label}
                  onChange={(e) => setEditingEdgeLabel({ ...editingEdgeLabel, label: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 mb-4"
                  placeholder={editingEdgeLabel.kind === 'option' ? 'Например: Да / Нет / Форрест Ia' : 'Подпись (или оставить пустым)'}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleEdgeLabelSave()}
                />
                <div className="flex gap-2 justify-between">
                  <button onClick={handleEdgeItemDelete} className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg">
                    Удалить
                  </button>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingEdgeLabel(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                      Отмена
                    </button>
                    <button onClick={handleEdgeLabelSave} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                      Сохранить
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Help hint */}
          <div className="absolute bottom-3 left-3 bg-white/95 rounded-lg px-3 py-2 text-xs text-gray-600 shadow border max-w-[640px] leading-relaxed">
            <b>Клик</b> по узлу — выделить (синяя рамка) &bull;
            <b> Перетяните</b> узел — новая позиция &bull;
            Потяните от узла к узлу — новая связь + опция &bull;
            <b> 2× клик</b> по связи — редактировать &bull;
            <b> Del / Backspace</b> — удалить выделенный узел или связь &bull;
            <b> N</b> — создать узел
          </div>

          {/* Live audit panel (top-right over the graph) */}
          <AuditPanel audit={audit} />
        </div>
      </div>
    </div>
  )
}

function AuditPanel({ audit }) {
  const [open, setOpen] = useState(() => {
    // Keep the panel open if there are issues; collapse on a clean schema.
    return !audit.ok
  })
  const navigate = useNavigate()
  const focus = (id) => {
    try { sessionStorage.setItem(HIGHLIGHT_KEY, id) } catch {}
    // Force a soft refresh of the tree so the highlight effect re-runs.
    window.location.href = `/tree?highlight=${encodeURIComponent(id)}`
  }
  const issueCount = audit.deadEnds.length + audit.brokenRefs.length + audit.unreachableNodes.length + audit.orphanFinals.length
  return (
    <div className="absolute top-3 right-3 bg-white/95 rounded-lg shadow-lg border w-72 text-xs">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          {audit.ok ? (
            <CheckCircle2 size={16} className="text-green-600" />
          ) : (
            <AlertTriangle size={16} className="text-yellow-600" />
          )}
          <span className="font-semibold">
            {audit.ok
              ? `Схема целостная (${audit.totals.nodes} узлов, ${audit.totals.finals} диагнозов)`
              : `Найдено проблем: ${issueCount}`}
          </span>
        </div>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && !audit.ok && (
        <div className="p-3 space-y-3 border-t max-h-[60vh] overflow-auto">
          {audit.deadEnds.length > 0 && (
            <div>
              <div className="font-semibold text-red-700 mb-1">
                Тупики ({audit.deadEnds.length})
              </div>
              <p className="text-[10px] text-gray-500 mb-1">
                Узлы без опций и рёбер (не терминальные) — бот зависнет здесь.
              </p>
              <div className="flex flex-wrap gap-1">
                {audit.deadEnds.slice(0, 20).map(id => (
                  <button
                    key={id}
                    onClick={() => focus(id)}
                    className="font-mono bg-red-50 hover:bg-red-100 text-red-700 px-1.5 py-0.5 rounded"
                  >
                    {id}
                  </button>
                ))}
                {audit.deadEnds.length > 20 && <span className="text-gray-400">+{audit.deadEnds.length - 20}</span>}
              </div>
            </div>
          )}
          {audit.brokenRefs.length > 0 && (
            <div>
              <div className="font-semibold text-orange-700 mb-1">
                Битые ссылки ({audit.brokenRefs.length})
              </div>
              <p className="text-[10px] text-gray-500 mb-1">
                Опция/ребро указывает на несуществующий узел.
              </p>
              <ul className="space-y-1">
                {audit.brokenRefs.slice(0, 15).map((r, i) => (
                  <li key={i} className="flex items-center gap-1 flex-wrap">
                    <button onClick={() => focus(r.from)} className="font-mono text-orange-800 hover:underline">{r.from}</button>
                    <span className="text-gray-500">→</span>
                    <span className="font-mono text-red-600 line-through">{r.to}</span>
                    <span className="text-gray-400 text-[10px]">({r.kind})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {audit.unreachableNodes.length > 0 && (
            <div>
              <div className="font-semibold text-gray-700 mb-1">
                Недостижимые узлы ({audit.unreachableNodes.length})
              </div>
              <p className="text-[10px] text-gray-500 mb-1">
                Ни одна ветка от N000 не ведёт сюда.
              </p>
              <div className="flex flex-wrap gap-1">
                {audit.unreachableNodes.slice(0, 20).map(id => (
                  <button
                    key={id}
                    onClick={() => focus(id)}
                    className="font-mono bg-gray-100 hover:bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded"
                  >
                    {id}
                  </button>
                ))}
                {audit.unreachableNodes.length > 20 && <span className="text-gray-400">+{audit.unreachableNodes.length - 20}</span>}
              </div>
            </div>
          )}
          {audit.orphanFinals.length > 0 && (
            <div>
              <div className="font-semibold text-purple-700 mb-1">
                Диагнозы без пути ({audit.orphanFinals.length})
              </div>
              <p className="text-[10px] text-gray-500 mb-1">
                К этим диагнозам нельзя прийти ни через одну опцию.
              </p>
              <div className="flex flex-wrap gap-1">
                {audit.orphanFinals.slice(0, 20).map(id => (
                  <button
                    key={id}
                    onClick={() => focus(id)}
                    className="font-mono bg-purple-50 hover:bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded"
                  >
                    {id}
                  </button>
                ))}
                {audit.orphanFinals.length > 20 && <span className="text-gray-400">+{audit.orphanFinals.length - 20}</span>}
              </div>
            </div>
          )}
        </div>
      )}
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
