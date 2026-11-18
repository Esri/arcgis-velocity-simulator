ARG NODE_IMAGE=node:24.19.0-bookworm-slim@sha256:be8929e08ae137e81b5e1edba02259e6c4cb2f5ad655092bb9f56b97e41c4536
ARG RUST_IMAGE=rust:1.100.0-slim-bookworm@sha256:a05e7b80377ed6099c177cad2b9f536e182b9574490c7b4c07acaa29a44fda57
FROM ${NODE_IMAGE} AS node
FROM ${RUST_IMAGE}

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/ /usr/local/lib/node_modules/
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
       ca-certificates curl file git build-essential pkg-config \
       libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev librsvg2-dev patchelf \
       libayatana-appindicator3-dev libxdo-dev libfuse2 \
       dpkg fakeroot binutils squashfs-tools desktop-file-utils \
       unzip zip xz-utils zstd \
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
