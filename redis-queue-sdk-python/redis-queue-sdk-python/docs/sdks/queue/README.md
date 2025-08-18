# Queue
(*queue*)

## Overview

### Available Operations

* [get_queue_message](#get_queue_message)
* [post_queue_message](#post_queue_message)
* [post_queue_batch](#post_queue_batch)
* [post_queue_ack](#post_queue_ack)
* [get_queue_metrics](#get_queue_metrics)
* [get_health](#get_health)
* [get_queue_status](#get_queue_status)
* [get_queue_messages](#get_queue_messages)
* [delete_queue_messages](#delete_queue_messages)
* [delete_queue_message_message_id_](#delete_queue_message_message_id_)
* [delete_queue_queue_type_clear](#delete_queue_queue_type_clear)
* [get_queue_config](#get_queue_config)
* [put_queue_config](#put_queue_config)

## get_queue_message

### Example Usage

<!-- UsageSnippet language="python" operationID="get_/queue/message" method="get" path="/queue/message" -->
```python
from openapi import SDK


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.get_queue_message()

    # Handle response
    print(res)

```

### Parameters

| Parameter                                                           | Type                                                                | Required                                                            | Description                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `timeout`                                                           | *Optional[str]*                                                     | :heavy_minus_sign:                                                  | N/A                                                                 |
| `retries`                                                           | [Optional[utils.RetryConfig]](../../models/utils/retryconfig.md)    | :heavy_minus_sign:                                                  | Configuration to override the default retry behavior of the client. |

### Response

**[models.GetQueueMessageResponse](../../models/getqueuemessageresponse.md)**

### Errors

| Error Type                                     | Status Code                                    | Content Type                                   |
| ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| errors.GetQueueMessageNotFoundError            | 404                                            | application/json                               |
| errors.GetQueueMessageUnprocessableEntityError | 422                                            | application/json                               |
| errors.APIError                                | 4XX, 5XX                                       | \*/\*                                          |

## post_queue_message

### Example Usage

<!-- UsageSnippet language="python" operationID="post_/queue/message" method="post" path="/queue/message" -->
```python
from openapi import SDK


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.post_queue_message(type_="<value>")

    # Handle response
    print(res)

```

### Parameters

| Parameter                                                           | Type                                                                | Required                                                            | Description                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `type`                                                              | *str*                                                               | :heavy_check_mark:                                                  | N/A                                                                 |
| `payload`                                                           | *OptionalNullable[Any]*                                             | :heavy_minus_sign:                                                  | N/A                                                                 |
| `priority`                                                          | *Optional[float]*                                                   | :heavy_minus_sign:                                                  | N/A                                                                 |
| `custom_ack_timeout`                                                | *Optional[float]*                                                   | :heavy_minus_sign:                                                  | N/A                                                                 |
| `retries`                                                           | [Optional[utils.RetryConfig]](../../models/utils/retryconfig.md)    | :heavy_minus_sign:                                                  | Configuration to override the default retry behavior of the client. |

### Response

**[models.PostQueueMessageResponse](../../models/postqueuemessageresponse.md)**

### Errors

| Error Type                                      | Status Code                                     | Content Type                                    |
| ----------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| errors.PostQueueMessageUnprocessableEntityError | 422                                             | application/json                                |
| errors.PostQueueMessageInternalServerError      | 500                                             | application/json                                |
| errors.APIError                                 | 4XX, 5XX                                        | \*/\*                                           |

## post_queue_batch

### Example Usage

<!-- UsageSnippet language="python" operationID="post_/queue/batch" method="post" path="/queue/batch" -->
```python
from openapi import SDK


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.post_queue_batch(request_body=[])

    # Handle response
    print(res)

```

### Parameters

| Parameter                                                           | Type                                                                | Required                                                            | Description                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `request_body`                                                      | List[[models.RequestBody](../../models/requestbody.md)]             | :heavy_check_mark:                                                  | Queue Message                                                       |
| `custom_ack_timeout`                                                | *Optional[float]*                                                   | :heavy_minus_sign:                                                  | N/A                                                                 |
| `retries`                                                           | [Optional[utils.RetryConfig]](../../models/utils/retryconfig.md)    | :heavy_minus_sign:                                                  | Configuration to override the default retry behavior of the client. |

### Response

**[models.PostQueueBatchResponse](../../models/postqueuebatchresponse.md)**

### Errors

| Error Type                                    | Status Code                                   | Content Type                                  |
| --------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| errors.PostQueueBatchUnprocessableEntityError | 422                                           | application/json                              |
| errors.APIError                               | 4XX, 5XX                                      | \*/\*                                         |

## post_queue_ack

### Example Usage

<!-- UsageSnippet language="python" operationID="post_/queue/ack" method="post" path="/queue/ack" -->
```python
from openapi import SDK


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.post_queue_ack(id="<id>")

    # Handle response
    print(res)

```

### Parameters

| Parameter                                                           | Type                                                                | Required                                                            | Description                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `id`                                                                | *str*                                                               | :heavy_check_mark:                                                  | N/A                                                                 |
| `type`                                                              | *Optional[str]*                                                     | :heavy_minus_sign:                                                  | N/A                                                                 |
| `payload`                                                           | *OptionalNullable[Any]*                                             | :heavy_minus_sign:                                                  | N/A                                                                 |
| `created_at`                                                        | *Optional[float]*                                                   | :heavy_minus_sign:                                                  | N/A                                                                 |
| `priority`                                                          | *Optional[float]*                                                   | :heavy_minus_sign:                                                  | N/A                                                                 |
| `attempt_count`                                                     | *Optional[float]*                                                   | :heavy_minus_sign:                                                  | N/A                                                                 |
| `dequeued_at`                                                       | *OptionalNullable[float]*                                           | :heavy_minus_sign:                                                  | N/A                                                                 |
| `last_error`                                                        | *OptionalNullable[str]*                                             | :heavy_minus_sign:                                                  | N/A                                                                 |
| `processing_duration`                                               | *Optional[float]*                                                   | :heavy_minus_sign:                                                  | N/A                                                                 |
| `retries`                                                           | [Optional[utils.RetryConfig]](../../models/utils/retryconfig.md)    | :heavy_minus_sign:                                                  | Configuration to override the default retry behavior of the client. |

### Response

**[models.PostQueueAckResponse](../../models/postqueueackresponse.md)**

### Errors

| Error Type                                  | Status Code                                 | Content Type                                |
| ------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| errors.PostQueueAckBadRequestError          | 400                                         | application/json                            |
| errors.PostQueueAckUnprocessableEntityError | 422                                         | application/json                            |
| errors.APIError                             | 4XX, 5XX                                    | \*/\*                                       |

## get_queue_metrics

### Example Usage

<!-- UsageSnippet language="python" operationID="get_/queue/metrics" method="get" path="/queue/metrics" -->
```python
from openapi import SDK


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.get_queue_metrics()

    # Handle response
    print(res)

```

### Parameters

| Parameter                                                           | Type                                                                | Required                                                            | Description                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `retries`                                                           | [Optional[utils.RetryConfig]](../../models/utils/retryconfig.md)    | :heavy_minus_sign:                                                  | Configuration to override the default retry behavior of the client. |

### Response

**[models.GetQueueMetricsResponse](../../models/getqueuemetricsresponse.md)**

### Errors

| Error Type      | Status Code     | Content Type    |
| --------------- | --------------- | --------------- |
| errors.APIError | 4XX, 5XX        | \*/\*           |

## get_health

### Example Usage

<!-- UsageSnippet language="python" operationID="get_/health" method="get" path="/health" -->
```python
from openapi import SDK


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.get_health()

    # Handle response
    print(res)

```

### Parameters

| Parameter                                                           | Type                                                                | Required                                                            | Description                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `retries`                                                           | [Optional[utils.RetryConfig]](../../models/utils/retryconfig.md)    | :heavy_minus_sign:                                                  | Configuration to override the default retry behavior of the client. |

### Response

**[models.GetHealthResponse](../../models/gethealthresponse.md)**

### Errors

| Error Type                          | Status Code                         | Content Type                        |
| ----------------------------------- | ----------------------------------- | ----------------------------------- |
| errors.GetHealthInternalServerError | 500                                 | application/json                    |
| errors.APIError                     | 4XX, 5XX                            | \*/\*                               |

## get_queue_status

### Example Usage

<!-- UsageSnippet language="python" operationID="get_/queue/status" method="get" path="/queue/status" -->
```python
from openapi import SDK


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.get_queue_status()

    # Handle response
    print(res)

```

### Parameters

| Parameter                                                           | Type                                                                | Required                                                            | Description                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `retries`                                                           | [Optional[utils.RetryConfig]](../../models/utils/retryconfig.md)    | :heavy_minus_sign:                                                  | Configuration to override the default retry behavior of the client. |

### Response

**[models.GetQueueStatusResponse](../../models/getqueuestatusresponse.md)**

### Errors

| Error Type      | Status Code     | Content Type    |
| --------------- | --------------- | --------------- |
| errors.APIError | 4XX, 5XX        | \*/\*           |

## get_queue_messages

### Example Usage

<!-- UsageSnippet language="python" operationID="get_/queue/messages" method="get" path="/queue/messages" -->
```python
from openapi import SDK


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.get_queue_messages(start_timestamp="<value>", end_timestamp="<value>")

    # Handle response
    print(res)

```

### Parameters

| Parameter                                                           | Type                                                                | Required                                                            | Description                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `start_timestamp`                                                   | *str*                                                               | :heavy_check_mark:                                                  | N/A                                                                 |
| `end_timestamp`                                                     | *str*                                                               | :heavy_check_mark:                                                  | N/A                                                                 |
| `limit`                                                             | *Optional[str]*                                                     | :heavy_minus_sign:                                                  | N/A                                                                 |
| `retries`                                                           | [Optional[utils.RetryConfig]](../../models/utils/retryconfig.md)    | :heavy_minus_sign:                                                  | Configuration to override the default retry behavior of the client. |

### Response

**[List[models.GetQueueMessagesResponse]](../../models/.md)**

### Errors

| Error Type                                      | Status Code                                     | Content Type                                    |
| ----------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| errors.GetQueueMessagesUnprocessableEntityError | 422                                             | application/json                                |
| errors.APIError                                 | 4XX, 5XX                                        | \*/\*                                           |

## delete_queue_messages

### Example Usage

<!-- UsageSnippet language="python" operationID="delete_/queue/messages" method="delete" path="/queue/messages" -->
```python
from openapi import SDK


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.delete_queue_messages(start_timestamp="<value>", end_timestamp="<value>")

    # Handle response
    print(res)

```

### Parameters

| Parameter                                                           | Type                                                                | Required                                                            | Description                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `start_timestamp`                                                   | *str*                                                               | :heavy_check_mark:                                                  | N/A                                                                 |
| `end_timestamp`                                                     | *str*                                                               | :heavy_check_mark:                                                  | N/A                                                                 |
| `retries`                                                           | [Optional[utils.RetryConfig]](../../models/utils/retryconfig.md)    | :heavy_minus_sign:                                                  | Configuration to override the default retry behavior of the client. |

### Response

**[models.DeleteQueueMessagesResponse](../../models/deletequeuemessagesresponse.md)**

### Errors

| Error Type                                         | Status Code                                        | Content Type                                       |
| -------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| errors.DeleteQueueMessagesUnprocessableEntityError | 422                                                | application/json                                   |
| errors.APIError                                    | 4XX, 5XX                                           | \*/\*                                              |

## delete_queue_message_message_id_

### Example Usage

<!-- UsageSnippet language="python" operationID="delete_/queue/message/{messageId}" method="delete" path="/queue/message/{messageId}" -->
```python
from openapi import SDK, models


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.delete_queue_message_message_id_(message_id="<id>", queue_type=models.DeleteQueueMessageMessageIDQueueType.ARCHIVE)

    # Handle response
    print(res)

```

### Parameters

| Parameter                                                                                           | Type                                                                                                | Required                                                                                            | Description                                                                                         |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `message_id`                                                                                        | *str*                                                                                               | :heavy_check_mark:                                                                                  | N/A                                                                                                 |
| `queue_type`                                                                                        | [models.DeleteQueueMessageMessageIDQueueType](../../models/deletequeuemessagemessageidqueuetype.md) | :heavy_check_mark:                                                                                  | N/A                                                                                                 |
| `retries`                                                                                           | [Optional[utils.RetryConfig]](../../models/utils/retryconfig.md)                                    | :heavy_minus_sign:                                                                                  | Configuration to override the default retry behavior of the client.                                 |

### Response

**[models.DeleteQueueMessageMessageIDResponse](../../models/deletequeuemessagemessageidresponse.md)**

### Errors

| Error Type                                            | Status Code                                           | Content Type                                          |
| ----------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| errors.DeleteQueueMessageMessageIDBadRequestError     | 400                                                   | application/json                                      |
| errors.DeleteQueueMessageMessageIDNotFoundError       | 404                                                   | application/json                                      |
| errors.DeleteQueueMessageMessageIDInternalServerError | 500                                                   | application/json                                      |
| errors.APIError                                       | 4XX, 5XX                                              | \*/\*                                                 |

## delete_queue_queue_type_clear

### Example Usage

<!-- UsageSnippet language="python" operationID="delete_/queue/{queueType}/clear" method="delete" path="/queue/{queueType}/clear" -->
```python
from openapi import SDK, models


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.delete_queue_queue_type_clear(queue_type=models.DeleteQueueQueueTypeClearQueueType.DEAD)

    # Handle response
    print(res)

```

### Parameters

| Parameter                                                                                       | Type                                                                                            | Required                                                                                        | Description                                                                                     |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `queue_type`                                                                                    | [models.DeleteQueueQueueTypeClearQueueType](../../models/deletequeuequeuetypeclearqueuetype.md) | :heavy_check_mark:                                                                              | N/A                                                                                             |
| `retries`                                                                                       | [Optional[utils.RetryConfig]](../../models/utils/retryconfig.md)                                | :heavy_minus_sign:                                                                              | Configuration to override the default retry behavior of the client.                             |

### Response

**[models.DeleteQueueQueueTypeClearResponse](../../models/deletequeuequeuetypeclearresponse.md)**

### Errors

| Error Type                                          | Status Code                                         | Content Type                                        |
| --------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| errors.DeleteQueueQueueTypeClearBadRequestError     | 400                                                 | application/json                                    |
| errors.DeleteQueueQueueTypeClearInternalServerError | 500                                                 | application/json                                    |
| errors.APIError                                     | 4XX, 5XX                                            | \*/\*                                               |

## get_queue_config

### Example Usage

<!-- UsageSnippet language="python" operationID="get_/queue/config" method="get" path="/queue/config" -->
```python
from openapi import SDK


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.get_queue_config()

    # Handle response
    print(res)

```

### Parameters

| Parameter                                                           | Type                                                                | Required                                                            | Description                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `retries`                                                           | [Optional[utils.RetryConfig]](../../models/utils/retryconfig.md)    | :heavy_minus_sign:                                                  | Configuration to override the default retry behavior of the client. |

### Response

**[models.GetQueueConfigResponse](../../models/getqueueconfigresponse.md)**

### Errors

| Error Type                               | Status Code                              | Content Type                             |
| ---------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| errors.GetQueueConfigInternalServerError | 500                                      | application/json                         |
| errors.APIError                          | 4XX, 5XX                                 | \*/\*                                    |

## put_queue_config

### Example Usage

<!-- UsageSnippet language="python" operationID="put_/queue/config" method="put" path="/queue/config" -->
```python
from openapi import SDK


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.put_queue_config()

    # Handle response
    print(res)

```

### Parameters

| Parameter                                                           | Type                                                                | Required                                                            | Description                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ack_timeout_seconds`                                               | *Optional[float]*                                                   | :heavy_minus_sign:                                                  | N/A                                                                 |
| `max_attempts`                                                      | *Optional[float]*                                                   | :heavy_minus_sign:                                                  | N/A                                                                 |
| `batch_size`                                                        | *Optional[float]*                                                   | :heavy_minus_sign:                                                  | N/A                                                                 |
| `retries`                                                           | [Optional[utils.RetryConfig]](../../models/utils/retryconfig.md)    | :heavy_minus_sign:                                                  | Configuration to override the default retry behavior of the client. |

### Response

**[models.PutQueueConfigResponse](../../models/putqueueconfigresponse.md)**

### Errors

| Error Type                               | Status Code                              | Content Type                             |
| ---------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| errors.PutQueueConfigBadRequestError     | 400                                      | application/json                         |
| errors.PutQueueConfigInternalServerError | 500                                      | application/json                         |
| errors.APIError                          | 4XX, 5XX                                 | \*/\*                                    |