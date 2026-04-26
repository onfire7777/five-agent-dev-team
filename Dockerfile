FROM node:22-slim

ARG GITHUB_MCP_VERSION=1.0.3

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git gnupg openssh-client \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg > /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && arch="$(dpkg --print-architecture)" \
  && case "$arch" in amd64) mcp_arch="x86_64" ;; arm64) mcp_arch="arm64" ;; *) echo "Unsupported architecture for github-mcp-server: $arch" >&2; exit 1 ;; esac \
  && mkdir -p /tmp/github-mcp-server \
  && curl -fsSL "https://github.com/github/github-mcp-server/releases/download/v${GITHUB_MCP_VERSION}/github-mcp-server_Linux_${mcp_arch}.tar.gz" -o /tmp/github-mcp-server.tar.gz \
  && tar -xzf /tmp/github-mcp-server.tar.gz -C /tmp/github-mcp-server \
  && find /tmp/github-mcp-server -type f -name github-mcp-server -exec install -m 0755 {} /usr/local/bin/github-mcp-server \; -quit \
  && test -x /usr/local/bin/github-mcp-server \
  && git config --system --add safe.directory /app \
  && rm -rf /var/lib/apt/lists/* /tmp/github-mcp-server /tmp/github-mcp-server.tar.gz

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 4310 5173

CMD ["npm", "run", "dev"]
