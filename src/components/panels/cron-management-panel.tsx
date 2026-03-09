'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl, CronJob } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
const log = createClientLogger('CronManagement')
import { buildDayKey, getCronOccurrences } from '@/lib/cron-occurrences'

interface DayJobSummary {
  job: CronJob
  runCount: number
  firstRunMs: number
}

function describeCronFrequency(schedule: string): string {
  const parts = schedule.replace(/\s*\([^)]+\)$/, '').trim().split(/\s+/)
  if (parts.length !== 5) return schedule

  const [minute, hour, dom, mon, dow] = parts

  // Every minute
  if (minute === '*' && hour === '*') return 'every minute'
  // Every N minutes
  if (minute.startsWith('*/') && hour === '*') return `every ${minute.slice(2)}m`
  // Every hour at :MM
  if (/^\d+$/.test(minute) && hour === '*') return `hourly at :${minute.padStart(2, '0')}`
  // Every N hours
  if (/^\d+$/.test(minute) && hour.startsWith('*/')) return `every ${hour.slice(2)}h`
  // Specific hour(s) daily
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && mon === '*') {
    const h = Number(hour)
    const m = Number(minute)
    const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
    if (dow !== '*') return `${time} (select days)`
    return `daily at ${time}`
  }
  // Weekly
  if (dom === '*' && mon === '*' && dow !== '*') return 'weekly'
  // Monthly
  if (dom !== '*' && mon === '*' && dow === '*') return 'monthly'

  return schedule
}

const AGENT_COLORS = [
  'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'bg-rose-500/20 text-rose-300 border-rose-500/30',
  'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
]

function getAgentColorClass(agentId: string, allAgents: string[]): string {
  const idx = allAgents.indexOf(agentId)
  return AGENT_COLORS[idx >= 0 ? idx % AGENT_COLORS.length : 0]
}

interface NewJobForm {
  name: string
  schedule: string
  command: string
  description: string
  model: string
}

type CalendarViewMode = 'agenda' | 'day' | 'week' | 'month'

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function getWeekStart(date: Date): Date {
  const day = date.getDay()
  const diffToMonday = (day + 6) % 7
  return addDays(startOfDay(date), -diffToMonday)
}

function getMonthStartGrid(date: Date): Date {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1)
  const day = firstOfMonth.getDay()
  return addDays(firstOfMonth, -day)
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function CronManagementPanel() {
  const { cronJobs, setCronJobs, dashboardMode } = useMissionControl()
  const isLocalMode = dashboardMode === 'local'
  const [isLoading, setIsLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null)
  const [jobLogs, setJobLogs] = useState<any[]>([])
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('week')
  const [calendarDate, setCalendarDate] = useState<Date>(startOfDay(new Date()))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date>(startOfDay(new Date()))
  const [searchQuery, setSearchQuery] = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [newJob, setNewJob] = useState<NewJobForm>({
    name: '',
    schedule: '0 * * * *', // Every hour
    command: '',
    description: '',
    model: ''
  })

  const formatRelativeTime = (timestamp: string | number, future = false) => {
    const now = new Date().getTime()
    const time = new Date(timestamp).getTime()
    const diff = future ? time - now : now - time
    
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`
    return future ? 'soon' : 'just now'
  }

  const loadCronJobs = useCallback(async () => {
    setIsLoading(true)
    try {
      const cronResponse = await fetch('/api/cron?action=list')
      const cronData = await cronResponse.json()
      const cronList = Array.isArray(cronData.jobs) ? cronData.jobs : []

      if (!isLocalMode) {
        setCronJobs(cronList)
        return
      }

      const schedulerResponse = await fetch('/api/scheduler')
      const schedulerData = await schedulerResponse.json()
      const schedulerTasks = Array.isArray(schedulerData.tasks) ? schedulerData.tasks : []
      const mappedSchedulerJobs: CronJob[] = schedulerTasks.map((task: any) => ({
        id: task.id,
        name: task.name || task.id || 'scheduler-task',
        schedule: 'system-managed automation',
        command: `Built-in local automation (${task.id || 'unknown'})`,
        agentId: 'mission-control-local',
        delivery: 'local',
        enabled: task.running ? true : !!task.enabled,
        lastRun: typeof task.lastRun === 'number' ? task.lastRun : undefined,
        nextRun: typeof task.nextRun === 'number' ? task.nextRun : undefined,
        lastStatus: task.running
          ? 'running'
          : (task.lastResult?.ok === false ? 'error' : (task.lastResult?.ok === true ? 'success' : undefined)),
      }))

      setCronJobs([...cronList, ...mappedSchedulerJobs])
    } catch (error) {
      log.error('Failed to load cron jobs:', error)
    } finally {
      setIsLoading(false)
    }
  }, [isLocalMode, setCronJobs])

  useEffect(() => {
    loadCronJobs()
  }, [loadCronJobs])

  useEffect(() => {
    const loadAvailableModels = async () => {
      try {
        const response = await fetch('/api/status?action=models')
        if (!response.ok) return
        const data = await response.json()
        const models = Array.isArray(data.models) ? data.models : []
        const names = models
          .map((model: any) => String(model.name || model.alias || '').trim())
          .filter(Boolean)
        setAvailableModels(Array.from(new Set<string>(names)))
      } catch {
        // Keep cron form usable even when model discovery is unavailable.
      }
    }
    loadAvailableModels()
  }, [])

  const loadJobLogs = async (job: CronJob) => {
    const isLocalAutomation = (job.delivery === 'local' && job.agentId === 'mission-control-local')
    if (isLocalAutomation) {
      const logs: Array<{ timestamp: number; message: string; level: string }> = []
      if (job.lastRun) {
        logs.push({
          timestamp: job.lastRun,
          message: `Last run recorded for ${job.name}`,
          level: job.lastStatus === 'error' ? 'error' : 'info',
        })
      }
      if (job.lastError) {
        logs.push({
          timestamp: job.lastRun || Date.now(),
          message: `Error: ${job.lastError}`,
          level: 'error',
        })
      }
      if (job.nextRun) {
        logs.push({
          timestamp: Date.now(),
          message: `Next scheduled run: ${new Date(job.nextRun).toLocaleString()}`,
          level: 'info',
        })
      }
      if (logs.length === 0) {
        logs.push({
          timestamp: Date.now(),
          message: 'No scheduler telemetry available yet for this local automation task',
          level: 'info',
        })
      }
      setJobLogs(logs)
      return
    }

    try {
      const response = await fetch(`/api/cron?action=logs&job=${encodeURIComponent(job.name)}`)
      const data = await response.json()
      setJobLogs(data.logs || [])
    } catch (error) {
      log.error('Failed to load job logs:', error)
      setJobLogs([])
    }
  }

  const toggleJob = async (job: CronJob) => {
    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle',
          jobName: job.name,
          enabled: !job.enabled
        })
      })

      if (response.ok) {
        await loadCronJobs() // Reload to get updated status
      } else {
        const error = await response.json()
        alert(`Failed to toggle job: ${error.error}`)
      }
    } catch (error) {
      log.error('Failed to toggle job:', error)
      alert('Network error occurred')
    }
  }

  const triggerJob = async (job: CronJob) => {
    const isLocalAutomation = (job.delivery === 'local' && job.agentId === 'mission-control-local')
    try {
      if (isLocalAutomation) {
        const response = await fetch('/api/scheduler', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: job.id }),
        })
        const result = await response.json()
        if (response.ok && result.ok) {
          alert(`Local automation executed: ${result.message}`)
        } else {
          alert(`Local automation failed: ${result.error || result.message || 'Unknown error'}`)
        }
        await loadCronJobs()
        return
      }

      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'trigger',
          jobId: job.id,
          jobName: job.name,
        })
      })

      const result = await response.json()
      
      if (result.success) {
        alert(`Job executed successfully:\n${result.stdout}`)
      } else {
        alert(`Job failed:\n${result.error}\n${result.stderr}`)
      }
    } catch (error) {
      log.error('Failed to trigger job:', error)
      alert('Network error occurred')
    }
  }

  const addJob = async () => {
    if (!newJob.name || !newJob.schedule || !newJob.command) {
      alert('Please fill in all required fields')
      return
    }

    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          jobName: newJob.name,
          schedule: newJob.schedule,
          command: newJob.command,
          ...(newJob.model.trim() ? { model: newJob.model.trim() } : {})
        })
      })

      if (response.ok) {
        setNewJob({
          name: '',
          schedule: '0 * * * *',
          command: '',
          description: '',
          model: ''
        })
        setShowAddForm(false)
        await loadCronJobs()
      } else {
        const error = await response.json()
        alert(`Failed to add job: ${error.error}`)
      }
    } catch (error) {
      log.error('Failed to add job:', error)
      alert('Network error occurred')
    }
  }

  const removeJob = async (job: CronJob) => {
    if (!confirm(`Are you sure you want to remove the job "${job.name}"?`)) {
      return
    }

    try {
      const response = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove',
          jobName: job.name
        })
      })

      if (response.ok) {
        await loadCronJobs()
        if (selectedJob?.name === job.name) {
          setSelectedJob(null)
        }
      } else {
        const error = await response.json()
        alert(`Failed to remove job: ${error.error}`)
      }
    } catch (error) {
      log.error('Failed to remove job:', error)
      alert('Network error occurred')
    }
  }

  const handleJobSelect = (job: CronJob) => {
    setSelectedJob(job)
    loadJobLogs(job)
  }

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'success': return 'text-green-400'
      case 'error': return 'text-red-400'
      case 'running': return 'text-blue-400'
      default: return 'text-muted-foreground'
    }
  }

  const getStatusBg = (status?: string) => {
    switch (status) {
      case 'success': return 'bg-green-500/20'
      case 'error': return 'bg-red-500/20'
      case 'running': return 'bg-blue-500/20'
      default: return 'bg-gray-500/20'
    }
  }

  const predefinedSchedules = [
    { label: 'Every minute', value: '* * * * *' },
    { label: 'Every 5 minutes', value: '*/5 * * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Daily at midnight', value: '0 0 * * *' },
    { label: 'Daily at 6 AM', value: '0 6 * * *' },
    { label: 'Weekly (Sunday)', value: '0 0 * * 0' },
    { label: 'Monthly (1st)', value: '0 0 1 * *' },
  ]

  const uniqueAgents = Array.from(
    new Set(
      cronJobs
        .map((job) => (job.agentId || '').trim())
        .filter(Boolean)
    )
  )

  const filteredJobs = cronJobs.filter((job) => {
    const query = searchQuery.trim().toLowerCase()
    const matchesQuery =
      !query ||
      job.name.toLowerCase().includes(query) ||
      job.command.toLowerCase().includes(query) ||
      (job.agentId || '').toLowerCase().includes(query) ||
      (job.model || '').toLowerCase().includes(query)

    const matchesAgent = agentFilter === 'all' || (job.agentId || '') === agentFilter
    const matchesState =
      stateFilter === 'all' ||
      (stateFilter === 'enabled' && job.enabled) ||
      (stateFilter === 'disabled' && !job.enabled)

    return matchesQuery && matchesAgent && matchesState
  })

  const dayStart = startOfDay(calendarDate)
  const dayEnd = addDays(dayStart, 1)

  const weekStart = getWeekStart(calendarDate)
  const weekDays = Array.from({ length: 7 }, (_, idx) => addDays(weekStart, idx))

  const monthGridStart = getMonthStartGrid(calendarDate)
  const monthDays = Array.from({ length: 42 }, (_, idx) => addDays(monthGridStart, idx))

  const calendarBounds = useMemo(() => {
    if (calendarView === 'day') {
      return { startMs: dayStart.getTime(), endMs: dayEnd.getTime() }
    }
    if (calendarView === 'week') {
      return { startMs: weekStart.getTime(), endMs: addDays(weekStart, 7).getTime() }
    }
    if (calendarView === 'month') {
      return { startMs: monthGridStart.getTime(), endMs: addDays(monthGridStart, 42).getTime() }
    }
    const agendaStart = Date.now()
    return { startMs: agendaStart, endMs: addDays(startOfDay(new Date()), 30).getTime() }
  }, [calendarView, dayEnd, dayStart, monthGridStart, weekStart])

  // Aggregate: unique jobs per day with run count (for week/month cells)
  const jobSummariesByDay = useMemo(() => {
    const dayMap = new Map<string, DayJobSummary[]>()
    for (const job of filteredJobs) {
      const occurrences = getCronOccurrences(job.schedule, calendarBounds.startMs, calendarBounds.endMs, 5000)

      // Fallback for unparseable schedules
      if (occurrences.length === 0 && typeof job.nextRun === 'number' && job.nextRun >= calendarBounds.startMs && job.nextRun < calendarBounds.endMs) {
        occurrences.push({ atMs: job.nextRun, dayKey: buildDayKey(new Date(job.nextRun)) })
      }

      // Group occurrences by day for this job
      const perDay = new Map<string, { count: number; firstMs: number }>()
      for (const occ of occurrences) {
        const existing = perDay.get(occ.dayKey)
        if (existing) {
          existing.count++
          if (occ.atMs < existing.firstMs) existing.firstMs = occ.atMs
        } else {
          perDay.set(occ.dayKey, { count: 1, firstMs: occ.atMs })
        }
      }

      for (const [dayKey, { count, firstMs }] of perDay) {
        const existing = dayMap.get(dayKey) || []
        existing.push({ job, runCount: count, firstRunMs: firstMs })
        dayMap.set(dayKey, existing)
      }
    }

    // Sort each day's jobs by first run time
    for (const [, summaries] of dayMap) {
      summaries.sort((a, b) => a.firstRunMs - b.firstRunMs)
    }
    return dayMap
  }, [calendarBounds.endMs, calendarBounds.startMs, filteredJobs])

  // Flat occurrence list for agenda view only (capped per job)
  const calendarOccurrences = useMemo(() => {
    if (calendarView !== 'agenda') return []
    const rows: Array<{ job: CronJob; atMs: number; dayKey: string }> = []
    for (const job of filteredJobs) {
      const occurrences = getCronOccurrences(job.schedule, calendarBounds.startMs, calendarBounds.endMs, 50)
      for (const occurrence of occurrences) {
        rows.push({ job, atMs: occurrence.atMs, dayKey: occurrence.dayKey })
      }
      if (occurrences.length === 0 && typeof job.nextRun === 'number' && job.nextRun >= calendarBounds.startMs && job.nextRun < calendarBounds.endMs) {
        rows.push({ job, atMs: job.nextRun, dayKey: buildDayKey(new Date(job.nextRun)) })
      }
    }
    rows.sort((a, b) => a.atMs - b.atMs)
    return rows.slice(0, 500)
  }, [calendarBounds.endMs, calendarBounds.startMs, calendarView, filteredJobs])

  const dayJobSummaries = jobSummariesByDay.get(buildDayKey(dayStart)) || []

  const jobsByWeekDay = weekDays.map((date) => ({
    date,
    jobs: jobSummariesByDay.get(buildDayKey(date)) || [],
  }))

  const jobsByMonthDay = monthDays.map((date) => ({
    date,
    jobs: jobSummariesByDay.get(buildDayKey(date)) || [],
  }))

  const selectedDayJobs = jobSummariesByDay.get(buildDayKey(selectedCalendarDate)) || []

  const moveCalendar = (direction: -1 | 1) => {
    setCalendarDate((prev) => {
      if (calendarView === 'day') return addDays(prev, direction)
      if (calendarView === 'week') return addDays(prev, direction * 7)
      if (calendarView === 'month') return new Date(prev.getFullYear(), prev.getMonth() + direction, 1)
      return addDays(prev, direction * 7)
    })
  }

  const calendarRangeLabel =
    calendarView === 'day'
      ? calendarDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
      : calendarView === 'week'
        ? `${formatDateLabel(weekDays[0])} - ${formatDateLabel(weekDays[6])}`
        : calendarDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="p-6 space-y-6">
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Cron Management</h1>
            <p className="text-muted-foreground mt-2">
              Manage automated tasks and scheduled jobs
            </p>
          </div>
          <div className="flex space-x-2">
            <Button
              onClick={loadCronJobs}
              disabled={isLoading}
              className="bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
            >
              {isLoading ? 'Loading...' : 'Refresh'}
            </Button>
            <Button
              onClick={() => setShowAddForm(true)}
            >
              Add Job
            </Button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Calendar View - Phase A (read-only) */}
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Calendar View</h2>
                <p className="text-sm text-muted-foreground">
                  {isLocalMode
                    ? 'Read-only schedule visibility across local cron jobs and automations'
                    : 'Interactive schedule across all matching cron jobs'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => moveCalendar(-1)}
                  variant="outline"
                  size="sm"
                >
                  Prev
                </Button>
                <Button
                  onClick={() => setCalendarDate(startOfDay(new Date()))}
                  variant="outline"
                  size="sm"
                >
                  Today
                </Button>
                <Button
                  onClick={() => moveCalendar(1)}
                  variant="outline"
                  size="sm"
                >
                  Next
                </Button>
                <div className="text-sm font-medium text-foreground ml-1">{calendarRangeLabel}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(['agenda', 'day', 'week', 'month'] as CalendarViewMode[]).map((mode) => (
                <Button
                  key={mode}
                  onClick={() => setCalendarView(mode)}
                  variant={calendarView === mode ? 'default' : 'outline'}
                  size="sm"
                >
                  {mode === 'agenda' ? 'Agenda' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                </Button>
              ))}
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search jobs, agents, models..."
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
              />
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
              >
                <option value="all">All Agents</option>
                {uniqueAgents.map((agentId) => (
                  <option key={agentId} value={agentId}>
                    {agentId}
                  </option>
                ))}
              </select>
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value as 'all' | 'enabled' | 'disabled')}
                className="px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
              >
                <option value="all">All States</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>

            {calendarView === 'agenda' && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-80 overflow-y-auto divide-y divide-border">
                  {calendarOccurrences.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">No jobs match the current filters.</div>
                  ) : (
                    calendarOccurrences.map((row) => (
                      <Button
                        key={`agenda-${row.job.id || row.job.name}-${row.atMs}`}
                        onClick={() => handleJobSelect(row.job)}
                        variant="ghost"
                        className="w-full p-3 h-auto text-left flex flex-col md:flex-row md:items-center md:justify-between gap-2"
                      >
                        <div>
                          <div className="font-medium text-foreground">{row.job.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.job.agentId || 'system'} · {row.job.enabled ? 'enabled' : 'disabled'} · {row.job.schedule}
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(row.atMs).toLocaleString()}
                        </div>
                      </Button>
                    ))
                  )}
                </div>
              </div>
            )}

            {calendarView === 'day' && (
              <div className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">{dayJobSummaries.length} unique jobs</span>
                </div>
                {dayJobSummaries.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No scheduled jobs for this day.</div>
                ) : (
                  <div className="space-y-1.5 max-h-96 overflow-y-auto">
                    {dayJobSummaries.map((row) => (
                      <Button
                        key={`day-${row.job.id || row.job.name}`}
                        onClick={() => handleJobSelect(row.job)}
                        variant="outline"
                        className={`w-full p-2 h-auto text-left flex items-center justify-between gap-2 border ${getAgentColorClass(row.job.agentId || '', uniqueAgents)}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground truncate">{row.job.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.job.agentId || 'system'} · {describeCronFrequency(row.job.schedule)}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                          {row.runCount > 1 ? `${row.runCount} runs` : new Date(row.firstRunMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {calendarView === 'week' && (
              <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                {jobsByWeekDay.map(({ date, jobs }) => {
                  const totalRuns = jobs.reduce((sum, j) => sum + j.runCount, 0)
                  return (
                    <div
                      key={`week-${date.toISOString()}`}
                      onClick={() => setSelectedCalendarDate(startOfDay(date))}
                      className={`rounded-lg border p-2 min-h-36 cursor-pointer flex flex-col ${isSameDay(date, selectedCalendarDate) ? 'bg-primary/10 border-primary/40' : 'border-border hover:bg-secondary/50'}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-medium ${isSameDay(date, new Date()) ? 'text-primary' : 'text-muted-foreground'}`}>
                          {date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                        </span>
                        {jobs.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">{jobs.length} jobs</span>
                        )}
                      </div>
                      <div className="space-y-1 flex-1 overflow-hidden">
                        {jobs.slice(0, 5).map((row) => (
                          <div
                            key={`week-job-${row.job.id || row.job.name}`}
                            className={`text-[11px] px-1.5 py-0.5 rounded border truncate ${getAgentColorClass(row.job.agentId || '', uniqueAgents)}`}
                            title={`${row.job.name} — ${row.runCount} run${row.runCount > 1 ? 's' : ''}`}
                          >
                            {row.job.name}
                          </div>
                        ))}
                        {jobs.length > 5 && (
                          <div className="text-[10px] text-muted-foreground">+{jobs.length - 5} more</div>
                        )}
                      </div>
                      {totalRuns > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-1 pt-1 border-t border-border/50">
                          {totalRuns.toLocaleString()} total runs
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {calendarView === 'month' && (
              <div className="grid grid-cols-7 gap-2">
                {jobsByMonthDay.map(({ date, jobs }) => {
                  const inCurrentMonth = date.getMonth() === calendarDate.getMonth()
                  const totalRuns = jobs.reduce((sum, j) => sum + j.runCount, 0)
                  return (
                    <div
                      key={`month-${date.toISOString()}`}
                      onClick={() => setSelectedCalendarDate(startOfDay(date))}
                      className={`border border-border rounded-lg p-2 min-h-24 cursor-pointer ${inCurrentMonth ? 'bg-transparent' : 'bg-secondary/30'} ${isSameDay(date, selectedCalendarDate) ? 'border-primary/40 bg-primary/10' : 'hover:bg-secondary/50'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-xs ${isSameDay(date, new Date()) ? 'text-primary font-semibold' : inCurrentMonth ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {date.getDate()}
                        </span>
                        {jobs.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">{jobs.length}</span>
                        )}
                      </div>
                      <div className="space-y-0.5 mt-1">
                        {jobs.slice(0, 3).map((row) => (
                          <div
                            key={`month-job-${row.job.id || row.job.name}`}
                            className={`text-[10px] px-1 py-0.5 rounded border truncate ${getAgentColorClass(row.job.agentId || '', uniqueAgents)}`}
                            title={`${row.job.name} — ${row.runCount} runs`}
                          >
                            {row.job.name}
                          </div>
                        ))}
                        {jobs.length > 3 && <div className="text-[10px] text-muted-foreground">+{jobs.length - 3}</div>}
                      </div>
                      {totalRuns > 0 && jobs.length > 0 && (
                        <div className="text-[9px] text-muted-foreground mt-0.5">{totalRuns.toLocaleString()} runs</div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {calendarView !== 'agenda' && (
              <div className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-foreground">
                    {selectedCalendarDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{selectedDayJobs.length} jobs</span>
                    {selectedDayJobs.length > 0 && (
                      <span className="text-xs text-muted-foreground">· {selectedDayJobs.reduce((s, r) => s + r.runCount, 0).toLocaleString()} total runs</span>
                    )}
                  </div>
                </div>
                {selectedDayJobs.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No jobs scheduled on this date.</div>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {selectedDayJobs.map((row) => (
                      <Button
                        key={`selected-day-${row.job.id || row.job.name}`}
                        onClick={() => handleJobSelect(row.job)}
                        variant="outline"
                        className={`w-full text-left p-2 h-auto flex items-center justify-between gap-2 border ${getAgentColorClass(row.job.agentId || '', uniqueAgents)}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground truncate">{row.job.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.job.agentId || 'system'} · {describeCronFrequency(row.job.schedule)}
                          </div>
                        </div>
                        <div className="text-right whitespace-nowrap">
                          <div className="text-xs text-foreground">{row.runCount} run{row.runCount > 1 ? 's' : ''}</div>
                          <div className="text-[10px] text-muted-foreground">
                            first {new Date(row.firstRunMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Job List — compact table */}
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Scheduled Jobs</h2>
            <span className="text-xs text-muted-foreground">{filteredJobs.length} of {cronJobs.length} jobs</span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader variant="inline" label="Loading jobs" />
            </div>
          ) : cronJobs.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No cron jobs found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Job Name</th>
                    <th className="pb-2 pr-3 font-medium">Agent</th>
                    <th className="pb-2 pr-3 font-medium">Schedule</th>
                    <th className="pb-2 pr-3 font-medium">Model</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 pr-3 font-medium">Last Run</th>
                    <th className="pb-2 pr-3 font-medium">Next Run</th>
                    <th className="pb-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filteredJobs.map((job, index) => {
                    const isLocalAutomation = job.delivery === 'local' && job.agentId === 'mission-control-local'
                    const isSelected = selectedJob?.name === job.name
                    return (
                      <tr
                        key={`${job.name}-${index}`}
                        onClick={() => handleJobSelect(job)}
                        className={`cursor-pointer transition-colors ${isSelected ? 'bg-primary/10' : 'hover:bg-secondary/50'}`}
                      >
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${job.enabled ? 'bg-green-500' : 'bg-gray-500'}`} />
                            <span className="font-medium text-foreground truncate max-w-48">{job.name}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${getAgentColorClass(job.agentId || '', uniqueAgents)}`}>
                            {job.agentId || 'system'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="text-xs">
                            <span className="text-foreground">{describeCronFrequency(job.schedule)}</span>
                            <div className="text-muted-foreground font-mono text-[10px]">{job.schedule}</div>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          {job.model ? (
                            <span className="text-xs font-mono text-muted-foreground">{job.model}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">--</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          {job.lastStatus ? (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusBg(job.lastStatus)} ${getStatusColor(job.lastStatus)}`}>
                              {job.lastStatus}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">--</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                          {job.lastRun ? formatRelativeTime(job.lastRun) : '--'}
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-primary/70 whitespace-nowrap">
                          {job.nextRun ? formatRelativeTime(job.nextRun, true) : '--'}
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              onClick={(e) => { e.stopPropagation(); toggleJob(job) }}
                              disabled={isLocalAutomation}
                              size="xs"
                              variant="outline"
                              className="text-[10px] h-6 px-1.5"
                            >
                              {job.enabled ? 'Disable' : 'Enable'}
                            </Button>
                            <Button
                              onClick={(e) => { e.stopPropagation(); triggerJob(job) }}
                              size="xs"
                              variant="outline"
                              className="text-[10px] h-6 px-1.5"
                            >
                              Run
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Job Detail Panel — expanded when a job is selected */}
        {selectedJob && (
          <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-foreground">{selectedJob.name}</h2>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 text-xs rounded-full ${selectedJob.enabled ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'}`}>
                  {selectedJob.enabled ? 'Enabled' : 'Disabled'}
                </span>
                {selectedJob.lastStatus && (
                  <span className={`px-2 py-1 text-xs rounded-full ${getStatusBg(selectedJob.lastStatus)} ${getStatusColor(selectedJob.lastStatus)}`}>
                    {selectedJob.lastStatus}
                  </span>
                )}
                <Button onClick={() => setSelectedJob(null)} variant="ghost" size="sm" className="text-xs">Close</Button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Left: Configuration */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Configuration</h3>
                  <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
                    <div className="grid grid-cols-[100px_1fr] gap-1 text-sm">
                      <span className="text-muted-foreground">Schedule</span>
                      <div>
                        <code className="font-mono text-foreground">{selectedJob.schedule}</code>
                        <div className="text-xs text-muted-foreground">{describeCronFrequency(selectedJob.schedule)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-[100px_1fr] gap-1 text-sm">
                      <span className="text-muted-foreground">Agent</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded border w-fit ${getAgentColorClass(selectedJob.agentId || '', uniqueAgents)}`}>
                        {selectedJob.agentId || 'system'}
                      </span>
                    </div>
                    {selectedJob.model && (
                      <div className="grid grid-cols-[100px_1fr] gap-1 text-sm">
                        <span className="text-muted-foreground">Model</span>
                        <code className="font-mono text-xs text-foreground">{selectedJob.model}</code>
                      </div>
                    )}
                    <div className="grid grid-cols-[100px_1fr] gap-1 text-sm">
                      <span className="text-muted-foreground">Delivery</span>
                      <span className="text-foreground text-xs">{selectedJob.delivery || 'gateway'}</span>
                    </div>
                    {selectedJob.delivery === 'local' && selectedJob.agentId === 'mission-control-local' && (
                      <div className="grid grid-cols-[100px_1fr] gap-1 text-sm">
                        <span className="text-muted-foreground">Source</span>
                        <span className="text-foreground text-xs">Local scheduler automation</span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Command</h3>
                  <pre className="bg-secondary/50 rounded-lg p-4 text-xs font-mono text-foreground whitespace-pre-wrap break-all overflow-x-auto max-h-32">{selectedJob.command}</pre>
                </div>

                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Timing</h3>
                  <div className="bg-secondary/50 rounded-lg p-4 space-y-2">
                    {selectedJob.lastRun && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Last run</span>
                        <span className="text-foreground">{new Date(selectedJob.lastRun).toLocaleString()} ({formatRelativeTime(selectedJob.lastRun)})</span>
                      </div>
                    )}
                    {selectedJob.nextRun && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Next run</span>
                        <span className="text-primary">{new Date(selectedJob.nextRun).toLocaleString()} ({formatRelativeTime(selectedJob.nextRun, true)})</span>
                      </div>
                    )}
                    {selectedJob.timezone && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Timezone</span>
                        <span className="text-foreground">{selectedJob.timezone}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => triggerJob(selectedJob)}
                    size="sm"
                    className="bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border-blue-500/30"
                  >
                    Run Now
                  </Button>
                  <Button
                    onClick={() => toggleJob(selectedJob)}
                    disabled={selectedJob.delivery === 'local' && selectedJob.agentId === 'mission-control-local'}
                    size="sm"
                    className={selectedJob.enabled
                      ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 border-yellow-500/30'
                      : 'bg-green-500/20 text-green-400 hover:bg-green-500/30 border-green-500/30'}
                  >
                    {selectedJob.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    onClick={() => removeJob(selectedJob)}
                    disabled={selectedJob.delivery === 'local' && selectedJob.agentId === 'mission-control-local'}
                    variant="destructive"
                    size="sm"
                  >
                    Remove
                  </Button>
                </div>
              </div>

              {/* Right: Logs */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Recent Logs</h3>
                <div className="bg-secondary/50 rounded-lg p-4 max-h-80 overflow-y-auto">
                  {jobLogs.length === 0 ? (
                    <div className="text-muted-foreground text-sm">No logs available</div>
                  ) : (
                    <div className="space-y-1.5 text-xs font-mono">
                      {jobLogs.map((logEntry, index) => (
                        <div key={index} className="text-muted-foreground">
                          <span className="text-[10px] text-muted-foreground/60">[{new Date(logEntry.timestamp).toLocaleString()}]</span>{' '}
                          {logEntry.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Claude Code Teams Overview */}
      <ClaudeCodeTeamsSection />

      {/* Add Job Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-2xl m-4">
            <h2 className="text-xl font-semibold mb-4">Add New Cron Job</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Job Name</label>
                <input
                  type="text"
                  value={newJob.name}
                  onChange={(e) => setNewJob(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., daily-backup, system-check"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Schedule (Cron Format)</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={newJob.schedule}
                    onChange={(e) => setNewJob(prev => ({ ...prev, schedule: e.target.value }))}
                    placeholder="0 * * * *"
                    className="flex-1 px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono"
                  />
                  <select
                    value=""
                    onChange={(e) => e.target.value && setNewJob(prev => ({ ...prev, schedule: e.target.value }))}
                    className="px-3 py-2 border border-border rounded-md bg-background text-foreground"
                  >
                    <option value="">Quick select...</option>
                    {predefinedSchedules.map((sched) => (
                      <option key={sched.value} value={sched.value}>{sched.label}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Format: minute hour day month dayOfWeek
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Command</label>
                <textarea
                  value={newJob.command}
                  onChange={(e) => setNewJob(prev => ({ ...prev, command: e.target.value }))}
                  placeholder="cd /path/to/script && ./script.sh"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono h-24"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Model (Optional)</label>
                <input
                  type="text"
                  value={newJob.model}
                  onChange={(e) => setNewJob(prev => ({ ...prev, model: e.target.value }))}
                  list="cron-model-suggestions"
                  placeholder="anthropic/claude-sonnet-4-20250514"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono text-sm"
                />
                <datalist id="cron-model-suggestions">
                  {availableModels.map((modelName) => (
                    <option key={modelName} value={modelName} />
                  ))}
                </datalist>
                <div className="mt-1 text-xs text-muted-foreground">
                  Leave empty to use the agent or gateway default model.
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Description (Optional)</label>
                <input
                  type="text"
                  value={newJob.description}
                  onChange={(e) => setNewJob(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="What does this job do?"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <Button
                onClick={() => setShowAddForm(false)}
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                onClick={addJob}
              >
                Add Job
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ClaudeCodeTeamsSection() {
  const [expanded, setExpanded] = useState(false)
  const [data, setData] = useState<{ teams: any[]; tasks: any[] }>({ teams: [], tasks: [] })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!expanded || loaded) return
    fetch('/api/claude-tasks')
      .then(r => r.json())
      .then(d => { setData(d); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [expanded, loaded])

  const statusCounts = data.tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1
    return acc
  }, {})

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-secondary/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">Claude Code Teams</h2>
          {data.teams.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400">{data.teams.length} teams</span>
          )}
        </div>
        <span className="text-muted-foreground text-sm">{expanded ? 'Collapse' : 'Expand'}</span>
      </button>
      {expanded && (
        <div className="px-6 pb-6 border-t border-border pt-4 space-y-4">
          {!loaded ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : data.teams.length === 0 ? (
            <div className="text-sm text-muted-foreground">No Claude Code teams found in ~/.claude/teams/</div>
          ) : (
            <>
              {Object.keys(statusCounts).length > 0 && (
                <div className="flex gap-3">
                  {Object.entries(statusCounts).map(([status, count]) => (
                    <span key={status} className={`text-xs px-2 py-1 rounded ${
                      status === 'completed' ? 'bg-green-500/20 text-green-400' :
                      status === 'in_progress' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {status}: {count}
                    </span>
                  ))}
                </div>
              )}
              <div className="space-y-3">
                {data.teams.map(team => (
                  <div key={team.name} className="border border-border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-foreground">{team.name}</span>
                      <span className="text-xs text-muted-foreground">{team.members?.length || 0} members</span>
                      {team.description && (
                        <span className="text-xs text-muted-foreground truncate">{team.description}</span>
                      )}
                    </div>
                    {team.members?.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {team.members.map((m: any) => (
                          <span key={m.agentId} className="text-[11px] px-2 py-0.5 rounded bg-secondary text-foreground">
                            {m.name} <span className="text-muted-foreground">({m.model || m.agentType})</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
