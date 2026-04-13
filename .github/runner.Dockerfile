FROM ghcr.io/actions/actions-runner:latest

ENV PROTOC_VERSION=28.3
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_NDK_HOME=/opt/android-sdk/ndk/26.1.10909125
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64

RUN sudo apt-get update && sudo apt-get install -y --no-install-recommends \
    build-essential \
    libgtk-3-dev \
    libssl-dev \
    libwebkit2gtk-4.1-dev \
    mingw-w64 \
    openjdk-17-jdk-headless \
    rsync \
    unzip \
    wget \
    xz-utils \
    zip \
    ca-certificates \
    curl \
    docker.io \
    && sudo rm -rf /var/lib/apt/lists/*

# Node.js 22 (for npx — apt nodejs is too old, missing Array.toReversed)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - \
    && sudo apt-get install -y nodejs \
    && sudo rm -rf /var/lib/apt/lists/*

RUN sudo usermod -aG docker runner

# protoc
RUN wget -q https://github.com/protocolbuffers/protobuf/releases/download/v${PROTOC_VERSION}/protoc-${PROTOC_VERSION}-linux-x86_64.zip \
    && sudo unzip -q protoc-${PROTOC_VERSION}-linux-x86_64.zip -d /usr/local \
    && sudo chmod +x /usr/local/bin/protoc \
    && rm protoc-${PROTOC_VERSION}-linux-x86_64.zip

# Android SDK + NDK
RUN sudo mkdir -p ${ANDROID_SDK_ROOT}/cmdline-tools \
    && wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/cmdline-tools.zip \
    && sudo unzip -q /tmp/cmdline-tools.zip -d ${ANDROID_SDK_ROOT}/cmdline-tools \
    && sudo mv ${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools ${ANDROID_SDK_ROOT}/cmdline-tools/latest \
    && rm /tmp/cmdline-tools.zip \
    && sudo chown -R runner:runner ${ANDROID_SDK_ROOT}
ENV PATH="${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${PATH}"
RUN yes | sdkmanager --licenses || true \
    && sdkmanager "platforms;android-34" "build-tools;34.0.0" "ndk;26.1.10909125"

# Rust + rcodesign
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/home/runner/.cargo/bin:${PATH}"
RUN cargo install apple-codesign
