ARG BASE_IMAGE=ubuntu:24.04@sha256:c92376659a7f14cc1f51615d73c9f4b7d8e18d59f370e02b4ed683ab4485c66c
ARG NODE_IMAGE=node:24.22.3-bookworm-slim@sha256:5f8fabfed57b75127de2f584593d67a9e8c90e6b0f65652871f9ef0f759c0299
ARG RUST_IMAGE=rust:1.100.0-slim-bookworm@sha256:a05e7b80377ed6099c177cad2b9f536e182b9574490c7b4c07acaa29a44fda57
FROM ${NODE_IMAGE} AS node
FROM ${RUST_IMAGE} AS rust
FROM ${BASE_IMAGE}

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/ /usr/local/lib/node_modules/
COPY --from=rust /usr/local/cargo/ /usr/local/cargo/
COPY --from=rust /usr/local/rustup/ /usr/local/rustup/
ENV CARGO_HOME=/usr/local/cargo \
    RUSTUP_HOME=/usr/local/rustup \
    PATH=/usr/local/cargo/bin:$PATH
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && grep -q 'VERSION_ID="24.04"' /etc/os-release \
    && grep -q 'noble-security' /etc/apt/sources.list.d/ubuntu.sources \
    && grep -q 'noble-updates' /etc/apt/sources.list.d/ubuntu.sources \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
       ca-certificates curl file git build-essential pkg-config \
       libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev librsvg2-dev patchelf \
       libayatana-appindicator3-dev libxdo-dev libfuse2t64 \
       libdbus-1-3 zenity xdg-desktop-portal xdg-desktop-portal-gtk \
       dpkg fakeroot binutils squashfs-tools desktop-file-utils \
       unzip zip xz-utils zstd \
    && node --version && rustc --version && cargo --version \
    && dpkg-query -W > /opt/velocity-build-packages.txt \
    && rm -rf /var/lib/apt/lists/*

COPY build.js /opt/velocity-build.js
COPY verify.js /opt/verify.js
ENV APPIMAGE_EXTRACT_AND_RUN=1 \
    TAR_OPTIONS=--no-same-owner \
    CI=true \
    CARGO_INCREMENTAL=0 \
    CARGO_BUILD_JOBS=2 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /work
ENTRYPOINT ["node", "/opt/velocity-build.js"]
