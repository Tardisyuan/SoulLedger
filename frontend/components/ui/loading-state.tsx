import { cn } from '@/lib/utils'

interface LoadingStateProps {
  message?: string
  className?: string
}

export function LoadingState({ message = '加载中...', className }: LoadingStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12', className)}>
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      <p className="mt-4 text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

interface ErrorStateProps {
  message?: string
  onRetry?: () => void
  className?: string
}

export function ErrorState({
  message = '加载失败',
  onRetry,
  className
}: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12', className)}>
      <p className="text-red-500">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-4 text-sm text-primary">
          重试
        </button>
      )}
    </div>
  )
}

interface EmptyStateProps {
  message?: string
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({
  message = '暂无数据',
  action,
  className
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12', className)}>
      <p className="text-muted-foreground">{message}</p>
      {action && (
        <button onClick={action.onClick} className="mt-4 text-sm text-primary">
          {action.label}
        </button>
      )}
    </div>
  )
}
