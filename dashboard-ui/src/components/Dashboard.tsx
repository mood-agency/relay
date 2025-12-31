import { useState, useEffect, useCallback, useMemo } from "react"
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
    Settings2,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Pencil,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    Search,
    Move
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

    // System Status (Counts)
    const [statusData, setStatusData] = useState<SystemStatus | null>(null)
    const [loadingStatus, setLoadingStatus] = useState(true)
    
    // Table Data (Server-side)
    const [messagesData, setMessagesData] = useState<MessagesResponse | null>(null)
    const [loadingMessages, setLoadingMessages] = useState(false)

    const [error, setError] = useState<string | null>(null)
    const [autoRefresh, setAutoRefresh] = useState(false)
    const [lastUpdated, setLastUpdated] = useState<string>("")
    const [activeTab, setActiveTab] = useState("main")
    
    // Filter & Sort State
    const [filterType, setFilterType] = useState("all")
    const [filterPriority, setFilterPriority] = useState("")
    const [filterAttempts, setFilterAttempts] = useState("")
    const [startDate, setStartDate] = useState<Date | undefined>()
    const [endDate, setEndDate] = useState<Date | undefined>()
    const [pageSize, setPageSize] = useState("10")
    const [currentPage, setCurrentPage] = useState(1)
    const [sortBy, setSortBy] = useState("created_at")
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
    const [search, setSearch] = useState("")
    
    // Selection State
    const [selectedIds, setSelectedIds] = useState<string[]>([])

    // Fetch System Status (Counts)
    const fetchStatus = useCallback(async () => {
        try {
            const response = await fetch('/api/queue/status')
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            const json = await response.json()
            setStatusData(json)
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
    const fetchMessages = useCallback(async () => {
        setLoadingMessages(true)
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
            setLoadingMessages(false)
        }
    }, [activeTab, currentPage, pageSize, sortBy, sortOrder, filterType, filterPriority, filterAttempts, startDate, endDate, search])

    const fetchAll = useCallback(() => {
        fetchStatus()
        fetchMessages()
    }, [fetchStatus, fetchMessages])

    // Initial Load
    useEffect(() => {
        fetchAll()
    }, [fetchAll])

    // Auto Refresh
    useEffect(() => {
        let interval: any
        if (autoRefresh) {
            interval = setInterval(fetchAll, 5000)
        }
        return () => clearInterval(interval)
    }, [autoRefresh, fetchAll])

    // Reset filters/pagination when tab changes
    useEffect(() => {
        setFilterType("all")
        setFilterPriority("")
        setFilterAttempts("")
        setStartDate(undefined)
        setEndDate(undefined)
        setSelectedIds([])
        setCurrentPage(1)
        setSearch("")
        setSortBy(activeTab === 'dead' ? 'processing_started_at' : 'created_at')
        setSortOrder("desc")
    }, [activeTab])

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
                    const promises = selectedIds.map(id => 
                        fetch(`/api/queue/message/${id}?queueType=${activeTab}`, {
                            method: 'DELETE',
                        })
                    )
                    
                    await Promise.all(promises)
                    
                    fetchAll()
                    setSelectedIds([])
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
        return format(new Date(ts * 1000), "MM/dd/yyyy HH:mm:ss")
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
        <div className="container mx-auto py-6 px-4 max-w-[1600px] animate-in fade-in duration-500">
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8 items-start">
                {/* Left Sidebar */}
                <div className="space-y-6 lg:sticky lg:top-6">
                    {/* Header */}
                    <div className="flex items-center gap-3 px-2">
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-foreground leading-none">RQD</h1>
                        </div>
                    </div>

                    <div className="space-y-6">
                        {/* Queue Navigation */}
                        <div className="space-y-1">
                            <h3 className="text-xs font-semibold text-muted-foreground px-2 pb-2 uppercase tracking-wider">Queues</h3>
                            <NavButton
                                active={activeTab === 'main'}
                                onClick={() => setActiveTab('main')}
                                icon={Inbox}
                                label="Main Queue"
                                count={statusData?.mainQueue?.length || 0}
                            />
                            <NavButton
                                active={activeTab === 'processing'}
                                onClick={() => setActiveTab('processing')}
                                icon={Loader2}
                                label="Processing"
                                count={statusData?.processingQueue?.length || 0}
                            />
                            <NavButton
                                active={activeTab === 'dead'}
                                onClick={() => setActiveTab('dead')}
                                icon={XCircle}
                                label="Dead Letter"
                                count={statusData?.deadLetterQueue?.length || 0}
                                variant="destructive"
                            />
                            <NavButton
                                active={activeTab === 'acknowledged'}
                                onClick={() => setActiveTab('acknowledged')}
                                icon={CheckCircle2}
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

                            </div>
                        </div>

                        <div className="h-px bg-border/50" />

                        {/* Actions */}
                        <div className="space-y-4">
                            <h3 className="text-xs font-semibold text-muted-foreground px-2 uppercase tracking-wider flex items-center gap-2">
                                <Settings2 className="h-3 w-3" /> Actions
                            </h3>
                            <div className="grid grid-cols-2 gap-2 px-1">
                                <Button onClick={handleRefresh} variant="outline" className="w-full justify-start h-9 px-2" title="Refresh">
                                    <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loadingMessages || loadingStatus ? 'animate-spin' : ''}`} />
                                    <span className="text-xs">Refresh</span>
                                </Button>
                                <Button
                                    onClick={() => setAutoRefresh(!autoRefresh)}
                                    variant={autoRefresh ? "secondary" : "outline"}
                                    className="w-full justify-start h-9 px-2"
                                >
                                    {autoRefresh ? <Pause className="h-3.5 w-3.5 mr-2" /> : <Play className="h-3.5 w-3.5 mr-2" />}
                                    <span className="text-xs">{autoRefresh ? "Auto On" : "Auto Off"}</span>
                                </Button>
                            </div>
                            <div className="px-1 space-y-2">
                                <Button onClick={handleClearAll} variant="destructive" className="w-full justify-start h-9 px-2">
                                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                                    <span className="text-xs">Clear All Queues</span>
                                </Button>
                            </div>
                        </div>

                        <div className="text-[10px] text-muted-foreground px-2 pt-2">
                            Last updated: {lastUpdated}
                        </div>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="min-w-0 space-y-4">
                    {error && (
                        <Card className="border-destructive/50 bg-destructive/10">
                            <CardContent className="pt-6 flex items-center gap-3 text-destructive">
                                <AlertTriangle className="h-5 w-5" />
                                <p className="font-medium text-sm">Error: {error}</p>
                            </CardContent>
                        </Card>
                    )}

                    <div className="mb-4 flex items-center justify-between">
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

                    <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
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
                                onDelete={(id) => handleDelete(id, activeTab)}
                                onEdit={activeTab === 'main' ? (msg) => setEditDialog({ isOpen: true, message: msg, queueType: 'main' }) : undefined}
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
                            />
                        )}
                        {activeTab === 'dead' && (
                            <DeadLetterTable
                                messages={messagesData?.messages || []}
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

function NavButton({ active, onClick, icon: Icon, label, count, variant = "default" }: any) {
    const badgeColor = 
        variant === "destructive" ? "bg-red-100 text-red-700 hover:bg-red-100" :
        variant === "success" ? "bg-green-100 text-green-700 hover:bg-green-100" : 
        "bg-secondary text-secondary-foreground hover:bg-secondary/80";

    return (
        <Button
            variant={active ? "secondary" : "ghost"}
            className={cn(
                "w-full justify-between font-normal h-10 px-3",
                active && "bg-secondary font-medium shadow-sm"
            )}
            onClick={onClick}
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
        <div className="flex items-center justify-between px-4 py-4 border-t bg-muted/5">
            <div className="flex items-center space-x-2">
                <p className="text-sm font-medium text-muted-foreground">Rows per page</p>
                <Select value={pageSize} onValueChange={setPageSize}>
                    <SelectTrigger className="h-8 w-[70px]">
                        <SelectValue placeholder={pageSize} />
                    </SelectTrigger>
                    <SelectContent side="top">
                        {[10, 20, 30, 40, 50].map((pageSize) => (
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
        <TableHead className="font-semibold text-foreground cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => onSort(field)}>
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

function QueueTable({ 
    messages, 
    queueType, 
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
    onSort
}: {
    messages: Message[],
    queueType: string,
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
    onSort: (field: string) => void
}) {
    
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
            case 'processing': return m.processing_started_at
            case 'acknowledged': return m.acknowledged_at
            default: return m.created_at
        }
    }

    const allSelected = messages.length > 0 && messages.every(msg => selectedIds.includes(msg.id))

    const getPriorityBadge = (p: number) => (
        <span className="text-sm text-foreground">
            {p ?? 0}
        </span>
    )

    return (
        <div>
            <div className="relative overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent border-b border-border/50">
                            <TableHead className="w-[40px]">
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
                            <TableHead className="text-right font-semibold text-foreground pr-6">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {messages.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground opacity-50 italic">
                                    No messages found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            messages.map((msg) => (
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
                                        <span className="text-sm text-foreground font-mono" title={msg.id}>
                                            {msg.id?.substring(0, 8)}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-left"><Badge variant="outline" className="font-medium">{msg.type}</Badge></TableCell>
                                    <TableCell className="text-left">{getPriorityBadge(msg.priority)}</TableCell>
                                    <TableCell className="max-w-[300px]">
                                        <div className="truncate text-sm text-muted-foreground" title={JSON.stringify(msg.payload)}>
                                            {JSON.stringify(msg.payload)}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm text-foreground whitespace-nowrap">
                                        {formatTime(getTimeValue(msg))}
                                    </TableCell>
                                    <TableCell>
                                        <span className="text-sm text-foreground pl-4 block">{msg.attempt_count || 0}</span>
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
                            ))
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
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (message) {
            setPayload(JSON.stringify(message.payload, null, 2));
            setPriority(message.priority || 0);
            setType(message.type || "default");
            setError(null);
        }
    }, [message]);

    const handleSave = async () => {
        if (!message) return;

        try {
            let parsedPayload;
            try {
                parsedPayload = JSON.parse(payload);
            } catch (e) {
                setError("Invalid JSON payload");
                return;
            }

            await onSave(message.id, queueType, {
                payload: parsedPayload,
                priority,
                type
            });
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
                        Make changes to the message here. Click save when you're done.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
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

function DeadLetterTable({ 
    messages, 
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
    onSort
}: {
    messages: Message[],
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
    onSort: (field: string) => void
}) {
    const allSelected = messages.length > 0 && messages.every(msg => selectedIds.includes(msg.id))

    return (
        <div>
            <div className="relative overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent border-b border-border/50">
                            <TableHead className="w-[40px]">
                                <input 
                                    type="checkbox" 
                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer align-middle accent-primary"
                                    checked={allSelected}
                                    onChange={() => onToggleSelectAll(messages.map(m => m.id))}
                                />
                            </TableHead>
                            <SortableHeader label="ID" field="id" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Type" field="type" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Payload" field="payload" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            {/* Use processing_started_at as 'Failed At' if failed_at is missing, assuming it's the last attempt time */}
                            <SortableHeader label="Failed At" field="failed_at" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Error Reason" field="error_message" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <TableHead className="text-right font-semibold text-foreground pr-6">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {messages.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground opacity-50 italic">
                                    No failed messages found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            messages.map((msg) => (
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
                                        <span className="text-sm text-foreground font-mono">
                                            {msg.id?.substring(0, 8)}...
                                        </span>
                                    </TableCell>
                                    <TableCell><Badge variant="outline" className="font-medium">{msg.type}</Badge></TableCell>
                                    <TableCell className="max-w-[300px]">
                                        <div className="truncate text-sm text-muted-foreground" title={JSON.stringify(msg.payload)}>
                                            {JSON.stringify(msg.payload)}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm text-foreground whitespace-nowrap">
                                        {formatTime(msg.failed_at || msg.processing_started_at)}
                                    </TableCell>
                                    <TableCell>
                                        <div className="text-sm font-medium text-destructive bg-destructive/5 p-2 rounded border border-destructive/20 max-w-[300px] truncate" title={msg.error_message || msg.last_error}>
                                            {msg.error_message || msg.last_error || "Unknown error"}
                                        </div>
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
                            ))
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
