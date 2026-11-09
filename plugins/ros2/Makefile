NAME     := ros2
VERSION  := $(shell jq -r .version package.json)
REF      := ghcr.io/projectqai/hydris/plugins/$(NAME):$(VERSION)
ARCHS    := amd64 arm64
# The in-tree CLI, so packing native binaries works without installing hydris.
HYDRIS   ?= go run -tags noui ../..

# install: a running hydris, and the plugin entity to install as.
SERVER    ?= http://localhost:50051
PLUGIN    ?= $(NAME).plugin
# The image tarball `hydris plugin build` writes for REF.
TARBALL   := $(subst :,_,$(subst /,_,$(REF))).tar

# Cyclone DDS is built from source with zig as the C cross compiler and
# linked statically, so the plugin is one static binary per arch.
CYCLONE_VERSION := 0.10.5
CYCLONE_SRC     := build/cyclonedds-$(CYCLONE_VERSION)
zigtarget        = $(if $(filter arm64,$(1)),aarch64,x86_64)-linux-musl

.PHONY: bin build push install test clean

# The libraries are listed so make keeps them rather than deleting them as
# intermediates.
bin: $(foreach a,$(ARCHS),build/cyclonedds-$(a)/lib/libddsc.a bin/$(NAME)-linux-$(a))

$(CYCLONE_SRC):
	mkdir -p build
	curl -fsSL https://github.com/eclipse-cyclonedds/cyclonedds/archive/refs/tags/$(CYCLONE_VERSION).tar.gz | tar xz -C build

build/zig-%:
	mkdir -p build
	printf '#!/bin/sh\nexec zig %s "$$@"\n' $* > $@
	chmod +x $@

build/cyclonedds-%/lib/libddsc.a: | $(CYCLONE_SRC) build/zig-ar build/zig-ranlib
	cmake -S $(CYCLONE_SRC) -B build/cmake-$* -G Ninja \
		-DCMAKE_SYSTEM_NAME=Linux \
		-DCMAKE_C_COMPILER=zig -DCMAKE_C_COMPILER_ARG1=cc -DCMAKE_C_FLAGS="-target $(call zigtarget,$*)" \
		-DCMAKE_AR=$(CURDIR)/build/zig-ar -DCMAKE_RANLIB=$(CURDIR)/build/zig-ranlib \
		-DCMAKE_INSTALL_PREFIX=$(CURDIR)/build/cyclonedds-$* -DCMAKE_BUILD_TYPE=Release \
		-DBUILD_SHARED_LIBS=OFF -DENABLE_SSL=OFF -DENABLE_SECURITY=OFF -DENABLE_SHM=OFF -DENABLE_LTO=OFF \
		-DBUILD_IDLC=OFF -DBUILD_DDSPERF=OFF -DBUILD_EXAMPLES=OFF -DBUILD_TESTING=OFF
	cmake --build build/cmake-$* --target install

bin/$(NAME)-linux-%: build/cyclonedds-%/lib/libddsc.a FORCE
	CGO_ENABLED=1 GOOS=linux GOARCH=$* CC="zig cc -target $(call zigtarget,$*)" \
	CGO_CFLAGS="-I$(CURDIR)/build/cyclonedds-$*/include" CGO_LDFLAGS="-L$(CURDIR)/build/cyclonedds-$*/lib" \
		go build -tags cyclonedds -trimpath -ldflags="-s -w -linkmode external -extldflags -static" -o $@ .

FORCE:

build: bin
	$(HYDRIS) plugin build . -t $(REF)

push: build
	docker push $(REF)

# install uploads the image to SERVER as the artifact of the plugin entity and
# runs it from there (artifact://), no registry needed. Rerunning it replaces
# the image and restarts the plugin. Installing a plugin takes admin, which a
# local connection is by default.
install: build
	@push() { curl -fsS -X POST -H 'Content-Type: application/json' -d "$$1" \
		$(SERVER)/world.WorldService/Push >/dev/null || exit 1; }; \
	plugin() { push '{"changes":[{"id":"$(PLUGIN)","device":{"parent":"plugins.custom","class":"plugin"},"artifact":{"id":"$(PLUGIN)"},"config":{"value":{"ref":"artifact://$(PLUGIN)","enabled":'$$1'}}}]}'; }; \
	plugin false && \
	curl -fsS -X POST --data-binary @$(TARBALL) $(SERVER)/artifacts/$(PLUGIN) && \
	plugin true && \
	echo "installed $(REF) as $(PLUGIN) on $(SERVER)"

# test runs the plugin end to end against throwaway hydris instances and a
# ROS 2 Jazzy container (see test/). It needs docker; the arm64 scenario
# needs qemu-aarch64. RUN=regexp picks scenarios.
test: bin
	go build -tags noui -o build/hydris ../..
	go run ./test -hydris build/hydris -plugin . $(if $(RUN),-run '$(RUN)')

clean:
	rm -rf bin build *.tar
