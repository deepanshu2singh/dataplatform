# Phase 8F.2 runtime PID fix

The previous production image validated Nginx during build with `nginx -t`.
That validation could leave `/tmp/nginx.pid` owned by root. The final image
runs as the unprivileged `nginx` user, so runtime startup could not overwrite
that root-owned file.

This replacement Dockerfile:

1. Removes `/tmp/nginx.pid` after the build-time Nginx config test.
2. Disables the stock Nginx Docker entrypoint because this image uses a fixed,
   immutable `/etc/nginx/nginx.conf` and does not need the root-oriented
   configuration mutation scripts.
3. Keeps the runtime process as the unprivileged `nginx` user.
