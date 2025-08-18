<!-- Start SDK Example Usage [usage] -->
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