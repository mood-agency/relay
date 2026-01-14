import React, { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import {
    RefreshCw,
    Play,
    Trash2,
    AlertTriangle,
    Loader2,
    Pause,
    Filter,
    Search,
    ArrowRightLeft,
    Plus,
    Download,
    Upload,
    Key,
    KeyRound,
    MoreVertical,
    Activity,
    User,
    FileText,
    AlertCircle,
    History,
    Inbox,
    Pickaxe,
    XCircle,
    Check,
    Archive
} from "lucide-react"

import { format } from "date-fns"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import MultipleSelector, { Option } from "@/components/ui/multi-select"

import { Button } from "@/components/ui/button"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Card, CardContent } from "@/components/ui/card"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs"

// Activity Logs components
import {
    ActivityLogsTable,
    AnomaliesTable,
    MessageHistoryTable,
    ConsumerStatsTable,
    type ActivityLogsResponse,
    type ActivityLogsFilter,
    type AnomaliesResponse,
    type MessageHistoryResponse,
    type ConsumerStatsResponse,
} from "@/components/logs"

// Queue components
import {
    type DashboardView,
    type QueueTab,
    MoveMessageDialog,
    ViewPayloadDialog,
    EditMessageDialog,
    CreateMessageDialog,
    useQueueMessages,
    MainQueueTable,
    ProcessingQueueTable,
    DeadLetterTable,
    AcknowledgedQueueTable,
    ArchivedQueueTable,
} from "@/components/queue"

// ============================================================================
// API Key Helpers
// ============================================================================

const getStoredApiKey = (): string => {
    const envKey = import.meta.env.VITE_API_KEY
    if (envKey) return envKey
    return localStorage.getItem('queue-api-key') || ''
}

const setStoredApiKey = (key: string) => {
    localStorage.setItem('queue-api-key', key)
}

// ============================================================================
// Route Types and Helpers
// ============================================================================

type ActivityTab = 'activity' | 'anomalies' | 'consumers'
const ACTIVITY_TABS: ActivityTab[] = ['activity', 'anomalies', 'consumers']
const QUEUE_TABS: QueueTab[] = ['main', 'processing', 'dead', 'acknowledged', 'archived']

const parseActivityTab = (value: string | undefined): ActivityTab => {
    if (value && ACTIVITY_TABS.includes(value as ActivityTab)) return value as ActivityTab
    return 'activity'
}

const parseQueueTab = (value: string | undefined): QueueTab => {
    if (value && QUEUE_TABS.includes(value as QueueTab)) return value as QueueTab
    return 'main'
}

// ============================================================================
// Dashboard Component
// ============================================================================

export default function Dashboard() {
    // Router hooks
    const params = useParams<{ tab?: string; messageId?: string }>()
    const navigate = useNavigate()
    const location = useLocation()

    // Derive current view from URL path
    const isLogsView = location.pathname.startsWith('/logs')
    const currentView: DashboardView = isLogsView ? 'activity' : 'queues'

    // Parse tabs from URL params
    const queueTab = parseQueueTab(params.tab)
    const activityTab = parseActivityTab(params.tab)
    // const messageIdFromUrl = params.messageId // Unused for now as we moved to dialog

    // API Key state
    const [apiKey, setApiKey] = useState<string>(getStoredApiKey)
    const [showApiKeyInput, setShowApiKeyInput] = useState(false)

    // Auth fetch helper
    const authFetch = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
        const headers = new Headers(options.headers)
        if (apiKey) {
            headers.set('X-API-KEY', apiKey)
        }
        return fetch(url, { ...options, headers })
    }, [apiKey])

    // Use the queue messages hook with current queue tab
    const queue = useQueueMessages({
        authFetch,
        apiKey,
        queueTab,
        navigate,
        onEvent: (type) => {
            // Refresh activity logs on relevant events if we are on the activity view
            // We refresh on 'requeue' (timeout movement) and other major events
            if (currentView === 'activity') {
                if (activityTab === 'activity') fetchActivityLogs()
                else if (activityTab === 'anomalies') fetchAnomalies()
                else if (activityTab === 'consumers') fetchConsumerStats()
            }
        }
    })

    // Move dialog state
    const [moveDialog, setMoveDialog] = useState<{
        isOpen: boolean
        targetQueue: string
    }>({
        isOpen: false,
        targetQueue: "main",
    })
    const [dlqReason, setDlqReason] = useState("")

    // Create dialog state
    const [createDialog, setCreateDialog] = useState(false)

    // View payload dialog state
    const [viewPayloadDialog, setViewPayloadDialog] = useState<{
        isOpen: boolean
        payload: any
    }>({
        isOpen: false,
        payload: null,
    })

    // Activity Log state
    const [activityLogs, setActivityLogs] = useState<ActivityLogsResponse | null>(null)
    const [loadingActivity, setLoadingActivity] = useState(false)
    const [activityFilter, setActivityFilter] = useState<ActivityLogsFilter>({
        action: '',
        message_id: '',
        has_anomaly: null,
        limit: 100,
        offset: 0
    })
    const [anomalies, setAnomalies] = useState<AnomaliesResponse | null>(null)
    const [loadingAnomalies, setLoadingAnomalies] = useState(false)
    const [anomalySeverityFilter, setAnomalySeverityFilter] = useState<string>('')
    const [anomalyActionFilter, setAnomalyActionFilter] = useState<string>('')
    const [anomalyTypeFilter, setAnomalyTypeFilter] = useState<string>('')
    const [anomalySortBy, setAnomalySortBy] = useState<string>('timestamp')
    const [anomalySortOrder, setAnomalySortOrder] = useState<string>('desc')
    const anomalySortInitialRef = useRef(true)
    const [messageHistory, setMessageHistory] = useState<MessageHistoryResponse | null>(null)
    const [loadingHistory, setLoadingHistory] = useState(false)
    const [messageIdSearch, setMessageIdSearch] = useState('')
    const [consumerStats, setConsumerStats] = useState<ConsumerStatsResponse | null>(null)
    const [loadingConsumerStats, setLoadingConsumerStats] = useState(false)
    const [historyDialog, setHistoryDialog] = useState<{ isOpen: boolean; messageId: string | null }>({
        isOpen: false,
        messageId: null
    })



    // Navigation helpers using react-router
    const navigateToActivityTab = useCallback((tab: ActivityTab) => {
        navigate(`/logs/${tab}`)
    }, [navigate])

    // Activity Log fetch functions
    const fetchActivityLogs = useCallback(async () => {
        setLoadingActivity(true)
        try {
            const params = new URLSearchParams()
            if (activityFilter.action) params.append('action', activityFilter.action)
            if (activityFilter.message_id) params.append('message_id', activityFilter.message_id)
            if (activityFilter.has_anomaly !== null) params.append('has_anomaly', String(activityFilter.has_anomaly))
            params.append('limit', String(activityFilter.limit))
            params.append('offset', String(activityFilter.offset))

            const response = await authFetch(`/api/queue/activity?${params.toString()}`)
            if (response.ok) {
                const data = await response.json()
                setActivityLogs(data)
            }
        } catch (err) {
            console.error('Failed to fetch activity logs:', err)
        } finally {
            setLoadingActivity(false)
        }
    }, [authFetch, activityFilter])

    const fetchAnomalies = useCallback(async () => {
        setLoadingAnomalies(true)
        try {
            const params = new URLSearchParams()
            if (anomalySeverityFilter) params.append('severity', anomalySeverityFilter)
            if (anomalyActionFilter) params.append('action', anomalyActionFilter)
            if (anomalyTypeFilter) params.append('type', anomalyTypeFilter)
            params.append('sort_by', anomalySortBy)
            params.append('sort_order', anomalySortOrder)

            const response = await authFetch(`/api/queue/activity/anomalies?${params.toString()}`)
            if (response.ok) {
                const data = await response.json()
                setAnomalies(data)
            }
        } catch (err) {
            console.error('Failed to fetch anomalies:', err)
        } finally {
            setLoadingAnomalies(false)
        }
    }, [authFetch, anomalySeverityFilter, anomalyActionFilter, anomalyTypeFilter, anomalySortBy, anomalySortOrder])

    const fetchMessageHistory = useCallback(async (messageId: string) => {
        if (!messageId) {
            setMessageHistory(null)
            return
        }
        setLoadingHistory(true)
        try {
            const response = await authFetch(`/api/queue/activity/message/${encodeURIComponent(messageId)}`)
            if (response.ok) {
                const data = await response.json()
                setMessageHistory(data)
            }
        } catch (err) {
            console.error('Failed to fetch message history:', err)
        } finally {
            setLoadingHistory(false)
        }
    }, [authFetch])

    const fetchConsumerStats = useCallback(async () => {
        setLoadingConsumerStats(true)
        try {
            const response = await authFetch('/api/queue/activity/consumers')
            if (response.ok) {
                const data = await response.json()
                setConsumerStats(data)
            }
        } catch (err) {
            console.error('Failed to fetch consumer stats:', err)
        } finally {
            setLoadingConsumerStats(false)
        }
    }, [authFetch])

    // Effect to fetch activity data when view changes
    useEffect(() => {
        if (currentView === 'activity') {
            if (activityTab === 'activity') {
                fetchActivityLogs()
            } else if (activityTab === 'anomalies') {
                fetchAnomalies()
            } else if (activityTab === 'consumers') {
                fetchConsumerStats()
            }
        }
    }, [currentView, activityTab, fetchActivityLogs, fetchAnomalies, fetchConsumerStats])

    // Fetch anomalies and consumer stats on initial load for badge indicators
    useEffect(() => {
        fetchAnomalies()
        fetchConsumerStats()
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Re-fetch anomalies when sort changes (skip initial render)
    useEffect(() => {
        if (anomalySortInitialRef.current) {
            anomalySortInitialRef.current = false
            return
        }
        if (currentView === 'activity' && activityTab === 'anomalies') {
            fetchAnomalies()
        }
    }, [anomalySortBy, anomalySortOrder, currentView, activityTab, fetchAnomalies])

    // Move messages handler (wraps the hook's handler with dialog state)
    const handleMoveMessages = useCallback(async () => {
        const success = await queue.handleMoveMessages(moveDialog.targetQueue, dlqReason)
        if (success) {
            setMoveDialog(prev => ({ ...prev, isOpen: false }))
            setDlqReason("")
        }
        return success
    }, [queue, moveDialog.targetQueue, dlqReason])

    // Create message handler (wraps the hook's handler with dialog state)
    const handleCreateMessage = useCallback(async (data: any) => {
        await queue.handleCreateMessage(data)
        setCreateDialog(false)
    }, [queue])

    // Loading state
    if (queue.loadingStatus && !queue.statusData) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen">
                <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground font-medium">Loading queue data...</p>
            </div>
        )
    }

    return (
        <div className="container mx-auto py-6 px-4 max-w-[1600px] h-screen max-h-screen overflow-hidden flex flex-col animate-in fade-in duration-500">
            <div className="flex-1 min-h-0 flex flex-col gap-4">
                {queue.error && (
                    <Card className="border-destructive/50 bg-destructive/10">
                        <CardContent className="pt-6 flex items-center gap-3 text-destructive">
                            <AlertTriangle className="h-5 w-5" />
                            <p className="font-medium text-sm">Error: {queue.error}</p>
                        </CardContent>
                    </Card>
                )}

                {/* Header with Title and Actions */}
                <Tabs
                    value={currentView}
                    onValueChange={(v) => {
                        if (v === 'queues') {
                            navigate(`/queue/${queueTab}`)
                        } else {
                            navigate('/logs/activity')
                        }
                    }}
                    className="flex flex-col flex-1 min-h-0 gap-4"
                >
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1 w-[300px]">
                            <h1 className="text-lg font-bold tracking-tight text-foreground mr-1">Relay</h1>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={() => {
                                            queue.handleRefresh()
                                            if (currentView === 'activity') {
                                                if (activityTab === 'activity') fetchActivityLogs()
                                                else if (activityTab === 'anomalies') fetchAnomalies()
                                                else if (activityTab === 'consumers') fetchConsumerStats()
                                            }
                                        }}
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        aria-label="Refresh"
                                    >
                                        <RefreshCw className={cn("h-3.5 w-3.5", (queue.loadingMessages || queue.loadingStatus || loadingActivity || loadingAnomalies || loadingConsumerStats) && "animate-spin")} />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Refresh</p>
                                </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={queue.handleToggleAutoRefresh}
                                        variant="ghost"
                                        size="icon"
                                        className={cn("h-8 w-8", queue.autoRefresh && "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:text-secondary-foreground")}
                                        aria-label={queue.autoRefresh ? "Disable auto refresh" : "Enable auto refresh"}
                                    >
                                        {queue.autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>{queue.autoRefresh ? "Pause Auto-refresh" : "Enable Auto-refresh"}</p>
                                </TooltipContent>
                            </Tooltip>
                            {queue.selectedIds.size > 0 && (
                                <>
                                    <div className="w-px h-5 bg-border/50 mx-1" />
                                    <span className="text-sm text-muted-foreground animate-in fade-in zoom-in duration-200">
                                        {queue.selectedIds.size.toLocaleString()} selected
                                    </span>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    const queues = ['main', 'processing', 'dead', 'acknowledged', 'archived']
                                                    const defaultTarget = queues.find(q => q !== queue.activeTab) || 'main'
                                                    setMoveDialog(prev => ({ ...prev, isOpen: true, targetQueue: defaultTarget }))
                                                }}
                                                className="h-8 w-8 animate-in fade-in zoom-in duration-200"
                                            >
                                                <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Move selected</p>
                                        </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={queue.handleBulkDelete}
                                                className="h-8 w-8 animate-in fade-in zoom-in duration-200"
                                            >
                                                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Delete selected</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </>
                            )}
                        </div>

                        {/* Center Tabs */}
                        <div className="flex-1 flex justify-center">
                            <TabsList className="grid w-[400px] grid-cols-2">
                                <TabsTrigger value="queues">
                                    Messages
                                </TabsTrigger>
                                <TabsTrigger value="activity" className="flex items-center gap-2">
                                    Activity
                                    {anomalies && anomalies.summary.by_severity.critical > 0 && (
                                        <span className="h-2 w-2 bg-destructive rounded-full animate-pulse" />
                                    )}
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        <div className="flex items-center justify-end gap-1 w-[300px]">
                            {/* Messages Filter - only show when viewing queues */}
                            {currentView === 'queues' && (
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className={cn("h-8 w-8 relative", queue.isFilterActive && "bg-primary/10 text-primary")}
                                            aria-label="Message Filters"
                                        >
                                            <Filter className="h-3.5 w-3.5" />
                                            {queue.isFilterActive && (
                                                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-primary rounded-full" />
                                            )}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-72 p-4" align="end">
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <h4 className="font-medium text-sm">Message Filters</h4>
                                                {queue.isFilterActive && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            queue.setSearch("")
                                                            queue.setFilterType("all")
                                                            queue.setFilterPriority("")
                                                            queue.setFilterAttempts("")
                                                            queue.setStartDate(undefined)
                                                            queue.setEndDate(undefined)
                                                        }}
                                                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                                    >
                                                        Clear all
                                                    </Button>
                                                )}
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-foreground/80">Search</label>
                                                <div className="relative">
                                                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                                    <input
                                                        placeholder="Search ID, payload..."
                                                        value={queue.search}
                                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => queue.setSearch(e.target.value)}
                                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pl-8 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-foreground/80">Message Type</label>
                                                <MultipleSelector
                                                    defaultOptions={queue.availableTypes.map(t => ({ label: t, value: t }))}
                                                    value={
                                                        queue.filterType === "all" || !queue.filterType
                                                            ? []
                                                            : queue.filterType.split(",").map(t => ({ label: t, value: t }))
                                                    }
                                                    onChange={(selected: Option[]) => {
                                                        if (selected.length === 0) {
                                                            queue.setFilterType("all")
                                                        } else {
                                                            queue.setFilterType(selected.map(s => s.value).join(","))
                                                        }
                                                    }}
                                                    hideClearAllButton
                                                    badgeClassName="rounded-full border border-border text-foreground font-medium bg-transparent hover:bg-transparent"
                                                    emptyIndicator={
                                                        <p className="text-center text-sm text-muted-foreground">No types found</p>
                                                    }
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-foreground/80">Priority</label>
                                                <Select value={queue.filterPriority || "any"} onValueChange={(val: string) => queue.setFilterPriority(val === "any" ? "" : val)}>
                                                    <SelectTrigger className="w-full">
                                                        <SelectValue placeholder="Any" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="any">Any</SelectItem>
                                                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => (
                                                            <SelectItem key={p} value={String(p)}>{p}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-foreground/80">Min Attempts</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="1"
                                                    placeholder="Any"
                                                    value={queue.filterAttempts}
                                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                                        const val = e.target.value
                                                        if (val === "" || /^\d+$/.test(val)) {
                                                            queue.setFilterAttempts(val)
                                                        }
                                                    }}
                                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-foreground/80">Date Range</label>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] text-muted-foreground">Start</label>
                                                        <DateTimePicker
                                                            date={queue.startDate}
                                                            setDate={queue.setStartDate}
                                                            placeholder="Start"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] text-muted-foreground">End</label>
                                                        <DateTimePicker
                                                            date={queue.endDate}
                                                            setDate={queue.setEndDate}
                                                            placeholder="End"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            )}

                            {/* History Filter - only show when viewing activity logs */}
                            {currentView === 'activity' && (
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className={cn(
                                                "h-8 w-8 relative",
                                                (activityFilter.action !== '' || activityFilter.message_id !== '' || activityFilter.has_anomaly !== null) && "bg-primary/10 text-primary"
                                            )}
                                            aria-label="History Filters"
                                        >
                                            <Filter className="h-3.5 w-3.5" />
                                            {(activityFilter.action !== '' || activityFilter.message_id !== '' || activityFilter.has_anomaly !== null) && (
                                                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-primary rounded-full" />
                                            )}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-72 p-4" align="end">
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <h4 className="font-medium text-sm">History Filters</h4>
                                                {(activityFilter.action !== '' || activityFilter.message_id !== '' || activityFilter.has_anomaly !== null) && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            setActivityFilter(prev => ({
                                                                ...prev,
                                                                action: '',
                                                                message_id: '',
                                                                has_anomaly: null,
                                                                offset: 0
                                                            }))
                                                        }}
                                                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                                    >
                                                        Clear all
                                                    </Button>
                                                )}
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-foreground/80">Message ID</label>
                                                <div className="relative">
                                                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                                    <input
                                                        placeholder="Search by message ID..."
                                                        value={activityFilter.message_id}
                                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setActivityFilter(prev => ({ ...prev, message_id: e.target.value, offset: 0 }))}
                                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pl-8 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-foreground/80">Action</label>
                                                <Select value={activityFilter.action || "any"} onValueChange={(val: string) => setActivityFilter(prev => ({ ...prev, action: val === "any" ? "" : val, offset: 0 }))}>
                                                    <SelectTrigger className="w-full">
                                                        <SelectValue placeholder="Any" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="any">Any</SelectItem>
                                                        <SelectItem value="enqueue">Enqueue</SelectItem>
                                                        <SelectItem value="dequeue">Dequeue</SelectItem>
                                                        <SelectItem value="ack">Acknowledge</SelectItem>
                                                        <SelectItem value="nack">Nack</SelectItem>
                                                        <SelectItem value="requeue">Requeue</SelectItem>
                                                        <SelectItem value="timeout">Timeout</SelectItem>
                                                        <SelectItem value="touch">Touch</SelectItem>
                                                        <SelectItem value="move">Move</SelectItem>
                                                        <SelectItem value="dlq">Dead Letter</SelectItem>
                                                        <SelectItem value="delete">Delete</SelectItem>
                                                        <SelectItem value="clear">Clear</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-foreground/80">Anomaly Status</label>
                                                <Select
                                                    value={activityFilter.has_anomaly === null ? "any" : activityFilter.has_anomaly ? "yes" : "no"}
                                                    onValueChange={(val: string) => setActivityFilter(prev => ({
                                                        ...prev,
                                                        has_anomaly: val === "any" ? null : val === "yes",
                                                        offset: 0
                                                    }))}
                                                >
                                                    <SelectTrigger className="w-full">
                                                        <SelectValue placeholder="Any" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="any">Any</SelectItem>
                                                        <SelectItem value="yes">Has Anomaly</SelectItem>
                                                        <SelectItem value="no">No Anomaly</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            )}
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        aria-label="More actions"
                                    >
                                        <MoreVertical className="h-3.5 w-3.5" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-48 p-1" align="end">
                                    <Button
                                        onClick={() => setCreateDialog(true)}
                                        variant="ghost"
                                        className="w-full justify-start gap-2 h-9 px-2"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Create Message
                                    </Button>
                                    <Button
                                        onClick={() => queue.fileInputRef.current?.click()}
                                        variant="ghost"
                                        className="w-full justify-start gap-2 h-9 px-2"
                                    >
                                        <Upload className="h-4 w-4" />
                                        Import Messages
                                    </Button>
                                    <Button
                                        onClick={queue.handleExport}
                                        variant="ghost"
                                        className="w-full justify-start gap-2 h-9 px-2"
                                    >
                                        <Download className="h-4 w-4" />
                                        Export Messages
                                    </Button>
                                    <Button
                                        onClick={() => setShowApiKeyInput(true)}
                                        variant="ghost"
                                        className="w-full justify-start gap-2 h-9 px-2"
                                    >
                                        {apiKey ? <KeyRound className="h-4 w-4" /> : <Key className="h-4 w-4" />}
                                        {apiKey ? "API Key Configured" : "Configure API Key"}
                                    </Button>
                                    <Button
                                        onClick={queue.handleClearAll}
                                        variant="ghost"
                                        className="w-full justify-start gap-2 h-9 px-2"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        Clear All Queues
                                    </Button>
                                    <Button
                                        onClick={queue.handleClearActivityLogs}
                                        variant="ghost"
                                        className="w-full justify-start gap-2 h-9 px-2"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        Clear Logs
                                    </Button>
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                    <TabsContent value="queues" className="flex-1 min-h-0 rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col mt-0 data-[state=inactive]:hidden">
                        <div className="flex items-center border-b bg-muted/20">
                            {[
                                { id: 'main' as const, icon: Inbox, label: 'Main', count: queue.statusData?.mainQueue?.length || 0 },
                                { id: 'processing' as const, icon: Pickaxe, label: 'Processing', count: queue.statusData?.processingQueue?.length || 0 },
                                { id: 'dead' as const, icon: XCircle, label: 'Dead Letter', count: queue.statusData?.deadLetterQueue?.length || 0, badgeVariant: 'destructive' as const },
                                { id: 'acknowledged' as const, icon: Check, label: 'Acknowledged', count: queue.statusData?.acknowledgedQueue?.length || 0, badgeVariant: 'success' as const },
                                { id: 'archived' as const, icon: Archive, label: 'Archived', count: queue.statusData?.archivedQueue?.length || 0 },
                            ].map((tab) => {
                                const Icon = tab.icon
                                const isActive = queue.activeTab === tab.id
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => queue.navigateToTab(tab.id)}
                                        className={cn(
                                            "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative",
                                            "hover:text-foreground hover:bg-muted/50",
                                            isActive
                                                ? "text-foreground"
                                                : "text-muted-foreground"
                                        )}
                                    >
                                        <Icon className={cn(
                                            "h-3.5 w-3.5",
                                            tab.badgeVariant === 'success' && tab.count > 0 && "text-green-500",
                                            tab.badgeVariant === 'destructive' && tab.count > 0 && "text-destructive"
                                        )} />
                                        {tab.label}
                                        <span className={cn(
                                            "text-xs px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center",
                                            tab.badgeVariant === 'success' && tab.count > 0
                                                ? "bg-green-500/10 text-green-500"
                                                : tab.badgeVariant === 'destructive' && tab.count > 0
                                                    ? "bg-destructive/10 text-destructive"
                                                    : "bg-muted text-muted-foreground"
                                        )}>
                                            {tab.count.toLocaleString()}
                                        </span>
                                        {isActive && (
                                            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/50" />
                                        )}
                                    </button>
                                )
                            })}
                        </div>

                        {/* Queue Table Content */}
                        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                            {queue.activeTab === 'main' && (
                                <MainQueueTable
                                    messages={queue.effectiveMessagesData?.messages || []}
                                    config={queue.config}
                                    onDelete={queue.handleTableDelete}
                                    onEdit={queue.openEditDialog}
                                    onViewPayload={(payload) => setViewPayloadDialog({ isOpen: true, payload })}
                                    formatTime={queue.formatTimestamp}
                                    pageSize={queue.pageSize}
                                    setPageSize={queue.setPageSize}
                                    selectedIds={queue.selectedIds}
                                    onToggleSelect={queue.handleToggleSelect}
                                    onToggleSelectAll={queue.handleSelectAll}
                                    currentPage={queue.currentPage}
                                    setCurrentPage={queue.setCurrentPage}
                                    totalPages={queue.effectiveMessagesData?.pagination?.totalPages || 0}
                                    totalItems={queue.effectiveMessagesData?.pagination?.total || 0}
                                    sortBy={queue.sortBy}
                                    sortOrder={queue.sortOrder}
                                    onSort={queue.handleSort}
                                    scrollResetKey={queue.scrollResetKey}
                                    highlightedIds={queue.highlightedIds}
                                    isFilterActive={queue.isFilterActive}
                                    activeFiltersDescription={queue.activeFiltersDescription}
                                    isLoading={queue.showMessagesLoading}
                                />
                            )}
                            {queue.activeTab === 'processing' && (
                                <ProcessingQueueTable
                                    messages={queue.effectiveMessagesData?.messages || []}
                                    config={queue.config}
                                    onDelete={queue.handleTableDelete}
                                    onEdit={queue.openEditDialog}
                                    onViewPayload={(payload) => setViewPayloadDialog({ isOpen: true, payload })}
                                    formatTime={queue.formatTimestamp}
                                    pageSize={queue.pageSize}
                                    setPageSize={queue.setPageSize}
                                    selectedIds={queue.selectedIds}
                                    onToggleSelect={queue.handleToggleSelect}
                                    onToggleSelectAll={queue.handleSelectAll}
                                    currentPage={queue.currentPage}
                                    setCurrentPage={queue.setCurrentPage}
                                    totalPages={queue.effectiveMessagesData?.pagination?.totalPages || 0}
                                    totalItems={queue.effectiveMessagesData?.pagination?.total || 0}
                                    sortBy={queue.sortBy}
                                    sortOrder={queue.sortOrder}
                                    onSort={queue.handleSort}
                                    scrollResetKey={queue.scrollResetKey}
                                    highlightedIds={queue.highlightedIds}
                                    isFilterActive={queue.isFilterActive}
                                    activeFiltersDescription={queue.activeFiltersDescription}
                                    isLoading={queue.showMessagesLoading}
                                />
                            )}
                            {queue.activeTab === 'dead' && (
                                <DeadLetterTable
                                    messages={queue.effectiveMessagesData?.messages || []}
                                    config={queue.config}
                                    onDelete={queue.handleTableDelete}
                                    onEdit={queue.openEditDialog}
                                    onViewPayload={(payload) => setViewPayloadDialog({ isOpen: true, payload })}
                                    formatTime={queue.formatTimestamp}
                                    pageSize={queue.pageSize}
                                    setPageSize={queue.setPageSize}
                                    selectedIds={queue.selectedIds}
                                    onToggleSelect={queue.handleToggleSelect}
                                    onToggleSelectAll={queue.handleSelectAll}
                                    currentPage={queue.currentPage}
                                    setCurrentPage={queue.setCurrentPage}
                                    totalPages={queue.effectiveMessagesData?.pagination?.totalPages || 0}
                                    totalItems={queue.effectiveMessagesData?.pagination?.total || 0}
                                    sortBy={queue.sortBy}
                                    sortOrder={queue.sortOrder}
                                    onSort={queue.handleSort}
                                    scrollResetKey={queue.scrollResetKey}
                                    highlightedIds={queue.highlightedIds}
                                    isFilterActive={queue.isFilterActive}
                                    activeFiltersDescription={queue.activeFiltersDescription}
                                    isLoading={queue.showMessagesLoading}
                                />
                            )}
                            {queue.activeTab === 'acknowledged' && (
                                <AcknowledgedQueueTable
                                    messages={queue.effectiveMessagesData?.messages || []}
                                    config={queue.config}
                                    onDelete={queue.handleTableDelete}
                                    onViewPayload={(payload) => setViewPayloadDialog({ isOpen: true, payload })}
                                    formatTime={queue.formatTimestamp}
                                    pageSize={queue.pageSize}
                                    setPageSize={queue.setPageSize}
                                    selectedIds={queue.selectedIds}
                                    onToggleSelect={queue.handleToggleSelect}
                                    onToggleSelectAll={queue.handleSelectAll}
                                    currentPage={queue.currentPage}
                                    setCurrentPage={queue.setCurrentPage}
                                    totalPages={queue.effectiveMessagesData?.pagination?.totalPages || 0}
                                    totalItems={queue.effectiveMessagesData?.pagination?.total || 0}
                                    sortBy={queue.sortBy}
                                    sortOrder={queue.sortOrder}
                                    onSort={queue.handleSort}
                                    scrollResetKey={queue.scrollResetKey}
                                    highlightedIds={queue.highlightedIds}
                                    isFilterActive={queue.isFilterActive}
                                    activeFiltersDescription={queue.activeFiltersDescription}
                                    isLoading={queue.showMessagesLoading}
                                />
                            )}
                            {queue.activeTab === 'archived' && (
                                <ArchivedQueueTable
                                    messages={queue.effectiveMessagesData?.messages || []}
                                    config={queue.config}
                                    onDelete={queue.handleTableDelete}
                                    onViewPayload={(payload) => setViewPayloadDialog({ isOpen: true, payload })}
                                    formatTime={queue.formatTimestamp}
                                    pageSize={queue.pageSize}
                                    setPageSize={queue.setPageSize}
                                    selectedIds={queue.selectedIds}
                                    onToggleSelect={queue.handleToggleSelect}
                                    onToggleSelectAll={queue.handleSelectAll}
                                    currentPage={queue.currentPage}
                                    setCurrentPage={queue.setCurrentPage}
                                    totalPages={queue.effectiveMessagesData?.pagination?.totalPages || 0}
                                    totalItems={queue.effectiveMessagesData?.pagination?.total || 0}
                                    sortBy={queue.sortBy}
                                    sortOrder={queue.sortOrder}
                                    onSort={queue.handleSort}
                                    scrollResetKey={queue.scrollResetKey}
                                    highlightedIds={queue.highlightedIds}
                                    isFilterActive={queue.isFilterActive}
                                    activeFiltersDescription={queue.activeFiltersDescription}
                                    isLoading={queue.showMessagesLoading}
                                />
                            )}
                        </div>
                    </TabsContent >

                    <TabsContent value="activity" className="flex-1 min-h-0 rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col mt-0 data-[state=inactive]:hidden">
                        {/* Activity Sub-tabs */}
                        <div className="flex items-center border-b bg-muted/20">
                            {[
                                { id: 'activity' as const, icon: FileText, label: 'All Logs' },
                                { id: 'anomalies' as const, icon: AlertCircle, label: 'Anomalies', count: anomalies?.summary.total },
                                { id: 'consumers' as const, icon: User, label: 'Consumers', count: consumerStats ? Object.keys(consumerStats.stats).length : undefined },
                            ].map((tab) => {
                                const Icon = tab.icon
                                const isActive = activityTab === tab.id
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => navigateToActivityTab(tab.id)}
                                        className={cn(
                                            "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative",
                                            "hover:text-foreground hover:bg-muted/50",
                                            isActive
                                                ? "text-foreground"
                                                : "text-muted-foreground"
                                        )}
                                    >
                                        <Icon className={cn(
                                            "h-3.5 w-3.5",
                                            tab.id === 'anomalies' && anomalies && anomalies.summary.by_severity.critical > 0 && "text-destructive"
                                        )} />
                                        {tab.label}
                                        {typeof tab.count === 'number' && tab.count > 0 && (
                                            <span className={cn(
                                                "text-xs px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center",
                                                tab.id === 'anomalies' && anomalies && anomalies.summary.by_severity.critical > 0
                                                    ? "bg-destructive/10 text-destructive"
                                                    : "bg-muted text-muted-foreground"
                                            )}>
                                                {tab.count.toLocaleString()}
                                            </span>
                                        )}
                                        {isActive && (
                                            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/50" />
                                        )}
                                    </button>
                                )
                            })}
                        </div>

                        {/* Activity Content */}
                        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                            {activityTab === 'activity' && (
                                <ActivityLogsTable
                                    logs={activityLogs?.logs ?? []}
                                    loading={loadingActivity}
                                    formatTime={queue.formatTimestamp}
                                    pageSize={String(activityFilter.limit)}
                                    setPageSize={(size) => setActivityFilter(prev => ({ ...prev, limit: Number(size), offset: 0 }))}
                                    currentPage={Math.floor(activityFilter.offset / activityFilter.limit) + 1}
                                    setCurrentPage={(page) => setActivityFilter(prev => ({ ...prev, offset: (page - 1) * prev.limit }))}
                                    totalPages={activityLogs ? Math.ceil(activityLogs.pagination.total / activityFilter.limit) : 0}
                                    totalItems={activityLogs?.pagination.total ?? 0}
                                    isFilterActive={activityFilter.action !== '' || activityFilter.message_id !== '' || activityFilter.has_anomaly !== null}
                                    onViewMessageHistory={(msgId) => {
                                        setMessageIdSearch(msgId)
                                        fetchMessageHistory(msgId)
                                        setHistoryDialog({ isOpen: true, messageId: msgId })
                                    }}
                                />
                            )}
                            {activityTab === 'anomalies' && (
                                <AnomaliesTable
                                    anomalies={anomalies}
                                    loading={loadingAnomalies}
                                    severityFilter={anomalySeverityFilter}
                                    setSeverityFilter={setAnomalySeverityFilter}
                                    actionFilter={anomalyActionFilter}
                                    setActionFilter={setAnomalyActionFilter}
                                    typeFilter={anomalyTypeFilter}
                                    setTypeFilter={setAnomalyTypeFilter}
                                    sortBy={anomalySortBy}
                                    setSortBy={setAnomalySortBy}
                                    sortOrder={anomalySortOrder}
                                    setSortOrder={setAnomalySortOrder}
                                    onRefresh={fetchAnomalies}
                                    formatTime={queue.formatTimestamp}
                                />
                            )}
                            {activityTab === 'consumers' && (
                                <ConsumerStatsTable
                                    stats={consumerStats}
                                    loading={loadingConsumerStats}
                                    onRefresh={fetchConsumerStats}
                                    formatTime={queue.formatTimestamp}
                                />
                            )}
                        </div>
                    </TabsContent>
                </Tabs >
            </div >

            {/* API Key Configuration Dialog */}
            <Dialog open={showApiKeyInput} onOpenChange={setShowApiKeyInput}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>API Key Configuration</DialogTitle>
                        <DialogDescription>
                            Enter your API key to authenticate with the queue API.
                            This key is stored locally in your browser.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <input
                            type="password"
                            placeholder="Enter your SECRET_KEY..."
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                            The API key should match the SECRET_KEY environment variable on the server.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => {
                            setApiKey('')
                            setStoredApiKey('')
                            setShowApiKeyInput(false)
                        }}>Clear</Button>
                        <Button onClick={() => {
                            setStoredApiKey(apiKey)
                            setShowApiKeyInput(false)
                            queue.fetchAll()
                        }}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog >

            {/* Confirmation Dialog */}
            <Dialog open={queue.confirmDialog.isOpen} onOpenChange={(open: boolean) => queue.setConfirmDialog(prev => ({ ...prev, isOpen: open }))}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{queue.confirmDialog.title}</DialogTitle>
                        <DialogDescription>
                            {queue.confirmDialog.description}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => queue.setConfirmDialog(prev => ({ ...prev, isOpen: false }))}>Cancel</Button>
                        <Button variant="destructive" onClick={async () => {
                            await queue.confirmDialog.action()
                            queue.setConfirmDialog(prev => ({ ...prev, isOpen: false }))
                        }}>Confirm</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog >

            <CreateMessageDialog
                isOpen={createDialog}
                onClose={() => setCreateDialog(false)}
                onCreate={handleCreateMessage}
            />

            <EditMessageDialog
                isOpen={queue.editDialog.isOpen}
                onClose={() => queue.setEditDialog(prev => ({ ...prev, isOpen: false }))}
                onSave={queue.handleSaveEdit}
                message={queue.editDialog.message}
                queueType={queue.editDialog.queueType}
                defaultAckTimeout={queue.config?.ack_timeout_seconds ?? 60}
            />

            <ViewPayloadDialog
                isOpen={viewPayloadDialog.isOpen}
                onClose={() => setViewPayloadDialog(prev => ({ ...prev, isOpen: false }))}
                payload={viewPayloadDialog.payload}
            />

            <MoveMessageDialog
                isOpen={moveDialog.isOpen}
                onClose={() => {
                    setMoveDialog(prev => ({ ...prev, isOpen: false }))
                    setDlqReason("")
                }}
                onConfirm={handleMoveMessages}
                targetQueue={moveDialog.targetQueue}
                setTargetQueue={(q: string) => {
                    setMoveDialog(prev => ({ ...prev, targetQueue: q }))
                    if (q !== "dead") setDlqReason("")
                }}
                dlqReason={dlqReason}
                setDlqReason={setDlqReason}
                count={queue.selectedIds.size}
                currentQueue={queue.activeTab}
            />

            <Dialog open={historyDialog.isOpen} onOpenChange={(open) => setHistoryDialog(prev => ({ ...prev, isOpen: open }))}>
                <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Message History from {historyDialog.messageId}</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col -mx-6 px-6">
                        <MessageHistoryTable
                            history={messageHistory}
                            loading={loadingHistory}
                            messageId={messageIdSearch}
                            setMessageId={setMessageIdSearch}
                            onSearch={fetchMessageHistory}
                            formatTime={queue.formatTimestamp}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            <input
                type="file"
                ref={queue.fileInputRef}
                className="hidden"
                accept=".json"
                onChange={queue.handleImport}
            />
        </div >
    )
}
