'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import { MemoryGraph } from './memory-graph'

const log = createClientLogger('MemoryBrowser')

interface MemoryFile {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modified?: number
  children?: MemoryFile[]
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function countFiles(files: MemoryFile[]): number {
  return files.reduce((acc, f) => {
    if (f.type === 'file') return acc + 1
    return acc + countFiles(f.children || [])
  }, 0)
}

function totalSize(files: MemoryFile[]): number {
  return files.reduce((acc, f) => {
    if (f.type === 'file' && f.size) return acc + f.size
    return acc + totalSize(f.children || [])
  }, 0)
}

// File type icon — simple text chars, no emoji
function fileIcon(name: string): string {
  if (name.endsWith('.md')) return '#'
  if (name.endsWith('.json') || name.endsWith('.jsonl')) return '{}'
  if (name.endsWith('.txt') || name.endsWith('.log')) return '|'
  return '~'
}

export function MemoryBrowserPanel() {
  const {
    memoryFiles,
    selectedMemoryFile,
    memoryContent,
    dashboardMode,
    setMemoryFiles,
    setSelectedMemoryFile,
    setMemoryContent
  } = useMissionControl()
  const isLocal = dashboardMode === 'local'

  const [isLoading, setIsLoading] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [searchResults, setSearchResults] = useState<{ path: string; name: string; matches: number }[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [activeView, setActiveView] = useState<'graph' | 'files'>(!isLocal ? 'graph' : 'files')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [fileFilter, setFileFilter] = useState<'all' | 'daily' | 'knowledge'>('all')

  const loadFileTree = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/memory?action=tree')
      const data = await response.json()
      setMemoryFiles(data.tree || [])
      setExpandedFolders(new Set(['daily', 'knowledge', 'memory', 'knowledge-base']))
    } catch (error) {
      log.error('Failed to load file tree:', error)
    } finally {
      setIsLoading(false)
    }
  }, [setMemoryFiles])

  useEffect(() => {
    loadFileTree()
  }, [loadFileTree])

  const filteredFiles = useMemo(() => {
    if (fileFilter === 'all') return memoryFiles
    const prefixes = fileFilter === 'daily'
      ? ['daily/', 'memory/']
      : ['knowledge/', 'knowledge-base/']
    return memoryFiles.filter((file) => {
      const p = `${file.path.replace(/\\/g, '/')}/`
      return prefixes.some((prefix) => p.startsWith(prefix))
    })
  }, [memoryFiles, fileFilter])

  const loadFileContent = async (filePath: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/memory?action=content&path=${encodeURIComponent(filePath)}`)
      const data = await response.json()
      if (data.content !== undefined) {
        setSelectedMemoryFile(filePath)
        setMemoryContent(data.content)
        setIsEditing(false)
        setEditedContent('')
        // Switch to files view if in graph view
        if (activeView === 'graph') setActiveView('files')
      }
    } catch (error) {
      log.error('Failed to load file content:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const searchFiles = async () => {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    try {
      const response = await fetch(`/api/memory?action=search&query=${encodeURIComponent(searchQuery)}`)
      const data = await response.json()
      setSearchResults(data.results || [])
    } catch (error) {
      log.error('Search failed:', error)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const toggleFolder = (folderPath: string) => {
    const next = new Set(expandedFolders)
    if (next.has(folderPath)) next.delete(folderPath)
    else next.add(folderPath)
    setExpandedFolders(next)
  }

  const saveFile = async () => {
    if (!selectedMemoryFile) return
    setIsSaving(true)
    try {
      const response = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', path: selectedMemoryFile, content: editedContent })
      })
      const data = await response.json()
      if (data.success) {
        setMemoryContent(editedContent)
        setIsEditing(false)
        setEditedContent('')
        loadFileTree()
      }
    } catch (error) {
      log.error('Failed to save file:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const createNewFile = async (filePath: string, content: string = '') => {
    try {
      const response = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', path: filePath, content })
      })
      const data = await response.json()
      if (data.success) {
        loadFileTree()
        loadFileContent(filePath)
      }
    } catch (error) {
      log.error('Failed to create file:', error)
    }
  }

  const deleteFile = async () => {
    if (!selectedMemoryFile) return
    try {
      const response = await fetch('/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', path: selectedMemoryFile })
      })
      const data = await response.json()
      if (data.success) {
        setSelectedMemoryFile('')
        setMemoryContent('')
        setShowDeleteConfirm(false)
        loadFileTree()
      }
    } catch (error) {
      log.error('Failed to delete file:', error)
    }
  }

  // Stats
  const fileCount = useMemo(() => countFiles(memoryFiles), [memoryFiles])
  const sizeTotal = useMemo(() => totalSize(memoryFiles), [memoryFiles])

  // --- Render file tree (Obsidian style) ---
  const renderTree = (files: MemoryFile[], depth = 0): React.ReactElement[] => {
    return files.map((file) => {
      const isDir = file.type === 'directory'
      const isExpanded = expandedFolders.has(file.path)
      const isSelected = selectedMemoryFile === file.path

      return (
        <div key={file.path}>
          <div
            className={`
              flex items-center gap-1 py-[3px] pr-2 cursor-pointer text-[13px] font-mono
              hover:bg-[hsl(var(--surface-2))] rounded-sm transition-colors duration-75
              ${isSelected ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground'}
            `}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => isDir ? toggleFolder(file.path) : loadFileContent(file.path)}
          >
            {/* Collapse indicator */}
            {isDir ? (
              <span className={`text-[10px] w-3 text-center shrink-0 transition-transform duration-100 ${isExpanded ? 'rotate-90' : ''}`}>
                &#9656;
              </span>
            ) : (
              <span className="w-3 shrink-0" />
            )}

            {/* Icon */}
            <span className={`text-[11px] w-4 text-center shrink-0 ${isDir ? 'text-muted-foreground/60' : 'text-muted-foreground/40'}`}>
              {isDir ? '/' : fileIcon(file.name)}
            </span>

            {/* Name */}
            <span className="truncate flex-1">{file.name}</span>

            {/* Size badge for files */}
            {!isDir && file.size != null && (
              <span className="text-[10px] text-muted-foreground/40 shrink-0 tabular-nums">
                {formatFileSize(file.size)}
              </span>
            )}
          </div>

          {/* Children */}
          {isDir && isExpanded && file.children && (
            <div>{renderTree(file.children, depth + 1)}</div>
          )}
        </div>
      )
    })
  }

  // --- Markdown renderer ---
  const renderMarkdown = (content: string) => {
    const lines = content.split('\n')
    const elements: React.ReactElement[] = []
    const seenHeaders = new Set<string>()

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()

      if (trimmed.startsWith('# ')) {
        const text = trimmed.slice(2)
        const id = `h1-${text.toLowerCase().replace(/\s+/g, '-')}`
        if (seenHeaders.has(id)) continue
        seenHeaders.add(id)
        elements.push(<h1 key={i} className="text-xl font-bold mt-6 mb-2 text-foreground font-mono">{text}</h1>)
      } else if (trimmed.startsWith('## ')) {
        const text = trimmed.slice(3)
        const id = `h2-${text.toLowerCase().replace(/\s+/g, '-')}`
        if (seenHeaders.has(id)) continue
        seenHeaders.add(id)
        elements.push(<h2 key={i} className="text-lg font-semibold mt-5 mb-2 text-foreground/90 font-mono">{text}</h2>)
      } else if (trimmed.startsWith('### ')) {
        const text = trimmed.slice(4)
        const id = `h3-${text.toLowerCase().replace(/\s+/g, '-')}`
        if (seenHeaders.has(id)) continue
        seenHeaders.add(id)
        elements.push(<h3 key={i} className="text-base font-semibold mt-4 mb-1.5 text-foreground/80 font-mono">{text}</h3>)
      } else if (trimmed.startsWith('- ')) {
        elements.push(
          <li key={i} className="ml-5 mb-0.5 list-disc text-foreground/80 text-sm leading-relaxed">
            {renderInline(trimmed.slice(2))}
          </li>
        )
      } else if (trimmed === '') {
        elements.push(<div key={i} className="h-2" />)
      } else if (trimmed.startsWith('```')) {
        // Collect code block
        const codeLang = trimmed.slice(3)
        const codeLines: string[] = []
        let j = i + 1
        while (j < lines.length && !lines[j].trim().startsWith('```')) {
          codeLines.push(lines[j])
          j++
        }
        elements.push(
          <pre key={i} className="bg-[hsl(var(--surface-1))] border border-border/50 rounded-md px-3 py-2 my-2 text-xs font-mono overflow-x-auto">
            {codeLang && <span className="text-muted-foreground/40 text-[10px] block mb-1">{codeLang}</span>}
            <code className="text-foreground/80">{codeLines.join('\n')}</code>
          </pre>
        )
        i = j // skip past closing ```
      } else {
        elements.push(
          <p key={i} className="mb-1.5 text-sm text-foreground/80 leading-relaxed">
            {renderInline(trimmed)}
          </p>
        )
      }
    }
    return elements
  }

  const renderInline = (text: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = []
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
    let lastIndex = 0
    let match: RegExpExecArray | null
    let key = 0
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
      const m = match[0]
      if (m.startsWith('`') && m.endsWith('`')) {
        parts.push(<code key={key++} className="bg-[hsl(var(--surface-2))] px-1 py-0.5 rounded text-[12px] font-mono text-primary/80">{m.slice(1, -1)}</code>)
      } else if (m.startsWith('**') && m.endsWith('**')) {
        parts.push(<strong key={key++} className="font-semibold text-foreground">{m.slice(2, -2)}</strong>)
      } else if (m.startsWith('*') && m.endsWith('*')) {
        parts.push(<em key={key++}>{m.slice(1, -1)}</em>)
      }
      lastIndex = pattern.lastIndex
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex))
    return parts
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top bar — Obsidian-style minimal header */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-[hsl(var(--surface-0))]">
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 rounded hover:bg-[hsl(var(--surface-2))] text-muted-foreground text-xs font-mono"
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          |||
        </button>

        <div className="w-px h-4 bg-border mx-1" />

        {/* View switches */}
        <button
          onClick={() => setActiveView('files')}
          className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${activeView === 'files' ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Files
        </button>
        {!isLocal && (
          <button
            onClick={() => setActiveView('graph')}
            className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${activeView === 'graph' ? 'bg-[hsl(var(--surface-2))] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Graph
          </button>
        )}

        <div className="flex-1" />

        {/* Stats */}
        <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums">
          {fileCount} files / {formatFileSize(sizeTotal)}
        </span>

        <div className="w-px h-4 bg-border mx-1" />

        <button
          onClick={() => setShowCreateModal(true)}
          className="px-2 py-1 rounded text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--surface-2))] transition-colors"
        >
          + new
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar — file explorer */}
        {sidebarOpen && (
          <div className="w-60 shrink-0 border-r border-border bg-[hsl(var(--surface-0))] flex flex-col">
            {/* Search */}
            <div className="p-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchFiles()}
                placeholder="Search files..."
                className="w-full px-2 py-1.5 text-xs font-mono bg-[hsl(var(--surface-1))] border border-border/50 rounded text-foreground placeholder-muted-foreground/40 focus:outline-none focus:border-primary/30"
              />
            </div>

            {/* Filter tabs */}
            <div className="flex gap-0.5 px-2 pb-2">
              {(['all', 'daily', 'knowledge'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFileFilter(f)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                    fileFilter === f
                      ? 'bg-[hsl(var(--surface-2))] text-foreground'
                      : 'text-muted-foreground/60 hover:text-muted-foreground'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Search results */}
            {searchResults.length > 0 && (
              <div className="px-2 pb-2 border-b border-border/50">
                <div className="text-[10px] text-muted-foreground/50 font-mono mb-1">
                  {searchResults.length} results
                </div>
                <div className="max-h-28 overflow-y-auto space-y-px">
                  {searchResults.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 py-1 px-1.5 rounded text-xs font-mono cursor-pointer hover:bg-[hsl(var(--surface-2))] text-muted-foreground"
                      onClick={() => {
                        loadFileContent(r.path)
                        setSearchResults([])
                      }}
                    >
                      <span className="truncate flex-1">{r.name}</span>
                      <span className="text-[10px] text-muted-foreground/40">{r.matches}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* File tree */}
            <div className="flex-1 overflow-y-auto py-1">
              {isLoading ? (
                <div className="flex items-center justify-center h-20">
                  <div className="animate-spin rounded-full h-4 w-4 border-b border-primary" />
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="text-center text-muted-foreground/40 text-xs font-mono py-8">
                  no files
                </div>
              ) : (
                renderTree(filteredFiles)
              )}
            </div>

            {/* Refresh */}
            <div className="p-2 border-t border-border/50">
              <button
                onClick={loadFileTree}
                disabled={isLoading}
                className="w-full py-1 text-[11px] font-mono text-muted-foreground/50 hover:text-muted-foreground rounded hover:bg-[hsl(var(--surface-1))] transition-colors"
              >
                refresh
              </button>
            </div>
          </div>
        )}

        {/* Main content area */}
        <div className="flex-1 min-w-0 flex flex-col bg-[hsl(var(--surface-0))]">
          {activeView === 'graph' && !isLocal ? (
            <div className="flex-1 p-4 overflow-auto">
              <MemoryGraph />
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              {/* File header bar */}
              {selectedMemoryFile && (
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-[hsl(var(--surface-0))]">
                  <span className="text-xs font-mono text-muted-foreground/60 truncate flex-1">
                    {selectedMemoryFile}
                  </span>
                  {memoryContent != null && (
                    <span className="text-[10px] font-mono text-muted-foreground/30 tabular-nums shrink-0">
                      {memoryContent.length} chars
                    </span>
                  )}
                  <div className="flex items-center gap-1 shrink-0">
                    {!isEditing ? (
                      <>
                        <button
                          onClick={() => { setIsEditing(true); setEditedContent(memoryContent ?? '') }}
                          className="px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground rounded hover:bg-[hsl(var(--surface-2))] transition-colors"
                        >
                          edit
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(true)}
                          className="px-2 py-0.5 text-[11px] font-mono text-red-400/60 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"
                        >
                          delete
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={saveFile}
                          disabled={isSaving}
                          className="px-2 py-0.5 text-[11px] font-mono text-green-400/80 hover:text-green-400 rounded hover:bg-green-500/10 transition-colors"
                        >
                          {isSaving ? 'saving...' : 'save'}
                        </button>
                        <button
                          onClick={() => { setIsEditing(false); setEditedContent('') }}
                          className="px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground rounded hover:bg-[hsl(var(--surface-2))] transition-colors"
                        >
                          cancel
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        setSelectedMemoryFile('')
                        setMemoryContent('')
                        setIsEditing(false)
                        setEditedContent('')
                      }}
                      className="px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground/40 hover:text-muted-foreground rounded hover:bg-[hsl(var(--surface-2))] transition-colors"
                    >
                      x
                    </button>
                  </div>
                </div>
              )}

              {/* Content */}
              <div className="flex-1 overflow-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="animate-spin rounded-full h-4 w-4 border-b border-primary" />
                  </div>
                ) : memoryContent != null && selectedMemoryFile ? (
                  <div className="p-6 max-w-3xl">
                    {isEditing ? (
                      <textarea
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="w-full min-h-[500px] p-3 bg-[hsl(var(--surface-1))] text-foreground font-mono text-sm border border-border/50 rounded-md resize-none focus:outline-none focus:border-primary/30 leading-relaxed"
                        placeholder="Edit file content..."
                      />
                    ) : selectedMemoryFile.endsWith('.md') ? (
                      <div>{renderMarkdown(memoryContent)}</div>
                    ) : selectedMemoryFile.endsWith('.json') ? (
                      <pre className="text-sm font-mono overflow-auto whitespace-pre-wrap break-words text-foreground/80 leading-relaxed">
                        <code>{(() => { try { return JSON.stringify(JSON.parse(memoryContent), null, 2) } catch { return memoryContent } })()}</code>
                      </pre>
                    ) : (
                      <pre className="text-sm font-mono whitespace-pre-wrap break-words text-foreground/80 leading-relaxed">
                        {memoryContent}
                      </pre>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30">
                    <span className="text-4xl font-mono mb-3">/</span>
                    <span className="text-sm font-mono">select a file to view</span>
                    <span className="text-xs font-mono mt-1 text-muted-foreground/20">
                      or switch to graph view
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create File Modal */}
      {showCreateModal && (
        <CreateFileModal
          onClose={() => setShowCreateModal(false)}
          onCreate={createNewFile}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && selectedMemoryFile && (
        <DeleteConfirmModal
          fileName={selectedMemoryFile}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={deleteFile}
        />
      )}
    </div>
  )
}

// --- Modals ---

function CreateFileModal({
  onClose,
  onCreate
}: {
  onClose: () => void
  onCreate: (path: string, content: string) => void
}) {
  const [fileName, setFileName] = useState('')
  const [filePath, setFilePath] = useState('knowledge/')
  const [initialContent, setInitialContent] = useState('')
  const [fileType, setFileType] = useState('md')

  const templates: Record<string, string> = {
    md: '# New Document\n\n',
    json: '{\n  \n}',
    txt: '',
    log: ''
  }

  const handleCreate = () => {
    if (!fileName.trim()) return
    onCreate(filePath + fileName + '.' + fileType, initialContent)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[hsl(var(--surface-1))] border border-border rounded-lg max-w-md w-full p-5 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-foreground font-mono">new file</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">x</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-mono text-muted-foreground mb-1">directory</label>
            <select
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30"
            >
              <option value="knowledge-base/">knowledge-base/</option>
              <option value="memory/">memory/</option>
              <option value="knowledge/">knowledge/</option>
              <option value="daily/">daily/</option>
              <option value="logs/">logs/</option>
              <option value="">root/</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-mono text-muted-foreground mb-1">name</label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="my-file"
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-muted-foreground mb-1">type</label>
            <select
              value={fileType}
              onChange={(e) => {
                setFileType(e.target.value)
                setInitialContent(templates[e.target.value] || '')
              }}
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30"
            >
              <option value="md">.md</option>
              <option value="json">.json</option>
              <option value="txt">.txt</option>
              <option value="log">.log</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-mono text-muted-foreground mb-1">content</label>
            <textarea
              value={initialContent}
              onChange={(e) => setInitialContent(e.target.value)}
              className="w-full h-20 px-2.5 py-1.5 text-xs font-mono bg-[hsl(var(--surface-0))] border border-border/50 rounded text-foreground focus:outline-none focus:border-primary/30 resize-none"
              placeholder="optional..."
            />
          </div>

          <div className="text-[10px] font-mono text-muted-foreground/40 bg-[hsl(var(--surface-0))] px-2 py-1 rounded">
            {filePath}{fileName || '...'}.{fileType}
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleCreate} disabled={!fileName.trim()} size="sm" className="flex-1">
              Create
            </Button>
            <Button onClick={onClose} variant="secondary" size="sm">
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DeleteConfirmModal({
  fileName,
  onClose,
  onConfirm
}: {
  fileName: string
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[hsl(var(--surface-1))] border border-border rounded-lg max-w-sm w-full p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-red-400 font-mono mb-3">delete file</h3>

        <div className="bg-red-500/5 border border-red-500/15 rounded-md p-3 mb-4">
          <p className="text-xs text-muted-foreground font-mono">permanently delete:</p>
          <p className="text-xs font-mono text-foreground mt-1 bg-[hsl(var(--surface-0))] px-2 py-1 rounded">
            {fileName}
          </p>
        </div>

        <div className="flex gap-2">
          <Button onClick={onConfirm} variant="destructive" size="sm" className="flex-1">
            Delete
          </Button>
          <Button onClick={onClose} variant="secondary" size="sm">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
