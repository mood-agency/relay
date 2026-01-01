import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
    RefreshCw,
    Play,
    Trash2,
    AlertTriangle,
    Loader2,
    Pause,
    Inbox,
    XCircle,
    CheckCircle2,
    Filter,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Pencil,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    Search,
    Move,
    Plus,
    Pickaxe,
    Check
} from "lucide-react"

import { format } from "date-fns"
import { DateTimePicker } from "@/components/ui/date-time-picker"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
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

// Types
interface Message {
    id: string
    type: string
    priority: number
    payload: any
    created_at: number
    processing_started_at?: number
    failed_at?: number
    acknowledged_at?: number
    attempt_count?: number
    error_message?: string
    last_error?: string
    dequeued_at?: number
    custom_ack_timeout?: number
    custom_max_attempts?: number
}

interface Pagination {
    total: number
    page: number
    limit: number
    totalPages: number
}

interface MessagesResponse {
    messages: Message[]
    pagination: Pagination
}

interface QueueInfo {
    name: string
    length: number
    messages: Message[] // Keeping this for backward compatibility if needed, but we rely on MessagesResponse for table
}

interface QueueMetadata {
    totalProcessed: number
    totalFailed: number
    totalAcknowledged: number
}

interface SystemStatus {
    mainQueue: QueueInfo
    processingQueue: QueueInfo
    deadLetterQueue: QueueInfo
    acknowledgedQueue: QueueInfo
    metadata: QueueMetadata
    availableTypes: string[]
}

const QUEUE_TABS = ["main", "processing", "dead", "acknowledged"] as const
type QueueTab = (typeof QUEUE_TABS)[number]
type SortOrder = "asc" | "desc"

type DashboardState = {
    queue: QueueTab
    page: number
    limit: string
    sortBy: string
    sortOrder: SortOrder
    filterType: string
    filterPriority: string
    filterAttempts: string
    startDate?: Date
    endDate?: Date
    search: string
}

export default function Dashboard() {
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        title: string;
        description: string;
        action: () => Promise<void>;
    }>({
        isOpen: false,
        title: "",
        description: "",
        action: async () => {},
    });

    const [editDialog, setEditDialog] = useState<{
        isOpen: boolean;
        message: Message | null;
        queueType: string;
    }>({
        isOpen: false,
        message: null,
        queueType: "",
    });

    const [moveDialog, setMoveDialog] = useState<{
        isOpen: boolean;
        targetQueue: string;
    }>({
        isOpen: false,
        targetQueue: "main",
    });

    const [createDialog, setCreateDialog] = useState(false);

    // System Status (Counts)
    const [statusData, setStatusData] = useState<SystemStatus | null>(null)
    const [loadingStatus, setLoadingStatus] = useState(true)
    
    // Table Data (Server-side)
    const [messagesData, setMessagesData] = useState<MessagesResponse | null>(null)
    const [loadingMessages, setLoadingMessages] = useState(false)

    const [error, setError] = useState<string | null>(null)
    const [autoRefresh, setAutoRefresh] = useState(false)
    const [lastUpdated, setLastUpdated] = useState<string>("")
    const parseQueueTab = useCallback((value: string | null): QueueTab | null => {
        if (!value) return null
        if ((QUEUE_TABS as readonly string[]).includes(value)) return value as QueueTab
        return null
    }, [])

    const getDashboardStateFromLocation = useCallback((): DashboardState => {
        const url = new URL(window.location.href)
        const params = url.searchParams

        const queue = parseQueueTab(params.get("queue")) ?? "main"

        const rawPage = params.get("page")
        const parsedPage = rawPage ? Number(rawPage) : 1
        const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1

        const rawLimit = params.get("limit")
        const parsedLimit = rawLimit ? Number(rawLimit) : 25
        const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1 ? Math.floor(parsedLimit).toString() : "25"

        const sortBy = params.get("sortBy") || "created_at"
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
    }, [parseQueueTab])

    const buildDashboardHref = useCallback((state: DashboardState) => {
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
        if (state.sortBy !== "created_at") params.set("sortBy", state.sortBy)
        if (state.sortOrder !== "desc") params.set("sortOrder", state.sortOrder)
        if (state.filterType && state.filterType !== "all") params.set("filterType", state.filterType)
        if (state.filterPriority) params.set("filterPriority", state.filterPriority)
        if (state.filterAttempts) params.set("filterAttempts", state.filterAttempts)
        if (state.startDate) params.set("startDate", state.startDate.toISOString())
        if (state.endDate) params.set("endDate", state.endDate.toISOString())
        if (state.search) params.set("search", state.search)

        return `${url.pathname}${url.search}${url.hash}`
    }, [])

    const writeDashboardStateToUrl = useCallback((state: DashboardState, mode: "push" | "replace") => {
        const next = buildDashboardHref(state)
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
        if (next === current) return
        if (mode === "push") window.history.pushState(state, "", next)
        else window.history.replaceState(state, "", next)
    }, [buildDashboardHref])

    const initialDashboardState = useMemo(() => getDashboardStateFromLocation(), [getDashboardStateFromLocation])

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
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => initialDashboardState.sortOrder)
    const [search, setSearch] = useState(() => initialDashboardState.search)
    
    // Config State
    const [config, setConfig] = useState<{ ack_timeout_seconds: number; max_attempts: number } | null>(null);

    // Selection State
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    
    // Scroll Reset State
    const [scrollResetKey, setScrollResetKey] = useState(0)
    
    // Throttling Ref
    const lastStatusFetchRef = useRef(0);

    // Trigger scroll reset on navigation/filter changes
    useEffect(() => {
        setScrollResetKey(prev => prev + 1)
    }, [activeTab, currentPage, pageSize, sortBy, sortOrder, filterType, filterPriority, filterAttempts, startDate, endDate, search])

    // Fetch Config
    const fetchConfig = useCallback(async () => {
        try {
            const response = await fetch('/api/queue/config');
            if (response.ok) {
                const json = await response.json();
                setConfig(json);
            }
        } catch (err) {
            console.error("Fetch config error:", err);
        }
    }, []);

    // Fetch System Status (Counts)
    const fetchStatus = useCallback(async (includeMessages = true) => {
        try {
            const response = await fetch(`/api/queue/status${!includeMessages ? '?include_messages=false' : ''}`)
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            const json = await response.json()
            
            if (includeMessages) {
                setStatusData(json)
            } else {
                // Merge counts only to preserve messages/types from full fetch
                setStatusData(prev => {
                    if (!prev) return json;
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
            
            setLastUpdated(new Date().toLocaleTimeString())
            setError(null)
        } catch (err: any) {
            console.error("Fetch status error:", err)
            // Don't set main error state here to avoid blocking table view if just stats fail
        } finally {
            setLoadingStatus(false)
        }
    }, [])

    // Fetch Messages (Table Data)
    const fetchMessages = useCallback(async (silent = false) => {
        if (!silent) setLoadingMessages(true)
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

            const response = await fetch(`/api/queue/${activeTab}/messages?${params.toString()}`)
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            const json = await response.json()
            setMessagesData(json)
            setError(null)
        } catch (err: any) {
            console.error("Fetch messages error:", err)
            setError(err.message)
        } finally {
            if (!silent) setLoadingMessages(false)
        }
    }, [activeTab, currentPage, pageSize, sortBy, sortOrder, filterType, filterPriority, filterAttempts, startDate, endDate, search])

    const fetchAll = useCallback((silent = false) => {
        fetchStatus()
        fetchMessages(silent)
    }, [fetchStatus, fetchMessages])

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
            setSelectedIds([])
        }

        window.addEventListener("popstate", onPopState)
        fetchConfig();
        fetchStatus();
        return () => window.removeEventListener("popstate", onPopState)
    }, [fetchConfig, fetchStatus, getDashboardStateFromLocation, parseQueueTab])

    const navigateToTab = useCallback((tab: QueueTab) => {
        setActiveTab(tab)
        setSelectedIds([])
        setCurrentPage(1)
        writeDashboardStateToUrl({
            queue: tab,
            page: 1,
            limit: pageSize,
            sortBy,
            sortOrder,
            filterType,
            filterPriority,
            filterAttempts,
            startDate,
            endDate,
            search,
        }, "push")
    }, [endDate, filterAttempts, filterPriority, filterType, pageSize, search, sortBy, sortOrder, startDate, writeDashboardStateToUrl])

    const getTabHref = useCallback((tab: QueueTab) => {
        return buildDashboardHref({
            queue: tab,
            page: 1,
            limit: pageSize,
            sortBy,
            sortOrder,
            filterType,
            filterPriority,
            filterAttempts,
            startDate,
            endDate,
            search,
        })
    }, [buildDashboardHref, endDate, filterAttempts, filterPriority, filterType, pageSize, search, sortBy, sortOrder, startDate])

    // Auto Refresh
    useEffect(() => {
        let interval: NodeJS.Timeout
        let eventSource: EventSource

        if (autoRefresh) {
            // Use SSE for reactive updates
            eventSource = new EventSource('/api/queue/events')
            
            eventSource.addEventListener('queue-update', (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);
                    const { type, payload } = data;

                    // Always fetch status to keep counters updated (lightweight)
                    // Throttle to max once per 2 seconds to reduce load
                    const now = Date.now();
                    if (now - lastStatusFetchRef.current > 2000) {
                        fetchStatus(false);
                        lastStatusFetchRef.current = now;
                    }

                    const isStandardSort = sortBy === 'created_at';
                    const hasNoFilters = 
                        !search && 
                        filterType === 'all' && 
                        !filterPriority && 
                        !filterAttempts && 
                        !startDate && 
                        !endDate;

                    if (type === 'enqueue') {
                        // Handle batch optimization signal
                        if (payload.force_refresh) {
                            if (activeTab === 'main') {
                                fetchMessages(true);
                            }
                            // Ensure status is updated for the new counts
                            fetchStatus(false);
                            return;
                        }

                        // Enqueue only affects main queue
                        if (activeTab !== 'main') return;

                        const messagesToAdd = payload.messages || (payload.message ? [payload.message] : []);
                        if (!messagesToAdd.length) return;

                        setMessagesData(prev => {
                            if (!prev) return prev;

                            // 1. Client-side Filtering
                            const filteredNew = messagesToAdd.filter((m: Message) => {
                                // Duplicate check
                                if (prev.messages.some(existing => existing.id === m.id)) return false;

                                // Filter Type
                                if (filterType && filterType !== 'all' && m.type !== filterType) return false;
                                
                                // Filter Priority
                                if (filterPriority && m.priority !== parseInt(filterPriority)) return false;
                                
                                // Filter Attempts
                                if (filterAttempts && (m.attempt_count || 0) < parseInt(filterAttempts)) return false;
                                
                                // Date Range
                                if (startDate && m.created_at * 1000 < startDate.getTime()) return false;
                                if (endDate && m.created_at * 1000 > endDate.getTime()) return false;
                                
                                // Search
                                if (search) {
                                    const searchLower = search.toLowerCase();
                                    const matchesId = m.id.toLowerCase().includes(searchLower);
                                    const matchesPayload = m.payload && JSON.stringify(m.payload).toLowerCase().includes(searchLower);
                                    const matchesError = m.error_message && m.error_message.toLowerCase().includes(searchLower);
                                    if (!matchesId && !matchesPayload && !matchesError) return false;
                                }
                                
                                return true;
                            });

                            if (filteredNew.length === 0) return prev;

                            // 2. Update Total Count
                            const newTotal = prev.pagination.total + filteredNew.length;
                            const newTotalPages = Math.ceil(newTotal / prev.pagination.limit);

                            // 3. Determine if we should update rows
                            // Helper to compare messages based on current sort
                            const compare = (a: Message, b: Message) => {
                                let valA = (a as any)[sortBy];
                                let valB = (b as any)[sortBy];
                                
                                if (sortBy === 'payload') {
                                    valA = JSON.stringify(valA);
                                    valB = JSON.stringify(valB);
                                }
                                
                                if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
                                if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
                                return 0;
                            };

                            let shouldUpdateRows = false;
                            if (currentPage === 1) {
                                shouldUpdateRows = true;
                            } else if (prev.messages.length > 0) {
                                // If any new message belongs "before" the current page's start, 
                                // it implies a shift from a previous page.
                                // In that case, we keep the view stable (don't update rows).
                                // We only update rows if new messages belong strictly "after" or "at" the start of this page.
                                const firstMsg = prev.messages[0];
                                const allBelongAfter = filteredNew.every((m: Message) => compare(m, firstMsg) >= 0);
                                if (allBelongAfter) {
                                    shouldUpdateRows = true;
                                }
                            } else {
                                shouldUpdateRows = true;
                            }

                            if (shouldUpdateRows) {
                                const combined = [...prev.messages, ...filteredNew];
                                combined.sort(compare);
                                const updatedList = combined.slice(0, Number(pageSize));
                                
                                return {
                                    ...prev,
                                    messages: updatedList,
                                    pagination: {
                                        ...prev.pagination,
                                        total: newTotal,
                                        totalPages: newTotalPages
                                    }
                                };
                            } else {
                                // Stable View: Just update total
                                return {
                                    ...prev,
                                    pagination: {
                                        ...prev.pagination,
                                        total: newTotal,
                                        totalPages: newTotalPages
                                    }
                                };
                            }
                        });
                    } else if (type === 'acknowledge' || type === 'delete') {
                         // Remove from list if present (works for any tab/view)
                         const idsToRemove = payload.ids || (payload.id ? [payload.id] : []);
                         
                         if (idsToRemove.length > 0) {
                             setMessagesData(prev => {
                                 if (!prev) return prev;
                                 
                                 // Update total count regardless of whether it's in view
                                 const newTotal = Math.max(0, prev.pagination.total - idsToRemove.length);
                                 const newTotalPages = Math.ceil(newTotal / prev.pagination.limit);

                                 // Check if any are in view to decide if we need to filter messages
                                 const shouldFilter = prev.messages.some(m => idsToRemove.includes(m.id));
                                 
                                 if (!shouldFilter) {
                                     return {
                                        ...prev,
                                        pagination: {
                                            ...prev.pagination,
                                            total: newTotal,
                                            totalPages: newTotalPages
                                        }
                                     };
                                 }
                                 
                                 return {
                                     ...prev,
                                     messages: prev.messages.filter(m => !idsToRemove.includes(m.id)),
                                     pagination: {
                                         ...prev.pagination,
                                         total: newTotal,
                                         totalPages: newTotalPages
                                     }
                                 };
                             });
                         } else {
                             fetchMessages(true);
                         }
                    } else if (type === 'update') {
                        // Check if update is for current queue
                        if (payload.queue && payload.queue !== activeTab) return;

                        if (payload.id && payload.updates) {
                            setMessagesData(prev => {
                                if (!prev) return prev;
                                // Only update if in view
                                if (!prev.messages.some(m => m.id === payload.id)) return prev;
                                
                                return {
                                    ...prev,
                                    messages: prev.messages.map(m => m.id === payload.id ? { ...m, ...payload.updates } : m)
                                };
                            });
                        } else {
                            fetchMessages(true);
                        }
                    } else {
                        // Other events (like metrics/stats only), just fetch stats or all
                        fetchMessages(true);
                    }
                } catch (e) {
                    console.error("SSE Parse Error", e);
                    fetchAll(true);
                }
            })

            eventSource.onerror = (err) => {
                console.error("SSE Error:", err)
                // If SSE fails, fallback to polling
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
    }, [autoRefresh, fetchAll])

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
    }, [activeTab, currentPage, endDate, filterAttempts, filterPriority, filterType, pageSize, search, sortBy, sortOrder, startDate, writeDashboardStateToUrl])

    useEffect(() => {
        fetchMessages()
    }, [fetchMessages])

    const handleRefresh = () => {
        fetchAll()
    }

    const handleSort = (field: string) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === "asc" ? "desc" : "asc")
        } else {
            setSortBy(field)
            setSortOrder("desc")
        }
    }

    const handleDelete = (id: string, queue: string) => {
        setConfirmDialog({
            isOpen: true,
            title: "Delete Message",
            description: "Are you sure you want to delete this message? This action cannot be undone.",
            action: async () => {
                try {
                    const response = await fetch(`/api/queue/message/${id}?queueType=${queue}`, {
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
    }

    const handleClearAll = () => {
        setConfirmDialog({
            isOpen: true,
            title: "Clear All Queues",
            description: "Are you sure you want to clear ALL queues? This cannot be undone.",
            action: async () => {
                try {
                    const response = await fetch('/api/queue/clear', { method: 'DELETE' })
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
    }

    const handleSaveEdit = async (id: string, queueType: string, updates: any) => {
        try {
            const response = await fetch(`/api/queue/message/${id}?queueType=${queueType}`, {
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
    }

    const handleCreateMessage = async (data: any) => {
        try {
            const response = await fetch('/api/queue/message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });
            
            if (response.ok) {
                fetchAll();
                setCreateDialog(false);
            } else {
                const err = await response.json();
                alert(`Error: ${err.message}`);
            }
        } catch (err) {
            alert("Failed to create message");
        }
    }

    const handleMoveMessages = async () => {
        if (!selectedIds.length) return;
        
        const selectedMessages = messagesData?.messages.filter(m => selectedIds.includes(m.id)) || [];
        if (selectedMessages.length === 0) return;

        try {
            const response = await fetch('/api/queue/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: selectedMessages,
                    fromQueue: activeTab,
                    toQueue: moveDialog.targetQueue
                })
            });
            
            if (response.ok) {
                const res = await response.json();
                setMoveDialog(prev => ({ ...prev, isOpen: false }));
                setSelectedIds([]);
                fetchAll();
            } else {
                const err = await response.json();
                alert(`Error: ${err.message}`);
            }
        } catch (e) {
            alert("Failed to move messages");
        }
    }

    const handleToggleSelect = (id: string) => {
        setSelectedIds(prev => 
            prev.includes(id) 
                ? prev.filter(i => i !== id)
                : [...prev, id]
        )
    }

    const handleSelectAll = (ids: string[]) => {
        const allSelected = ids.every(id => selectedIds.includes(id))
        
        if (allSelected) {
            setSelectedIds(prev => prev.filter(id => !ids.includes(id)))
        } else {
            const newIds = ids.filter(id => !selectedIds.includes(id))
            setSelectedIds(prev => [...prev, ...newIds])
        }
    }

    const handleBulkDelete = () => {
        if (selectedIds.length === 0) return

        setConfirmDialog({
            isOpen: true,
            title: `Delete ${selectedIds.length} Messages`,
            description: "Are you sure you want to delete the selected messages? This action cannot be undone.",
            action: async () => {
                try {
                    const response = await fetch(`/api/queue/messages/delete?queueType=${activeTab}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ messageIds: selectedIds }),
                    })
                    
                    if (response.ok) {
                        const json = await response.json()
                        fetchAll()
                        setSelectedIds([])
                    } else {
                        const err = await response.json()
                        alert(`Error: ${err.message}`)
                    }
                } catch (err) {
                    alert("Failed to delete some messages")
                }
            }
        })
    }

    const handleClearCurrentQueue = () => {
        setConfirmDialog({
            isOpen: true,
            title: `Clear ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Queue`,
            description: `Are you sure you want to delete ALL messages in the ${activeTab} queue? This action cannot be undone.`,
            action: async () => {
                try {
                    await fetch(`/api/queue/${activeTab}/clear`, {
                        method: 'DELETE',
                    })
                    fetchAll()
                    setSelectedIds([])
                } catch (err) {
                    alert("Failed to clear queue")
                }
            }
        })
    }

    const formatTimestamp = (ts?: number) => {
        if (!ts) return "N/A"
        return format(new Date(ts * 1000), "dd MMM, yyyy HH:mm:ss.SSS")
    }

    // Available types for filter dropdown
    const availableTypes = statusData?.availableTypes || []

    if (loadingStatus && !statusData) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen">
                <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground font-medium">Loading queue data...</p>
            </div>
        )
    }

    return (
        <div className="container mx-auto py-6 px-4 max-w-[1600px] h-screen max-h-screen overflow-hidden flex flex-col animate-in fade-in duration-500">
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8 items-stretch">
                {/* Left Sidebar */}
                <div className="space-y-6 lg:sticky lg:top-6 self-start">
                    {/* Header */}
                    <div className="flex items-center gap-3 px-2">
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-foreground leading-none">Relay</h1>
                        </div>
                    </div>

                    <div className="space-y-6">
                        {/* Actions */}
                        <div className="flex items-center gap-1 px-2">
                            <Button
                                onClick={() => setCreateDialog(true)}
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Create Message"
                                aria-label="Create Message"
                            >
                                <Plus className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                onClick={handleRefresh}
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Refresh"
                                aria-label="Refresh"
                            >
                                <RefreshCw className={cn("h-3.5 w-3.5", (loadingMessages || loadingStatus) && "animate-spin")} />
                            </Button>
                            <Button
                                onClick={() => setAutoRefresh(!autoRefresh)}
                                variant="ghost"
                                size="icon"
                                className={cn("h-8 w-8", autoRefresh && "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:text-secondary-foreground")}
                                title={autoRefresh ? "Auto refresh on" : "Auto refresh off"}
                                aria-label={autoRefresh ? "Disable auto refresh" : "Enable auto refresh"}
                            >
                                {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                            </Button>
                            <Button
                                onClick={handleClearAll}
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                title="Clear all queues"
                                aria-label="Clear all queues"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>

                        <div className="h-px bg-border/50" />

                        {/* Queue Navigation */}
                        <div className="space-y-1">
                            <h3 className="text-xs font-semibold text-muted-foreground px-2 pb-2 uppercase tracking-wider">Queues</h3>
                            <NavButton
                                active={activeTab === 'main'}
                                href={getTabHref("main")}
                                onClick={() => navigateToTab('main')}
                                icon={Inbox}
                                label="Main Queue"
                                count={statusData?.mainQueue?.length || 0}
                            />
                            <NavButton
                                active={activeTab === 'processing'}
                                href={getTabHref("processing")}
                                onClick={() => navigateToTab('processing')}
                                icon={Pickaxe}
                                label="Processing"
                                count={statusData?.processingQueue?.length || 0}
                            />
                            <NavButton
                                active={activeTab === 'dead'}
                                href={getTabHref("dead")}
                                onClick={() => navigateToTab('dead')}
                                icon={XCircle}
                                label="Dead Letter"
                                count={statusData?.deadLetterQueue?.length || 0}
                                variant="destructive"
                            />
                            <NavButton
                                active={activeTab === 'acknowledged'}
                                href={getTabHref("acknowledged")}
                                onClick={() => navigateToTab('acknowledged')}
                                icon={Check }
                                label="Acknowledged"
                                count={statusData?.acknowledgedQueue?.length || 0}
                                variant="success"
                            />
                        </div>

                        <div className="h-px bg-border/50" />

                        {/* Filters */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-semibold text-muted-foreground px-2 uppercase tracking-wider flex items-center gap-2">
                                <Filter className="h-3 w-3" /> Filters
                            </h3>
                            <div className="space-y-4 px-1">
                                {/* Search */}
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-foreground/80">Search</label>
                                    <div className="relative">
                                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <input
                                            placeholder="Search ID, payload..."
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pl-8 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-foreground/80">Message Type</label>
                                    <Select value={filterType} onValueChange={setFilterType}>
                                        <SelectTrigger className="w-full">
                                            <SelectValue placeholder="All Types" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Types</SelectItem>
                                            {availableTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-foreground/80">Priority</label>
                                    <input
                                        type="number"
                                        step="1"
                                        placeholder="Any"
                                        value={filterPriority}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === "" || /^-?\d+$/.test(val)) {
                                                setFilterPriority(val);
                                            }
                                        }}
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-foreground/80">Min Attempts</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        placeholder="Any"
                                        value={filterAttempts}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === "" || /^\d+$/.test(val)) {
                                                setFilterAttempts(val);
                                            }
                                        }}
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-foreground/80">Date Range</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-muted-foreground">Start</label>
                                            <DateTimePicker 
                                                date={startDate} 
                                                setDate={setStartDate} 
                                                placeholder="Start Date"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-muted-foreground">End</label>
                                            <DateTimePicker 
                                                date={endDate} 
                                                setDate={setEndDate} 
                                                placeholder="End Date"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {(search || filterType !== "all" || filterPriority || filterAttempts || startDate || endDate) && (
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => {
                                            setSearch("")
                                            setFilterType("all")
                                            setFilterPriority("")
                                            setFilterAttempts("")
                                            setStartDate(undefined)
                                            setEndDate(undefined)
                                        }}
                                        className="w-full animate-in fade-in zoom-in duration-200"
                                    >
                                        <XCircle className="h-3.5 w-3.5 mr-2" />
                                        Clear Filters
                                    </Button>
                                )}

                            </div>
                        </div>

                        <div className="h-px bg-border/50" />

                    
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="min-w-0 flex flex-col min-h-0 gap-4">
                    {error && (
                        <Card className="border-destructive/50 bg-destructive/10">
                            <CardContent className="pt-6 flex items-center gap-3 text-destructive">
                                <AlertTriangle className="h-5 w-5" />
                                <p className="font-medium text-sm">Error: {error}</p>
                            </CardContent>
                        </Card>
                    )}

                    <div className="flex items-center justify-between">
                        <div>
                            <div className="flex items-center gap-3">
                                <h2 className="text-lg font-semibold tracking-tight">
                                    {activeTab === 'main' && 'Main Queue'}
                                    {activeTab === 'processing' && 'Processing Queue'}
                                    {activeTab === 'dead' && 'Dead Letter Queue'}
                                    {activeTab === 'acknowledged' && 'Acknowledged Messages'}
                                </h2>
                               
                            </div>
                            <p className="text-sm text-muted-foreground">
                                {activeTab === 'main' && 'Messages waiting to be processed.'}
                                {activeTab === 'processing' && 'Messages currently being processed.'}
                                {activeTab === 'dead' && 'Messages that failed processing.'}
                                {activeTab === 'acknowledged' && 'Successfully processed messages.'}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            {selectedIds.length > 0 && (
                                <>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => {
                                            // Set default target to first queue that isn't the current one
                                            const queues = ['main', 'dead', 'acknowledged'];
                                            const defaultTarget = queues.find(q => q !== activeTab) || 'main';
                                            setMoveDialog(prev => ({ ...prev, isOpen: true, targetQueue: defaultTarget }));
                                        }}
                                        className="h-8 animate-in fade-in zoom-in duration-200"
                                    >
                                        <Move className="h-3.5 w-3.5 mr-2" />
                                        Move Selected ({selectedIds.length})
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={handleBulkDelete}
                                        className="h-8 animate-in fade-in zoom-in duration-200"
                                    >
                                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                                        Delete Selected ({selectedIds.length})
                                    </Button>
                                </>
                            )}
                            <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={handleClearCurrentQueue}
                                className="h-8 hover:bg-destructive hover:text-destructive-foreground"
                            >
                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                Clear {activeTab === 'dead' ? 'Dead Letter' : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Queue
                            </Button>
                        </div>
                    </div>

                    <div className="relative flex flex-col flex-1 min-h-0 rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
                        {/* Unified Table Loading State */}
                        {loadingMessages && (
                            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            </div>
                        )}
                        
                        {(activeTab === 'main' || activeTab === 'processing' || activeTab === 'acknowledged') && (
                            <QueueTable
                                messages={messagesData?.messages || []}
                                queueType={activeTab}
                                config={config}
                                onDelete={(id) => handleDelete(id, activeTab)}
                                onEdit={activeTab === 'main' || activeTab === 'processing' ? (msg) => setEditDialog({ isOpen: true, message: msg, queueType: activeTab }) : undefined}
                                formatTime={formatTimestamp}
                                pageSize={pageSize}
                                setPageSize={setPageSize}
                                selectedIds={selectedIds}
                                onToggleSelect={handleToggleSelect}
                                onToggleSelectAll={handleSelectAll}
                                currentPage={currentPage}
                                setCurrentPage={setCurrentPage}
                                totalPages={messagesData?.pagination?.totalPages || 0}
                                totalItems={messagesData?.pagination?.total || 0}
                                sortBy={sortBy}
                                sortOrder={sortOrder}
                                onSort={handleSort}
                                scrollResetKey={scrollResetKey}
                            />
                        )}
                        {activeTab === 'dead' && (
                            <DeadLetterTable
                                messages={messagesData?.messages || []}
                                config={config}
                                onDelete={(id) => handleDelete(id, 'dead')}
                                onEdit={(msg) => setEditDialog({ isOpen: true, message: msg, queueType: 'dead' })}
                                formatTime={formatTimestamp}
                                pageSize={pageSize}
                                setPageSize={setPageSize}
                                selectedIds={selectedIds}
                                onToggleSelect={handleToggleSelect}
                                onToggleSelectAll={handleSelectAll}
                                currentPage={currentPage}
                                setCurrentPage={setCurrentPage}
                                totalPages={messagesData?.pagination?.totalPages || 0}
                                totalItems={messagesData?.pagination?.total || 0}
                                sortBy={sortBy}
                                sortOrder={sortOrder}
                                onSort={handleSort}
                                scrollResetKey={scrollResetKey}
                            />
                        )}
                    </div>
                </div>
            </div>

            <Dialog open={confirmDialog.isOpen} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, isOpen: open }))}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{confirmDialog.title}</DialogTitle>
                        <DialogDescription>
                            {confirmDialog.description}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}>Cancel</Button>
                        <Button variant="destructive" onClick={async () => {
                            await confirmDialog.action();
                            setConfirmDialog(prev => ({ ...prev, isOpen: false }));
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
                isOpen={editDialog.isOpen}
                onClose={() => setEditDialog(prev => ({ ...prev, isOpen: false }))}
                onSave={handleSaveEdit}
                message={editDialog.message}
                queueType={editDialog.queueType}
            />

            <MoveMessageDialog
                isOpen={moveDialog.isOpen}
                onClose={() => setMoveDialog(prev => ({ ...prev, isOpen: false }))}
                onConfirm={handleMoveMessages}
                targetQueue={moveDialog.targetQueue}
                setTargetQueue={(q) => setMoveDialog(prev => ({ ...prev, targetQueue: q }))}
                count={selectedIds.length}
                currentQueue={activeTab}
            />
        </div>
    )
}

function MoveMessageDialog({
    isOpen,
    onClose,
    onConfirm,
    targetQueue,
    setTargetQueue,
    count,
    currentQueue
}: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void>;
    targetQueue: string;
    setTargetQueue: (q: string) => void;
    count: number;
    currentQueue: string;
}) {
    const allQueues = [
        { value: "main", label: "Main Queue" },
        { value: "processing", label: "Processing Queue" },
        { value: "dead", label: "Dead Letter Queue" },
        { value: "acknowledged", label: "Acknowledged Queue" },
    ];
    
    // Filter out the current queue from available options
    const availableQueues = allQueues.filter(q => q.value !== currentQueue);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Move Messages</DialogTitle>
                    <DialogDescription>
                        Move {count} selected messages to another queue.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="targetQueue" className="text-right text-sm font-medium">
                            To Queue
                        </label>
                        <Select value={targetQueue} onValueChange={setTargetQueue}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="Select queue" />
                            </SelectTrigger>
                            <SelectContent>
                                {availableQueues.map(q => (
                                    <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={onConfirm}>Move Messages</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function NavButton({ active, href, onClick, icon: Icon, label, count, variant = "default" }: any) {
    const badgeColor = 
        variant === "destructive" ? "bg-red-100 text-red-700 hover:bg-red-100" :
        variant === "success" ? "bg-green-100 text-green-700 hover:bg-green-100" : 
        "bg-secondary text-secondary-foreground hover:bg-secondary/80";

    return (
        <Button
            asChild
            variant={active ? "secondary" : "ghost"}
            className={cn(
                "w-full justify-between font-normal h-10 px-3",
                active && "bg-secondary font-medium shadow-sm"
            )}
        >
            <a
                href={href}
                onClick={(e) => {
                    if (!onClick) return
                    e.preventDefault()
                    onClick()
                }}
            >
                <span className="flex items-center gap-3">
                    <Icon className={cn("h-4 w-4", active ? "text-foreground" : "text-muted-foreground")} />
                    <span className={cn(active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                </span>
                {count > 0 && (
                    <Badge variant="secondary" className={cn("ml-auto text-[10px] h-5 px-1.5 min-w-[1.25rem] justify-center", badgeColor)}>
                        {count}
                    </Badge>
                )}
            </a>
        </Button>
    )
}

function PaginationFooter({
    pageSize,
    setPageSize,
    currentPage,
    totalPages,
    setCurrentPage,
    totalItems
}: {
    pageSize: string,
    setPageSize: (size: string) => void,
    currentPage: number,
    totalPages: number,
    setCurrentPage: (page: number) => void,
    totalItems: number
}) {
    return (
        <div className="shrink-0 flex items-center justify-between px-4 py-4 border-t bg-muted/5">
            <div className="flex items-center space-x-2">
                <p className="text-sm font-medium text-muted-foreground">Rows per page</p>
                <Select value={pageSize} onValueChange={setPageSize}>
                    <SelectTrigger className="h-8 w-[70px]">
                        <SelectValue placeholder={pageSize} />
                    </SelectTrigger>
                    <SelectContent side="top">
                        {[25, 50, 100, 250, 500, 1000].map((pageSize) => (
                            <SelectItem key={pageSize} value={`${pageSize}`}>
                                {pageSize}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            
            <div className="flex items-center space-x-6 lg:space-x-8">
                <div className="flex w-[200px] items-center justify-center text-sm font-medium">
                    Page {currentPage} of {totalPages} ({totalItems} items)
                </div>
                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0 lg:flex"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                    >
                        <span className="sr-only">Go to first page</span>
                        <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => setCurrentPage(currentPage - 1)}
                        disabled={currentPage === 1}
                    >
                        <span className="sr-only">Go to previous page</span>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => setCurrentPage(currentPage + 1)}
                        disabled={currentPage === totalPages}
                    >
                        <span className="sr-only">Go to next page</span>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0 lg:flex"
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                    >
                        <span className="sr-only">Go to last page</span>
                        <ChevronsRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    )
}

function SortableHeader({ label, field, currentSort, currentOrder, onSort }: { label: string, field: string, currentSort: string, currentOrder: string, onSort: (f: string) => void }) {
    return (
        <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground cursor-pointer hover:bg-muted/50 transition-colors text-xs" onClick={() => onSort(field)}>
            <div className="flex items-center gap-1">
                {label}
                {currentSort === field ? (
                    currentOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                ) : (
                    <ArrowUpDown className="h-3 w-3 text-muted-foreground opacity-50" />
                )}
            </div>
        </TableHead>
    )
}

function useElementHeight(elementRef: { current: HTMLElement | null }) {
    const [height, setHeight] = useState(0)

    useEffect(() => {
        let rafId = 0
        let cleanup = () => {}

        const attach = () => {
            const element = elementRef.current
            if (!element) {
                rafId = window.requestAnimationFrame(attach)
                return
            }

            const update = () => setHeight(element.getBoundingClientRect().height)
            update()

            if (typeof ResizeObserver === "undefined") {
                window.addEventListener("resize", update)
                cleanup = () => window.removeEventListener("resize", update)
                return
            }

            const observer = new ResizeObserver(update)
            observer.observe(element)
            cleanup = () => observer.disconnect()
        }

        attach()

        return () => {
            if (rafId) window.cancelAnimationFrame(rafId)
            cleanup()
        }
    }, [])

    return height
}

function QueueTable({ 
    messages, 
    queueType, 
    config,
    onDelete, 
    onEdit, 
    formatTime, 
    pageSize, 
    setPageSize, 
    selectedIds, 
    onToggleSelect, 
    onToggleSelectAll,
    currentPage,
    setCurrentPage,
    totalPages,
    totalItems,
    sortBy,
    sortOrder,
    onSort,
    scrollResetKey
}: {
    messages: Message[],
    queueType: string,
    config?: { ack_timeout_seconds: number; max_attempts: number } | null,
    onDelete: (id: string) => void,
    onEdit?: (message: Message) => void,
    formatTime: (ts?: number) => string,
    pageSize: string,
    setPageSize: (size: string) => void,
    selectedIds: string[],
    onToggleSelect: (id: string) => void,
    onToggleSelectAll: (ids: string[]) => void,
    currentPage: number,
    setCurrentPage: (page: number) => void,
    totalPages: number,
    totalItems: number,
    sortBy: string,
    sortOrder: string,
    onSort: (field: string) => void,
    scrollResetKey: number
}) {
    // Add state for live updates
    const [currentTime, setCurrentTime] = useState(Date.now())

    useEffect(() => {
        if (queueType === 'processing') {
            setCurrentTime(Date.now())
        }
    }, [queueType])

    useEffect(() => {
        // Only run interval if we are in processing queue and have messages
        if (queueType !== 'processing' || messages.length === 0) return

        setCurrentTime(Date.now())
        const interval = setInterval(() => {
            setCurrentTime(Date.now())
        }, 1000)

        return () => clearInterval(interval)
    }, [queueType, messages.length])
    
    const getTimeLabel = () => {
        switch (queueType) {
            case 'processing': return 'Started At'
            case 'acknowledged': return 'Ack At'
            default: return 'Created At'
        }
    }

    const getTimeField = () => {
        switch (queueType) {
            case 'processing': return 'processing_started_at'
            case 'acknowledged': return 'acknowledged_at'
            default: return 'created_at'
        }
    }

    const getTimeValue = (m: Message) => {
        switch (queueType) {
            case 'processing': return m.dequeued_at || m.processing_started_at
            case 'acknowledged': return m.acknowledged_at
            default: return m.created_at
        }
    }

    const calculateTimeRemaining = (m: Message) => {
        if (queueType !== 'processing' || !config) return null
        
        // Use dequeued_at if available, otherwise fall back to processing_started_at
        const startTime = m.dequeued_at || m.processing_started_at
        if (!startTime) return "N/A"

        // startTime is in seconds (from backend), ack_timeout_seconds is in seconds
        // currentTime is in ms, so divide by 1000
        const now = currentTime / 1000
        
        // Use custom timeout if available, else global config
        const timeoutSeconds = m.custom_ack_timeout || config.ack_timeout_seconds
        
        const deadline = startTime + timeoutSeconds
        const remaining = deadline - now

        if (remaining <= 0) return <span className="text-destructive font-medium">Overdue</span>
        
        return <span className="text-primary font-mono">{Math.ceil(remaining)}s</span>
    }

    const allSelected = messages.length > 0 && messages.every(msg => selectedIds.includes(msg.id))

    const getPriorityBadge = (p: number) => (
        <span className="text-xs text-foreground">
            {p ?? 0}
        </span>
    )

    const shouldVirtualize = messages.length >= 100
    const scrollContainerRef = useRef<HTMLDivElement | null>(null)
    const viewportHeight = useElementHeight(scrollContainerRef)
    const [scrollTop, setScrollTop] = useState(0)

    useEffect(() => {
        setScrollTop(0)
        if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0
    }, [scrollResetKey])

    const virtual = useMemo(() => {
        if (!shouldVirtualize) return null

        const rowHeight = 44
        const overscan = 8
        const viewportPx = Math.max(viewportHeight, 320)
        const total = messages.length

        const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
        const endIndex = Math.min(total, Math.ceil((scrollTop + viewportPx) / rowHeight) + overscan)

        return {
            rowHeight,
            startIndex,
            endIndex,
            topSpacerHeight: startIndex * rowHeight,
            bottomSpacerHeight: (total - endIndex) * rowHeight,
            visibleMessages: messages.slice(startIndex, endIndex),
        }
    }, [messages, scrollTop, shouldVirtualize, viewportHeight])

    return (
        <div className="flex flex-col flex-1 min-h-0">
            <div
                ref={scrollContainerRef}
                className="relative flex-1 min-h-0 overflow-auto"
                onScroll={shouldVirtualize ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
            >
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent border-b border-border/50">
                            <TableHead className="sticky top-0 z-20 bg-card w-[40px] text-xs">
                                <input 
                                    type="checkbox" 
                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer align-middle accent-primary"
                                    checked={allSelected}
                                    onChange={() => onToggleSelectAll(messages.map(m => m.id))}
                                />
                            </TableHead>
                            <SortableHeader label="ID" field="id" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Type" field="type" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Priority" field="priority" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Payload" field="payload" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label={getTimeLabel()} field={getTimeField()} currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Attempts" field="attempt_count" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            {(queueType === 'main' || queueType === 'acknowledged') && <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Ack Timeout</TableHead>}
                            {queueType === 'processing' && <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Time Remaining</TableHead>}
                            <TableHead className="sticky top-0 z-20 bg-card text-right font-semibold text-foreground pr-6 text-xs">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {messages.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground opacity-50 italic text-xs">
                                    No messages found.
                                </TableCell>
                            </TableRow>
                        ) : shouldVirtualize && virtual ? (
                            <>
                                {virtual.topSpacerHeight > 0 && (
                                    <TableRow className="hover:bg-transparent">
                                        <TableCell colSpan={9} className="p-0" style={{ height: virtual.topSpacerHeight }} />
                                    </TableRow>
                                )}
                                {virtual.visibleMessages.map((msg) => {
                                    const payloadText = JSON.stringify(msg.payload)
                                    return (
                                        <TableRow key={msg.id} className="group transition-colors duration-150 border-muted/30">
                                            <TableCell>
                                                <input 
                                                    type="checkbox" 
                                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer align-middle accent-primary"
                                                    checked={selectedIds.includes(msg.id)}
                                                    onChange={(e) => {
                                                        e.stopPropagation()
                                                        onToggleSelect(msg.id)
                                                    }}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-xs text-foreground font-mono" title={msg.id}>
                                                    {msg.id}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-left"><Badge variant="outline" className="font-medium">{msg.type}</Badge></TableCell>
                                            <TableCell className="text-left">{getPriorityBadge(msg.priority)}</TableCell>
                                            <TableCell className="max-w-[300px]">
                                                <div className="truncate text-xs font-mono" title={payloadText}>
                                                    {payloadText}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs text-foreground whitespace-nowrap">
                                                {formatTime(getTimeValue(msg))}
                                            </TableCell>
                                            <TableCell>
                                                    <span className="text-xs text-foreground pl-4 block">
                                                        {msg.attempt_count || (queueType === 'main' ? 0 : 1)}
                                                        {(msg.custom_max_attempts ?? config?.max_attempts) && (
                                                            <span className="text-muted-foreground"> / {msg.custom_max_attempts ?? config?.max_attempts}</span>
                                                        )}
                                                    </span>
                                            </TableCell>
                                            {(queueType === 'main' || queueType === 'acknowledged') && (
                                                <TableCell className="text-xs text-foreground whitespace-nowrap">
                                                    {msg.custom_ack_timeout ?? config?.ack_timeout_seconds ?? 60}s
                                                </TableCell>
                                            )}
                                            {queueType === 'processing' && (
                                                <TableCell className="text-xs text-foreground whitespace-nowrap">
                                                    {calculateTimeRemaining(msg)}
                                                </TableCell>
                                            )}
                                            <TableCell className="text-right pr-6">
                                                <div className="flex justify-end gap-1">
                                                    {onEdit && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                onEdit(msg)
                                                            }}
                                                            className="text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all rounded-full h-8 w-8"
                                                            title="Edit Message"
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            onDelete(msg.id)
                                                        }}
                                                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all rounded-full h-8 w-8"
                                                        title="Delete Message"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                                {virtual.bottomSpacerHeight > 0 && (
                                    <TableRow className="hover:bg-transparent">
                                        <TableCell colSpan={9} className="p-0" style={{ height: virtual.bottomSpacerHeight }} />
                                    </TableRow>
                                )}
                            </>
                        ) : (
                            messages.map((msg) => {
                                const payloadText = JSON.stringify(msg.payload)
                                return (
                                <TableRow key={msg.id} className="group transition-colors duration-150 border-muted/30">
                                    <TableCell>
                                        <input 
                                            type="checkbox" 
                                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer align-middle accent-primary"
                                            checked={selectedIds.includes(msg.id)}
                                            onChange={(e) => {
                                                e.stopPropagation()
                                                onToggleSelect(msg.id)
                                            }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                                <span className="text-xs text-foreground font-mono" title={msg.id}>
                                                    {msg.id}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-left"><Badge variant="outline" className="font-medium">{msg.type}</Badge></TableCell>
                                            <TableCell className="text-left">{getPriorityBadge(msg.priority)}</TableCell>
                                            <TableCell className="max-w-[300px]">
                                                <div className="truncate text-xs text-muted-foreground font-mono" title={payloadText}>
                                                    {payloadText}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs text-foreground whitespace-nowrap">
                                                {formatTime(getTimeValue(msg))}
                                            </TableCell>
                                            <TableCell>
                                                    <span className="text-xs text-foreground pl-4 block">
                                                        {msg.attempt_count || (queueType === 'main' ? 0 : 1)}
                                                        {(msg.custom_max_attempts ?? config?.max_attempts) && (
                                                            <span className="text-muted-foreground"> / {msg.custom_max_attempts ?? config?.max_attempts}</span>
                                                        )}
                                                    </span>
                                            </TableCell>
                                            {(queueType === 'main' || queueType === 'acknowledged') && (
                                                <TableCell className="text-xs text-foreground whitespace-nowrap">
                                                    {msg.custom_ack_timeout ?? config?.ack_timeout_seconds ?? 60}s
                                                </TableCell>
                                            )}
                                            {queueType === 'processing' && (
                                                <TableCell className="text-xs text-foreground whitespace-nowrap">
                                                    {calculateTimeRemaining(msg)}
                                                </TableCell>
                                            )}
                                    <TableCell className="text-right pr-6">
                                        <div className="flex justify-end gap-1">
                                            {onEdit && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        onEdit(msg)
                                                    }}
                                                    className="text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all rounded-full h-8 w-8"
                                                    title="Edit Message"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    onDelete(msg.id)
                                                }}
                                                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all rounded-full h-8 w-8"
                                                title="Delete Message"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                                )
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
            {totalPages > 0 && (
                <PaginationFooter
                    pageSize={pageSize}
                    setPageSize={setPageSize}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    setCurrentPage={setCurrentPage}
                    totalItems={totalItems}
                />
            )}
        </div>
    )
}

function EditMessageDialog({
    isOpen,
    onClose,
    onSave,
    message,
    queueType
}: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (id: string, queueType: string, updates: any) => Promise<void>;
    message: Message | null;
    queueType: string;
}) {
    const [payload, setPayload] = useState("");
    const [priority, setPriority] = useState(0);
    const [type, setType] = useState("");
    const [customAckTimeout, setCustomAckTimeout] = useState<number | "">("");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (message) {
            setPayload(JSON.stringify(message.payload, null, 2));
            setPriority(message.priority || 0);
            setType(message.type || "default");
            setCustomAckTimeout(message.custom_ack_timeout || "");
            setError(null);
        }
    }, [message]);

    const handleSave = async () => {
        if (!message) return;

        try {
            const updates: any = {};
            
            if (queueType === 'processing') {
                if (customAckTimeout === "" || Number(customAckTimeout) <= 0) {
                    setError("Ack Timeout must be a positive number");
                    return;
                }
                updates.custom_ack_timeout = Number(customAckTimeout);
            } else {
                let parsedPayload;
                try {
                    parsedPayload = JSON.parse(payload);
                } catch (e) {
                    setError("Invalid JSON payload");
                    return;
                }
                updates.payload = parsedPayload;
                updates.priority = priority;
                updates.type = type;
            }

            await onSave(message.id, queueType, updates);
        } catch (e) {
            setError("Failed to save message");
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Edit Message</DialogTitle>
                    <DialogDescription>
                        {queueType === 'processing' 
                            ? "Edit the timeout for this processing message." 
                            : "Make changes to the message here. Click save when you're done."}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="edit-id" className="text-right text-sm font-medium">
                            ID
                        </label>
                        <input
                            id="edit-id"
                            value={message?.id || ""}
                            readOnly
                            className="col-span-3 flex h-9 w-full rounded-md border border-input bg-muted px-3 py-1 text-sm shadow-sm font-mono focus-visible:outline-none cursor-text"
                        />
                    </div>
                    {queueType === 'processing' ? (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <label htmlFor="ackTimeout" className="text-right text-sm font-medium">
                                Ack Timeout (s)
                            </label>
                            <input
                                id="ackTimeout"
                                type="number"
                                value={customAckTimeout}
                                onChange={(e) => setCustomAckTimeout(e.target.value === "" ? "" : Number(e.target.value))}
                                className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            />
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <label htmlFor="type" className="text-right text-sm font-medium">
                                    Type
                                </label>
                                <input
                                    id="type"
                                    value={type}
                                    onChange={(e) => setType(e.target.value)}
                                    className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <label htmlFor="priority" className="text-right text-sm font-medium">
                                    Priority
                                </label>
                                <input
                                    id="priority"
                                    type="number"
                                    value={priority}
                                    onChange={(e) => setPriority(Number(e.target.value))}
                                    className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-start gap-4">
                                <label htmlFor="payload" className="text-right text-sm font-medium pt-2">
                                    Payload
                                </label>
                                <textarea
                                    id="payload"
                                    value={payload}
                                    onChange={(e) => setPayload(e.target.value)}
                                    className="col-span-3 flex min-h-[150px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                                />
                            </div>
                        </>
                    )}
                    {error && (
                        <div className="text-sm text-destructive font-medium text-center">
                            {error}
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={handleSave}>
                        Save changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CreateMessageDialog({
    isOpen,
    onClose,
    onCreate
}: {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (data: any) => Promise<void>;
}) {
    const [payload, setPayload] = useState("{\n  \n}");
    const [priority, setPriority] = useState(0);
    const [type, setType] = useState("default");
    const [queue, setQueue] = useState("");
    const [ackTimeout, setAckTimeout] = useState<number | "">("");
    const [maxAttempts, setMaxAttempts] = useState<number | "">("");
    const [error, setError] = useState<string | null>(null);

    // Reset state when dialog opens
    useEffect(() => {
        if (isOpen) {
            setPayload("{\n  \n}");
            setPriority(0);
            setType("default");
            setQueue("");
            setAckTimeout("");
            setMaxAttempts("");
            setError(null);
        }
    }, [isOpen]);

    const handleCreate = async () => {
        try {
            let parsedPayload;
            try {
                parsedPayload = JSON.parse(payload);
            } catch (e) {
                setError("Invalid JSON payload");
                return;
            }

            const data: any = {
                type,
                payload: parsedPayload,
                priority,
            };

            if (queue.trim()) {
                data.queue = queue.trim();
            }

            if (ackTimeout !== "" && Number(ackTimeout) > 0) {
                data.ackTimeout = Number(ackTimeout);
            }

            if (maxAttempts !== "" && Number(maxAttempts) > 0) {
                data.maxAttempts = Number(maxAttempts);
            }

            await onCreate(data);
        } catch (e) {
            setError("Failed to create message");
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Create New Message</DialogTitle>
                    <DialogDescription>
                        Create a new message to be enqueued.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="create-type" className="text-right text-sm font-medium">
                            Type
                        </label>
                        <input
                            id="create-type"
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                            className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="default"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="create-queue" className="text-right text-sm font-medium">
                            Queue
                        </label>
                        <Select value={queue || "main"} onValueChange={(val) => setQueue(val === "main" ? "" : val)}>
                            <SelectTrigger className="col-span-3" id="create-queue">
                                <SelectValue placeholder="Select queue" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="main">Main Queue</SelectItem>
                                <SelectItem value="dead">Dead Letter Queue</SelectItem>
                                <SelectItem value="acknowledged">Acknowledged Queue</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="create-priority" className="text-right text-sm font-medium">
                            Priority
                        </label>
                        <input
                            id="create-priority"
                            type="number"
                            value={priority}
                            onChange={(e) => setPriority(Number(e.target.value))}
                            className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="create-ackTimeout" className="text-right text-sm font-medium">
                            Ack Timeout (s)
                        </label>
                        <input
                            id="create-ackTimeout"
                            type="number"
                            value={ackTimeout}
                            onChange={(e) => setAckTimeout(e.target.value === "" ? "" : Number(e.target.value))}
                            className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="Optional"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="create-maxAttempts" className="text-right text-sm font-medium">
                            Max Attempts
                        </label>
                        <input
                            id="create-maxAttempts"
                            type="number"
                            min={1}
                            step={1}
                            value={maxAttempts}
                            onChange={(e) => setMaxAttempts(e.target.value === "" ? "" : Number(e.target.value))}
                            className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="Optional"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-start gap-4">
                        <label htmlFor="create-payload" className="text-right text-sm font-medium pt-2">
                            Payload
                        </label>
                        <textarea
                            id="create-payload"
                            value={payload}
                            onChange={(e) => setPayload(e.target.value)}
                            className="col-span-3 flex min-h-[150px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                        />
                    </div>
                    {error && (
                        <div className="text-sm text-destructive font-medium text-center">
                            {error}
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={handleCreate}>
                        Create Message
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function DeadLetterTable({ 
    messages, 
    config,
    onDelete, 
    onEdit, 
    formatTime, 
    pageSize, 
    setPageSize, 
    selectedIds, 
    onToggleSelect, 
    onToggleSelectAll,
    currentPage,
    setCurrentPage,
    totalPages,
    totalItems,
    sortBy,
    sortOrder,
    onSort,
    scrollResetKey
}: {
    messages: Message[],
    config?: { ack_timeout_seconds: number; max_attempts: number } | null,
    onDelete: (id: string) => void,
    onEdit?: (message: Message) => void,
    formatTime: (ts?: number) => string,
    pageSize: string,
    setPageSize: (size: string) => void,
    selectedIds: string[],
    onToggleSelect: (id: string) => void,
    onToggleSelectAll: (ids: string[]) => void,
    currentPage: number,
    setCurrentPage: (page: number) => void,
    totalPages: number,
    totalItems: number,
    sortBy: string,
    sortOrder: string,
    onSort: (field: string) => void,
    scrollResetKey: number
}) {
    const allSelected = messages.length > 0 && messages.every(msg => selectedIds.includes(msg.id))

    const getPriorityBadge = (p: number) => (
        <span className="text-xs text-foreground">
            {p ?? 0}
        </span>
    )

    const shouldVirtualize = messages.length >= 100
    const scrollContainerRef = useRef<HTMLDivElement | null>(null)
    const viewportHeight = useElementHeight(scrollContainerRef)
    const [scrollTop, setScrollTop] = useState(0)

    useEffect(() => {
        setScrollTop(0)
        if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0
    }, [scrollResetKey])

    const virtual = useMemo(() => {
        if (!shouldVirtualize) return null

        const rowHeight = 44
        const overscan = 8
        const viewportPx = Math.max(viewportHeight, 320)
        const total = messages.length

        const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
        const endIndex = Math.min(total, Math.ceil((scrollTop + viewportPx) / rowHeight) + overscan)

        return {
            rowHeight,
            startIndex,
            endIndex,
            topSpacerHeight: startIndex * rowHeight,
            bottomSpacerHeight: (total - endIndex) * rowHeight,
            visibleMessages: messages.slice(startIndex, endIndex),
        }
    }, [messages, scrollTop, shouldVirtualize, viewportHeight])

    return (
        <div className="flex flex-col flex-1 min-h-0">
            <div
                ref={scrollContainerRef}
                className="relative flex-1 min-h-0 overflow-auto"
                onScroll={shouldVirtualize ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
            >
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent border-b border-border/50">
                            <TableHead className="sticky top-0 z-20 bg-card w-[40px] text-xs">
                                <input 
                                    type="checkbox" 
                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer align-middle accent-primary"
                                    checked={allSelected}
                                    onChange={() => onToggleSelectAll(messages.map(m => m.id))}
                                />
                            </TableHead>
                            <SortableHeader label="ID" field="id" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Type" field="type" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Priority" field="priority" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Payload" field="payload" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            {/* Use processing_started_at as 'Failed At' if failed_at is missing, assuming it's the last attempt time */}
                            <SortableHeader label="Failed At" field="failed_at" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Error Reason" field="error_message" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Attempts" field="attempt_count" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Ack Timeout</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card text-right font-semibold text-foreground pr-6 text-xs">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {messages.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={10} className="h-32 text-center text-muted-foreground opacity-50 italic text-xs">
                                    No failed messages found.
                                </TableCell>
                            </TableRow>
                        ) : shouldVirtualize && virtual ? (
                            <>
                                {virtual.topSpacerHeight > 0 && (
                                    <TableRow className="hover:bg-transparent">
                                        <TableCell colSpan={10} className="p-0" style={{ height: virtual.topSpacerHeight }} />
                                    </TableRow>
                                )}
                                {virtual.visibleMessages.map((msg) => {
                                    const payloadText = JSON.stringify(msg.payload)
                                    const errorText = msg.error_message || msg.last_error || "Unknown error"
                                    return (
                                        <TableRow key={msg.id} className="group transition-colors duration-150 border-muted/30">
                                            <TableCell>
                                                <input 
                                                    type="checkbox" 
                                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer align-middle accent-primary"
                                                    checked={selectedIds.includes(msg.id)}
                                                    onChange={(e) => {
                                                        e.stopPropagation()
                                                        onToggleSelect(msg.id)
                                                    }}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-xs text-foreground font-mono">
                                                    {msg.id}
                                                </span>
                                            </TableCell>
                                            <TableCell><Badge variant="outline" className="font-medium">{msg.type}</Badge></TableCell>
                                            <TableCell className="text-left">{getPriorityBadge(msg.priority)}</TableCell>
                                            <TableCell className="max-w-[300px]">
                                                <div className="truncate text-xs text-muted-foreground font-mono" title={payloadText}>
                                                    {payloadText}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs text-foreground whitespace-nowrap">
                                                {formatTime(msg.failed_at || msg.processing_started_at)}
                                            </TableCell>
                                            <TableCell>
                                                <div className="text-xs font-medium max-w-[300px] truncate" title={errorText}>
                                                    {errorText}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-xs text-foreground pl-4 block">
                                                    {msg.attempt_count || 1}
                                                    {config?.max_attempts && <span className="text-muted-foreground"> / {config.max_attempts}</span>}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-xs text-foreground whitespace-nowrap">
                                                {msg.custom_ack_timeout ?? config?.ack_timeout_seconds ?? 60}s
                                            </TableCell>
                                            <TableCell className="text-right pr-6">
                                                <div className="flex justify-end gap-1">
                                                    {onEdit && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                onEdit(msg)
                                                            }}
                                                            className="text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all rounded-full h-8 w-8"
                                                            title="Edit Message"
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            onDelete(msg.id)
                                                        }}
                                                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all rounded-full h-8 w-8"
                                                        title="Delete Message"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                                {virtual.bottomSpacerHeight > 0 && (
                                    <TableRow className="hover:bg-transparent">
                                        <TableCell colSpan={10} className="p-0" style={{ height: virtual.bottomSpacerHeight }} />
                                    </TableRow>
                                )}
                            </>
                        ) : (
                            messages.map((msg) => {
                                const payloadText = JSON.stringify(msg.payload)
                                const errorText = msg.error_message || msg.last_error || "Unknown error"
                                return (
                                <TableRow key={msg.id} className="group transition-colors duration-150 border-muted/30">
                                    <TableCell>
                                        <input 
                                            type="checkbox" 
                                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer align-middle accent-primary"
                                            checked={selectedIds.includes(msg.id)}
                                            onChange={(e) => {
                                                e.stopPropagation()
                                                onToggleSelect(msg.id)
                                            }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <span className="text-xs text-foreground font-mono">
                                            {msg.id}
                                        </span>
                                    </TableCell>
                                    <TableCell><Badge variant="outline" className="font-medium">{msg.type}</Badge></TableCell>
                                    <TableCell className="text-left">{getPriorityBadge(msg.priority)}</TableCell>
                                    <TableCell className="max-w-[300px]">
                                        <div className="truncate text-xs text-muted-foreground font-mono" title={payloadText}>
                                            {payloadText}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-xs text-foreground whitespace-nowrap">
                                        {formatTime(msg.failed_at || msg.processing_started_at)}
                                    </TableCell>
                                    <TableCell>
                                        <div className="text-xs font-medium max-w-[300px] truncate" title={errorText}>
                                            {errorText}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <span className="text-xs text-foreground pl-4 block">
                                            {msg.attempt_count || 1}
                                            {(msg.custom_max_attempts ?? config?.max_attempts) && (
                                                <span className="text-muted-foreground"> / {msg.custom_max_attempts ?? config?.max_attempts}</span>
                                            )}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-xs text-foreground whitespace-nowrap">
                                        {msg.custom_ack_timeout ?? config?.ack_timeout_seconds ?? 60}s
                                    </TableCell>
                                    <TableCell className="text-right pr-6">
                                        <div className="flex justify-end gap-1">
                                            {onEdit && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        onEdit(msg)
                                                    }}
                                                    className="text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all rounded-full h-8 w-8"
                                                    title="Edit Message"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    onDelete(msg.id)
                                                }}
                                                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all rounded-full h-8 w-8"
                                                title="Delete Message"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                                )
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
            {totalPages > 0 && (
                <PaginationFooter
                    pageSize={pageSize}
                    setPageSize={setPageSize}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    setCurrentPage={setCurrentPage}
                    totalItems={totalItems}
                />
            )}
        </div>
    )
}
