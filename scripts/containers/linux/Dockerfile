ARG BASE_IMAGE=ubuntu:24.04@sha256:c92376659a7f14cc1f51615d73c9f4b7d8e18d59f370e02b4ed683ab4485c66c
ARG NODE_IMAGE=node:24.22.3-bookworm-slim@sha256:5f8fabfed57b75127de2f584593d67a9e8c90e6b0f65652871f9ef0f759c0299
FROM ${NODE_IMAGE} AS node
FROM ${BASE_IMAGE}

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/ /usr/local/lib/node_modules/
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && grep -q 'VERSION_ID="24.04"' /etc/os-release \
    && grep -q 'noble-security' /etc/apt/sources.list.d/ubuntu.sources \
    && grep -q 'noble-updates' /etc/apt/sources.list.d/ubuntu.sources \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
       ca-certificates curl file git \
       libgtk-3-0t64 libnss3 libnspr4 libasound2t64 libnotify4 libxss1 libxtst6 \
       libatspi2.0-0t64 libuuid1 libsecret-1-0 libgbm1 libdrm2 libfuse2t64 \
       xdg-utils \
       dpkg fakeroot binutils squashfs-tools desktop-file-utils qemu-user-static \
       unzip zip xz-utils zstd \
    && node --version \
    && dpkg-query -W > /opt/velocity-build-packages.txt \
    && rm -rf /var/lib/apt/lists/*

COPY build.js /opt/velocity-build.js
COPY verify.js /opt/verify.js
ENV APPIMAGE_EXTRACT_AND_RUN=1 \
    TAR_OPTIONS=--no-same-owner \
    CI=true \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /work
ENTRYPOINT ["node", "/opt/velocity-build.js"]
