'use client'

import { useState, useCallback } from 'react'
import { useMissionControl, Conversation, Agent } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { createClientLogger } from '@/lib/client-logger'
import { Button } from '@/components/ui/button'

const log = createClientLogger('ConversationList')

function timeAgo(timestamp: number): string {
  const diff = Math.floor(Date.now() / 1000) - timestamp
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

const STATUS_COLORS: Record<string, string> = {
  busy: 'bg-green-500',
  idle: 'bg-yellow-500',
  error: 'bg-red-500',
  offline: 'bg-muted-foreground/30',
}

interface ConversationListProps {
  onNewConversation: (agentName: string) => void
}

export function ConversationList({ onNewConversation }: ConversationListProps) {
  const {
    conversations,
    setConversations,
    activeConversation,
    setActiveConversation,
    agents,
    markConversationRead,
    dashboardMode,
  } = useMissionControl()
  const [showNewChat, setShowNewChat] = useState(false)
  const [search, setSearch] = useState('')

  const loadConversations = useCallback(async () => {
    try {
      const [chatRes, sessionsRes] = await Promise.all([
        fetch('/api/chat/conversations'),
        fetch('/api/sessions?include_local=1'),
      ])

      if (!chatRes.ok) return
      const chatData = await chatRes.json()
      const sessionsData = sessionsRes.ok ? await sessionsRes.json() : { sessions: [] }

      const chatConversations = (chatData.conversations || []).map((c: any) => ({
        id: c.conversation_id,
        name: c.conversation_id.startsWith('agent_')
          ? c.conversation_id.replace('agent_', '')
          : c.conversation_id,
        source: 'chat' as const,
        participants: [],
        lastMessage: c.last_message
          ? {
              id: c.last_message.id,
              conversation_id: c.last_message.conversation_id,
              from_agent: c.last_message.from_agent,
              to_agent: c.last_message.to_agent,
              content: c.last_message.content,
              message_type: c.last_message.message_type,
              metadata: c.last_message.metadata,
              read_at: c.last_message.read_at,
              created_at: c.last_message.created_at,
            }
          : undefined,
        unreadCount: c.unread_count || 0,
        updatedAt: Number(c.last_message_at || 0),
      }))

      // In local mode, surface local Claude/Codex sessions as read-only chat rows.
      const localToolSessions = (sessionsData.sessions || [])
        .filter((s: any) =>
          s?.source === 'local' &&
          (s?.kind === 'claude-code' || s?.kind === 'codex-cli')
        )
        .map((s: any) => {
          const lastActivityMs = Number(s.lastActivity || s.startTime || 0)
          const updatedAt = lastActivityMs > 1_000_000_000_000
            ? Math.floor(lastActivityMs / 1000)
            : lastActivityMs
          const kindLabel = s.kind === 'codex-cli' ? 'Codex' : 'Claude'
          const sessionName = `${kindLabel} • ${s.key || s.id}`

          return {
            id: `session:${s.kind}:${s.id}`,
            name: sessionName,
            kind: s.kind,
            source: 'session' as const,
            participants: [],
            lastMessage: {
              id: Number(`9${String(s.id).replace(/\D/g, '').slice(-12)}`) || Date.now(),
              conversation_id: `session:${s.kind}:${s.id}`,
              from_agent: 'system',
              to_agent: null,
              content: `${s.model || kindLabel} • ${s.tokens || ''}`.trim(),
              message_type: 'system' as const,
              created_at: updatedAt || Math.floor(Date.now() / 1000),
            },
            unreadCount: 0,
            updatedAt,
          }
        })

      const mergedConversations = dashboardMode === 'local'
        ? [...chatConversations, ...localToolSessions]
        : chatConversations

      setConversations(
        mergedConversations.sort((a: Conversation, b: Conversation) => b.updatedAt - a.updatedAt)
      )
    } catch (err) {
      log.error('Failed to load conversations:', err)
    }
  }, [dashboardMode, setConversations])

  useSmartPoll(loadConversations, 30000, { pauseWhenSseConnected: true })

  const handleSelect = (convId: string) => {
    setActiveConversation(convId)
    markConversationRead(convId)
  }

  const filteredConversations = conversations.filter((c) => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      c.id.toLowerCase().includes(s) ||
      (c.name || '').toLowerCase().includes(s) ||
      c.lastMessage?.from_agent.toLowerCase().includes(s) ||
      c.lastMessage?.content.toLowerCase().includes(s)
    )
  })

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="p-3 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Chats</h3>
          <Button
            onClick={() => setShowNewChat(!showNewChat)}
            variant="ghost"
            size="icon-xs"
            className="w-6 h-6"
            title="New conversation"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </Button>
        </div>
        <div className="relative">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50">
            <circle cx="7" cy="7" r="4" />
            <path d="M14 14l-3-3" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full bg-surface-1 rounded-md pl-7 pr-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* New chat agent picker */}
      {showNewChat && (
        <div className="border-b border-border p-2 bg-surface-1 max-h-48 overflow-y-auto flex-shrink-0 fade-in">
          <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1 px-1">Chat with agent</div>
          {agents.map((agent) => (
            <Button
              key={agent.id}
              onClick={() => {
                onNewConversation(agent.name)
                setShowNewChat(false)
              }}
              variant="ghost"
              size="xs"
              className="w-full justify-start px-2 py-1.5 h-auto gap-2"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[agent.status] || STATUS_COLORS.offline}`} />
              <span className="font-medium text-foreground">{agent.name}</span>
              <span className="text-muted-foreground/50 text-[10px] ml-auto truncate max-w-[60px]">{agent.role}</span>
            </Button>
          ))}
          {agents.length === 0 && (
            <div className="text-xs text-muted-foreground/50 px-1 py-2">No agents registered</div>
          )}
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground/50">
            No conversations yet
          </div>
        ) : (
          filteredConversations.map((conv) => {
            const displayName = conv.name || conv.id.replace('agent_', '')
            const isSessionRow = conv.id.startsWith('session:')
            const agentName = conv.id.replace('agent_', '')
            const agent = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase())
            const isActive = activeConversation === conv.id

            return (
              <Button
                key={conv.id}
                onClick={() => handleSelect(conv.id)}
                variant="ghost"
                className={`w-full justify-start h-auto px-3 py-2.5 rounded-none ${
                  isActive
                    ? 'bg-accent/60 border-l-2 border-primary'
                    : 'border-l-2 border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 w-full">
                  {/* Mini avatar */}
                  <div className="relative flex-shrink-0">
                    <div className="w-7 h-7 rounded-full bg-surface-2 flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                    {agent && !isSessionRow && (
                      <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${STATUS_COLORS[agent.status] || STATUS_COLORS.offline}`} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground truncate">
                        {displayName}
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-1">
                        {conv.unreadCount > 0 && (
                          <span className="bg-primary text-primary-foreground text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-medium">
                            {conv.unreadCount}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground/40">
                          {conv.updatedAt ? timeAgo(conv.updatedAt) : ''}
                        </span>
                      </div>
                    </div>
                    {conv.lastMessage && (
                      <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
                        {conv.lastMessage.from_agent === 'human'
                          ? `You: ${conv.lastMessage.content}`
                          : conv.lastMessage.content}
                      </p>
                    )}
                  </div>
                </div>
              </Button>
            )
          })
        )}
      </div>
    </div>
  )
}
