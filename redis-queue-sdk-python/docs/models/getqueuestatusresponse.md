# GetQueueStatusResponse

Queue Status


## Fields

| Field                                                  | Type                                                   | Required                                               | Description                                            |
| ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------ |
| `main_queue`                                           | [models.MainQueue](../models/mainqueue.md)             | :heavy_check_mark:                                     | N/A                                                    |
| `processing_queue`                                     | [models.ProcessingQueue](../models/processingqueue.md) | :heavy_check_mark:                                     | N/A                                                    |
| `dead_letter_queue`                                    | [models.DeadLetterQueue](../models/deadletterqueue.md) | :heavy_check_mark:                                     | N/A                                                    |
| `archive_queue`                                        | [models.ArchiveQueue](../models/archivequeue.md)       | :heavy_check_mark:                                     | N/A                                                    |
| `metadata`                                             | [models.Metadata](../models/metadata.md)               | :heavy_check_mark:                                     | N/A                                                    |
| `available_types`                                      | List[*str*]                                            | :heavy_check_mark:                                     | N/A                                                    |