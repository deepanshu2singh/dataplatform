"""Fail safely before a cloud Function's bounded response reaches its host."""
from starlette.responses import JSONResponse

CLOUD_RESPONSE_MAX_BYTES = 3 * 1024 * 1024


class CloudResponseLimitMiddleware:
    def __init__(self, app, *, enabled: bool, max_bytes: int = CLOUD_RESPONSE_MAX_BYTES):
        self.app = app
        self.enabled = enabled
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not self.enabled:
            await self.app(scope, receive, send)
            return
        start = None
        chunks = []
        size = 0
        exceeded = False

        async def bounded_send(message):
            nonlocal start, size, exceeded
            if message["type"] == "http.response.start":
                start = message
                return
            if message["type"] != "http.response.body":
                await send(message)
                return
            body = message.get("body", b"")
            size += len(body)
            if size > self.max_bytes:
                exceeded = True
                chunks.clear()
            if not exceeded:
                chunks.append(body)
            if message.get("more_body", False):
                return
            if exceeded:
                response = JSONResponse(status_code=413, content={
                    "detail": "This response is too large for cloud delivery. "
                    "Reduce the result size or request fewer rows.",
                })
                await response(scope, receive, send)
            else:
                await send(start)
                await send({"type": "http.response.body", "body": b"".join(chunks)})

        await self.app(scope, receive, bounded_send)
