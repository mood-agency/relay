import React, { useState, useEffect, useCallback } from "react"
import { useNavigate, useParams, useLocation } from "react-router-dom"
import {
    Database,
    Zap,
    Layers,
    Inbox,
    Pickaxe,
    XCircle,
    Check,
    Archive,
    FileText,
    AlertCircle,
    User,
    ChevronRight,
    ChevronDown,
    Plus,
    RefreshCw,
    Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { QueueInfo } from "@/components/queues/QueueManagement"
import { SystemStatus } from "@/components/queue/types"

// ============================================================================
// Types
// ============================================================================

type QueueTab = 'main' | 'processing' | 'dead' | 'acknowledged' | 'archived'
type ActivityTab = 'activity' | 'anomalies' | 'consumers'

interface SidebarProps {
    authFetch: (url: string, options?: RequestInit) => Promise<Response>
    onCreateQueue?: () => void
    statusData?: SystemStatus | null
    activityCounts?: {
        logs?: number
        anomalies?: number
        criticalAnomalies?: number
        consumers?: number
    }
}

// ============================================================================
// Helper Components
// ============================================================================

const getQueueTypeIcon = (type: string) => {
    switch (type) {
        case "standard":
            return <Database className="h-3.5 w-3.5" />
        case "unlogged":
            return <Zap className="h-3.5 w-3.5 text-yellow-500" />
        case "partitioned":
            return <Layers className="h-3.5 w-3.5 text-blue-500" />
        default:
            return <Database className="h-3.5 w-3.5" />
    }
}

// ============================================================================
// Sidebar Component
// ============================================================================

export default function Sidebar({
    authFetch,
    onCreateQueue,
    statusData,
    activityCounts,
}: SidebarProps) {
    const navigate = useNavigate()
    const params = useParams<{ queueName?: string; tab?: string }>()
    const location = useLocation()

    // State
    const [queues, setQueues] = useState<QueueInfo[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['queues', 'messages', 'activity']))

    // Current state from URL
    const currentQueueName = params.queueName || null
    const currentTab = params.tab || 'main'
    const isActivityTab = ['activity', 'anomalies', 'consumers'].includes(currentTab)

    // Fetch queues
    const fetchQueues = useCallback(async () => {
        try {
            const response = await authFetch("/api/queues")
            if (response.ok) {
                const data = await response.json()
                setQueues(data.queues || [])
            }
        } catch (err) {
            console.error('Failed to fetch queues:', err)
        } finally {
            setLoading(false)
        }
    }, [authFetch])

    useEffect(() => {
        fetchQueues()
    }, [fetchQueues])

    // Toggle section expansion
    const toggleSection = (section: string) => {
        setExpandedSections(prev => {
            const next = new Set(prev)
            if (next.has(section)) {
                next.delete(section)
            } else {
                next.add(section)
            }
            return next
        })
    }

    // Navigation helpers
    const navigateToQueue = (queueName: string) => {
        navigate(`/queues/${queueName}/main`)
    }

    const navigateToQueueTab = (tab: QueueTab) => {
        if (currentQueueName) {
            navigate(`/queues/${currentQueueName}/${tab}`)
        }
    }

    const navigateToActivityTab = (tab: ActivityTab) => {
        if (currentQueueName) {
            navigate(`/queues/${currentQueueName}/${tab}`)
        }
    }

    // Queue tabs configuration
    type QueueStatusKey = 'mainQueue' | 'processingQueue' | 'deadLetterQueue' | 'acknowledgedQueue' | 'archivedQueue'
    const queueTabs: { id: QueueTab; icon: typeof Inbox; label: string; countKey: QueueStatusKey }[] = [
        { id: 'main', icon: Inbox, label: 'Main', countKey: 'mainQueue' },
        { id: 'processing', icon: Pickaxe, label: 'Processing', countKey: 'processingQueue' },
        { id: 'dead', icon: XCircle, label: 'Dead Letter', countKey: 'deadLetterQueue' },
        { id: 'acknowledged', icon: Check, label: 'Acknowledged', countKey: 'acknowledgedQueue' },
        { id: 'archived', icon: Archive, label: 'Archived', countKey: 'archivedQueue' },
    ]

    // Activity tabs configuration
    const activityTabs: { id: ActivityTab; icon: typeof FileText; label: string }[] = [
        { id: 'activity', icon: FileText, label: 'All Logs' },
        { id: 'anomalies', icon: AlertCircle, label: 'Anomalies' },
        { id: 'consumers', icon: User, label: 'Consumers' },
    ]

    return (
        <div className="w-64 h-full border-r bg-card flex flex-col">
            {/* Header */}
            <div className="p-4 border-b flex items-center justify-between">
                <h1
                    className="font-semibold text-lg cursor-pointer hover:text-primary transition-colors"
                    onClick={() => navigate('/queues')}
                >
                    Relay
                </h1>
                <div className="flex items-center gap-1">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={fetchQueues}
                                disabled={loading}
                                className="h-8 w-8"
                            >
                                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Refresh queues</TooltipContent>
                    </Tooltip>
                </div>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-2">
                    {/* Queues Section */}
                    <div className="mb-2">
                        <button
                            onClick={() => toggleSection('queues')}
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
                        >
                            {expandedSections.has('queues') ? (
                                <ChevronDown className="h-3 w-3" />
                            ) : (
                                <ChevronRight className="h-3 w-3" />
                            )}
                            Queues
                            <span className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded">
                                {queues.length}
                            </span>
                        </button>

                        {expandedSections.has('queues') && (
                            <div className="mt-1 space-y-0.5">
                                {loading ? (
                                    <div className="flex items-center justify-center py-4">
                                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                    </div>
                                ) : queues.length === 0 ? (
                                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                                        No queues yet
                                    </div>
                                ) : (
                                    queues.map((queue) => (
                                        <button
                                            key={queue.name}
                                            onClick={() => navigateToQueue(queue.name)}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                                                currentQueueName === queue.name
                                                    ? "bg-primary/10 text-primary font-medium"
                                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                            )}
                                        >
                                            {getQueueTypeIcon(queue.queue_type)}
                                            <span className="truncate flex-1 text-left">{queue.name}</span>
                                            {queue.dead_count > 0 && (
                                                <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">
                                                    {queue.dead_count}
                                                </span>
                                            )}
                                        </button>
                                    ))
                                )}

                                {/* Create Queue Button */}
                                {onCreateQueue && (
                                    <button
                                        onClick={onCreateQueue}
                                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        <span>Create Queue</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Messages Section - Only show when a queue is selected */}
                    {currentQueueName && (
                        <div className="mb-2">
                            <button
                                onClick={() => toggleSection('messages')}
                                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
                            >
                                {expandedSections.has('messages') ? (
                                    <ChevronDown className="h-3 w-3" />
                                ) : (
                                    <ChevronRight className="h-3 w-3" />
                                )}
                                Messages
                            </button>

                            {expandedSections.has('messages') && (
                                <div className="mt-1 space-y-0.5">
                                    {queueTabs.map((tab) => {
                                        const Icon = tab.icon
                                        const count = statusData?.[tab.countKey]?.length || 0
                                        const isActive = !isActivityTab && currentTab === tab.id
                                        const isDead = tab.id === 'dead'
                                        const isAcknowledged = tab.id === 'acknowledged'

                                        return (
                                            <button
                                                key={tab.id}
                                                onClick={() => navigateToQueueTab(tab.id)}
                                                className={cn(
                                                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                                                    isActive
                                                        ? "bg-primary/10 text-primary font-medium"
                                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                                )}
                                            >
                                                <Icon className={cn(
                                                    "h-3.5 w-3.5",
                                                    isDead && count > 0 && "text-destructive",
                                                    isAcknowledged && count > 0 && "text-green-500"
                                                )} />
                                                <span className="flex-1 text-left">{tab.label}</span>
                                                <span className={cn(
                                                    "text-[10px] px-1.5 py-0.5 rounded min-w-[1.5rem] text-center",
                                                    isDead && count > 0
                                                        ? "bg-destructive/10 text-destructive"
                                                        : isAcknowledged && count > 0
                                                            ? "bg-green-500/10 text-green-500"
                                                            : "bg-muted text-muted-foreground"
                                                )}>
                                                    {count}
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Activity Section - Only show when a queue is selected */}
                    {currentQueueName && (
                        <div className="mb-2">
                            <button
                                onClick={() => toggleSection('activity')}
                                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
                            >
                                {expandedSections.has('activity') ? (
                                    <ChevronDown className="h-3 w-3" />
                                ) : (
                                    <ChevronRight className="h-3 w-3" />
                                )}
                                Activity
                                {(activityCounts?.criticalAnomalies ?? 0) > 0 && (
                                    <span className="h-2 w-2 bg-destructive rounded-full animate-pulse ml-auto" />
                                )}
                            </button>

                            {expandedSections.has('activity') && (
                                <div className="mt-1 space-y-0.5">
                                    {activityTabs.map((tab) => {
                                        const Icon = tab.icon
                                        const isActive = isActivityTab && currentTab === tab.id
                                        const isAnomalies = tab.id === 'anomalies'
                                        const hasCritical = isAnomalies && (activityCounts?.criticalAnomalies ?? 0) > 0

                                        let count: number | undefined
                                        if (tab.id === 'activity') count = activityCounts?.logs
                                        else if (tab.id === 'anomalies') count = activityCounts?.anomalies
                                        else if (tab.id === 'consumers') count = activityCounts?.consumers

                                        return (
                                            <button
                                                key={tab.id}
                                                onClick={() => navigateToActivityTab(tab.id)}
                                                className={cn(
                                                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                                                    isActive
                                                        ? "bg-primary/10 text-primary font-medium"
                                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                                )}
                                            >
                                                <Icon className={cn(
                                                    "h-3.5 w-3.5",
                                                    hasCritical && "text-destructive"
                                                )} />
                                                <span className="flex-1 text-left">{tab.label}</span>
                                                {typeof count === 'number' && count > 0 && (
                                                    <span className={cn(
                                                        "text-[10px] px-1.5 py-0.5 rounded min-w-[1.5rem] text-center",
                                                        hasCritical
                                                            ? "bg-destructive/10 text-destructive"
                                                            : "bg-muted text-muted-foreground"
                                                    )}>
                                                        {count}
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    )
}
