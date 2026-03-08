'use client'

import { APP_VERSION } from '@/lib/version'

function OpenClawMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Left talon */}
      <path
        d="M14 36c-2-8 0-16 6-22 3-3 6-4.5 10-5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="currentColor"
        fillOpacity="0.06"
      />
      {/* Right talon (mirrored) */}
      <path
        d="M34 36c2-8 0-16-6-22-3-3-6-4.5-10-5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="currentColor"
        fillOpacity="0.06"
      />
      {/* Center dot */}
      <circle cx="24" cy="28" r="2.5" fill="currentColor" fillOpacity="0.8" />
    </svg>
  )
}

function ClaudeMark({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Vertical spoke */}
      <line x1="24" y1="8" x2="24" y2="40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      {/* 60-degree spoke */}
      <line x1="10.14" y1="32" x2="37.86" y2="16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      {/* 120-degree spoke */}
      <line x1="10.14" y1="16" x2="37.86" y2="32" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

interface InitStep {
  key: string
  label: string
  status: 'pending' | 'done'
}

interface LoaderProps {
  variant?: 'page' | 'panel' | 'inline'
  label?: string
  steps?: InitStep[]
}

function LoaderDots({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dotSize = size === 'sm' ? 'w-1 h-1' : 'w-1.5 h-1.5'
  return (
    <div className="flex items-center gap-1.5">
      <div className={`${dotSize} rounded-full bg-void-cyan animate-pulse`} style={{ animationDelay: '0ms' }} />
      <div className={`${dotSize} rounded-full bg-void-cyan animate-pulse`} style={{ animationDelay: '200ms' }} />
      <div className={`${dotSize} rounded-full bg-void-cyan animate-pulse`} style={{ animationDelay: '400ms' }} />
    </div>
  )
}

function StepIcon({ status, isActive }: { status: 'pending' | 'done'; isActive: boolean }) {
  if (status === 'done') {
    return (
      <svg className="w-3.5 h-3.5 text-primary check-enter" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8.5l3.5 3.5 6.5-7" />
      </svg>
    )
  }
  if (isActive) {
    return <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
  }
  return <div className="w-2 h-2 rounded-full bg-border" />
}

function PageLoader({ steps }: { steps?: InitStep[] }) {
  const doneCount = steps?.filter(s => s.status === 'done').length ?? 0
  const totalCount = steps?.length ?? 1
  const progress = steps ? (doneCount / totalCount) * 100 : 0
  const allDone = steps ? doneCount === totalCount : false

  // Find the first pending step (the "active" one)
  const activeIndex = steps?.findIndex(s => s.status === 'pending') ?? -1

  return (
    <div
      className={`flex items-center justify-center min-h-screen bg-background void-bg transition-opacity duration-300 ${allDone ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="flex flex-col items-center gap-8 w-64">
        {/* Converging logo pair */}
        <div className="relative flex items-center justify-center h-20">
          {/* Center glow burst (fires after logos arrive) */}
          <div className="absolute w-24 h-24 rounded-full bg-primary/15 blur-2xl opacity-0 animate-converge-burst" />
          {/* Ambient glow (starts after entrance) */}
          <div
            className="absolute w-28 h-28 rounded-full bg-primary/8 blur-2xl animate-glow-pulse"
            style={{ animationDelay: '1.4s' }}
          />
          {/* Logo pair with post-converge float */}
          <div className="animate-float" style={{ animationDelay: '1.4s' }}>
            <div className="flex items-center gap-3">
              <div className="opacity-0 animate-converge-left">
                <OpenClawMark className="w-10 h-10 text-primary" />
              </div>
              <div className="w-1 h-1 rounded-full bg-primary opacity-0 animate-converge-burst" />
              <div className="opacity-0 animate-converge-right">
                <ClaudeMark className="w-10 h-10" style={{ color: 'hsl(25, 95%, 53%)' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="flex flex-col items-center gap-1">
          <h1 className="font-mono text-sm tracking-[0.2em] uppercase text-foreground font-medium">
            Mission Control
          </h1>
          <p className="text-2xs text-muted-foreground/60">
            Agent Orchestration
          </p>
        </div>

        {/* Progress section */}
        {steps ? (
          <div className="w-full flex flex-col items-center gap-4">
            {/* Progress bar */}
            <div className="w-full h-0.5 bg-border/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary shimmer-bar rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Step list */}
            <div className="w-full space-y-2">
              {steps.map((step, i) => (
                <div
                  key={step.key}
                  className={`flex items-center gap-2.5 text-xs transition-opacity duration-200 ${
                    step.status === 'done'
                      ? 'text-muted-foreground/70'
                      : i === activeIndex
                        ? 'text-foreground'
                        : 'text-muted-foreground/40'
                  }`}
                >
                  <div className="w-4 h-4 flex items-center justify-center shrink-0">
                    <StepIcon status={step.status} isActive={i === activeIndex} />
                  </div>
                  <span className="font-mono text-2xs tracking-wide">{step.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* SSR fallback — no progress data yet */
          <LoaderDots />
        )}

        {/* Version */}
        <span className="text-2xs font-mono text-muted-foreground/40">
          v{APP_VERSION}
        </span>
      </div>
    </div>
  )
}

export function Loader({ variant = 'panel', label, steps }: LoaderProps) {
  if (variant === 'page') {
    return <PageLoader steps={steps} />
  }

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2">
        <LoaderDots size="sm" />
        {label && <span className="text-sm text-muted-foreground">{label}</span>}
      </div>
    )
  }

  // panel (default)
  return (
    <div className="flex items-center justify-center py-12">
      <div className="flex flex-col items-center gap-3">
        <LoaderDots />
        {label && <span className="text-sm text-muted-foreground">{label}</span>}
      </div>
    </div>
  )
}
