import React, { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import {
    RefreshCw,
    Play,
    Trash2,
    AlertTriangle,
    Loader2,
    Pause,
    ArrowRightLeft,
    Plus,
    Download,
    Upload,
    Key,
    KeyRound,
    MoreVertical,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Card, CardContent } from "@/components/ui/card"
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
import { ThemeToggle } from "@/components/ThemeToggle"

// Layout
import { Sidebar } from "@/components/layout"

// Queue Management
import { QueueManagement } from "@/components/queues"

// ============================================================================
// API Key Helpers
// ============================================================================

const getStoredApiKey = (): string => {
    const envKey = import.meta.env.VITE_SECRET_KEY
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
    const params = useParams<{ tab?: string; queueName?: string; messageId?: string }>()
    const navigate = useNavigate()
    const location = useLocation()

    // Get current queue name from URL (null means we're on the queue list page)
    const currentQueueName = params.queueName || null

    // Derive current view from URL path
    // /queues = queue list, /queues/:queueName/:tab = queue detail with messages or activity
    // Activity tabs: activity, anomalies, consumers
    const isQueueList = location.pathname === '/queues'
    const isActivityView = ACTIVITY_TABS.includes(params.tab as ActivityTab)
    const currentView: DashboardView = isQueueList ? 'queue-management' : (isActivityView ? 'activity' : 'queues')

    // Parse tabs from URL params
    const queueTab = parseQueueTab(params.tab)
    const activityTab = parseActivityTab(params.tab)

    // Refs for stable access in callbacks (must be defined before useQueueMessages)
    const currentViewRef = useRef(currentView)
    const activityTabRef = useRef(activityTab)
    currentViewRef.current = currentView
    activityTabRef.current = activityTab

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

    // Refs for fetch functions (to avoid stale closures in onEvent callback)
    const fetchActivityLogsRef = useRef<(silent?: boolean) => Promise<void>>()
    const fetchAnomaliesRef = useRef<(silent?: boolean) => Promise<void>>()
    const fetchConsumerStatsRef = useRef<() => Promise<void>>()

    // Use the queue messages hook with current queue tab
    const queue = useQueueMessages({
        authFetch,
        apiKey,
        queueTab,
        queueName: currentQueueName || 'default',
        navigate,
        onEvent: (type: string) => {
            // Refresh activity logs on relevant events if we are on the activity view
            // Use refs to avoid stale closure issues with currentView/activityTab
            // Use silent=true to avoid showing loading spinner on SSE-triggered updates
            if (currentViewRef.current === 'activity') {
                if (activityTabRef.current === 'activity') fetchActivityLogsRef.current?.(true)
                else if (activityTabRef.current === 'anomalies') fetchAnomaliesRef.current?.(true)
                // Consumer stats only update on dequeue events, not enqueue
                else if (activityTabRef.current === 'consumers' && type === 'dequeue') fetchConsumerStatsRef.current?.()
            }
        },
        onActivityCleared: () => {
            // Refresh activity data after clearing logs
            setActivityLogs(null)
            setAnomalies(null)
            setConsumerStats(null)
            fetchActivityLogsRef.current?.()
            fetchAnomaliesRef.current?.()
            fetchConsumerStatsRef.current?.()
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
    const [anomalyTypeFilter, setAnomalyTypeFilter] = useState<string>('')
    const [anomalySortBy, setAnomalySortBy] = useState<string>('timestamp')
    const [anomalySortOrder, setAnomalySortOrder] = useState<string>('desc')
    const [messageHistory, setMessageHistory] = useState<MessageHistoryResponse | null>(null)
    const [loadingHistory, setLoadingHistory] = useState(false)
    const [messageIdSearch, setMessageIdSearch] = useState('')
    const [consumerStats, setConsumerStats] = useState<ConsumerStatsResponse | null>(null)
    const [loadingConsumerStats, setLoadingConsumerStats] = useState(false)
    const [historyDialog, setHistoryDialog] = useState<{ isOpen: boolean; messageId: string | null }>({
        isOpen: false,
        messageId: null
    })

    // Queue refresh trigger - incremented when queues are created/renamed/deleted
    const [queueRefreshTrigger, setQueueRefreshTrigger] = useState(0)

    // Highlighted log IDs for activity logs (for animation on new entries)
    const [highlightedLogIds, setHighlightedLogIds] = useState<Set<string>>(new Set())

    // Ref for activity logs (for detecting new entries)
    const activityLogsRef = useRef(activityLogs)

    useEffect(() => {
        activityLogsRef.current = activityLogs
    }, [activityLogs])

    // Navigation helpers using react-router
    const navigateToActivityTab = useCallback((tab: ActivityTab) => {
        // Activity sub-tabs are within the queue context
        const queueName = currentQueueName || 'default'
        navigate(`/queues/${queueName}/${tab}`)
    }, [navigate, currentQueueName])

    // Activity Log fetch functions
    const fetchActivityLogs = useCallback(async (silent = false) => {
        if (!silent) setLoadingActivity(true)
        try {
            const params = new URLSearchParams()
            if (currentQueueName) params.append('queue_name', currentQueueName)
            if (activityFilter.action) params.append('action', activityFilter.action)
            if (activityFilter.message_id) params.append('message_id', activityFilter.message_id)
            if (activityFilter.has_anomaly !== null) params.append('has_anomaly', String(activityFilter.has_anomaly))
            params.append('limit', String(activityFilter.limit))
            params.append('offset', String(activityFilter.offset))

            const response = await authFetch(`/api/queue/activity?${params.toString()}`)
            if (response.ok) {
                const data = await response.json()

                // Detect new logs for highlighting (only on silent/SSE updates)
                if (silent && activityLogsRef.current?.logs) {
                    const existingIds = new Set(activityLogsRef.current.logs.map((l: { log_id: string }) => l.log_id))
                    const newLogIds = data.logs
                        .filter((l: { log_id: string }) => !existingIds.has(l.log_id))
                        .map((l: { log_id: string }) => l.log_id)

                    if (newLogIds.length > 0) {
                        // Add to highlighted set
                        setHighlightedLogIds(prev => {
                            const next = new Set(prev)
                            newLogIds.forEach((id: string) => next.add(id))
                            return next
                        })
                        // Remove highlight after animation
                        setTimeout(() => {
                            setHighlightedLogIds(prev => {
                                const next = new Set(prev)
                                newLogIds.forEach((id: string) => next.delete(id))
                                return next
                            })
                        }, 2000)
                    }
                }

                setActivityLogs(data)
            }
        } catch (err) {
            console.error('Failed to fetch activity logs:', err)
        } finally {
            if (!silent) setLoadingActivity(false)
        }
    }, [authFetch, activityFilter, currentQueueName])

    const fetchAnomalies = useCallback(async (silent = false) => {
        if (!silent) setLoadingAnomalies(true)
        try {
            const params = new URLSearchParams()
            if (currentQueueName) params.append('queue_name', currentQueueName)
            if (anomalySeverityFilter) params.append('severity', anomalySeverityFilter)
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
            if (!silent) setLoadingAnomalies(false)
        }
    }, [authFetch, anomalySeverityFilter, anomalyTypeFilter, anomalySortBy, anomalySortOrder, currentQueueName])

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

    // Update refs for fetch functions (used in onEvent callback to avoid stale closures)
    useEffect(() => {
        fetchActivityLogsRef.current = fetchActivityLogs
    }, [fetchActivityLogs])

    useEffect(() => {
        fetchAnomaliesRef.current = fetchAnomalies
    }, [fetchAnomalies])

    useEffect(() => {
        fetchConsumerStatsRef.current = fetchConsumerStats
    }, [fetchConsumerStats])

    // Effect to fetch activity data when view/tab changes
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

    // Re-fetch anomalies when sort or filter changes (skip initial render)
    const anomalyParamsInitialRef = useRef(true)
    useEffect(() => {
        if (anomalyParamsInitialRef.current) {
            anomalyParamsInitialRef.current = false
            return
        }
        if (currentView === 'activity' && activityTab === 'anomalies') {
            fetchAnomalies()
        }
    }, [anomalySortBy, anomalySortOrder, anomalySeverityFilter, anomalyTypeFilter, currentView, activityTab, fetchAnomalies])

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

    // Calculate activity counts for sidebar
    const activityCounts = {
        logs: activityLogs?.pagination?.total,
        anomalies: anomalies?.summary?.total,
        criticalAnomalies: anomalies?.summary?.by_severity?.critical ?? 0,
        consumers: consumerStats ? Object.keys(consumerStats.stats).length : undefined,
    }

    // Loading state
    if (queue.loadingStatus && !queue.statusData) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen">
                <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground font-medium">Loading queue data...</p>
            </div>
        )
    }

    // Get current tab title
    const getTabTitle = () => {
        if (isQueueList) return 'All Queues'
        if (isActivityView) {
            switch (activityTab) {
                case 'activity': return 'Activity Logs'
                case 'anomalies': return 'Anomalies'
                case 'consumers': return 'Consumers'
            }
        }
        switch (queueTab) {
            case 'main': return 'Main Queue'
            case 'processing': return 'Processing'
            case 'dead': return 'Dead Letter'
            case 'acknowledged': return 'Acknowledged'
            case 'archived': return 'Archived'
        }
        return 'Queue'
    }

    return (
        <div className="flex h-screen max-h-screen overflow-hidden animate-in fade-in duration-500">
            {/* Sidebar */}
            <Sidebar
                authFetch={authFetch}
                statusData={queue.statusData}
                activityCounts={activityCounts}
                refreshTrigger={queueRefreshTrigger}
            />

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                {/* Header */}
                <div className="h-[57px] flex items-center justify-between gap-4 px-6 border-b bg-background">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold">
                            {currentQueueName && !isQueueList && (
                                <span className="text-muted-foreground font-normal">{currentQueueName} / </span>
                            )}
                            {getTabTitle()}
                        </h2>
                        {!isQueueList && (
                            <>
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
                                            <RefreshCw className={cn("h-4 w-4", (queue.loadingMessages || queue.loadingStatus || loadingActivity || loadingAnomalies || loadingConsumerStats) && "animate-spin")} />
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
                                            {queue.autoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{queue.autoRefresh ? "Pause Auto-refresh" : "Enable Auto-refresh"}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </>
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                        <ThemeToggle />
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    aria-label="More actions"
                                >
                                    <MoreVertical className="h-4 w-4" />
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

                {/* Error Display */}
                {queue.error && (
                    <Card className="border-destructive/50 bg-destructive/10 mx-6 mt-4">
                        <CardContent className="pt-6 flex items-center gap-3 text-destructive">
                            <AlertTriangle className="h-5 w-5" />
                            <p className="font-medium text-sm">Error: {queue.error}</p>
                        </CardContent>
                    </Card>
                )}

                {/* Main Content Area */}
                <div className="flex-1 min-h-0 overflow-hidden">
                    <div className="h-full bg-card text-card-foreground overflow-hidden flex flex-col">
                        {/* Queue List View */}
                        {isQueueList && (
                            <QueueManagement
                                authFetch={authFetch}
                                onQueueSelect={(queueName) => navigate(`/queues/${queueName}/main`)}
                                onQueuesChanged={() => setQueueRefreshTrigger(prev => prev + 1)}
                            />
                        )}

                        {/* Queue Messages View */}
                        {!isQueueList && !isActivityView && (
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
                                        // Filter props
                                        search={queue.search}
                                        setSearch={queue.setSearch}
                                        filterType={queue.filterType}
                                        setFilterType={queue.setFilterType}
                                        filterPriority={queue.filterPriority}
                                        setFilterPriority={queue.setFilterPriority}
                                                                                startDate={queue.startDate}
                                        setStartDate={queue.setStartDate}
                                        endDate={queue.endDate}
                                        setEndDate={queue.setEndDate}
                                        availableTypes={queue.availableTypes}
                                        // Selection action handlers
                                        onMoveSelected={() => {
                                            const queues = ['main', 'processing', 'dead', 'acknowledged', 'archived']
                                            const defaultTarget = queues.find(q => q !== queue.activeTab) || 'processing'
                                            setMoveDialog(prev => ({ ...prev, isOpen: true, targetQueue: defaultTarget }))
                                        }}
                                        onDeleteSelected={queue.handleBulkDelete}
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
                                        // Filter props
                                        search={queue.search}
                                        setSearch={queue.setSearch}
                                        filterType={queue.filterType}
                                        setFilterType={queue.setFilterType}
                                        filterPriority={queue.filterPriority}
                                        setFilterPriority={queue.setFilterPriority}
                                                                                startDate={queue.startDate}
                                        setStartDate={queue.setStartDate}
                                        endDate={queue.endDate}
                                        setEndDate={queue.setEndDate}
                                        availableTypes={queue.availableTypes}
                                        // Selection action handlers
                                        onMoveSelected={() => {
                                            const queues = ['main', 'processing', 'dead', 'acknowledged', 'archived']
                                            const defaultTarget = queues.find(q => q !== queue.activeTab) || 'main'
                                            setMoveDialog(prev => ({ ...prev, isOpen: true, targetQueue: defaultTarget }))
                                        }}
                                        onDeleteSelected={queue.handleBulkDelete}
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
                                        // Filter props
                                        search={queue.search}
                                        setSearch={queue.setSearch}
                                        filterType={queue.filterType}
                                        setFilterType={queue.setFilterType}
                                        filterPriority={queue.filterPriority}
                                        setFilterPriority={queue.setFilterPriority}
                                                                                startDate={queue.startDate}
                                        setStartDate={queue.setStartDate}
                                        endDate={queue.endDate}
                                        setEndDate={queue.setEndDate}
                                        availableTypes={queue.availableTypes}
                                        // Selection action handlers
                                        onMoveSelected={() => {
                                            const queues = ['main', 'processing', 'dead', 'acknowledged', 'archived']
                                            const defaultTarget = queues.find(q => q !== queue.activeTab) || 'main'
                                            setMoveDialog(prev => ({ ...prev, isOpen: true, targetQueue: defaultTarget }))
                                        }}
                                        onDeleteSelected={queue.handleBulkDelete}
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
                                        // Filter props
                                        search={queue.search}
                                        setSearch={queue.setSearch}
                                        filterType={queue.filterType}
                                        setFilterType={queue.setFilterType}
                                        filterPriority={queue.filterPriority}
                                        setFilterPriority={queue.setFilterPriority}
                                                                                startDate={queue.startDate}
                                        setStartDate={queue.setStartDate}
                                        endDate={queue.endDate}
                                        setEndDate={queue.setEndDate}
                                        availableTypes={queue.availableTypes}
                                        // Selection action handlers
                                        onMoveSelected={() => {
                                            const queues = ['main', 'processing', 'dead', 'acknowledged', 'archived']
                                            const defaultTarget = queues.find(q => q !== queue.activeTab) || 'main'
                                            setMoveDialog(prev => ({ ...prev, isOpen: true, targetQueue: defaultTarget }))
                                        }}
                                        onDeleteSelected={queue.handleBulkDelete}
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
                                        // Filter props
                                        search={queue.search}
                                        setSearch={queue.setSearch}
                                        filterType={queue.filterType}
                                        setFilterType={queue.setFilterType}
                                        filterPriority={queue.filterPriority}
                                        setFilterPriority={queue.setFilterPriority}
                                                                                startDate={queue.startDate}
                                        setStartDate={queue.setStartDate}
                                        endDate={queue.endDate}
                                        setEndDate={queue.setEndDate}
                                        availableTypes={queue.availableTypes}
                                        // Selection action handlers
                                        onMoveSelected={() => {
                                            const queues = ['main', 'processing', 'dead', 'acknowledged', 'archived']
                                            const defaultTarget = queues.find(q => q !== queue.activeTab) || 'main'
                                            setMoveDialog(prev => ({ ...prev, isOpen: true, targetQueue: defaultTarget }))
                                        }}
                                        onDeleteSelected={queue.handleBulkDelete}
                                    />
                                )}
                            </div>
                        )}

                        {/* Activity View */}
                        {!isQueueList && isActivityView && (
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
                                        highlightedIds={highlightedLogIds}
                                        // Filter props
                                        filterAction={activityFilter.action}
                                        setFilterAction={(value) => setActivityFilter(prev => ({ ...prev, action: value, offset: 0 }))}
                                        filterMessageId={activityFilter.message_id}
                                        setFilterMessageId={(value) => setActivityFilter(prev => ({ ...prev, message_id: value, offset: 0 }))}
                                        filterHasAnomaly={activityFilter.has_anomaly}
                                        setFilterHasAnomaly={(value) => setActivityFilter(prev => ({ ...prev, has_anomaly: value, offset: 0 }))}
                                    />
                                )}
                                {activityTab === 'anomalies' && (
                                    <AnomaliesTable
                                        anomalies={anomalies}
                                        loading={loadingAnomalies}
                                        severityFilter={anomalySeverityFilter}
                                        setSeverityFilter={setAnomalySeverityFilter}
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
                        )}
                    </div>
                </div>
            </div>

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
            </Dialog>

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
            </Dialog>

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
        </div>
    )
}
