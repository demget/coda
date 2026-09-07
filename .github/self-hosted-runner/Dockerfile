FROM myoung34/github-runner:ubuntu-noble

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git jq \
  && rm -rf /var/lib/apt/lists/*

# Copy the binary into /usr/local/bin so a runtime mount of ~/.grok (auth only)
# cannot hide the image's Grok install.
RUN curl -fsSL https://x.ai/cli/install.sh | bash \
  && cp -L /root/.grok/bin/grok /usr/local/bin/grok \
  && cp -L /root/.grok/bin/agent /usr/local/bin/agent \
  && chmod 755 /usr/local/bin/grok /usr/local/bin/agent \
  && grok --version

RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*
