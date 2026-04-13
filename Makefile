.PHONY: all build clean frontend aio android desktop desktop-dev all pre-release release install-tools docker desktop_windows setup

VERSION ?= $(shell git describe --always --dirty --tags)
LDFLAGS  = -X 'github.com/projectqai/hydris/pkg/version.Version=$(VERSION)'

default: all

setup:
	go tool lefthook install
	cd view && bun i

install-tools:
	go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
	go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
	go install connectrpc.com/connect/cmd/protoc-gen-connect-go@latest
	go install github.com/pseudomuto/protoc-gen-doc/cmd/protoc-gen-doc@latest
	go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest

frontend:
	cd view && bun i
	cd view && bun run build:web -c

all:
	make frontend
	make cli
	make desktop
	make android
	make docker

cli: cli_linux cli_windows cli_mac

cli_linux:
	CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -ldflags="$(LDFLAGS)" -o bin/hydris-cli-linux-amd64-$(VERSION) .
	tar -cJf bin/hydris-cli-linux-amd64-$(VERSION).tar.xz -C bin hydris-cli-linux-amd64-$(VERSION)
	rm bin/hydris-cli-linux-amd64-$(VERSION)
	CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 go build -ldflags="$(LDFLAGS)" -o bin/hydris-cli-linux-arm64-$(VERSION) .
	tar -cJf bin/hydris-cli-linux-arm64-$(VERSION).tar.xz -C bin hydris-cli-linux-arm64-$(VERSION)
	rm bin/hydris-cli-linux-arm64-$(VERSION)

cli_windows:
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="$(LDFLAGS)" -o bin/hydris-cli-windows-amd64-$(VERSION).exe .
	cd bin && zip hydris-cli-windows-amd64-$(VERSION).zip hydris-cli-windows-amd64-$(VERSION).exe && rm hydris-cli-windows-amd64-$(VERSION).exe

cli_mac:
	CGO_ENABLED=0 GOOS=darwin  GOARCH=arm64 go build -ldflags="$(LDFLAGS)" -o bin/hydris-cli-macos-arm64-$(VERSION) .
	tar -cJf bin/hydris-cli-macos-arm64-$(VERSION).tar.xz -C bin hydris-cli-macos-arm64-$(VERSION)
	rm bin/hydris-cli-macos-arm64-$(VERSION)

desktop: desktop_windows desktop_mac

desktop_native:
	cd desktop && go build -ldflags="$(LDFLAGS)" -o ../bin/hydris-desktop-$$(go env GOOS)-$$(go env GOARCH)-$(VERSION) .

# Compile the native macOS HAL dylib (run once on a Mac).
# Provides BLE (CoreBluetooth), serial (IOKit/POSIX) access.
hal_dylib:
	clang -dynamiclib -framework Foundation -framework IOKit -framework CoreBluetooth \
		-arch arm64 -O2 -fobjc-arc \
		hal/macos/hal_serial.m hal/macos/hal_ble.m \
		-o hal/macos/libhydris_hal.dylib

# Compile the native macOS WKWebView helper (run once on a Mac).
# Produces a universal binary (arm64 + x86_64).
desktop_shim:
	clang -framework Cocoa -framework WebKit -arch arm64 -arch x86_64 \
		-O2 -o desktop/shim/hydris-webview-webkit desktop/shim/main.m

# Compile the CEF-based macOS webview (run once on a Mac).
# Requires: cmake, clang++. Downloads CEF automatically.
desktop_shim_chrome:
	cd desktop/shim && ./fetch_cef.sh
	cd desktop/shim && $(MAKE) all

# macOS WKWebView build — lightweight, uses system WebKit.
desktop_mac:
	@test -f desktop/shim/hydris-webview-webkit || (echo "run 'make desktop_shim' on a Mac first" && false)
	cd desktop && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="$(LDFLAGS)" -o ../bin/hydris-desktop-macos-arm64-$(VERSION) .
	$(call make_app_bundle_base,bin/hydris-desktop-macos-arm64-$(VERSION),bin/Hydris.app)
	cp desktop/shim/hydris-webview-webkit bin/Hydris.app/Contents/MacOS/hydris-webview
	@test -f hal/macos/libhydris_hal.dylib && cp hal/macos/libhydris_hal.dylib bin/Hydris.app/Contents/MacOS/libhydris_hal.dylib || echo "warning: HAL dylib not built, run 'make hal_dylib' on a Mac"
	$(call codesign_app,bin/Hydris.app)
	cd bin && rm -f hydris-desktop-macos-arm64-$(VERSION).zip && zip -r hydris-desktop-macos-arm64-$(VERSION).zip Hydris.app
	rm -rf bin/Hydris.app bin/hydris-desktop-macos-arm64-$(VERSION)

# macOS CEF/Chromium build — full Chromium browser engine.
desktop_mac_chrome:
	@test -f desktop/shim/hydris-webview || (echo "run 'make desktop_shim_chrome' on a Mac first" && false)
	@test -f desktop/shim/hydris-webview-helper || (echo "run 'make desktop_shim_chrome' on a Mac first" && false)
	cd desktop/shim && ./fetch_cef.sh arm64
	cd desktop && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="$(LDFLAGS)" -o ../bin/hydris-desktop-macos-chrome-arm64-$(VERSION) .
	$(call make_app_bundle_base,bin/hydris-desktop-macos-chrome-arm64-$(VERSION),bin/Hydris-Chrome.app)
	cp desktop/shim/hydris-webview bin/Hydris-Chrome.app/Contents/MacOS/hydris-webview
	cp -R desktop/shim/cef/Release/Chromium\ Embedded\ Framework.framework bin/Hydris-Chrome.app/Contents/Frameworks/
	mkdir -p "bin/Hydris-Chrome.app/Contents/Frameworks/hydris-webview Helper.app/Contents/MacOS"
	cp desktop/shim/hydris-webview-helper \
		"bin/Hydris-Chrome.app/Contents/Frameworks/hydris-webview Helper.app/Contents/MacOS/hydris-webview Helper"
	cp desktop/shim/HelperInfo.plist "bin/Hydris-Chrome.app/Contents/Frameworks/hydris-webview Helper.app/Contents/Info.plist"
	$(call codesign_app,bin/Hydris-Chrome.app)
	cd bin && rm -f hydris-desktop-macos-chrome-arm64-$(VERSION).zip && zip -r hydris-desktop-macos-chrome-arm64-$(VERSION).zip Hydris-Chrome.app
	rm -rf bin/Hydris-Chrome.app bin/hydris-desktop-macos-chrome-arm64-$(VERSION)

# Shared app bundle base — Go binary, ffmpeg, icon, Info.plist. No webview shim.
define make_app_bundle_base
	rm -rf $(2)
	mkdir -p $(2)/Contents/MacOS $(2)/Contents/Resources $(2)/Contents/Frameworks
	cp $(1) $(2)/Contents/MacOS/hydris
	unzip -o -j desktop/shim/ffmpeg-macos-arm64.zip ffmpeg -d $(2)/Contents/MacOS/
	chmod +x $(2)/Contents/MacOS/ffmpeg
	cp assets/icons/hydris.icns $(2)/Contents/Resources/hydris.icns
	sed 's/VERSION/$(VERSION)/g' desktop/Info.plist > $(2)/Contents/Info.plist
endef

define codesign_app
	@if which codesign >/dev/null 2>&1; then \
		codesign --force --deep --sign - $(1); \
	elif which rcodesign >/dev/null 2>&1; then \
		rcodesign sign $(1); \
	else \
		echo "warning: no codesign or rcodesign found, skipping signing"; \
	fi
endef

desktop_windows:
	x86_64-w64-mingw32-windres desktop/hydris.rc -O coff -o desktop/hydris_windows.syso
	cd desktop && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="$(LDFLAGS) -H windowsgui" -o ../bin/hydris-desktop-windows-amd64-$(VERSION).exe .
	cd bin && zip hydris-desktop-windows-amd64-$(VERSION).zip hydris-desktop-windows-amd64-$(VERSION).exe && rm hydris-desktop-windows-amd64-$(VERSION).exe

android: android_aar
	cp android/aar/build/outputs/aar/aar-release.aar view/packages/hydris-engine/android/libs/hydris.aar
	cd view/packages/hydris-engine/android/libs && unzip -o hydris.aar classes.jar 'jni/*' -d . && unzip -o hydris.aar libs/classes.jar -d . && mv libs/classes.jar go-classes.jar && rmdir libs 2>/dev/null || true
	cp hal/android/build/intermediates/compile_library_classes_jar/release/bundleLibCompileToJarRelease/classes.jar view/packages/hydris-engine/android/libs/hal-classes.jar
	cd view && bun i
	cd view && bun run build:android
	@echo adb install -r view/apps/foss/android/app/build/outputs/apk/release/app-release.apk

android_go:
	cd android && go mod tidy && go install golang.org/x/mobile/cmd/gomobile && gomobile init && gomobile bind -target=android/arm64 -androidapi 24 -ldflags "-checklinkname=0 $(LDFLAGS)" -o hydris-go.aar

android_aar: android_go
	cp android/hydris-go.aar android/aar/libs/hydris-go.aar
	cd android && ./gradlew :aar:assembleRelease

android_test: android_aar
	cd android && ./gradlew :testapp:assembleDebug
	adb install -r android/testapp/build/outputs/apk/debug/testapp-debug.apk

DOCKER_IMAGE ?= ghcr.io/projectqai/hydris

docker:
	CGO_ENABLED=0 go build -ldflags="$(LDFLAGS)" -o bin/hydris .
	cp bin/hydris bin/hydris-$$(go env GOARCH)
	docker build -t $(DOCKER_IMAGE):$(VERSION) .
	rm -f bin/hydris-$$(go env GOARCH)

pre-release: vet
	@[ -z "$$(git status --porcelain)" ]                                || (echo "FAIL: working tree is dirty" && false)
	@echo "$(VERSION)" | grep -qv dirty                                 || (echo "FAIL: version is dirty" && false)
	@echo "$(VERSION)" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+'           || (echo "FAIL: tag doesn't look like vX.Y.Z" && false)

release: pre-release
	sed 's|ORIGIN_URL|file://$(CURDIR)|' scripts/copy.bara.sky > /tmp/copy.bara.sky
	copybara migrate /tmp/copy.bara.sky default --force --init-history --git-destination-non-fast-forward
	git fetch github
	git -c user.name="Project Q" -c user.email="opensource@project-q.ai" tag -f $(VERSION) github/main
	git push -f github $(VERSION)

deeptest:
	mkdir -p view/apps/foss/build
	touch view/apps/foss/build/.gitkeep
	go run ./cmd/deeptest

clean:
	rm -rf bin/
	rm -rf view/dist

lint: vet

vet:
	mkdir -p view/apps/foss/build
	touch view/apps/foss/build/.gitkeep
	go fmt ./...
	go vet ./...
	go test  ./...
	golangci-lint run ./...
	govulncheck ./...
	cd desktop && go mod tidy && [ -z "$$(git diff --name-only go.mod go.sum)" ] || (echo "FAIL: desktop/go.mod or desktop/go.sum is out of date; run 'cd desktop && go mod tidy'" && false)
	cd android && go mod tidy && [ -z "$$(git diff --name-only go.mod go.sum)" ] || (echo "FAIL: android/go.mod or android/go.sum is out of date; run 'cd android && go mod tidy'" && false)
