.PHONY: all build clean frontend aio android all pre-release release install-tools

VERSION ?= $(shell git describe --always --dirty --tags)

default: aio

install-tools:
	go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
	go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
	go install connectrpc.com/connect/cmd/protoc-gen-connect-go@latest
	go install github.com/pseudomuto/protoc-gen-doc/cmd/protoc-gen-doc@latest
	go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest

gen:
	go generate

frontend:
	cd view/frontend && bun i
	cd view/frontend && bun run build:web -c

aio: gen frontend
	go build -ldflags="-X 'github.com/projectqai/hydris/version.Version=$$(git describe --always --dirty --tags)'" -o hydris .

ext: gen
	go build -ldflags="-X 'github.com/projectqai/hydris/version.Version=$$(git describe --always --dirty --tags)'" -o hydris -tags ext .

all: gen frontend linux_ windows_ darwin_

linux_:
	CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -ldflags="-X 'github.com/projectqai/hydris/version.Version=$(VERSION)'" -o hydris-linux-amd64-$(VERSION) .
	CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 go build -ldflags="-X 'github.com/projectqai/hydris/version.Version=$(VERSION)'" -o hydris-linux-arm64-$(VERSION) .
windows_:
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-X 'github.com/projectqai/hydris/version.Version=$(VERSION)'" -o hydris-windows-amd64-$(VERSION).exe .
darwin_:
	CGO_ENABLED=0 GOOS=darwin  GOARCH=amd64 go build -ldflags="-X 'github.com/projectqai/hydris/version.Version=$(VERSION)'" -o hydris-darwin-amd64-$(VERSION) .
	CGO_ENABLED=0 GOOS=darwin  GOARCH=arm64 go build -ldflags="-X 'github.com/projectqai/hydris/version.Version=$(VERSION)'" -o hydris-darwin-arm64-$(VERSION) .

android: gen frontend android_
	cp android/hydris.aar view/frontend/packages/hydris-engine/android/libs/hydris.aar
	cd view/frontend && bun i
	cd view/frontend && bun run build:android
	@echo adb install -r view/frontend/apps/foss/android/app/build/outputs/apk/release/app-release.apk 
android_:
	cd android && go mod tidy && go install golang.org/x/mobile/cmd/gomobile && gomobile init && gomobile bind -target=android/arm64 -androidapi 24 -o hydris.aar

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

clean:
	rm -rf view/dist
	rm -f hydris

lint: vet

vet:
	go fmt ./...
	go vet ./...
	go test  ./...
	golangci-lint run ./...
	govulncheck ./...
