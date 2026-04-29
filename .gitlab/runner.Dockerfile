FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PROTOC_VERSION=28.3
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_NDK_HOME=/opt/android-sdk/ndk/26.1.10909125
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

RUN sed -i 's|http://archive.ubuntu.com|http://mirror.ubuntu.ikoula.com|g; s|http://security.ubuntu.com|http://mirror.ubuntu.ikoula.com|g' /etc/apt/sources.list

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    git \
    libgtk-3-dev \
    libssl-dev \
    libwebkit2gtk-4.1-dev \
    make \
    mingw-w64 \
    openjdk-17-jdk-headless \
    pkg-config \
    rsync \
    sudo \
    unzip \
    wget \
    xz-utils \
    zip \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Go
ARG GO_VERSION=1.26.2
RUN wget -q https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz \
    && tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz \
    && rm go${GO_VERSION}.linux-amd64.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"

# Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/root/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

# protoc
RUN wget -q https://github.com/protocolbuffers/protobuf/releases/download/v${PROTOC_VERSION}/protoc-${PROTOC_VERSION}-linux-x86_64.zip \
    && unzip -q protoc-${PROTOC_VERSION}-linux-x86_64.zip -d /usr/local \
    && chmod +x /usr/local/bin/protoc \
    && rm protoc-${PROTOC_VERSION}-linux-x86_64.zip

# Android SDK + NDK
RUN mkdir -p ${ANDROID_SDK_ROOT}/cmdline-tools \
    && wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/cmdline-tools.zip \
    && unzip -q /tmp/cmdline-tools.zip -d ${ANDROID_SDK_ROOT}/cmdline-tools \
    && mv ${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools ${ANDROID_SDK_ROOT}/cmdline-tools/latest \
    && rm /tmp/cmdline-tools.zip
ENV PATH="${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${PATH}"
RUN yes | sdkmanager --licenses || true \
    && sdkmanager "platforms;android-34" "build-tools;34.0.0" "ndk;26.1.10909125"

# Rust + rcodesign
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN cargo install apple-codesign

