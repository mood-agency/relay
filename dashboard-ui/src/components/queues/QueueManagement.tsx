import React, { useState, useEffect, useCallback, useMemo } from "react"
import { format } from "date-fns"
import {
    Search,
    Plus,
    Trash2,
    Loader2,
    Database,
    Zap,
    Layers,
    AlertTriangle,
    Edit,
    ArrowUp,
    ArrowDown,
    ArrowUpDown,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent } from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { PaginationFooter, EmptyState } from "@/components/ui/data-table"
import * as tableStyles from "@/components/ui/table-styles"

// ============================================================================
// Types
// ============================================================================

export interface QueueInfo {
    name: string
    queue_type: "standard" | "unlogged" | "partitioned"
    ack_timeout_seconds: number
    max_attempts: number
    partition_interval: string | null
    retention_interval: string | null
    description: string | null
    created_at: string
    updated_at: string
    message_count: number
    processing_count: number
    dead_count: number
}

interface CreateQueueForm {
    name: string
    queue_type: "standard" | "unlogged" | "partitioned"
    ack_timeout_seconds: number
    max_attempts: number
    partition_interval: string
    retention_interval: string
    description: string
}

interface EditQueueForm {
    name: string
    ack_timeout_seconds: number
    max_attempts: number
    description: string
}

type SortField = "name" | "queue_type" | "message_count" | "processing_count" | "dead_count" | "created_at"
type SortDirection = "asc" | "desc"

interface SortState {
    field: SortField
    direction: SortDirection
}

// ============================================================================
// Helper Components
// ============================================================================

interface SortableHeaderProps {
    label: string
    field: SortField
    sortState: SortState | null
    onSort: (field: SortField) => void
    className?: string
}

function SortableHeader({ label, field, sortState, onSort, className }: SortableHeaderProps) {
    const isActive = sortState?.field === field
    const direction = isActive ? sortState.direction : null
    const isRightAligned = className?.includes("text-right")

    return (
        <TableHead
            className={cn(tableStyles.TABLE_HEADER_SORTABLE, className)}
            onClick={() => onSort(field)}
        >
            <div className={cn(tableStyles.FLEX_INLINE, isRightAligned && "justify-end")}>
                {label}
                {direction === "asc" ? (
                    <ArrowUp className={tableStyles.SORT_ICON} />
                ) : direction === "desc" ? (
                    <ArrowDown className={tableStyles.SORT_ICON} />
                ) : (
                    <ArrowUpDown className={tableStyles.SORT_ICON_INACTIVE} />
                )}
            </div>
        </TableHead>
    )
}

const getQueueTypeIcon = (type: string) => {
    switch (type) {
        case "standard":
            return <Database className="h-4 w-4" />
        case "unlogged":
            return <Zap className="h-4 w-4" />
        case "partitioned":
            return <Layers className="h-4 w-4" />
        default:
            return <Database className="h-4 w-4" />
    }
}

const getQueueTypeBadge = (type: string) => {
    switch (type) {
        case "standard":
            return <Badge variant="outline" className="gap-1"><Database className="h-3 w-3" /> Standard</Badge>
        case "unlogged":
            return <Badge variant="outline" className="gap-1 border-yellow-500/50 text-yellow-600"><Zap className="h-3 w-3" /> Unlogged</Badge>
        case "partitioned":
            return <Badge variant="outline" className="gap-1 border-blue-500/50 text-blue-600"><Layers className="h-3 w-3" /> Partitioned</Badge>
        default:
            return <Badge variant="outline">{type}</Badge>
    }
}

// ============================================================================
// Create Queue Dialog
// ============================================================================

interface CreateQueueDialogProps {
    isOpen: boolean
    onClose: () => void
    onCreate: (data: CreateQueueForm) => Promise<void>
    isLoading: boolean
}

function CreateQueueDialog({ isOpen, onClose, onCreate, isLoading }: CreateQueueDialogProps) {
    const [form, setForm] = useState<CreateQueueForm>({
        name: "",
        queue_type: "standard",
        ack_timeout_seconds: 30,
        max_attempts: 3,
        partition_interval: "daily",
        retention_interval: "7 days",
        description: "",
    })
    const [error, setError] = useState<string | null>(null)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        // Validate name
        if (!form.name.trim()) {
            setError("Queue name is required")
            return
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(form.name)) {
            setError("Queue name can only contain alphanumeric characters, underscores, and hyphens")
            return
        }

        try {
            await onCreate(form)
            setForm({
                name: "",
                queue_type: "standard",
                ack_timeout_seconds: 30,
                max_attempts: 3,
                partition_interval: "daily",
                retention_interval: "7 days",
                description: "",
            })
            onClose()
        } catch (err: any) {
            setError(err.message || "Failed to create queue")
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Create New Queue</DialogTitle>
                    <DialogDescription>
                        Create a new message queue with custom configuration.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit}>
                    <div className="space-y-4 py-4">
                        {error && (
                            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Queue Name *</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="my-queue"
                                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            <p className="text-xs text-muted-foreground">Alphanumeric, underscores, and hyphens only</p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Queue Type</label>
                            <Select
                                value={form.queue_type}
                                onValueChange={(v) => setForm(prev => ({ ...prev, queue_type: v as any }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="standard">
                                        <div className="flex items-center gap-2">
                                            <Database className="h-4 w-4" />
                                            Standard (High Durability)
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="unlogged">
                                        <div className="flex items-center gap-2">
                                            <Zap className="h-4 w-4" />
                                            Unlogged (High Performance)
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="partitioned">
                                        <div className="flex items-center gap-2">
                                            <Layers className="h-4 w-4" />
                                            Partitioned (High Scalability)
                                        </div>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {form.queue_type === "standard" && "Messages stored in logged PostgreSQL tables. Best for general use."}
                                {form.queue_type === "unlogged" && "2-3x faster writes, but data lost on crash. Best for transient data."}
                                {form.queue_type === "partitioned" && "Uses table partitioning for very high throughput."}
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">ACK Timeout (s)</label>
                                <input
                                    type="number"
                                    value={form.ack_timeout_seconds}
                                    onChange={(e) => setForm(prev => ({ ...prev, ack_timeout_seconds: parseInt(e.target.value) || 30 }))}
                                    min={1}
                                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Max Attempts</label>
                                <input
                                    type="number"
                                    value={form.max_attempts}
                                    onChange={(e) => setForm(prev => ({ ...prev, max_attempts: parseInt(e.target.value) || 3 }))}
                                    min={1}
                                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>
                        </div>

                        {form.queue_type === "partitioned" && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Partition Interval</label>
                                    <Select
                                        value={form.partition_interval}
                                        onValueChange={(v) => setForm(prev => ({ ...prev, partition_interval: v }))}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="hourly">Hourly</SelectItem>
                                            <SelectItem value="daily">Daily</SelectItem>
                                            <SelectItem value="weekly">Weekly</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Retention Interval</label>
                                    <Select
                                        value={form.retention_interval}
                                        onValueChange={(v) => setForm(prev => ({ ...prev, retention_interval: v }))}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="1 day">1 Day</SelectItem>
                                            <SelectItem value="7 days">7 Days</SelectItem>
                                            <SelectItem value="30 days">30 Days</SelectItem>
                                            <SelectItem value="90 days">90 Days</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Description</label>
                            <textarea
                                value={form.description}
                                onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Optional description..."
                                rows={2}
                                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Create Queue
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

// ============================================================================
// Edit Queue Dialog
// ============================================================================

interface EditQueueDialogProps {
    isOpen: boolean
    onClose: () => void
    onSave: (data: EditQueueForm) => Promise<void>
    queue: QueueInfo | null
    isLoading: boolean
}

function EditQueueDialog({ isOpen, onClose, onSave, queue, isLoading }: EditQueueDialogProps) {
    const [form, setForm] = useState<EditQueueForm>({
        name: "",
        ack_timeout_seconds: 30,
        max_attempts: 3,
        description: "",
    })
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (queue) {
            setForm({
                name: queue.name,
                ack_timeout_seconds: queue.ack_timeout_seconds,
                max_attempts: queue.max_attempts,
                description: queue.description || "",
            })
        }
    }, [queue])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        // Validate name
        if (!form.name.trim()) {
            setError("Queue name is required")
            return
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(form.name)) {
            setError("Queue name can only contain alphanumeric characters, underscores, and hyphens")
            return
        }

        try {
            await onSave(form)
            onClose()
        } catch (err: any) {
            setError(err.message || "Failed to update queue")
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit Queue</DialogTitle>
                    <DialogDescription>
                        Update queue configuration. Note: Queue type cannot be changed.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit}>
                    <div className="space-y-4 py-4">
                        {error && (
                            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Queue Name</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="my-queue"
                                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            <p className="text-xs text-muted-foreground">Alphanumeric, underscores, and hyphens only</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">ACK Timeout (s)</label>
                                <input
                                    type="number"
                                    value={form.ack_timeout_seconds}
                                    onChange={(e) => setForm(prev => ({ ...prev, ack_timeout_seconds: parseInt(e.target.value) || 30 }))}
                                    min={1}
                                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Max Attempts</label>
                                <input
                                    type="number"
                                    value={form.max_attempts}
                                    onChange={(e) => setForm(prev => ({ ...prev, max_attempts: parseInt(e.target.value) || 3 }))}
                                    min={1}
                                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Description</label>
                            <textarea
                                value={form.description}
                                onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Optional description..."
                                rows={2}
                                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Save Changes
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

// ============================================================================
// Delete Queue Dialog
// ============================================================================

interface DeleteQueueDialogProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: (force: boolean) => Promise<void>
    queue: QueueInfo | null
    isLoading: boolean
}

function DeleteQueueDialog({ isOpen, onClose, onConfirm, queue, isLoading }: DeleteQueueDialogProps) {
    const [forceDelete, setForceDelete] = useState(false)
    const [confirmText, setConfirmText] = useState("")
    const [error, setError] = useState<string | null>(null)

    const totalMessages = (queue?.message_count || 0) + (queue?.processing_count || 0) + (queue?.dead_count || 0)
    const hasMessages = totalMessages > 0
    const canDelete = confirmText === queue?.name

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!canDelete) return
        setError(null)

        try {
            await onConfirm(forceDelete)
            setConfirmText("")
            setForceDelete(false)
            onClose()
        } catch (err: any) {
            setError(err.message || "Failed to delete queue")
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={() => {
            setConfirmText("")
            setForceDelete(false)
            setError(null)
            onClose()
        }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-destructive">
                        <AlertTriangle className="h-5 w-5" />
                        Delete Queue
                    </DialogTitle>
                    <DialogDescription>
                        This action cannot be undone. This will permanently delete the queue
                        <span className="font-mono font-semibold mx-1">{queue?.name}</span>
                        and all its data.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit}>
                    <div className="space-y-4 py-4">
                        {error && (
                            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                {error}
                            </div>
                        )}

                        {hasMessages && (
                            <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
                                <div className="flex items-center gap-2 text-yellow-600 font-medium text-sm mb-2">
                                    <AlertTriangle className="h-4 w-4" />
                                    Queue has {totalMessages.toLocaleString()} messages
                                </div>
                                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                                    <Checkbox
                                        checked={forceDelete}
                                        onCheckedChange={(checked) => setForceDelete(checked === true)}
                                    />
                                    Force delete (delete all messages)
                                </label>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium">
                                Type <span className="font-mono font-semibold">{queue?.name}</span> to confirm
                            </label>
                            <input
                                type="text"
                                value={confirmText}
                                onChange={(e) => setConfirmText(e.target.value)}
                                placeholder="Queue name"
                                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="destructive"
                            disabled={!canDelete || isLoading || (hasMessages && !forceDelete)}
                        >
                            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Delete Queue
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

// ============================================================================
// Rename Queue Dialog
// ============================================================================

interface RenameQueueDialogProps {
    isOpen: boolean
    onClose: () => void
    onRename: (newName: string) => Promise<void>
    queue: QueueInfo | null
    isLoading: boolean
}

function RenameQueueDialog({ isOpen, onClose, onRename, queue, isLoading }: RenameQueueDialogProps) {
    const [newName, setNewName] = useState("")
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (queue && isOpen) {
            setNewName(queue.name)
            setError(null)
        }
    }, [queue, isOpen])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        // Validate new name
        if (!newName.trim()) {
            setError("Queue name is required")
            return
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
            setError("Queue name can only contain alphanumeric characters, underscores, and hyphens")
            return
        }
        if (newName === queue?.name) {
            setError("New name must be different from current name")
            return
        }

        try {
            await onRename(newName.trim())
            onClose()
        } catch (err: any) {
            setError(err.message || "Failed to rename queue")
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Rename Queue</DialogTitle>
                    <DialogDescription>
                        Change the name of queue <span className="font-mono font-semibold">{queue?.name}</span>
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit}>
                    <div className="space-y-4 py-4">
                        {error && (
                            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium">New Queue Name *</label>
                            <input
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="my-queue"
                                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            <p className="text-xs text-muted-foreground">Alphanumeric, underscores, and hyphens only</p>
                        </div>

                        {/* Queue Info (read-only) */}
                        <div className="space-y-3 pt-2 border-t">
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Queue Configuration</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">ACK Timeout</label>
                                    <p className="text-sm font-medium">{queue?.ack_timeout_seconds}s</p>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">Max Attempts</label>
                                    <p className="text-sm font-medium">{queue?.max_attempts}</p>
                                </div>
                            </div>
                            {queue?.description && (
                                <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">Description</label>
                                    <p className="text-sm text-muted-foreground">{queue.description}</p>
                                </div>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading || newName === queue?.name}>
                            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Rename Queue
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

// ============================================================================
// Main Component
// ============================================================================

interface QueueManagementProps {
    authFetch: (url: string, options?: RequestInit) => Promise<Response>
    onQueueSelect?: (queueName: string) => void
    onQueuesChanged?: () => void
}

export default function QueueManagement({ authFetch, onQueueSelect, onQueuesChanged }: QueueManagementProps) {
    // State
    const [queues, setQueues] = useState<QueueInfo[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState("")
    const [typeFilter, setTypeFilter] = useState<string>("all")

    // Sort state
    const [sortState, setSortState] = useState<SortState | null>(null)

    // Dialog state
    const [createDialog, setCreateDialog] = useState(false)
    const [editDialog, setEditDialog] = useState<{ isOpen: boolean; queue: QueueInfo | null }>({ isOpen: false, queue: null })
    const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; queue: QueueInfo | null }>({ isOpen: false, queue: null })
    const [renameDialog, setRenameDialog] = useState<{ isOpen: boolean; queue: QueueInfo | null }>({ isOpen: false, queue: null })
    const [actionLoading, setActionLoading] = useState(false)

    // Pagination
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState("25")

    // Fetch queues
    const fetchQueues = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const response = await authFetch("/api/queues")
            if (!response.ok) {
                throw new Error(`Failed to fetch queues: ${response.statusText}`)
            }
            const data = await response.json()
            setQueues(data.queues || [])
        } catch (err: any) {
            setError(err.message || "Failed to fetch queues")
        } finally {
            setLoading(false)
        }
    }, [authFetch])

    useEffect(() => {
        fetchQueues()
    }, [fetchQueues])

    // Create queue
    const handleCreateQueue = useCallback(async (data: CreateQueueForm) => {
        setActionLoading(true)
        try {
            const body: any = {
                name: data.name,
                queue_type: data.queue_type,
                ack_timeout_seconds: data.ack_timeout_seconds,
                max_attempts: data.max_attempts,
                description: data.description || undefined,
            }

            if (data.queue_type === "partitioned") {
                body.partition_interval = data.partition_interval
                body.retention_interval = data.retention_interval
            }

            const response = await authFetch("/api/queues", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.message || `Failed to create queue: ${response.statusText}`)
            }

            await fetchQueues()
            onQueuesChanged?.()
        } finally {
            setActionLoading(false)
        }
    }, [authFetch, fetchQueues, onQueuesChanged])

    // Update queue
    const handleUpdateQueue = useCallback(async (data: EditQueueForm) => {
        if (!editDialog.queue) return
        setActionLoading(true)
        try {
            const originalName = editDialog.queue.name
            const nameChanged = data.name !== originalName

            // If name changed, rename first
            if (nameChanged) {
                const renameResponse = await authFetch(`/api/queues/${encodeURIComponent(originalName)}/rename`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ newName: data.name }),
                })

                if (!renameResponse.ok) {
                    const errorData = await renameResponse.json().catch(() => ({}))
                    throw new Error(errorData.message || `Failed to rename queue: ${renameResponse.statusText}`)
                }
            }

            // Update other settings (use new name if renamed)
            const queueName = nameChanged ? data.name : originalName
            const { name, ...updateData } = data
            const response = await authFetch(`/api/queues/${encodeURIComponent(queueName)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updateData),
            })

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.message || `Failed to update queue: ${response.statusText}`)
            }

            await fetchQueues()
            onQueuesChanged?.()
        } finally {
            setActionLoading(false)
        }
    }, [authFetch, editDialog.queue, fetchQueues, onQueuesChanged])

    // Delete queue
    const handleDeleteQueue = useCallback(async (force: boolean) => {
        if (!deleteDialog.queue) return
        setActionLoading(true)
        try {
            const url = `/api/queues/${encodeURIComponent(deleteDialog.queue.name)}${force ? "?force=true" : ""}`
            const response = await authFetch(url, { method: "DELETE" })

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.message || `Failed to delete queue: ${response.statusText}`)
            }

            await fetchQueues()
            onQueuesChanged?.()
        } finally {
            setActionLoading(false)
        }
    }, [authFetch, deleteDialog.queue, fetchQueues, onQueuesChanged])

    // Rename queue
    const handleRenameQueue = useCallback(async (newName: string) => {
        if (!renameDialog.queue) return
        setActionLoading(true)
        try {
            const response = await authFetch(`/api/queues/${encodeURIComponent(renameDialog.queue.name)}/rename`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ newName }),
            })

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.message || `Failed to rename queue: ${response.statusText}`)
            }

            await fetchQueues()
            onQueuesChanged?.()
        } finally {
            setActionLoading(false)
        }
    }, [authFetch, renameDialog.queue, fetchQueues, onQueuesChanged])

    // Sort handler
    const handleSort = useCallback((field: SortField) => {
        setSortState(current => {
            if (current?.field === field) {
                // Toggle direction or clear
                if (current.direction === "asc") {
                    return { field, direction: "desc" }
                } else {
                    return null // Clear sort
                }
            }
            return { field, direction: "asc" }
        })
        setCurrentPage(1)
    }, [])

    // Filter and sort queues
    const filteredAndSortedQueues = useMemo(() => {
        let result = queues.filter(q => {
            const matchesSearch = !search ||
                q.name.toLowerCase().includes(search.toLowerCase()) ||
                (q.description?.toLowerCase().includes(search.toLowerCase()))
            const matchesType = typeFilter === "all" || q.queue_type === typeFilter
            return matchesSearch && matchesType
        })

        if (sortState) {
            result = [...result].sort((a, b) => {
                const { field, direction } = sortState
                let comparison = 0

                switch (field) {
                    case "name":
                        comparison = a.name.localeCompare(b.name)
                        break
                    case "queue_type":
                        comparison = a.queue_type.localeCompare(b.queue_type)
                        break
                    case "message_count":
                        comparison = a.message_count - b.message_count
                        break
                    case "processing_count":
                        comparison = a.processing_count - b.processing_count
                        break
                    case "dead_count":
                        comparison = a.dead_count - b.dead_count
                        break
                    case "created_at":
                        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                        break
                }

                return direction === "asc" ? comparison : -comparison
            })
        }

        return result
    }, [queues, search, typeFilter, sortState])

    // Paginate
    const pageSizeNum = parseInt(pageSize)
    const totalPages = Math.ceil(filteredAndSortedQueues.length / pageSizeNum)
    const paginatedQueues = filteredAndSortedQueues.slice(
        (currentPage - 1) * pageSizeNum,
        currentPage * pageSizeNum
    )

    // Format time
    const formatTime = (timestamp: string) => {
        try {
            return format(new Date(timestamp), "MMM d, yyyy HH:mm")
        } catch {
            return timestamp
        }
    }

    if (loading && queues.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground font-medium">Loading queues...</p>
            </div>
        )
    }

    return (
        <div className={tableStyles.TABLE_CONTAINER}>
            {error && (
                <Card className="border-destructive/50 bg-destructive/10 mb-4">
                    <CardContent className="pt-6 flex items-center gap-3 text-destructive">
                        <AlertTriangle className="h-5 w-5" />
                        <p className="font-medium text-sm">{error}</p>
                    </CardContent>
                </Card>
            )}

            {/* Toolbar */}
            <div className="flex items-center gap-3 px-6 py-3 border-b bg-muted/10">
                {/* Search */}
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search queues..."
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value)
                            setCurrentPage(1)
                        }}
                        className="w-full pl-9 pr-3 py-2 h-9 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                </div>

                {/* Type Filter */}
                <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setCurrentPage(1) }}>
                    <SelectTrigger className="w-[160px] h-9">
                        <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="unlogged">Unlogged</SelectItem>
                        <SelectItem value="partitioned">Partitioned</SelectItem>
                    </SelectContent>
                </Select>

                <div className="flex-1" />

                <Button onClick={() => setCreateDialog(true)} size="sm" className="h-9">
                    <Plus className="h-4 w-4 mr-2" />
                    Create Queue
                </Button>
            </div>

            {/* Table */}
            <ScrollArea className={tableStyles.SCROLL_AREA}>
                <Table>
                    <TableHeader>
                        <TableRow className={tableStyles.TABLE_ROW_HEADER}>
                            <SortableHeader label="Name" field="name" sortState={sortState} onSort={handleSort} className={tableStyles.TABLE_HEADER_FIRST} />
                            <SortableHeader label="Type" field="queue_type" sortState={sortState} onSort={handleSort} />
                            <SortableHeader label="Messages" field="message_count" sortState={sortState} onSort={handleSort} className="text-right" />
                            <SortableHeader label="Processing" field="processing_count" sortState={sortState} onSort={handleSort} className="text-right" />
                            <SortableHeader label="Dead" field="dead_count" sortState={sortState} onSort={handleSort} className="text-right" />
                            <SortableHeader label="Created" field="created_at" sortState={sortState} onSort={handleSort} />
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[110px]")}>Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {paginatedQueues.length === 0 ? (
                            <TableRow className={tableStyles.TABLE_ROW_EMPTY}>
                                <TableCell colSpan={7} className={tableStyles.TABLE_CELL_EMPTY}>
                                    <EmptyState
                                        icon={Database}
                                        title={search || typeFilter !== "all" ? "No queues found" : "No queues yet"}
                                        description={search || typeFilter !== "all"
                                            ? "Try adjusting your search or filters"
                                            : "Create a queue to get started"
                                        }
                                        isFilterActive={!!search || typeFilter !== "all"}
                                    />
                                </TableCell>
                            </TableRow>
                        ) : (
                            paginatedQueues.map((queue) => (
                                <TableRow
                                    key={queue.name}
                                    className={cn(
                                        tableStyles.TABLE_ROW_BASE,
                                        onQueueSelect && "cursor-pointer"
                                    )}
                                    onClick={() => onQueueSelect?.(queue.name)}
                                >
                                    <TableCell className={tableStyles.TABLE_CELL_FIRST}>
                                        <span className={cn(tableStyles.TEXT_MONO, "font-medium")}>{queue.name}</span>
                                    </TableCell>
                                    <TableCell>
                                        {getQueueTypeBadge(queue.queue_type)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <span className={tableStyles.TEXT_MONO}>{queue.message_count.toLocaleString()}</span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <span className={tableStyles.TEXT_MONO}>{queue.processing_count.toLocaleString()}</span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <span className={cn(
                                            tableStyles.TEXT_MONO,
                                            queue.dead_count > 0 && "text-destructive font-medium"
                                        )}>
                                            {queue.dead_count.toLocaleString()}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        <span className={tableStyles.TABLE_CELL_TIME}>
                                            {formatTime(queue.created_at)}
                                        </span>
                                    </TableCell>
                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                        <div className={tableStyles.FLEX_INLINE}>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setEditDialog({ isOpen: true, queue })}
                                                        className={tableStyles.BUTTON_ACTION}
                                                    >
                                                        <Edit className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>Edit settings</TooltipContent>
                                            </Tooltip>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setDeleteDialog({ isOpen: true, queue })}
                                                        className={cn(tableStyles.BUTTON_ACTION, "text-destructive hover:text-destructive")}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>Delete queue</TooltipContent>
                                            </Tooltip>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </ScrollArea>

            {/* Pagination */}
            {totalPages > 0 && (
                <PaginationFooter
                    pageSize={pageSize}
                    setPageSize={(size) => { setPageSize(size); setCurrentPage(1) }}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    setCurrentPage={setCurrentPage}
                    totalItems={filteredAndSortedQueues.length}
                    pageSizeOptions={[10, 25, 50, 100]}
                />
            )}

            {/* Dialogs */}
            <CreateQueueDialog
                isOpen={createDialog}
                onClose={() => setCreateDialog(false)}
                onCreate={handleCreateQueue}
                isLoading={actionLoading}
            />

            <EditQueueDialog
                isOpen={editDialog.isOpen}
                onClose={() => setEditDialog({ isOpen: false, queue: null })}
                onSave={handleUpdateQueue}
                queue={editDialog.queue}
                isLoading={actionLoading}
            />

            <DeleteQueueDialog
                isOpen={deleteDialog.isOpen}
                onClose={() => setDeleteDialog({ isOpen: false, queue: null })}
                onConfirm={handleDeleteQueue}
                queue={deleteDialog.queue}
                isLoading={actionLoading}
            />

            <RenameQueueDialog
                isOpen={renameDialog.isOpen}
                onClose={() => setRenameDialog({ isOpen: false, queue: null })}
                onRename={handleRenameQueue}
                queue={renameDialog.queue}
                isLoading={actionLoading}
            />
        </div>
    )
}
