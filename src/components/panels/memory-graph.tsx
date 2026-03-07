'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import { Button } from '@/components/ui/button'

// --- Data interfaces (match API response) ---

interface AgentFileInfo {
  path: string
  chunks: number
  textSize: number
}

interface AgentGraphData {
  name: string
  dbSize: number
  totalChunks: number
  totalFiles: number
  files: AgentFileInfo[]
}

// --- Simulation node/link types ---

interface GraphNode extends SimulationNodeDatum {
  id: string
  type: 'hub' | 'file'
  label: string
  radius: number
  color: string
  // hub-specific
  agentName?: string
  totalChunks?: number
  totalFiles?: number
  dbSize?: number
  // file-specific
  filePath?: string
  chunks?: number
  textSize?: number
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  color: string
}

// --- Color palette ---

const AGENT_COLORS = [
  '#22d3ee', // cyan
  '#f59e0b', // amber
  '#a78bfa', // violet
  '#34d399', // mint
  '#f87171', // crimson
  '#60a5fa', // blue
  '#f472b6', // pink
  '#4ade80', // green
  '#facc15', // yellow
  '#c084fc', // purple
  '#fb923c', // orange
  '#2dd4bf', // teal
  '#a3e635', // lime
  '#e879f9', // fuchsia
  '#38bdf8', // sky
  '#818cf8', // indigo
  '#fbbf24', // gold
]

function getFileColor(filePath: string): string {
  if (filePath.startsWith('sessions/') || filePath.includes('/sessions/')) return '#22d3ee'
  if (filePath.startsWith('memory/') || filePath.includes('/memory/')) return '#34d399'
  if (filePath.startsWith('knowledge') || filePath.includes('/knowledge')) return '#818cf8'
  if (filePath.endsWith('.md')) return '#f59e0b'
  if (filePath.endsWith('.json') || filePath.endsWith('.jsonl')) return '#a78bfa'
  return '#60a5fa'
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// --- Component ---

export function MemoryGraph() {
  const [agents, setAgents] = useState<AgentGraphData[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFile, setSelectedFile] = useState<AgentFileInfo | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<Simulation<GraphNode, GraphLink> | null>(null)
  const nodesRef = useRef<GraphNode[]>([])
  const linksRef = useRef<GraphLink[]>([])
  const transformRef = useRef({ x: 0, y: 0, k: 1 })
  const hoveredNodeRef = useRef<GraphNode | null>(null)
  const dragNodeRef = useRef<GraphNode | null>(null)
  const isDraggingRef = useRef(false)
  const isPanningRef = useRef(false)
  const lastMouseRef = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number>(0)
  const isSimRunningRef = useRef(false)
  const tooltipRef = useRef<HTMLDivElement>(null)

  // Fetch data
  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/memory/graph?agent=all')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setAgents(data.agents || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Stats
  const stats = useMemo(() => {
    const totalAgents = agents.length
    const totalFiles = agents.reduce((s, a) => s + a.totalFiles, 0)
    const totalChunks = agents.reduce((s, a) => s + a.totalChunks, 0)
    const totalSize = agents.reduce((s, a) => s + a.dbSize, 0)
    return { totalAgents, totalFiles, totalChunks, totalSize }
  }, [agents])

  // Build simulation nodes/links from data
  const { simNodes, simLinks } = useMemo(() => {
    if (!agents.length) return { simNodes: [], simLinks: [] }

    const nodes: GraphNode[] = []
    const links: GraphLink[] = []

    if (selectedAgent === 'all') {
      // All-agents: hub nodes only, with files around each
      agents.forEach((agent, i) => {
        const color = AGENT_COLORS[i % AGENT_COLORS.length]
        const hubRadius = Math.max(16, Math.min(36, 12 + Math.sqrt(agent.totalChunks) * 1.5))

        nodes.push({
          id: `hub-${agent.name}`,
          type: 'hub',
          label: agent.name,
          radius: hubRadius,
          color,
          agentName: agent.name,
          totalChunks: agent.totalChunks,
          totalFiles: agent.totalFiles,
          dbSize: agent.dbSize,
        })

        // Add file nodes for each agent (limit for perf)
        const maxFiles = 30
        const files = agent.files.slice(0, maxFiles)
        files.forEach((file, fi) => {
          const fileRadius = Math.max(3, Math.min(10, 2 + Math.sqrt(file.chunks) * 1.2))
          const fileColor = getFileColor(file.path)
          const nodeId = `file-${agent.name}-${fi}`

          nodes.push({
            id: nodeId,
            type: 'file',
            label: file.path.split('/').pop() || file.path,
            radius: fileRadius,
            color: fileColor,
            filePath: file.path,
            chunks: file.chunks,
            textSize: file.textSize,
            agentName: agent.name,
          })

          links.push({
            source: `hub-${agent.name}`,
            target: nodeId,
            color,
          })
        })
      })
    } else {
      // Single-agent: hub at center, all files around
      const agent = agents.find((a) => a.name === selectedAgent)
      if (!agent) return { simNodes: [], simLinks: [] }

      const agentIdx = agents.indexOf(agent)
      const color = AGENT_COLORS[agentIdx % AGENT_COLORS.length]
      const hubRadius = Math.max(20, Math.min(40, 14 + Math.sqrt(agent.totalChunks) * 1.5))

      nodes.push({
        id: `hub-${agent.name}`,
        type: 'hub',
        label: agent.name,
        radius: hubRadius,
        color,
        agentName: agent.name,
        totalChunks: agent.totalChunks,
        totalFiles: agent.totalFiles,
        dbSize: agent.dbSize,
        fx: 0,
        fy: 0,
      })

      let files = agent.files
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        files = files.filter((f) => f.path.toLowerCase().includes(q))
      }

      const maxFiles = 120
      const displayFiles = files.slice(0, maxFiles)

      displayFiles.forEach((file, fi) => {
        const fileRadius = Math.max(4, Math.min(14, 3 + Math.sqrt(file.chunks) * 1.5))
        const fileColor = getFileColor(file.path)
        const nodeId = `file-${agent.name}-${fi}`

        nodes.push({
          id: nodeId,
          type: 'file',
          label: file.path.split('/').pop() || file.path,
          radius: fileRadius,
          color: fileColor,
          filePath: file.path,
          chunks: file.chunks,
          textSize: file.textSize,
          agentName: agent.name,
        })

        links.push({
          source: `hub-${agent.name}`,
          target: nodeId,
          color,
        })
      })

      // Weak inter-file links for same-directory clustering
      const dirMap = new Map<string, string[]>()
      displayFiles.forEach((file, fi) => {
        const dir = file.path.split('/').slice(0, -1).join('/')
        if (!dir) return
        const nodeId = `file-${agent.name}-${fi}`
        if (!dirMap.has(dir)) dirMap.set(dir, [])
        dirMap.get(dir)!.push(nodeId)
      })
      for (const ids of dirMap.values()) {
        for (let i = 0; i < ids.length - 1 && i < 5; i++) {
          links.push({
            source: ids[i],
            target: ids[i + 1],
            color: 'rgba(255,255,255,0.05)',
          })
        }
      }
    }

    return { simNodes: nodes, simLinks: links }
  }, [agents, selectedAgent, searchQuery])

  // --- Canvas drawing ---

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.width / dpr
    const h = canvas.height / dpr

    const { x: tx, y: ty, k } = transformRef.current
    const nodes = nodesRef.current
    const links = linksRef.current
    const hoveredNode = hoveredNodeRef.current

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.scale(dpr, dpr)

    // Dot grid background
    const gridSize = 40
    ctx.fillStyle = 'rgba(34,211,238,0.04)'
    const startX = (-tx / k) % gridSize
    const startY = (-ty / k) % gridSize
    for (let gx = -startX; gx < w; gx += gridSize / k) {
      for (let gy = -startY; gy < h; gy += gridSize / k) {
        ctx.fillRect(gx, gy, 1, 1)
      }
    }

    // Apply transform
    ctx.translate(w / 2 + tx, h / 2 + ty)
    ctx.scale(k, k)

    // Determine connected set for hover highlighting
    const connectedSet = new Set<string>()
    if (hoveredNode) {
      connectedSet.add(hoveredNode.id)
      for (const link of links) {
        const src = typeof link.source === 'object' ? link.source.id : String(link.source)
        const tgt = typeof link.target === 'object' ? link.target.id : String(link.target)
        if (src === hoveredNode.id) connectedSet.add(tgt)
        if (tgt === hoveredNode.id) connectedSet.add(src)
      }
    }

    // Draw edges
    for (const link of links) {
      const src = link.source as GraphNode
      const tgt = link.target as GraphNode
      if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) continue

      let alpha = 0.15
      if (hoveredNode) {
        const srcConnected = connectedSet.has(src.id)
        const tgtConnected = connectedSet.has(tgt.id)
        alpha = srcConnected && tgtConnected ? 0.6 : 0.04
      }

      ctx.beginPath()
      ctx.moveTo(src.x, src.y)
      ctx.lineTo(tgt.x, tgt.y)
      ctx.strokeStyle = hexToRgba(link.color.startsWith('#') ? link.color : '#ffffff', alpha)
      ctx.lineWidth = hoveredNode && connectedSet.has(src.id) && connectedSet.has(tgt.id) ? 1.5 : 0.5
      ctx.stroke()
    }

    // Draw nodes
    for (const node of nodes) {
      if (node.x == null || node.y == null) continue

      let alpha = 1.0
      let glowing = false
      if (hoveredNode) {
        if (node.id === hoveredNode.id) {
          glowing = true
        } else if (connectedSet.has(node.id)) {
          alpha = 0.9
        } else {
          alpha = 0.15
        }
      }

      // Search highlighting
      if (searchQuery && node.type === 'file') {
        const q = searchQuery.toLowerCase()
        const matches = node.label.toLowerCase().includes(q) ||
          (node.filePath != null && node.filePath.toLowerCase().includes(q))
        if (!matches) alpha = Math.min(alpha, 0.1)
        if (matches && !hoveredNode) glowing = true
      }

      const r = node.radius

      // Glow effect
      if (glowing) {
        const gradient = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, r * 3)
        gradient.addColorStop(0, hexToRgba(node.color, 0.3))
        gradient.addColorStop(1, hexToRgba(node.color, 0))
        ctx.fillStyle = gradient
        ctx.fillRect(node.x - r * 3, node.y - r * 3, r * 6, r * 6)
      }

      // Node circle
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2)

      if (node.type === 'hub') {
        ctx.fillStyle = hexToRgba(node.color, 0.15 * alpha)
        ctx.fill()
        ctx.strokeStyle = hexToRgba(node.color, 0.8 * alpha)
        ctx.lineWidth = 2
        ctx.stroke()
      } else {
        ctx.fillStyle = hexToRgba(node.color, 0.7 * alpha)
        ctx.fill()
      }

      // Labels
      const showLabels = node.type === 'hub' || k > 1.2 || glowing || node.id === hoveredNode?.id
      if (showLabels) {
        const fontSize = node.type === 'hub' ? Math.max(10, r * 0.6) : Math.max(8, 9)
        ctx.font = `${node.type === 'hub' ? 'bold ' : ''}${fontSize}px ui-monospace, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = node.type === 'hub' ? 'middle' : 'top'
        ctx.fillStyle = hexToRgba(node.color, alpha)

        if (node.type === 'hub') {
          ctx.fillText(node.label, node.x, node.y - 4)
          // Sub-label
          ctx.font = `${Math.max(7, r * 0.35)}px ui-monospace, monospace`
          ctx.fillStyle = hexToRgba('#94a3b8', 0.7 * alpha)
          ctx.fillText(`${node.totalChunks} chunks`, node.x, node.y + fontSize * 0.5)
        } else {
          ctx.fillText(node.label, node.x, node.y + r + 3)
        }
      }
    }

    ctx.restore()
  }, [searchQuery])

  // --- Simulation setup ---

  useEffect(() => {
    if (!simNodes.length) {
      nodesRef.current = []
      linksRef.current = []
      if (simRef.current) {
        simRef.current.stop()
        simRef.current = null
      }
      draw()
      return
    }

    // Copy nodes to avoid mutating memoized data
    const nodes: GraphNode[] = simNodes.map((n) => ({ ...n }))
    const links: GraphLink[] = simLinks.map((l) => ({ ...l }))

    nodesRef.current = nodes
    linksRef.current = links

    // Reset transform
    transformRef.current = { x: 0, y: 0, k: 1 }
    hoveredNodeRef.current = null

    const isAllView = selectedAgent === 'all'

    const sim = forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance((l) => {
            const src = l.source as GraphNode
            const tgt = l.target as GraphNode
            if (src.type === 'hub' || tgt.type === 'hub') {
              return isAllView ? 60 + (tgt as GraphNode).radius * 2 : 80 + (tgt as GraphNode).radius * 3
            }
            return 20 // inter-file directory links
          })
          .strength((l) => {
            const src = l.source as GraphNode
            const tgt = l.target as GraphNode
            if (src.type === 'hub' || tgt.type === 'hub') return 0.6
            return 0.05 // weak directory clustering
          })
      )
      .force(
        'charge',
        forceManyBody<GraphNode>().strength((d) => (d.type === 'hub' ? -400 : -30))
      )
      .force('center', forceCenter(0, 0).strength(0.05))
      .force(
        'collide',
        forceCollide<GraphNode>().radius((d) => d.radius + 3).strength(0.7)
      )
      .force('x', forceX<GraphNode>(0).strength(0.02))
      .force('y', forceY<GraphNode>(0).strength(0.02))
      .alphaDecay(0.012)
      .velocityDecay(0.3)

    sim.on('tick', () => {
      draw()
    })

    sim.on('end', () => {
      isSimRunningRef.current = false
    })

    isSimRunningRef.current = true
    simRef.current = sim

    return () => {
      sim.stop()
      simRef.current = null
    }
  }, [simNodes, simLinks, selectedAgent, draw])

  // --- Canvas resize ---

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = container.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      draw()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    return () => observer.disconnect()
  }, [draw])

  // --- Interaction handlers ---

  const screenToWorld = useCallback((clientX: number, clientY: number): { wx: number; wy: number } => {
    const canvas = canvasRef.current
    if (!canvas) return { wx: 0, wy: 0 }
    const rect = canvas.getBoundingClientRect()
    const { x: tx, y: ty, k } = transformRef.current
    const cx = clientX - rect.left
    const cy = clientY - rect.top
    const wx = (cx - rect.width / 2 - tx) / k
    const wy = (cy - rect.height / 2 - ty) / k
    return { wx, wy }
  }, [])

  const findNodeAt = useCallback((wx: number, wy: number): GraphNode | null => {
    const nodes = nodesRef.current
    // Search in reverse so top-drawn nodes are found first
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      if (n.x == null || n.y == null) continue
      const dx = wx - n.x
      const dy = wy - n.y
      const hitRadius = Math.max(n.radius, 8) // minimum hit target
      if (dx * dx + dy * dy <= hitRadius * hitRadius) return n
    }
    return null
  }, [])

  const updateTooltip = useCallback((node: GraphNode | null, clientX: number, clientY: number) => {
    const tip = tooltipRef.current
    if (!tip) return

    if (!node) {
      tip.style.display = 'none'
      return
    }

    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()

    // Build tooltip content safely using textContent
    tip.textContent = ''
    if (node.type === 'hub') {
      const sizeLabel = (node.dbSize || 0) > 1024 * 1024
        ? `${((node.dbSize || 0) / (1024 * 1024)).toFixed(1)}MB`
        : `${((node.dbSize || 0) / 1024).toFixed(0)}KB`
      const title = document.createElement('strong')
      title.textContent = node.agentName || ''
      tip.appendChild(title)
      tip.appendChild(document.createElement('br'))
      tip.appendChild(document.createTextNode(`${node.totalChunks} chunks / ${node.totalFiles} files`))
      tip.appendChild(document.createElement('br'))
      tip.appendChild(document.createTextNode(sizeLabel))
    } else {
      const title = document.createElement('strong')
      title.textContent = node.filePath || ''
      tip.appendChild(title)
      tip.appendChild(document.createElement('br'))
      tip.appendChild(document.createTextNode(`${node.chunks} chunks / ${formatBytes(node.textSize || 0)}`))
    }

    tip.style.display = 'block'

    // Position tooltip relative to container
    const tx = clientX - rect.left + 12
    const ty = clientY - rect.top - 10
    tip.style.left = `${Math.min(tx, rect.width - 200)}px`
    tip.style.top = `${Math.max(ty, 0)}px`
  }, [])

  // Mouse handlers
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onMouseDown = (e: MouseEvent) => {
      const { wx, wy } = screenToWorld(e.clientX, e.clientY)
      const node = findNodeAt(wx, wy)

      if (node) {
        dragNodeRef.current = node
        isDraggingRef.current = true
        node.fx = node.x
        node.fy = node.y
        if (simRef.current) {
          simRef.current.alphaTarget(0.3).restart()
          isSimRunningRef.current = true
        }
      } else {
        isPanningRef.current = true
      }
      lastMouseRef.current = { x: e.clientX, y: e.clientY }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current && dragNodeRef.current) {
        const { wx, wy } = screenToWorld(e.clientX, e.clientY)
        dragNodeRef.current.fx = wx
        dragNodeRef.current.fy = wy
        updateTooltip(dragNodeRef.current, e.clientX, e.clientY)
        return
      }

      if (isPanningRef.current) {
        const dx = e.clientX - lastMouseRef.current.x
        const dy = e.clientY - lastMouseRef.current.y
        transformRef.current.x += dx
        transformRef.current.y += dy
        lastMouseRef.current = { x: e.clientX, y: e.clientY }
        draw()
        return
      }

      // Hover detection
      const { wx, wy } = screenToWorld(e.clientX, e.clientY)
      const node = findNodeAt(wx, wy)
      const prev = hoveredNodeRef.current

      if (node !== prev) {
        hoveredNodeRef.current = node
        canvas.style.cursor = node ? 'pointer' : 'grab'
        updateTooltip(node, e.clientX, e.clientY)
        if (!isSimRunningRef.current) draw()
      } else if (node) {
        updateTooltip(node, e.clientX, e.clientY)
      }
    }

    const onMouseUp = () => {
      if (isDraggingRef.current && dragNodeRef.current) {
        // Pin where dropped
        dragNodeRef.current.fx = dragNodeRef.current.x
        dragNodeRef.current.fy = dragNodeRef.current.y
        if (simRef.current) {
          simRef.current.alphaTarget(0)
        }
        dragNodeRef.current = null
        isDraggingRef.current = false
      }
      isPanningRef.current = false
    }

    const onClick = (e: MouseEvent) => {
      if (isDraggingRef.current) return
      const { wx, wy } = screenToWorld(e.clientX, e.clientY)
      const node = findNodeAt(wx, wy)

      if (!node) return

      if (node.type === 'hub' && selectedAgent === 'all') {
        setSelectedAgent(node.agentName!)
        setSelectedFile(null)
        setSearchQuery('')
      } else if (node.type === 'file' && node.filePath) {
        const agent = agents.find((a) => a.name === node.agentName)
        const file = agent?.files.find((f) => f.path === node.filePath)
        if (file) setSelectedFile(file)
      }
    }

    const onDblClick = (e: MouseEvent) => {
      const { wx, wy } = screenToWorld(e.clientX, e.clientY)
      const node = findNodeAt(wx, wy)

      if (node) {
        // Unpin on double-click
        node.fx = null
        node.fy = null
        if (simRef.current) {
          simRef.current.alphaTarget(0.1).restart()
          isSimRunningRef.current = true
          setTimeout(() => simRef.current?.alphaTarget(0), 500)
        }
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      const t = transformRef.current
      const canvasEl = canvasRef.current!
      const rect = canvasEl.getBoundingClientRect()

      // Zoom toward cursor
      const cx = e.clientX - rect.left - rect.width / 2
      const cy = e.clientY - rect.top - rect.height / 2

      const newK = Math.max(0.1, Math.min(5, t.k * factor))
      const dk = newK / t.k

      t.x = cx - (cx - t.x) * dk
      t.y = cy - (cy - t.y) * dk
      t.k = newK

      draw()
    }

    const onMouseLeave = () => {
      hoveredNodeRef.current = null
      updateTooltip(null, 0, 0)
      isPanningRef.current = false
      if (isDraggingRef.current && dragNodeRef.current) {
        dragNodeRef.current.fx = dragNodeRef.current.x
        dragNodeRef.current.fy = dragNodeRef.current.y
        if (simRef.current) simRef.current.alphaTarget(0)
        dragNodeRef.current = null
        isDraggingRef.current = false
      }
      if (!isSimRunningRef.current) draw()
    }

    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('dblclick', onDblClick)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('mouseleave', onMouseLeave)

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('dblclick', onDblClick)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [screenToWorld, findNodeAt, updateTooltip, draw, selectedAgent, agents])

  // Cleanup raf on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // --- Render ---

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        <span className="ml-3 text-muted-foreground">Loading memory graph...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <span className="text-red-400 mb-2">Failed to load memory graph</span>
        <span className="text-sm">{error}</span>
        <Button onClick={fetchData} className="mt-4" variant="secondary" size="sm">
          Retry
        </Button>
      </div>
    )
  }

  if (!agents.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <span>No memory databases found</span>
        <span className="text-xs mt-1">OpenClaw memory SQLite files not detected</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground font-mono">AGENT:</label>
          <select
            value={selectedAgent}
            onChange={(e) => {
              setSelectedAgent(e.target.value)
              setSelectedFile(null)
              setSearchQuery('')
            }}
            className="px-2 py-1 text-sm bg-surface-1 border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="all">All Agents ({stats.totalAgents})</option>
            {agents.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name} ({a.totalChunks} chunks)
              </option>
            ))}
          </select>
        </div>

        {selectedAgent !== 'all' && (
          <>
            <Button
              onClick={() => {
                setSelectedAgent('all')
                setSelectedFile(null)
                setSearchQuery('')
              }}
              variant="secondary"
              size="sm"
            >
              Back to Overview
            </Button>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter files..."
              className="px-2 py-1 text-sm bg-surface-1 border border-border rounded-md text-foreground placeholder-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 w-48"
            />
          </>
        )}

        <span className="text-[10px] text-muted-foreground/50 font-mono ml-auto">
          drag nodes / scroll to zoom / dbl-click to unpin
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-surface-1 border border-border rounded-md px-3 py-2">
          <div className="text-lg font-bold text-foreground font-mono">{stats.totalAgents}</div>
          <div className="text-xs text-muted-foreground">Agents</div>
        </div>
        <div className="bg-surface-1 border border-border rounded-md px-3 py-2">
          <div className="text-lg font-bold text-foreground font-mono">{stats.totalFiles.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Source Files</div>
        </div>
        <div className="bg-surface-1 border border-border rounded-md px-3 py-2">
          <div className="text-lg font-bold text-foreground font-mono">{stats.totalChunks.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Total Chunks</div>
        </div>
        <div className="bg-surface-1 border border-border rounded-md px-3 py-2">
          <div className="text-lg font-bold text-foreground font-mono">{formatBytes(stats.totalSize)}</div>
          <div className="text-xs text-muted-foreground">DB Size</div>
        </div>
      </div>

      {/* Graph canvas */}
      <div
        ref={containerRef}
        className="border border-border rounded-lg overflow-hidden relative bg-[hsl(var(--surface-0))]"
        style={{ height: '500px' }}
      >
        <canvas
          ref={canvasRef}
          style={{ cursor: 'grab', display: 'block' }}
        />
        <div
          ref={tooltipRef}
          className="absolute pointer-events-none bg-surface-1 border border-border rounded-md px-2.5 py-1.5 text-xs font-mono text-foreground shadow-lg z-10"
          style={{ display: 'none', maxWidth: '280px' }}
        />
      </div>

      {/* Selected file detail */}
      {selectedFile && (
        <div className="bg-surface-1 border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-foreground font-mono">{selectedFile.path}</h3>
            <Button onClick={() => setSelectedFile(null)} variant="ghost" size="sm">
              Close
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Chunks:</span>{' '}
              <span className="text-foreground font-mono">{selectedFile.chunks}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Text Size:</span>{' '}
              <span className="text-foreground font-mono">{formatBytes(selectedFile.textSize)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
