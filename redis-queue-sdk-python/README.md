# openapi

Developer-friendly & type-safe Python SDK specifically catered to leverage *openapi* API.

<div align="left">
    <a href="https://www.speakeasy.com/?utm_source=openapi&utm_campaign=python"><img src="https://custom-icon-badges.demolab.com/badge/-Built%20By%20Speakeasy-212015?style=for-the-badge&logoColor=FBE331&logo=speakeasy&labelColor=545454" /></a>
    <a href="https://opensource.org/licenses/MIT">
        <img src="https://img.shields.io/badge/License-MIT-blue.svg" style="width: 100px; height: 28px;" />
    </a>
</div>


<br /><br />
> [!IMPORTANT]
> This SDK is not yet ready for production use. To complete setup please follow the steps outlined in your [workspace](https://app.speakeasy.com/org/mood/braindog). Delete this section before > publishing to a package manager.

<!-- Start Summary [summary] -->
## Summary


<!-- End Summary [summary] -->

<!-- Start Table of Contents [toc] -->
## Table of Contents
<!-- $toc-max-depth=2 -->
* [openapi](#openapi)
  * [SDK Installation](#sdk-installation)
  * [IDE Support](#ide-support)
  * [SDK Example Usage](#sdk-example-usage)
  * [Available Resources and Operations](#available-resources-and-operations)
  * [Retries](#retries)
  * [Error Handling](#error-handling)
  * [Custom HTTP Client](#custom-http-client)
  * [Resource Management](#resource-management)
  * [Debugging](#debugging)
* [Development](#development)
  * [Maturity](#maturity)
  * [Contributions](#contributions)

<!-- End Table of Contents [toc] -->

<!-- Start SDK Installation [installation] -->
## SDK Installation

> [!TIP]
> To finish publishing your SDK to PyPI you must [run your first generation action](https://www.speakeasy.com/docs/github-setup#step-by-step-guide).


> [!NOTE]
> **Python version upgrade policy**
>
> Once a Python version reaches its [official end of life date](https://devguide.python.org/versions/), a 3-month grace period is provided for users to upgrade. Following this grace period, the minimum python version supported in the SDK will be updated.

The SDK can be installed with either *pip* or *poetry* package managers.

### PIP

*PIP* is the default package installer for Python, enabling easy installation and management of packages from PyPI via the command line.

```bash
pip install git+<UNSET>.git
```

### Poetry

*Poetry* is a modern tool that simplifies dependency management and package publishing by using a single `pyproject.toml` file to handle project metadata and dependencies.

```bash
poetry add git+<UNSET>.git
```

### Shell and script usage with `uv`

You can use this SDK in a Python shell with [uv](https://docs.astral.sh/uv/) and the `uvx` command that comes with it like so:

```shell
uvx --from openapi python
```

It's also possible to write a standalone Python script without needing to set up a whole project like so:

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "openapi",
# ]
# ///

from openapi import SDK

sdk = SDK(
  # SDK arguments
)

# Rest of script here...
```

Once that is saved to a file, you can run it with `uv run script.py` where
`script.py` can be replaced with the actual file name.
<!-- End SDK Installation [installation] -->

<!-- Start IDE Support [idesupport] -->
## IDE Support

### PyCharm

Generally, the SDK will work well with most IDEs out of the box. However, when using PyCharm, you can enjoy much better integration with Pydantic by installing an additional plugin.

- [PyCharm Pydantic Plugin](https://docs.pydantic.dev/latest/integrations/pycharm/)
<!-- End IDE Support [idesupport] -->

<!-- Start SDK Example Usage [usage] -->
## SDK Example Usage

### Example

```python
# Synchronous Example
from openapi import SDK


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.get_queue_message()

    # Handle response
    print(res)
```

</br>

The same SDK client can also be used to make asychronous requests by importing asyncio.
```python
# Asynchronous Example
import asyncio
from openapi import SDK

async def main():

    async with SDK(
        server_url="https://api.example.com",
    ) as sdk:

        res = await sdk.queue.get_queue_message_async()

        # Handle response
        print(res)

asyncio.run(main())
```
<!-- End SDK Example Usage [usage] -->

<!-- Start Available Resources and Operations [operations] -->
## Available Resources and Operations

<details open>
<summary>Available methods</summary>

### [queue](docs/sdks/queue/README.md)

* [get_queue_message](docs/sdks/queue/README.md#get_queue_message)
* [post_queue_message](docs/sdks/queue/README.md#post_queue_message)
* [post_queue_batch](docs/sdks/queue/README.md#post_queue_batch)
* [post_queue_ack](docs/sdks/queue/README.md#post_queue_ack)
* [get_queue_metrics](docs/sdks/queue/README.md#get_queue_metrics)
* [get_health](docs/sdks/queue/README.md#get_health)
* [get_queue_status](docs/sdks/queue/README.md#get_queue_status)
* [get_queue_messages](docs/sdks/queue/README.md#get_queue_messages)
* [delete_queue_messages](docs/sdks/queue/README.md#delete_queue_messages)
* [delete_queue_message_message_id_](docs/sdks/queue/README.md#delete_queue_message_message_id_)
* [delete_queue_queue_type_clear](docs/sdks/queue/README.md#delete_queue_queue_type_clear)
* [get_queue_config](docs/sdks/queue/README.md#get_queue_config)
* [put_queue_config](docs/sdks/queue/README.md#put_queue_config)


</details>
<!-- End Available Resources and Operations [operations] -->

<!-- Start Retries [retries] -->
## Retries

Some of the endpoints in this SDK support retries. If you use the SDK without any configuration, it will fall back to the default retry strategy provided by the API. However, the default retry strategy can be overridden on a per-operation basis, or across the entire SDK.

To change the default retry strategy for a single API call, simply provide a `RetryConfig` object to the call:
```python
from openapi import SDK
from openapi.utils import BackoffStrategy, RetryConfig


with SDK(
    server_url="https://api.example.com",
) as sdk:

    res = sdk.queue.get_queue_message(,
        RetryConfig("backoff", BackoffStrategy(1, 50, 1.1, 100), False))

    # Handle response
    print(res)

```

If you'd like to override the default retry strategy for all operations that support retries, you can use the `retry_config` optional parameter when initializing the SDK:
```python
from openapi import SDK
from openapi.utils import BackoffStrategy, RetryConfig


with SDK(
    server_url="https://api.example.com",
    retry_config=RetryConfig("backoff", BackoffStrategy(1, 50, 1.1, 100), False),
) as sdk:

    res = sdk.queue.get_queue_message()

    # Handle response
    print(res)

```
<!-- End Retries [retries] -->

<!-- Start Error Handling [errors] -->
## Error Handling

[`SDKError`](./src/openapi/errors/sdkerror.py) is the base class for all HTTP error responses. It has the following properties:

| Property           | Type             | Description                                                                             |
| ------------------ | ---------------- | --------------------------------------------------------------------------------------- |
| `err.message`      | `str`            | Error message                                                                           |
| `err.status_code`  | `int`            | HTTP response status code eg `404`                                                      |
| `err.headers`      | `httpx.Headers`  | HTTP response headers                                                                   |
| `err.body`         | `str`            | HTTP body. Can be empty string if no body is returned.                                  |
| `err.raw_response` | `httpx.Response` | Raw HTTP response                                                                       |
| `err.data`         |                  | Optional. Some errors may contain structured data. [See Error Classes](#error-classes). |

### Example
```python
from openapi import SDK, errors


with SDK(
    server_url="https://api.example.com",
) as sdk:
    res = None
    try:

        res = sdk.queue.get_queue_message()

        # Handle response
        print(res)


    except errors.SDKError as e:
        # The base class for HTTP error responses
        print(e.message)
        print(e.status_code)
        print(e.body)
        print(e.headers)
        print(e.raw_response)

        # Depending on the method different errors may be thrown
        if isinstance(e, errors.GetQueueMessageNotFoundError):
            print(e.data.message)  # str
```

### Error Classes
**Primary error:**
* [`SDKError`](./src/openapi/errors/sdkerror.py): The base class for HTTP error responses.

<details><summary>Less common errors (23)</summary>

<br />

**Network errors:**
* [`httpx.RequestError`](https://www.python-httpx.org/exceptions/#httpx.RequestError): Base class for request errors.
    * [`httpx.ConnectError`](https://www.python-httpx.org/exceptions/#httpx.ConnectError): HTTP client was unable to make a request to a server.
    * [`httpx.TimeoutException`](https://www.python-httpx.org/exceptions/#httpx.TimeoutException): HTTP request timed out.


**Inherit from [`SDKError`](./src/openapi/errors/sdkerror.py)**:
* [`PostQueueAckBadRequestError`](./src/openapi/errors/postqueueackbadrequesterror.py): Message not acknowledged. Status code `400`. Applicable to 1 of 13 methods.*
* [`DeleteQueueMessageMessageIDBadRequestError`](./src/openapi/errors/deletequeuemessagemessageidbadrequesterror.py): Bad Request. Status code `400`. Applicable to 1 of 13 methods.*
* [`DeleteQueueQueueTypeClearBadRequestError`](./src/openapi/errors/deletequeuequeuetypeclearbadrequesterror.py): Bad Request. Status code `400`. Applicable to 1 of 13 methods.*
* [`PutQueueConfigBadRequestError`](./src/openapi/errors/putqueueconfigbadrequesterror.py): Validation Error. Status code `400`. Applicable to 1 of 13 methods.*
* [`GetQueueMessageNotFoundError`](./src/openapi/errors/getqueuemessagenotfounderror.py): Message not found. Status code `404`. Applicable to 1 of 13 methods.*
* [`DeleteQueueMessageMessageIDNotFoundError`](./src/openapi/errors/deletequeuemessagemessageidnotfounderror.py): Message not found. Status code `404`. Applicable to 1 of 13 methods.*
* [`GetQueueMessageUnprocessableEntityError`](./src/openapi/errors/getqueuemessageunprocessableentityerror.py): Validation Error. Status code `422`. Applicable to 1 of 13 methods.*
* [`PostQueueMessageUnprocessableEntityError`](./src/openapi/errors/postqueuemessageunprocessableentityerror.py): Validation Error. Status code `422`. Applicable to 1 of 13 methods.*
* [`PostQueueBatchUnprocessableEntityError`](./src/openapi/errors/postqueuebatchunprocessableentityerror.py): Validation Error. Status code `422`. Applicable to 1 of 13 methods.*
* [`PostQueueAckUnprocessableEntityError`](./src/openapi/errors/postqueueackunprocessableentityerror.py): Validation Error. Status code `422`. Applicable to 1 of 13 methods.*
* [`GetQueueMessagesUnprocessableEntityError`](./src/openapi/errors/getqueuemessagesunprocessableentityerror.py): Validation Error. Status code `422`. Applicable to 1 of 13 methods.*
* [`DeleteQueueMessagesUnprocessableEntityError`](./src/openapi/errors/deletequeuemessagesunprocessableentityerror.py): Validation Error. Status code `422`. Applicable to 1 of 13 methods.*
* [`PostQueueMessageInternalServerError`](./src/openapi/errors/postqueuemessageinternalservererror.py): Internal Server Error. Status code `500`. Applicable to 1 of 13 methods.*
* [`GetHealthInternalServerError`](./src/openapi/errors/gethealthinternalservererror.py): Internal Server Error. Status code `500`. Applicable to 1 of 13 methods.*
* [`DeleteQueueMessageMessageIDInternalServerError`](./src/openapi/errors/deletequeuemessagemessageidinternalservererror.py): Internal Server Error. Status code `500`. Applicable to 1 of 13 methods.*
* [`DeleteQueueQueueTypeClearInternalServerError`](./src/openapi/errors/deletequeuequeuetypeclearinternalservererror.py): Internal Server Error. Status code `500`. Applicable to 1 of 13 methods.*
* [`GetQueueConfigInternalServerError`](./src/openapi/errors/getqueueconfiginternalservererror.py): Internal Server Error. Status code `500`. Applicable to 1 of 13 methods.*
* [`PutQueueConfigInternalServerError`](./src/openapi/errors/putqueueconfiginternalservererror.py): Internal Server Error. Status code `500`. Applicable to 1 of 13 methods.*
* [`ResponseValidationError`](./src/openapi/errors/responsevalidationerror.py): Type mismatch between the response data and the expected Pydantic model. Provides access to the Pydantic validation error via the `cause` attribute.

</details>

\* Check [the method documentation](#available-resources-and-operations) to see if the error is applicable.
<!-- End Error Handling [errors] -->

<!-- Start Custom HTTP Client [http-client] -->
## Custom HTTP Client

The Python SDK makes API calls using the [httpx](https://www.python-httpx.org/) HTTP library.  In order to provide a convenient way to configure timeouts, cookies, proxies, custom headers, and other low-level configuration, you can initialize the SDK client with your own HTTP client instance.
Depending on whether you are using the sync or async version of the SDK, you can pass an instance of `HttpClient` or `AsyncHttpClient` respectively, which are Protocol's ensuring that the client has the necessary methods to make API calls.
This allows you to wrap the client with your own custom logic, such as adding custom headers, logging, or error handling, or you can just pass an instance of `httpx.Client` or `httpx.AsyncClient` directly.

For example, you could specify a header for every request that this sdk makes as follows:
```python
from openapi import SDK
import httpx

http_client = httpx.Client(headers={"x-custom-header": "someValue"})
s = SDK(client=http_client)
```

or you could wrap the client with your own custom logic:
```python
from openapi import SDK
from openapi.httpclient import AsyncHttpClient
import httpx

class CustomClient(AsyncHttpClient):
    client: AsyncHttpClient

    def __init__(self, client: AsyncHttpClient):
        self.client = client

    async def send(
        self,
        request: httpx.Request,
        *,
        stream: bool = False,
        auth: Union[
            httpx._types.AuthTypes, httpx._client.UseClientDefault, None
        ] = httpx.USE_CLIENT_DEFAULT,
        follow_redirects: Union[
            bool, httpx._client.UseClientDefault
        ] = httpx.USE_CLIENT_DEFAULT,
    ) -> httpx.Response:
        request.headers["Client-Level-Header"] = "added by client"

        return await self.client.send(
            request, stream=stream, auth=auth, follow_redirects=follow_redirects
        )

    def build_request(
        self,
        method: str,
        url: httpx._types.URLTypes,
        *,
        content: Optional[httpx._types.RequestContent] = None,
        data: Optional[httpx._types.RequestData] = None,
        files: Optional[httpx._types.RequestFiles] = None,
        json: Optional[Any] = None,
        params: Optional[httpx._types.QueryParamTypes] = None,
        headers: Optional[httpx._types.HeaderTypes] = None,
        cookies: Optional[httpx._types.CookieTypes] = None,
        timeout: Union[
            httpx._types.TimeoutTypes, httpx._client.UseClientDefault
        ] = httpx.USE_CLIENT_DEFAULT,
        extensions: Optional[httpx._types.RequestExtensions] = None,
    ) -> httpx.Request:
        return self.client.build_request(
            method,
            url,
            content=content,
            data=data,
            files=files,
            json=json,
            params=params,
            headers=headers,
            cookies=cookies,
            timeout=timeout,
            extensions=extensions,
        )

s = SDK(async_client=CustomClient(httpx.AsyncClient()))
```
<!-- End Custom HTTP Client [http-client] -->

<!-- Start Resource Management [resource-management] -->
## Resource Management

The `SDK` class implements the context manager protocol and registers a finalizer function to close the underlying sync and async HTTPX clients it uses under the hood. This will close HTTP connections, release memory and free up other resources held by the SDK. In short-lived Python programs and notebooks that make a few SDK method calls, resource management may not be a concern. However, in longer-lived programs, it is beneficial to create a single SDK instance via a [context manager][context-manager] and reuse it across the application.

[context-manager]: https://docs.python.org/3/reference/datamodel.html#context-managers

```python
from openapi import SDK
def main():

    with SDK(
        server_url="https://api.example.com",
    ) as sdk:
        # Rest of application here...


# Or when using async:
async def amain():

    async with SDK(
        server_url="https://api.example.com",
    ) as sdk:
        # Rest of application here...
```
<!-- End Resource Management [resource-management] -->

<!-- Start Debugging [debug] -->
## Debugging

You can setup your SDK to emit debug logs for SDK requests and responses.

You can pass your own logger class directly into your SDK.
```python
from openapi import SDK
import logging

logging.basicConfig(level=logging.DEBUG)
s = SDK(server_url="https://example.com", debug_logger=logging.getLogger("openapi"))
```
<!-- End Debugging [debug] -->

<!-- Placeholder for Future Speakeasy SDK Sections -->

# Development

## Maturity

This SDK is in beta, and there may be breaking changes between versions without a major version update. Therefore, we recommend pinning usage
to a specific package version. This way, you can install the same version each time without breaking changes unless you are intentionally
looking for the latest version.

## Contributions

While we value open-source contributions to this SDK, this library is generated programmatically. Any manual changes added to internal files will be overwritten on the next generation. 
We look forward to hearing your feedback. Feel free to open a PR or an issue with a proof of concept and we'll do our best to include it in a future release. 

### SDK Created by [Speakeasy](https://www.speakeasy.com/?utm_source=openapi&utm_campaign=python)
