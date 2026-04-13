NAME    := airthings
VERSION := $(shell jq -r .version package.json)
REF     := ghcr.io/projectqai/hydris/plugins/$(NAME):$(VERSION)

.PHONY: build push

build:
	hydris plugin build . -t $(REF)

push: build
	docker push $(REF)
