import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { format } from "date-fns"
import { NavigateFunction, useSearchParams, useLocation } from "react-router-dom"

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
    queueTab: QueueTab
    navigate: NavigateFunction
    onEvent?: (type: string, payload: any) => void
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
    handleClearActivityLogs: () => void
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

const getFilterStateFromSearchParams = (params: URLSearchParams, queueTab: QueueTab) => {
    const rawPage = params.get("page")
    const parsedPage = rawPage ? Number(rawPage) : 1
    const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1

    const rawLimit = params.get("limit")
    const parsedLimit = rawLimit ? Number(rawLimit) : 100
    const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1 ? Math.floor(parsedLimit).toString() : "100"

    const sortBy = params.get("sortBy") || getDefaultSortBy(queueTab)
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

const buildSearchParams = (state: Omit<DashboardState, 'queue'>, queueTab: QueueTab): string => {
    const params = new URLSearchParams()

    if (state.page !== 1) params.set("page", state.page.toString())
    if (state.limit !== "100") params.set("limit", state.limit)
    if (state.sortBy !== getDefaultSortBy(queueTab)) params.set("sortBy", state.sortBy)
    if (state.sortOrder !== "desc") params.set("sortOrder", state.sortOrder)
    if (state.filterType && state.filterType !== "all") params.set("filterType", state.filterType)
    if (state.filterPriority) params.set("filterPriority", state.filterPriority)
    if (state.filterAttempts) params.set("filterAttempts", state.filterAttempts)
    if (state.startDate) params.set("startDate", state.startDate.toISOString())
    if (state.endDate) params.set("endDate", state.endDate.toISOString())
    if (state.search) params.set("search", state.search)

    const str = params.toString()
    return str ? `?${str}` : ''
}

// ============================================================================
// Main Hook
// ============================================================================

export function useQueueMessages({ authFetch, apiKey, queueTab, navigate, onEvent }: UseQueueMessagesOptions): UseQueueMessagesReturn {
    // Use search params and location from react-router
    const [searchParams] = useSearchParams()
    const location = useLocation()

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

    // Initialize state from URL search params
    const initialFilterState = useMemo(() => getFilterStateFromSearchParams(searchParams, queueTab), [])

    // Use queueTab from props (router param)
    const activeTab = queueTab

    // Filter & Sort State
    const [filterType, setFilterType] = useState(() => initialFilterState.filterType)
    const [filterPriority, setFilterPriority] = useState(() => initialFilterState.filterPriority)
    const [filterAttempts, setFilterAttempts] = useState(() => initialFilterState.filterAttempts)
    const [startDate, setStartDate] = useState<Date | undefined>(() => initialFilterState.startDate)
    const [endDate, setEndDate] = useState<Date | undefined>(() => initialFilterState.endDate)
    const [pageSize, setPageSize] = useState(() => initialFilterState.limit)
    const [currentPage, setCurrentPage] = useState(() => initialFilterState.page)
    const [sortBy, setSortBy] = useState(() => initialFilterState.sortBy)
    const [sortOrder, setSortOrder] = useState<SortOrder>(() => initialFilterState.sortOrder)
    const [search, setSearch] = useState(() => initialFilterState.search)

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

                    // Call the onEvent callback if provided
                    if (onEvent) {
                        onEvent(type, payload)
                    }

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
                                    limit: Number(pageSize) || 100,
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
    // URL Sync - Update search params when filter state changes (not tab changes)
    // =========================================================================

    // Track when we're navigating to prevent URL sync interference
    const isNavigatingRef = useRef(false)
    const prevTabRef = useRef(activeTab)

    useEffect(() => {
        // Only sync URL when we're on a queue route
        if (!location.pathname.startsWith('/queue/')) {
            return
        }

        // Skip URL sync when we're in the middle of a tab navigation
        if (isNavigatingRef.current) {
            return
        }

        // Skip URL sync when tab just changed - let the navigation settle
        if (prevTabRef.current !== activeTab) {
            prevTabRef.current = activeTab
            return
        }

        const searchStr = buildSearchParams({
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
        }, activeTab)

        // Use replace to update search params without adding to history
        navigate(`/queue/${activeTab}${searchStr}`, { replace: true })
    }, [navigate, location.pathname, activeTab, currentPage, endDate, filterAttempts, filterPriority, filterType, pageSize, search, sortBy, sortOrder, startDate])

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
        fetchConfig()
        fetchStatus()
    }, [fetchConfig, fetchStatus])

    // Sync state with URL search params when they change
    useEffect(() => {
        const filterState = getFilterStateFromSearchParams(searchParams, activeTab)
        setCurrentPage(filterState.page)
        setPageSize(filterState.limit)
        setSortBy(filterState.sortBy)
        setSortOrder(filterState.sortOrder)
        setFilterType(filterState.filterType)
        setFilterPriority(filterState.filterPriority)
        setFilterAttempts(filterState.filterAttempts)
        setStartDate(filterState.startDate)
        setEndDate(filterState.endDate)
        setSearch(filterState.search)
    }, [searchParams, activeTab])

    // =========================================================================
    // Handlers
    // =========================================================================

    const navigateToTab = useCallback((tab: QueueTab) => {
        // Set flag to prevent URL sync effect from interfering
        isNavigatingRef.current = true

        const defaultSortBy = getDefaultSortBy(tab)
        setSelectedIds(new Set())
        setLastSelectedId(null)
        setCurrentPage(1)
        setSortBy(defaultSortBy)
        setSortOrder("desc")

        // Build search params for filters
        const searchStr = buildSearchParams({
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
        }, tab)

        navigate(`/queue/${tab}${searchStr}`)

        // Clear flag after navigation (use setTimeout to ensure it happens after React batches updates)
        setTimeout(() => {
            isNavigatingRef.current = false
        }, 0)
    }, [navigate, endDate, filterAttempts, filterPriority, filterType, pageSize, search, startDate])

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

    const handleClearActivityLogs = useCallback(() => {
        setConfirmDialog({
            isOpen: true,
            title: "Clear Activity Logs",
            description: "Are you sure you want to clear the activity logs? This action cannot be undone.",
            action: async () => {
                try {
                    const response = await authFetch('/api/queue/activity/clear', { method: 'DELETE' })
                    if (response.ok) {
                        // If we are on Activity tab, we might want to refresh. 
                        // But fetchAll refreshes everything so it's fine.
                        fetchAll()
                    }
                    else {
                        const err = await response.json()
                        alert(`Error: ${err.message}`)
                    }
                } catch (err) {
                    alert("Failed to clear activity logs")
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
        handleClearActivityLogs,
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
