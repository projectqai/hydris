# Build the CEF-based macOS webview shim.
# Prerequisites: run ./fetch_cef.sh first to download the CEF binary distribution.

ARCH     ?= $(shell uname -m)
CEF_DIR   = cef
WRAPPER_A = $(CEF_DIR)/build/libcef_dll_wrapper/libcef_dll_wrapper.a

CXX      = clang++
CXXFLAGS = -std=c++17 -O2 -Wall -arch $(ARCH) \
           -I$(CEF_DIR) \
           -mmacosx-version-min=11.0

LDFLAGS  = -framework Cocoa \
           -arch $(ARCH) \
           -Wl,-rpath,@executable_path/../Frameworks \
           -mmacosx-version-min=11.0

.PHONY: all clean fetch

all: hydris-webview hydris-webview-helper

# Main browser process binary
hydris-webview: cef_main.mm $(WRAPPER_A)
	$(CXX) $(CXXFLAGS) -ObjC++ $< $(WRAPPER_A) $(LDFLAGS) -o $@

# Helper subprocess binary (renderer, GPU, etc.)
# The helper lives at: Contents/Frameworks/Helper.app/Contents/MacOS/binary
# CEF framework is at: Contents/Frameworks/Chromium Embedded Framework.framework
# So rpath needs: @executable_path/../../../..  (up to Contents/Frameworks/)
hydris-webview-helper: cef_helper.mm $(WRAPPER_A)
	$(CXX) $(CXXFLAGS) -ObjC++ $< $(WRAPPER_A) \
		-framework Cocoa -arch $(ARCH) -mmacosx-version-min=11.0 \
		-Wl,-rpath,@executable_path/../../../.. \
		-o $@

$(WRAPPER_A):
	@echo "CEF wrapper not found — run ./fetch_cef.sh first" && false

fetch:
	./fetch_cef.sh $(ARCH)

clean:
	rm -f hydris-webview hydris-webview-helper
