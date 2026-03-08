import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

/**
 * GET /api/sessions/transcript/gateway?key=<session-key>&limit=50
 *
 * Reads the JSONL transcript file for a gateway session directly from disk.
 * OpenClaw stores session transcripts at:
 *   {OPENCLAW_STATE_DIR}/agents/{agent}/sessions/{sessionId}.jsonl
 *
 * The session key (e.g. "agent:jarv:cron:task-name") is used to look up
 * the sessionId from the agent's sessions.json, then the JSONL file is read.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const sessionKey = searchParams.get('key') || ''
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)

  if (!sessionKey) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 })
  }

  const stateDir = config.openclawStateDir
  if (!stateDir) {
    return NextResponse.json({ messages: [], source: 'gateway', error: 'OPENCLAW_STATE_DIR not configured' })
  }

  try {
    // Extract agent name from session key (e.g. "agent:jarv:main" -> "jarv")
    const agentName = extractAgentName(sessionKey)
    if (!agentName) {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Could not determine agent from session key' })
    }

    // Look up the sessionId from the agent's sessions.json
    const sessionsFile = path.join(stateDir, 'agents', agentName, 'sessions', 'sessions.json')
    if (!existsSync(sessionsFile)) {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Agent sessions file not found' })
    }

    let sessionsData: Record<string, any>
    try {
      sessionsData = JSON.parse(readFileSync(sessionsFile, 'utf-8'))
    } catch {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Could not parse sessions.json' })
    }

    const sessionEntry = sessionsData[sessionKey]
    if (!sessionEntry?.sessionId) {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Session not found in sessions.json' })
    }

    const sessionId = sessionEntry.sessionId
    const jsonlPath = path.join(stateDir, 'agents', agentName, 'sessions', `${sessionId}.jsonl`)
    if (!existsSync(jsonlPath)) {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Session JSONL file not found' })
    }

    // Read and parse the JSONL file
    const raw = readFileSync(jsonlPath, 'utf-8')
    const messages = parseJsonlTranscript(raw, limit)

    return NextResponse.json({ messages, source: 'gateway' })
  } catch (err: any) {
    logger.warn({ err, sessionKey }, 'Gateway session transcript read failed')
    return NextResponse.json({ messages: [], source: 'gateway', error: 'Failed to read session transcript' })
  }
}

function extractAgentName(sessionKey: string): string | null {
  // Session keys follow patterns like:
  //   "agent:jarv:main"
  //   "agent:jarv:cron:task-name"
  //   "agent:jarv:telegram:direct:12345"
  const parts = sessionKey.split(':')
  if (parts.length >= 2 && parts[0] === 'agent') {
    return parts[1]
  }
  return null
}

type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: string }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system'
  parts: MessageContentPart[]
  timestamp?: string
}

/**
 * Parse OpenClaw JSONL transcript format.
 *
 * Each line is a JSON object. We care about entries with type: "message"
 * which contain { message: { role, content } } in Claude API format.
 */
function parseJsonlTranscript(raw: string, limit: number): TranscriptMessage[] {
  const lines = raw.split('\n').filter(Boolean)
  const out: TranscriptMessage[] = []

  for (const line of lines) {
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    // Only process message entries
    if (entry.type !== 'message' || !entry.message) continue

    const msg = entry.message
    const role = msg.role === 'assistant' ? 'assistant' as const
      : msg.role === 'system' ? 'system' as const
      : 'user' as const

    const parts: MessageContentPart[] = []
    const ts = typeof entry.timestamp === 'string' ? entry.timestamp
      : typeof msg.timestamp === 'string' ? msg.timestamp
      : undefined

    // String content
    if (typeof msg.content === 'string' && msg.content.trim()) {
      parts.push({ type: 'text', text: msg.content.trim().slice(0, 8000) })
    }
    // Array content blocks (Claude API format)
    else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || typeof block !== 'object') continue
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          parts.push({ type: 'text', text: block.text.trim().slice(0, 8000) })
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          parts.push({ type: 'thinking', thinking: block.thinking.slice(0, 4000) })
        } else if (block.type === 'tool_use') {
          parts.push({
            type: 'tool_use',
            id: block.id || '',
            name: block.name || 'unknown',
            input: JSON.stringify(block.input || {}).slice(0, 500),
          })
        } else if (block.type === 'tool_result') {
          const content = typeof block.content === 'string' ? block.content
            : Array.isArray(block.content) ? block.content.map((c: any) => c?.text || '').join('\n')
            : ''
          if (content.trim()) {
            parts.push({
              type: 'tool_result',
              toolUseId: block.tool_use_id || '',
              content: content.trim().slice(0, 8000),
              isError: block.is_error === true,
            })
          }
        }
      }
    }

    if (parts.length > 0) {
      out.push({ role, parts, timestamp: ts })
    }
  }

  return out.slice(-limit)
}

export const dynamic = 'force-dynamic'
