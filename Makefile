.PHONY: all build clean frontend aio

all: aio

gen:
	go generate

frontend:
	cd view && npm i
	cd view && npm run gen-proto
	cd view && npm run build

aio: gen
	go build -ldflags="-X 'github.com/projectqai/hydra/version.Version=$$(git describe --always --dirty --tags)'" -o hydra .

ext: gen
	go build -ldflags="-X 'github.com/projectqai/hydra/version.Version=$$(git describe --always --dirty --tags)'" -o hydra -tags ext .

build: all

clean:
	rm -rf view/dist
	rm -f hydra
