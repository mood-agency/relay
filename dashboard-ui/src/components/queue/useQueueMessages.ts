import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { format } from "date-fns"

import {
    type Message,
    type MessagesResponse,
    type SystemStatus,
    type QueueTab,
    type SortOrder,
    type DashboardState,
    type QueueConfig,
    QUEUE_TABS,
    getDefaultSortBy,
} from "./types"

// ============================================================================
// Types
// ============================================================================

export interface UseQueueMessagesOptions {
    authFetch: (url: string, options?: RequestInit) => Promise<Response>
    apiKey: string
}

export interface UseQueueMessagesReturn {
    // Status data
    statusData: SystemStatus | null
    loadingStatus: boolean
    
    // Messages data
    messagesData: MessagesResponse | null
    effectiveMessagesData: MessagesResponse | null
    loadingMessages: boolean
    showMessagesLoading: boolean
    
    // Config
    config: QueueConfig | null
    
    // Error state
    error: string | null
    
    // Tab state
    activeTab: QueueTab
    navigateToTab: (tab: QueueTab) => void
    
    // Pagination
    currentPage: number
    setCurrentPage: (page: number) => void
    pageSize: string
    setPageSize: (size: string) => void
    
    // Sorting
    sortBy: string
    sortOrder: SortOrder
    handleSort: (field: string) => void
    
    // Filtering
    filterType: string
    setFilterType: (type: string) => void
    filterPriority: string
    setFilterPriority: (priority: string) => void
    filterAttempts: string
    setFilterAttempts: (attempts: string) => void
    startDate: Date | undefined
    setStartDate: (date: Date | undefined) => void
    endDate: Date | undefined
    setEndDate: (date: Date | undefined) => void
    search: string
    setSearch: (search: string) => void
    isFilterActive: boolean
    activeFiltersDescription: string
    
    // Selection
    selectedIds: Set<string>
    setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
    handleToggleSelect: (id: string, shiftKey?: boolean) => void
    handleSelectAll: (ids: string[]) => void
    
    // Highlighting
    highlightedIds: Set<string>
    scrollResetKey: number
    
    // Auto refresh
    autoRefresh: boolean
    setAutoRefresh: (value: boolean) => void
    handleToggleAutoRefresh: () => void
    
    // Actions
    fetchAll: (silent?: boolean) => void
    handleRefresh: () => void
    handleDelete: (id: string, queue: string) => void
    handleTableDelete: (id: string) => void
    handleSaveEdit: (id: string, queueType: string, updates: any) => Promise<void>
    handleCreateMessage: (data: any) => Promise<void>
    handleMoveMessages: (targetQueue: string, dlqReason: string) => Promise<boolean>
    handleBulkDelete: () => void
    handleClearQueue: (queueType: string, label: string) => void
    handleClearAll: () => void
    handleExport: () => void
    handleImport: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
    
    // Dialog triggers
    openEditDialog: (message: Message) => void
    
    // Utilities
    formatTimestamp: (ts?: number) => string
    availableTypes: string[]
    messagesRef: React.RefObject<Message[]>
    fileInputRef: React.RefObject<HTMLInputElement>
    
    // Confirmation dialog state (for parent to render)
    confirmDialog: {
        isOpen: boolean
        title: string
        description: string
        action: () => Promise<void>
    }
    setConfirmDialog: React.Dispatch<React.SetStateAction<{
        isOpen: boolean
        title: string
        description: string
        action: () => Promise<void>
    }>>
    
    // Edit dialog state (for parent to render)
    editDialog: {
        isOpen: boolean
        message: Message | null
        queueType: string
    }
    setEditDialog: React.Dispatch<React.SetStateAction<{
        isOpen: boolean
        message: Message | null
        queueType: string
    }>>
}

// ============================================================================
// URL State Helpers
// ============================================================================

const parseQueueTab = (value: string | null): QueueTab | null => {
    if (!value) return null
    if ((QUEUE_TABS as readonly string[]).includes(value)) return value as QueueTab
    return null
}

const getDashboardStateFromLocation = (): DashboardState => {
    const url = new URL(window.location.href)
    const params = url.searchParams

    const queue = parseQueueTab(params.get("queue")) ?? "main"

    const rawPage = params.get("page")
    const parsedPage = rawPage ? Number(rawPage) : 1
    const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1

    const rawLimit = params.get("limit")
    const parsedLimit = rawLimit ? Number(rawLimit) : 25
    const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1 ? Math.floor(parsedLimit).toString() : "25"

    const sortBy = params.get("sortBy") || getDefaultSortBy(queue)
    const sortOrder: SortOrder = params.get("sortOrder") === "asc" ? "asc" : "desc"

    const filterType = params.get("filterType") || "all"
    const filterPriority = params.get("filterPriority") || ""
    const filterAttempts = params.get("filterAttempts") || ""

    const startDateRaw = params.get("startDate")
    const startDateParsed = startDateRaw ? new Date(startDateRaw) : undefined
    const startDate = startDateParsed && !Number.isNaN(startDateParsed.getTime()) ? startDateParsed : undefined

    const endDateRaw = params.get("endDate")
    const endDateParsed = endDateRaw ? new Date(endDateRaw) : undefined
    const endDate = endDateParsed && !Number.isNaN(endDateParsed.getTime()) ? endDateParsed : undefined

    const search = params.get("search") || ""

    return {
        queue,
        page,
        limit,
        sortBy,
        sortOrder,
        filterType,
        filterPriority,
        filterAttempts,
        startDate,
        endDate,
        search,
    }
}

const buildDashboardHref = (state: DashboardState) => {
    const url = new URL(window.location.href)
    const params = url.searchParams

    params.delete("queue")
    params.delete("page")
    params.delete("limit")
    params.delete("sortBy")
    params.delete("sortOrder")
    params.delete("filterType")
    params.delete("filterPriority")
    params.delete("filterAttempts")
    params.delete("startDate")
    params.delete("endDate")
    params.delete("search")

    if (state.queue !== "main") params.set("queue", state.queue)
    if (state.page !== 1) params.set("page", state.page.toString())
    if (state.limit !== "25") params.set("limit", state.limit)
    if (state.sortBy !== getDefaultSortBy(state.queue)) params.set("sortBy", state.sortBy)
    if (state.sortOrder !== "desc") params.set("sortOrder", state.sortOrder)
    if (state.filterType && state.filterType !== "all") params.set("filterType", state.filterType)
    if (state.filterPriority) params.set("filterPriority", state.filterPriority)
    if (state.filterAttempts) params.set("filterAttempts", state.filterAttempts)
    if (state.startDate) params.set("startDate", state.startDate.toISOString())
    if (state.endDate) params.set("endDate", state.endDate.toISOString())
    if (state.search) params.set("search", state.search)

    return `${url.pathname}${url.search}${url.hash}`
}

const writeDashboardStateToUrl = (state: DashboardState, mode: "push" | "replace") => {
    const next = buildDashboardHref(state)
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (next === current) return
    if (mode === "push") window.history.pushState(state, "", next)
    else window.history.replaceState(state, "", next)
}

// ============================================================================
// Main Hook
// ============================================================================

export function useQueueMessages({ authFetch, apiKey }: UseQueueMessagesOptions): UseQueueMessagesReturn {
    // Dialog state
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean
        title: string
        description: string
        action: () => Promise<void>
    }>({
        isOpen: false,
        title: "",
        description: "",
        action: async () => { },
    })

    const [editDialog, setEditDialog] = useState<{
        isOpen: boolean
        message: Message | null
        queueType: string
    }>({
        isOpen: false,
        message: null,
        queueType: "",
    })

    // System Status (Counts)
    const [statusData, setStatusData] = useState<SystemStatus | null>(null)
    const [loadingStatus, setLoadingStatus] = useState(true)

    // Table Data (Server-side)
    const [messagesData, setMessagesData] = useState<MessagesResponse | null>(null)
    const [messagesQueueType, setMessagesQueueType] = useState<QueueTab | null>(null)
    const [loadingMessages, setLoadingMessages] = useState(false)

    const [error, setError] = useState<string | null>(null)
    const [autoRefresh, setAutoRefresh] = useState(true)

    // Config State
    const [config, setConfig] = useState<QueueConfig | null>(null)

    // Initialize state from URL
    const initialDashboardState = useMemo(() => getDashboardStateFromLocation(), [])

    const [activeTab, setActiveTab] = useState<QueueTab>(() => initialDashboardState.queue)

    // Filter & Sort State
    const [filterType, setFilterType] = useState(() => initialDashboardState.filterType)
    const [filterPriority, setFilterPriority] = useState(() => initialDashboardState.filterPriority)
    const [filterAttempts, setFilterAttempts] = useState(() => initialDashboardState.filterAttempts)
    const [startDate, setStartDate] = useState<Date | undefined>(() => initialDashboardState.startDate)
    const [endDate, setEndDate] = useState<Date | undefined>(() => initialDashboardState.endDate)
    const [pageSize, setPageSize] = useState(() => initialDashboardState.limit)
    const [currentPage, setCurrentPage] = useState(() => initialDashboardState.page)
    const [sortBy, setSortBy] = useState(() => initialDashboardState.sortBy)
    const [sortOrder, setSortOrder] = useState<SortOrder>(() => initialDashboardState.sortOrder)
    const [search, setSearch] = useState(() => initialDashboardState.search)

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)
    const messagesRef = useRef<Message[]>([])

    // Computed values
    const effectiveMessagesData = messagesQueueType === activeTab ? messagesData : null
    const showMessagesLoading = loadingMessages || (messagesQueueType !== null && messagesQueueType !== activeTab)

    useEffect(() => {
        messagesRef.current = effectiveMessagesData?.messages ?? []
    }, [effectiveMessagesData])

    // Scroll Reset State
    const [scrollResetKey, setScrollResetKey] = useState(0)

    // Highlight State
    const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set())

    // Throttling Ref
    const lastStatusFetchRef = useRef(0)

    // File Input Ref
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Active Tab Ref (for race condition handling)
    const activeTabRef = useRef(activeTab)
    const prevAutoRefreshRef = useRef(autoRefresh)
    
    useEffect(() => {
        activeTabRef.current = activeTab
    }, [activeTab])

    // Trigger scroll reset on navigation/filter changes
    useEffect(() => {
        setScrollResetKey(prev => prev + 1)
    }, [activeTab, currentPage, pageSize, sortBy, sortOrder, filterType, filterPriority, filterAttempts, startDate, endDate, search])

    // Clear selection on navigation/filter changes
    useEffect(() => {
        setSelectedIds(new Set())
        setLastSelectedId(null)
    }, [activeTab, currentPage, pageSize, sortBy, sortOrder, filterType, filterPriority, filterAttempts, startDate, endDate, search])

    // =========================================================================
    // Fetch Functions
    // =========================================================================

    const fetchConfig = useCallback(async () => {
        try {
            const response = await authFetch('/api/queue/config')
            if (response.ok) {
                const json = await response.json()
                setConfig(json)
            }
        } catch (err) {
            console.error("Fetch config error:", err)
        }
    }, [authFetch])

    const fetchStatus = useCallback(async (includeMessages = true) => {
        try {
            const response = await authFetch(`/api/queue/status${!includeMessages ? '?include_messages=false' : ''}`)
            if (!response.ok) {
                let errorMsg = `HTTP ${response.status}: ${response.statusText}`
                try {
                    const errorJson = await response.json()
                    if (errorJson && errorJson.message) {
                        errorMsg += ` - ${errorJson.message}`
                    }
                } catch (e) { /* ignore */ }
                throw new Error(errorMsg)
            }
            const json = await response.json()

            if (includeMessages) {
                setStatusData(json)
            } else {
                setStatusData(prev => {
                    if (!prev) return json
                    return {
                        ...prev,
                        mainQueue: { ...prev.mainQueue, length: json.mainQueue.length },
                        processingQueue: { ...prev.processingQueue, length: json.processingQueue.length },
                        deadLetterQueue: { ...prev.deadLetterQueue, length: json.deadLetterQueue.length },
                        acknowledgedQueue: { ...prev.acknowledgedQueue, length: json.acknowledgedQueue.length, total: json.acknowledgedQueue.total },
                        metadata: json.metadata
                    }
                })
            }

            setError(null)
        } catch (err: any) {
            console.error("Fetch status error:", err)
        } finally {
            setLoadingStatus(false)
        }
    }, [authFetch])

    const fetchMessages = useCallback(async (silent = false) => {
        const currentTab = activeTab
        setMessagesQueueType(currentTab)
        if (!silent) setLoadingMessages(true)
        if (!silent) setMessagesData(null)
        try {
            const params = new URLSearchParams()
            params.append('page', currentPage.toString())
            params.append('limit', pageSize)
            params.append('sortBy', sortBy)
            params.append('sortOrder', sortOrder)

            if (filterType && filterType !== 'all') params.append('filterType', filterType)
            if (filterPriority) params.append('filterPriority', filterPriority)
            if (filterAttempts) params.append('filterAttempts', filterAttempts)
            if (startDate) params.append('startDate', startDate.toISOString())
            if (endDate) params.append('endDate', endDate.toISOString())
            if (search) params.append('search', search)

            const response = await authFetch(`/api/queue/${currentTab}/messages?${params.toString()}`)
            if (!response.ok) {
                let errorMsg = `HTTP ${response.status}: ${response.statusText}`
                try {
                    const errorJson = await response.json()
                    if (errorJson && errorJson.message) {
                        errorMsg += ` - ${errorJson.message}`
                    }
                } catch (e) { /* ignore */ }
                throw new Error(errorMsg)
            }
            const json = await response.json()

            if (currentTab !== activeTabRef.current) return

            setMessagesData(json)
            setError(null)
        } catch (err: any) {
            if (currentTab !== activeTabRef.current) return
            console.error("Fetch messages error:", err)
            setError(err.message)
        } finally {
            if (currentTab !== activeTabRef.current) return
            if (!silent) setLoadingMessages(false)
        }
    }, [activeTab, currentPage, pageSize, sortBy, sortOrder, filterType, filterPriority, filterAttempts, startDate, endDate, search, authFetch])

    const fetchAll = useCallback((silent = false) => {
        fetchStatus()
        fetchMessages(silent)
    }, [fetchStatus, fetchMessages])

    // =========================================================================
    // SSE / Auto Refresh
    // =========================================================================

    useEffect(() => {
        let interval: NodeJS.Timeout
        let eventSource: EventSource

        if (autoRefresh) {
            const sseUrl = apiKey 
                ? `/api/queue/events?apiKey=${encodeURIComponent(apiKey)}`
                : '/api/queue/events'
            eventSource = new EventSource(sseUrl)

            eventSource.addEventListener('queue-update', (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data)
                    const { type, payload } = data

                    const now = Date.now()
                    if (now - lastStatusFetchRef.current > 2000) {
                        fetchStatus(false)
                        lastStatusFetchRef.current = now
                    }

                    if (type === 'enqueue') {
                        if (payload.force_refresh) {
                            if (activeTab === 'main') {
                                fetchMessages(true)
                            }
                            fetchStatus(false)
                            return
                        }

                        if (activeTab !== 'main') return

                        const messagesToAdd = payload.messages || (payload.message ? [payload.message] : [])
                        if (!messagesToAdd.length) {
                            fetchMessages(true)
                            return
                        }
                        
                        const hasRedactedPayload = messagesToAdd.some((m: Message) => m.payload === "[REDACTED]")
                        if (hasRedactedPayload) {
                            fetchMessages(true)
                            return
                        }

                        setMessagesData(prev => {
                            const base: MessagesResponse = prev ?? {
                                messages: [],
                                pagination: {
                                    total: 0,
                                    page: 1,
                                    limit: Number(pageSize) || 25,
                                    totalPages: 1
                                }
                            }

                            const filteredNew = messagesToAdd.filter((m: Message) => {
                                if (base.messages.some(existing => existing.id === m.id)) return false
                                if (filterType && filterType !== 'all') {
                                    const types = filterType.split(',')
                                    if (!types.includes(m.type)) return false
                                }
                                if (filterPriority && m.priority !== parseInt(filterPriority)) return false
                                if (filterAttempts && (m.attempt_count || 0) < parseInt(filterAttempts)) return false
                                if (startDate && m.created_at * 1000 < startDate.getTime()) return false
                                if (endDate && m.created_at * 1000 > endDate.getTime()) return false
                                if (search) {
                                    const searchLower = search.toLowerCase()
                                    const matchesId = m.id.toLowerCase().includes(searchLower)
                                    const matchesPayload = m.payload && JSON.stringify(m.payload).toLowerCase().includes(searchLower)
                                    const matchesError = m.error_message && m.error_message.toLowerCase().includes(searchLower)
                                    if (!matchesId && !matchesPayload && !matchesError) return false
                                }
                                return true
                            })

                            if (filteredNew.length === 0) return base

                            const newTotal = base.pagination.total + filteredNew.length
                            const newTotalPages = Math.ceil(newTotal / base.pagination.limit)

                            const compare = (a: Message, b: Message) => {
                                let valA = (a as any)[sortBy]
                                let valB = (b as any)[sortBy]
                                if (sortBy === 'payload') {
                                    valA = JSON.stringify(valA)
                                    valB = JSON.stringify(valB)
                                }
                                if (valA < valB) return sortOrder === 'asc' ? -1 : 1
                                if (valA > valB) return sortOrder === 'asc' ? 1 : -1
                                return 0
                            }

                            let shouldUpdateRows = false
                            if (currentPage === 1) {
                                shouldUpdateRows = true
                            } else if (base.messages.length > 0) {
                                const firstMsg = base.messages[0]
                                const allBelongAfter = filteredNew.every((m: Message) => compare(m, firstMsg) >= 0)
                                if (allBelongAfter) {
                                    shouldUpdateRows = true
                                }
                            } else {
                                shouldUpdateRows = true
                            }

                            const newIds = filteredNew.map((m: Message) => m.id)
                            setTimeout(() => {
                                setHighlightedIds(prev => {
                                    const next = new Set(prev)
                                    newIds.forEach((id: string) => next.add(id))
                                    return next
                                })
                                setTimeout(() => {
                                    setHighlightedIds(prev => {
                                        const next = new Set(prev)
                                        newIds.forEach((id: string) => next.delete(id))
                                        return next
                                    })
                                }, 2000)
                            }, 0)

                            if (shouldUpdateRows) {
                                const combined = [...base.messages, ...filteredNew]
                                combined.sort(compare)
                                const updatedList = combined.slice(0, Number(pageSize))

                                return {
                                    ...base,
                                    messages: updatedList,
                                    pagination: {
                                        ...base.pagination,
                                        total: newTotal,
                                        totalPages: newTotalPages
                                    }
                                }
                            } else {
                                return {
                                    ...base,
                                    pagination: {
                                        ...base.pagination,
                                        total: newTotal,
                                        totalPages: newTotalPages
                                    }
                                }
                            }
                        })
                    } else if (type === 'acknowledge' || type === 'delete') {
                        const idsToRemove = payload.ids || (payload.id ? [payload.id] : [])
                        const affectedQueue = payload.queue

                        if (affectedQueue && affectedQueue !== activeTab) return

                        if (idsToRemove.length > 0) {
                            setMessagesData(prev => {
                                if (!prev) return prev

                                const inViewCount = prev.messages.filter(m => idsToRemove.includes(m.id)).length

                                if (inViewCount === 0) {
                                    const newTotal = Math.max(0, prev.pagination.total - idsToRemove.length)
                                    const newTotalPages = Math.ceil(newTotal / prev.pagination.limit) || 1
                                    return {
                                        ...prev,
                                        pagination: {
                                            ...prev.pagination,
                                            total: newTotal,
                                            totalPages: newTotalPages
                                        }
                                    }
                                }

                                const newTotal = Math.max(0, prev.pagination.total - inViewCount)
                                const newTotalPages = Math.ceil(newTotal / prev.pagination.limit) || 1

                                return {
                                    ...prev,
                                    messages: prev.messages.filter(m => !idsToRemove.includes(m.id)),
                                    pagination: {
                                        ...prev.pagination,
                                        total: newTotal,
                                        totalPages: newTotalPages
                                    }
                                }
                            })
                        } else {
                            fetchMessages(true)
                        }
                    } else if (type === 'update') {
                        if (payload.queue && payload.queue !== activeTab) return

                        if (payload.id && payload.updates) {
                            setMessagesData(prev => {
                                if (!prev) return prev
                                if (!prev.messages.some(m => m.id === payload.id)) return prev

                                return {
                                    ...prev,
                                    messages: prev.messages.map(m => m.id === payload.id ? { ...m, ...payload.updates } : m)
                                }
                            })
                        } else {
                            fetchMessages(true)
                        }
                    } else if (type === 'move') {
                        const { from, to, ids } = payload

                        if (from === activeTab && ids && ids.length > 0) {
                            setMessagesData(prev => {
                                if (!prev) return prev

                                const idsToRemove = new Set(ids)
                                const removedCount = prev.messages.filter(m => idsToRemove.has(m.id)).length
                                const newTotal = Math.max(0, prev.pagination.total - removedCount)
                                const newTotalPages = Math.ceil(newTotal / prev.pagination.limit) || 1

                                return {
                                    ...prev,
                                    messages: prev.messages.filter(m => !idsToRemove.has(m.id)),
                                    pagination: {
                                        ...prev.pagination,
                                        total: newTotal,
                                        totalPages: newTotalPages
                                    }
                                }
                            })
                        }

                        if (to === activeTab) {
                            fetchMessages(true)
                        }
                    } else {
                        fetchMessages(true)
                    }
                } catch (e) {
                    console.error("SSE Parse Error", e)
                    fetchAll(true)
                }
            })

            eventSource.onerror = (err: Event) => {
                console.error("SSE Error:", err)
                if (eventSource.readyState === EventSource.CLOSED) {
                    if (!interval) {
                        interval = setInterval(fetchAll, 5000)
                    }
                }
            }
        }

        return () => {
            if (interval) clearInterval(interval)
            if (eventSource) eventSource.close()
        }
    }, [autoRefresh, fetchAll, apiKey])

    // =========================================================================
    // URL Sync
    // =========================================================================

    useEffect(() => {
        writeDashboardStateToUrl({
            queue: activeTab,
            page: currentPage,
            limit: pageSize,
            sortBy,
            sortOrder,
            filterType,
            filterPriority,
            filterAttempts,
            startDate,
            endDate,
            search,
        }, "replace")
    }, [activeTab, currentPage, endDate, filterAttempts, filterPriority, filterType, pageSize, search, sortBy, sortOrder, startDate])

    // Fetch on filter/autoRefresh changes
    useEffect(() => {
        const justTurnedOff = prevAutoRefreshRef.current && !autoRefresh
        if (!justTurnedOff) {
            fetchAll()
        }
        prevAutoRefreshRef.current = autoRefresh
    }, [autoRefresh, fetchAll])

    // Initial Load
    useEffect(() => {
        const url = new URL(window.location.href)
        const rawQueue = url.searchParams.get("queue")
        const parsedQueue = parseQueueTab(rawQueue)
        let shouldReplace = false

        if (rawQueue && !parsedQueue) {
            url.searchParams.delete("queue")
            shouldReplace = true
        }

        const pageRaw = url.searchParams.get("page")
        if (pageRaw) {
            const n = Number(pageRaw)
            if (!Number.isFinite(n) || n < 1) {
                url.searchParams.delete("page")
                shouldReplace = true
            }
        }

        const limitRaw = url.searchParams.get("limit")
        if (limitRaw) {
            const n = Number(limitRaw)
            if (!Number.isFinite(n) || n < 1) {
                url.searchParams.delete("limit")
                shouldReplace = true
            }
        }

        const sortOrderRaw = url.searchParams.get("sortOrder")
        if (sortOrderRaw && sortOrderRaw !== "asc" && sortOrderRaw !== "desc") {
            url.searchParams.delete("sortOrder")
            shouldReplace = true
        }

        const startDateRaw = url.searchParams.get("startDate")
        if (startDateRaw) {
            const d = new Date(startDateRaw)
            if (Number.isNaN(d.getTime())) {
                url.searchParams.delete("startDate")
                shouldReplace = true
            }
        }

        const endDateRaw = url.searchParams.get("endDate")
        if (endDateRaw) {
            const d = new Date(endDateRaw)
            if (Number.isNaN(d.getTime())) {
                url.searchParams.delete("endDate")
                shouldReplace = true
            }
        }

        if (shouldReplace) {
            window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
        }

        const onPopState = () => {
            const next = getDashboardStateFromLocation()
            setActiveTab(next.queue)
            setCurrentPage(next.page)
            setPageSize(next.limit)
            setSortBy(next.sortBy)
            setSortOrder(next.sortOrder)
            setFilterType(next.filterType)
            setFilterPriority(next.filterPriority)
            setFilterAttempts(next.filterAttempts)
            setStartDate(next.startDate)
            setEndDate(next.endDate)
            setSearch(next.search)
            setSelectedIds(new Set())
            setLastSelectedId(null)
        }

        window.addEventListener("popstate", onPopState)
        fetchConfig()
        fetchStatus()
        return () => window.removeEventListener("popstate", onPopState)
    }, [fetchConfig, fetchStatus])

    // =========================================================================
    // Handlers
    // =========================================================================

    const navigateToTab = useCallback((tab: QueueTab) => {
        const defaultSortBy = getDefaultSortBy(tab)
        setActiveTab(tab)
        setSelectedIds(new Set())
        setLastSelectedId(null)
        setCurrentPage(1)
        setSortBy(defaultSortBy)
        setSortOrder("desc")
        writeDashboardStateToUrl({
            queue: tab,
            page: 1,
            limit: pageSize,
            sortBy: defaultSortBy,
            sortOrder: "desc",
            filterType,
            filterPriority,
            filterAttempts,
            startDate,
            endDate,
            search,
        }, "push")
    }, [endDate, filterAttempts, filterPriority, filterType, pageSize, search, startDate])

    const handleRefresh = useCallback(() => {
        fetchAll()
    }, [fetchAll])

    const handleToggleAutoRefresh = useCallback(() => {
        if (!autoRefresh) {
            setCurrentPage(1)
            setAutoRefresh(true)
        } else {
            setAutoRefresh(false)
        }
    }, [autoRefresh])

    const handleSort = useCallback((field: string) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === "asc" ? "desc" : "asc")
        } else {
            setSortBy(field)
            setSortOrder("desc")
        }
    }, [sortBy, sortOrder])

    const handleDelete = useCallback((id: string, queue: string) => {
        setConfirmDialog({
            isOpen: true,
            title: "Delete Message",
            description: "Are you sure you want to delete this message? This action cannot be undone.",
            action: async () => {
                try {
                    const response = await authFetch(`/api/queue/message/${id}?queueType=${queue}`, {
                        method: 'DELETE',
                    })
                    if (response.ok) fetchAll()
                    else {
                        const err = await response.json()
                        alert(`Error: ${err.message}`)
                    }
                } catch (err) {
                    alert("Failed to delete message")
                }
            }
        })
    }, [authFetch, fetchAll])

    const handleTableDelete = useCallback((id: string) => {
        handleDelete(id, activeTab)
    }, [handleDelete, activeTab])

    const handleClearAll = useCallback(() => {
        setConfirmDialog({
            isOpen: true,
            title: "Clear All Queues",
            description: "Are you sure you want to clear ALL queues? This cannot be undone.",
            action: async () => {
                try {
                    const response = await authFetch('/api/queue/clear', { method: 'DELETE' })
                    if (response.ok) fetchAll()
                    else {
                        const err = await response.json()
                        alert(`Error: ${err.message}`)
                    }
                } catch (err) {
                    alert("Failed to clear queues")
                }
            }
        })
    }, [authFetch, fetchAll])

    const handleSaveEdit = useCallback(async (id: string, queueType: string, updates: any) => {
        try {
            const response = await authFetch(`/api/queue/message/${id}?queueType=${queueType}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(updates),
            })

            if (response.ok) {
                fetchAll()
                setEditDialog(prev => ({ ...prev, isOpen: false }))
            } else {
                const err = await response.json()
                alert(`Error: ${err.message}`)
            }
        } catch (err) {
            alert("Failed to update message")
        }
    }, [authFetch, fetchAll])

    const handleCreateMessage = useCallback(async (data: any) => {
        try {
            const response = await authFetch('/api/queue/message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            })

            if (response.ok) {
                fetchAll()
            } else {
                const err = await response.json()
                alert(`Error: ${err.message}`)
            }
        } catch (err) {
            alert("Failed to create message")
        }
    }, [authFetch, fetchAll])

    const handleMoveMessages = useCallback(async (targetQueue: string, dlqReason: string) => {
        if (!selectedIds.size) return false

        const selectedMessages = messagesData?.messages.filter(m => selectedIds.has(m.id)) || []
        if (selectedMessages.length === 0) return false

        try {
            const reason = dlqReason.trim()
            const response = await authFetch('/api/queue/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: selectedMessages,
                    fromQueue: activeTab,
                    toQueue: targetQueue,
                    errorReason: targetQueue === 'dead' && reason ? reason : undefined
                })
            })

            if (response.ok) {
                setSelectedIds(new Set())
                fetchAll()
                return true
            } else {
                const err = await response.json()
                alert(`Error: ${err.message}`)
                return false
            }
        } catch (e) {
            alert("Failed to move messages")
            return false
        }
    }, [selectedIds, messagesData, activeTab, authFetch, fetchAll])

    const handleToggleSelect = useCallback((id: string, shiftKey?: boolean) => {
        const currentMessages = messagesRef.current

        setSelectedIds(prev => {
            const next = new Set(prev)
            const isSelected = next.has(id)

            if (shiftKey && lastSelectedId && currentMessages.length > 0) {
                const fromIndex = currentMessages.findIndex(m => m.id === lastSelectedId)
                const toIndex = currentMessages.findIndex(m => m.id === id)

                if (fromIndex !== -1 && toIndex !== -1) {
                    const start = Math.min(fromIndex, toIndex)
                    const end = Math.max(fromIndex, toIndex)
                    const rangeIds = currentMessages.slice(start, end + 1).map(m => m.id)
                    const shouldSelect = !isSelected

                    if (shouldSelect) {
                        for (const rangeId of rangeIds) next.add(rangeId)
                    } else {
                        for (const rangeId of rangeIds) next.delete(rangeId)
                    }
                    return next
                }
            }

            if (isSelected) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })

        setLastSelectedId(id)
    }, [lastSelectedId])

    const handleSelectAll = useCallback((ids: string[]) => {
        setSelectedIds(prev => {
            const allSelected = ids.every(id => prev.has(id))
            const next = new Set(prev)

            if (allSelected) {
                for (const id of ids) next.delete(id)
            } else {
                for (const id of ids) next.add(id)
            }
            return next
        })
    }, [])

    const handleBulkDelete = useCallback(() => {
        if (selectedIds.size === 0) return

        setConfirmDialog({
            isOpen: true,
            title: `Delete ${selectedIds.size} Messages`,
            description: "Are you sure you want to delete the selected messages? This action cannot be undone.",
            action: async () => {
                try {
                    const response = await authFetch(`/api/queue/messages/delete?queueType=${activeTab}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ messageIds: Array.from(selectedIds) }),
                    })

                    if (response.ok) {
                        fetchAll()
                        setSelectedIds(new Set())
                    } else {
                        const err = await response.json()
                        alert(`Error: ${err.message}`)
                    }
                } catch (err) {
                    alert("Failed to delete some messages")
                }
            }
        })
    }, [selectedIds, activeTab, authFetch, fetchAll])

    const handleClearQueue = useCallback((queueType: string, label: string) => {
        setConfirmDialog({
            isOpen: true,
            title: `Clear ${label} Queue`,
            description: `Are you sure you want to delete ALL messages in the ${label} queue? This action cannot be undone.`,
            action: async () => {
                try {
                    await authFetch(`/api/queue/${queueType}/clear`, {
                        method: 'DELETE',
                    })
                    fetchAll()
                    setSelectedIds(new Set())
                } catch (err) {
                    alert("Failed to clear queue")
                }
            }
        })
    }, [authFetch, fetchAll])

    const handleExport = useCallback(() => {
        try {
            const params = new URLSearchParams()
            params.append('sortBy', sortBy)
            params.append('sortOrder', sortOrder)

            if (filterType && filterType !== 'all') params.append('filterType', filterType)
            if (filterPriority) params.append('filterPriority', filterPriority)
            if (filterAttempts) params.append('filterAttempts', filterAttempts)
            if (startDate) params.append('startDate', startDate.toISOString())
            if (endDate) params.append('endDate', endDate.toISOString())
            if (search) params.append('search', search)

            window.location.href = `/api/queue/${activeTab}/export?${params.toString()}`
        } catch (err: any) {
            console.error("Export error:", err)
            alert(`Failed to export: ${err.message}`)
        }
    }, [activeTab, sortBy, sortOrder, filterType, filterPriority, filterAttempts, startDate, endDate, search])

    const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        try {
            const formData = new FormData()
            formData.append('file', file)

            const response = await authFetch('/api/queue/import', {
                method: 'POST',
                body: formData,
            })

            if (response.ok) {
                const res = await response.json()
                fetchAll()
                alert(res.message)
            } else {
                const err = await response.json()
                throw new Error(err.message)
            }
        } catch (err: any) {
            console.error("Import error:", err)
            alert(`Failed to import: ${err.message}`)
        } finally {
            if (fileInputRef.current) {
                fileInputRef.current.value = ""
            }
        }
    }, [authFetch, fetchAll])

    const openEditDialog = useCallback((message: Message) => {
        setEditDialog({ isOpen: true, message, queueType: activeTab })
    }, [activeTab])

    const formatTimestamp = useCallback((ts?: number) => {
        if (!ts) return "N/A"
        return format(new Date(ts * 1000), "dd MMM, yyyy HH:mm:ss.SSS")
    }, [])

    // =========================================================================
    // Computed Values
    // =========================================================================

    const availableTypes = statusData?.availableTypes || []

    const isFilterActive = useMemo(() => {
        return filterType !== 'all' ||
            filterPriority !== '' ||
            filterAttempts !== '' ||
            startDate !== undefined ||
            endDate !== undefined ||
            search !== ''
    }, [filterType, filterPriority, filterAttempts, startDate, endDate, search])

    const activeFiltersDescription = useMemo(() => {
        const filters = []
        if (filterType !== 'all') filters.push(`Type: ${filterType}`)
        if (filterPriority) filters.push(`Priority: ${filterPriority}`)
        if (filterAttempts) filters.push(`Min Attempts: ${filterAttempts}`)
        if (startDate) filters.push(`From: ${format(startDate, 'MMM d, HH:mm')}`)
        if (endDate) filters.push(`To: ${format(endDate, 'MMM d, HH:mm')}`)
        if (search) filters.push(`Search: "${search}"`)
        return filters.join(', ')
    }, [filterType, filterPriority, filterAttempts, startDate, endDate, search])

    // =========================================================================
    // Return
    // =========================================================================

    return {
        // Status data
        statusData,
        loadingStatus,
        
        // Messages data
        messagesData,
        effectiveMessagesData,
        loadingMessages,
        showMessagesLoading,
        
        // Config
        config,
        
        // Error state
        error,
        
        // Tab state
        activeTab,
        navigateToTab,
        
        // Pagination
        currentPage,
        setCurrentPage,
        pageSize,
        setPageSize,
        
        // Sorting
        sortBy,
        sortOrder,
        handleSort,
        
        // Filtering
        filterType,
        setFilterType,
        filterPriority,
        setFilterPriority,
        filterAttempts,
        setFilterAttempts,
        startDate,
        setStartDate,
        endDate,
        setEndDate,
        search,
        setSearch,
        isFilterActive,
        activeFiltersDescription,
        
        // Selection
        selectedIds,
        setSelectedIds,
        handleToggleSelect,
        handleSelectAll,
        
        // Highlighting
        highlightedIds,
        scrollResetKey,
        
        // Auto refresh
        autoRefresh,
        setAutoRefresh,
        handleToggleAutoRefresh,
        
        // Actions
        fetchAll,
        handleRefresh,
        handleDelete,
        handleTableDelete,
        handleSaveEdit,
        handleCreateMessage,
        handleMoveMessages,
        handleBulkDelete,
        handleClearQueue,
        handleClearAll,
        handleExport,
        handleImport,
        
        // Dialog triggers
        openEditDialog,
        
        // Utilities
        formatTimestamp,
        availableTypes,
        messagesRef,
        fileInputRef,
        
        // Dialog state
        confirmDialog,
        setConfirmDialog,
        editDialog,
        setEditDialog,
    }
}
