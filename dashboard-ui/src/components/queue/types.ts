// ============================================================================
// Queue Types and Constants
// ============================================================================

export interface Message {
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
    archived_at?: number
    consumer_id?: string | null
    lock_token?: string
}

export interface Pagination {
    total: number
    page: number
    limit: number
    totalPages: number
}

export interface MessagesResponse {
    messages: Message[]
    pagination: Pagination
}

export interface QueueInfo {
    name: string
    length: number
    messages: Message[]
}

export interface QueueMetadata {
    totalProcessed: number
    totalFailed: number
    totalAcknowledged: number
}

export interface SystemStatus {
    mainQueue: QueueInfo
    processingQueue: QueueInfo
    deadLetterQueue: QueueInfo
    acknowledgedQueue: QueueInfo
    archivedQueue: QueueInfo
    metadata: QueueMetadata
    availableTypes: string[]
}

export interface QueueConfig {
    ack_timeout_seconds: number
    max_attempts: number
}

export type DashboardView = 'queues' | 'activity' | 'queue-management'

export const QUEUE_TABS = ["main", "processing", "dead", "acknowledged", "archived"] as const
export type QueueTab = (typeof QUEUE_TABS)[number]

export const QUEUE_TAB_NAMES: Record<QueueTab, string> = {
    main: "Main",
    processing: "Processing ",
    dead: "Failed",
    acknowledged: "Acknowledged",
    archived: "Archived",
}

export type SortOrder = "asc" | "desc"

export type DashboardState = {
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

export const getDefaultSortBy = (queue: QueueTab): string => {
    switch (queue) {
        case "processing": return "dequeued_at"
        case "acknowledged": return "acknowledged_at"
        // dead and archived don't have dedicated timestamp columns, use created_at
        case "dead": return "created_at"
        case "archived": return "created_at"
        default: return "created_at"
    }
}

// Helper function to syntax highlight JSON
export function syntaxHighlightJson(json: string): string {
    return json.replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        (match) => {
            let cls = 'text-amber-400'; // number
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'text-sky-400'; // key
                    match = match.slice(0, -1) + '<span class="text-slate-500">:</span>';
                } else {
                    cls = 'text-emerald-400'; // string
                }
            } else if (/true|false/.test(match)) {
                cls = 'text-purple-400'; // boolean
            } else if (/null/.test(match)) {
                cls = 'text-rose-400'; // null
            }
            return `<span class="${cls}">${match}</span>`;
        }
    );
}
