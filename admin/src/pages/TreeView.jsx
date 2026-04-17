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

  const { setViewport, getNode, getViewport, screenToFlowPosition } = useReactFlow()

  // Predictable zoom level for the "focus" action. Same value every time.
  const FOCUS_ZOOM = 1.5

  // Self-correcting centering. Strategy:
  //   1. Read the target node's real screen-space bounding rect from the DOM
  //      (React Flow renders each node as `.react-flow__node[data-id=X]` with
  //      all transforms already applied).
  //   2. Wait across a few animation frames until the node's height stops
  //      changing — this avoids capturing a half-rendered rect.
  //   3. Convert the stabilised centre to flow coords via screenToFlowPosition
  //      and project to setViewport(x, y, zoom) at FOCUS_ZOOM.
  //   4. ~720 ms later (after the smooth animation) re-read the node's screen
  //      rect. If its centre is more than 2 px off from the pane centre, add
  //      the delta directly to the current viewport — that delta is in screen
  //      pixels, which is exactly the unit of viewport.{x,y}. One correction
  //      is enough; we never loop, to avoid any chance of oscillation.
  //
  // All decisions are logged under the [TreeView/focus] prefix so residual
  // issues can be diagnosed from devtools without changing any code.
  const focusOnNode = useCallback((nodeId) => {
    if (!nodeId) return false
    const pane = paneRef.current
    if (!pane) return false
    const paneRect = pane.getBoundingClientRect()
    if (!paneRect.width || !paneRect.height) return false

    const selector = `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`
    const nodeEl = pane.querySelector(selector)
    if (!nodeEl) return false
    const initialRect = nodeEl.getBoundingClientRect()
    if (!initialRect.width || !initialRect.height) return false

    const MAX_STABLE_ATTEMPTS = 10
    let lastHeight = initialRect.height
    let stableFrames = 0

    const commit = (finalRect) => {
      const centerFlow = screenToFlowPosition({
        x: finalRect.left + finalRect.width / 2,
        y: finalRect.top + finalRect.height / 2,
      })
      const zoom = FOCUS_ZOOM
      const x = paneRect.width / 2 - centerFlow.x * zoom
      const y = paneRect.height / 2 - centerFlow.y * zoom

      console.log('[TreeView/focus] start', {
        nodeId,
        paneRect: { left: paneRect.left, top: paneRect.top, width: paneRect.width, height: paneRect.height },
        nodeRect: { left: finalRect.left, top: finalRect.top, width: finalRect.width, height: finalRect.height },
        centerFlow,
        viewport: { x, y, zoom },
      })

      setViewport({ x, y, zoom }, { duration: 650 })

      setTimeout(() => {
        const el = pane.querySelector(selector)
        if (!el) {
          console.warn('[TreeView/focus] verify skipped — node element no longer in DOM')
          return
        }
        const actualNr = el.getBoundingClientRect()
        const latestPane = pane.getBoundingClientRect()
        const actualCenter = {
          x: actualNr.left + actualNr.width / 2,
          y: actualNr.top + actualNr.height / 2,
        }
        const paneCenter = {
          x: latestPane.left + latestPane.width / 2,
          y: latestPane.top + latestPane.height / 2,
        }
        const dx = paneCenter.x - actualCenter.x
        const dy = paneCenter.y - actualCenter.y

        console.log('[TreeView/focus] verify', {
          nodeId,
          nodeRect: { left: actualNr.left, top: actualNr.top, width: actualNr.width, height: actualNr.height },
          paneCenter,
          delta: { dx, dy },
        })

        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          const vp = getViewport()
          const corrected = { x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }
          setViewport(corrected, { duration: 200 })
          console.log('[TreeView/focus] corrected', corrected)
        } else {
          console.log('[TreeView/focus] ok — within 2 px of pane centre')
        }
      }, 720)
    }

    const waitStable = (attempt) => {
      const cur = nodeEl.getBoundingClientRect()
      if (Math.abs(cur.height - lastHeight) < 0.5) {
        stableFrames += 1
      } else {
        stableFrames = 0
        lastHeight = cur.height
      }
      if (stableFrames >= 2 || attempt >= MAX_STABLE_ATTEMPTS) {
        if (stableFrames < 2) {
          console.warn('[TreeView/focus] height did not stabilise after', attempt, 'frames — proceeding anyway')
        }
        commit(cur)
        return
      }
      console.log('[TreeView/focus] waiting…', { attempt, height: cur.height })
      requestAnimationFrame(() => waitStable(attempt + 1))
    }

    waitStable(0)
    return true
  }, [screenToFlowPosition, setViewport, getViewport])

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
    if (node.data?.isBounds) return
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
    if (flowEdges.length === 0) {
      return raw.map((n, i) => ({
        ...n,
        position: { x: (i % 6) * (NODE_W + 40), y: Math.floor(i / 6) * 100 },
      }))
    }
    return layoutGraph(raw, flowEdges)
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

  // Pane-aware constraints: minimum zoom = "whole graph fits", and
  // translateExtent = the area that the visible pane covers at that zoom
  // (always ⊇ graphBounds, with extra "slack" in whichever axis is not the
  // limiting one). Both depend on the current pane size, so they are
  // recomputed on resize.
  //
  // Why the extent must extend beyond graphBounds: at fit zoom the viewport
  // is exactly as tall (or wide) as the graph in the limiting dimension and
  // LARGER than the graph in the other. If extent == graphBounds, ReactFlow
  // can't place the viewport correctly (visible > extent on one axis) and
  // clamps translate in a broken way — the graph drifts off-screen.
  const [dynMinZoom, setDynMinZoom] = useState(0.02)
  const [translateExtent, setTranslateExtent] = useState(undefined)
  useEffect(() => {
    if (!graphBounds) return
    const compute = () => {
      const pane = paneRef.current?.getBoundingClientRect()
      if (!pane || !pane.width || !pane.height) return
      const gw = graphBounds.maxX - graphBounds.minX
      const gh = graphBounds.maxY - graphBounds.minY
      if (gw <= 0 || gh <= 0) return
      const fit = Math.min(pane.width / gw, pane.height / gh)
      const minZ = Math.max(0.02, Math.min(fit, 3))
      setDynMinZoom(minZ)

      // Extent centred on the graph, sized to match the visible area at
      // fit zoom. That means at fit zoom the visible rect equals the
      // extent exactly (pan locked). At higher zooms the visible rect is
      // smaller and can be moved within extent — so the graph always
      // stays on screen but the user can freely pan around inside.
      const cx = (graphBounds.minX + graphBounds.maxX) / 2
      const cy = (graphBounds.minY + graphBounds.maxY) / 2
      const visW = pane.width / fit
      const visH = pane.height / fit
      const eps = 1
      setTranslateExtent([
        [cx - visW / 2 - eps, cy - visH / 2 - eps],
        [cx + visW / 2 + eps, cy + visH / 2 + eps],
      ])
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
      if (n.data?.isBounds) return
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

    // Use the exact fit zoom (pane / graph) — no padding, otherwise the
    // computed zoom would be below dynMinZoom and ReactFlow would clamp
    // it up, which shifts the graph off-screen.
    const zoomX = rect.width / graphW
    const zoomY = rect.height / graphH
    const zoom = Math.max(dynMinZoom, 0.02, Math.min(zoomX, zoomY, 1.5))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const x = rect.width / 2 - cx * zoom
    const y = rect.height / 2 - cy * zoom
    setViewport({ x, y, zoom }, { duration: 0 })
    return true
  }, [flowNodes, getNode, setViewport, dynMinZoom])

  // One-time viewport initialization. We wait for:
  //   1. The ReactFlow instance to be ready (onInit fired)
  //   2. All three fetches to have RESOLVED (nodes, edges, finals) so the
  //      graph we're measuring is the final one — otherwise dagre re-lays
  //      everything after partial data arrives and we centre on stale coords.
  //   3. flowNodes to contain at least one item.
  //   4. The pane's DOM bounding box to have real width/height (browser
  //      layout pass completed).
  //
  // We then retry focusOnNode for up to ~30 frames because the target node's
  // DOM element might not be rendered on the first frame (React Flow renders
  // nodes after layout). Each retry re-queries the DOM; once it finds the
  // rendered node, it centres and stops.
  useEffect(() => {
    if (initDone.current) return
    if (!rfReady) return
    if (!nodesFetched || !edgesFetched || !finalsFetched) return
    if (flowNodes.length === 0) return
    if (highlightId && !getNode(highlightId)) return
    const rect = paneRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return

    initDone.current = true

    let cancelled = false
    let rafId = 0

    // Validate a saved viewport: at its zoom/translate, the pane centre must
    // resolve to a flow coordinate inside the graph bounds. Anything else is
    // treated as stale (e.g. a bad viewport saved during an earlier buggy
    // build) and discarded so we fall through to fitAllNodes.
    const isSavedViewportValid = (vp) => {
      if (!vp || typeof vp.x !== 'number' || typeof vp.y !== 'number' || typeof vp.zoom !== 'number') return false
      if (!Number.isFinite(vp.x) || !Number.isFinite(vp.y) || !Number.isFinite(vp.zoom)) return false
      // Zoom must be within the ACTUAL bounds ReactFlow allows right now.
      // If dynMinZoom hasn't updated yet, fall back to the permissive default.
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
    }

    const runFallback = () => {
      // On F5/Ctrl+R the user explicitly asked for "always show the whole
      // graph". We clear any saved viewport in the initial-state factory
      // already, but double-check here.
      if (isPageReload) {
        fitAllNodes()
        return
      }
      try {
        const saved = sessionStorage.getItem(VIEWPORT_KEY)
        if (saved) {
          const vp = JSON.parse(saved)
          if (isSavedViewportValid(vp)) {
            setViewport(vp, { duration: 0 })
            return
          }
          try { sessionStorage.removeItem(VIEWPORT_KEY) } catch {}
        }
      } catch {
        try { sessionStorage.removeItem(VIEWPORT_KEY) } catch {}
      }
      fitAllNodes()
    }

    const tryFocus = (attempt) => {
      if (cancelled) return
      if (highlightId && focusOnNode(highlightId)) return
      if (attempt < 30) {
        rafId = requestAnimationFrame(() => tryFocus(attempt + 1))
        return
      }
      // DOM never produced the node — fall back.
      runFallback()
    }

    if (highlightId) {
      rafId = requestAnimationFrame(() => tryFocus(0))
    } else {
      rafId = requestAnimationFrame(() => requestAnimationFrame(runFallback))
    }

    return () => {
      cancelled = true
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [rfReady, nodesFetched, edgesFetched, finalsFetched, flowNodes.length, highlightId, focusOnNode, fitAllNodes, setViewport, getNode, graphBounds, dynMinZoom, isPageReload])

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
