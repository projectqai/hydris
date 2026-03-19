// CEF-based macOS webview for Hydris.
// Usage: hydris-webview [--debug] URL
// Fd 3 is a keepalive pipe from the parent process.

#include "include/cef_app.h"
#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/cef_parser.h"
#include "include/wrapper/cef_helpers.h"
#include "include/wrapper/cef_library_loader.h"
#import <Cocoa/Cocoa.h>

#include <string>
#include <unistd.h>

static std::string g_url;
static bool g_debug = false;
static NSWindow* g_window = nil;

// ---------------------------------------------------------------------------
// Client — browser-level event handling
// ---------------------------------------------------------------------------
class HydrisClient : public CefClient,
                     public CefLifeSpanHandler,
                     public CefKeyboardHandler,
                     public CefLoadHandler {
public:
	CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
	CefRefPtr<CefKeyboardHandler> GetKeyboardHandler() override { return this; }
	CefRefPtr<CefLoadHandler>     GetLoadHandler() override { return this; }

	// LifeSpan
	void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
		CEF_REQUIRE_UI_THREAD();
		browser_ = browser;
	}

	bool DoClose(CefRefPtr<CefBrowser> browser) override {
		CEF_REQUIRE_UI_THREAD();
		return false;
	}

	void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
		CEF_REQUIRE_UI_THREAD();
		browser_ = nullptr;
		CefQuitMessageLoop();
	}

	// Keyboard — F11 fullscreen
	bool OnPreKeyEvent(CefRefPtr<CefBrowser> browser,
	                   const CefKeyEvent& event,
	                   CefEventHandle os_event,
	                   bool* is_keyboard_shortcut) override {
		if (event.type == KEYEVENT_RAWKEYDOWN && event.native_key_code == 103) {
			if (g_window) [g_window toggleFullScreen:nil];
			return true;
		}
		return false;
	}

	// Load — background color while loading
	void OnLoadError(CefRefPtr<CefBrowser> browser,
	                 CefRefPtr<CefFrame> frame,
	                 ErrorCode errorCode,
	                 const CefString& errorText,
	                 const CefString& failedUrl) override {
		CEF_REQUIRE_UI_THREAD();
		if (errorCode == ERR_ABORTED) return;
		std::string msg = "<html><body style='background:#1a1a2e;color:#eee;font-family:system-ui;"
		                  "display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>"
		                  "<div><h2>Failed to load</h2><p>" + failedUrl.ToString() +
		                  "</p><p>" + errorText.ToString() + "</p></div></body></html>";
		frame->LoadURL("data:text/html;charset=utf-8," + CefURIEncode(msg, false).ToString());
	}

private:
	CefRefPtr<CefBrowser> browser_;
	IMPLEMENT_REFCOUNTING(HydrisClient);
};

// ---------------------------------------------------------------------------
// App — process-level callbacks, creates browser on context init
// ---------------------------------------------------------------------------
class HydrisApp : public CefApp,
                  public CefBrowserProcessHandler {
public:
	CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override {
		return this;
	}

	void OnBeforeCommandLineProcessing(
	    const CefString& process_type,
	    CefRefPtr<CefCommandLine> command_line) override {
		// We're a webview shell, not a browser — disable features that
		// trigger Keychain access (cookie encryption, password manager).
		command_line->AppendSwitch("use-mock-keychain");
		command_line->AppendSwitch("disable-features=PasswordManager");
		command_line->AppendSwitch("disable-gpu-sandbox");
	}

	void OnContextInitialized() override {
		CEF_REQUIRE_UI_THREAD();

		// Native window
		NSRect frame = NSMakeRect(0, 0, 1280, 800);
		NSUInteger style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
		                   NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
		g_window = [[NSWindow alloc] initWithContentRect:frame
		                                       styleMask:style
		                                         backing:NSBackingStoreBuffered
		                                           defer:NO];
		[g_window setTitle:@"Hydris"];
		[g_window setCollectionBehavior:NSWindowCollectionBehaviorFullScreenPrimary];
		[g_window setFrameAutosaveName:@"HydrisMainWindow"];
		if (![g_window isVisible]) [g_window center];

		// Create browser parented to the window's content view
		CefWindowInfo window_info;
		NSView* content = [g_window contentView];
		window_info.SetAsChild((__bridge void*)content,
		                       CefRect(0, 0, (int)frame.size.width, (int)frame.size.height));

		CefBrowserSettings settings;

		CefBrowserHost::CreateBrowser(window_info,
		                              new HydrisClient(),
		                              g_url,
		                              settings,
		                              nullptr,
		                              nullptr);

		[g_window makeKeyAndOrderFront:nil];
		[NSApp activateIgnoringOtherApps:YES];
	}

	IMPLEMENT_REFCOUNTING(HydrisApp);
};

// ---------------------------------------------------------------------------
// Menu bar — same as WKWebView version
// ---------------------------------------------------------------------------
static void setup_menu(void) {
	NSMenu* menubar = [[NSMenu alloc] init];

	// App menu
	NSMenuItem* appMenuItem = [[NSMenuItem alloc] init];
	[menubar addItem:appMenuItem];
	NSMenu* appMenu = [[NSMenu alloc] initWithTitle:@"Hydris"];
	[appMenu addItemWithTitle:@"About Hydris"
	                   action:@selector(orderFrontStandardAboutPanel:)
	            keyEquivalent:@""];
	[appMenu addItem:[NSMenuItem separatorItem]];
	[appMenu addItemWithTitle:@"Hide Hydris" action:@selector(hide:) keyEquivalent:@"h"];
	NSMenuItem* hideOthers = [appMenu addItemWithTitle:@"Hide Others"
	                                            action:@selector(hideOtherApplications:)
	                                     keyEquivalent:@"h"];
	[hideOthers setKeyEquivalentModifierMask:NSEventModifierFlagOption | NSEventModifierFlagCommand];
	[appMenu addItemWithTitle:@"Show All" action:@selector(unhideAllApplications:) keyEquivalent:@""];
	[appMenu addItem:[NSMenuItem separatorItem]];
	[appMenu addItemWithTitle:@"Quit Hydris" action:@selector(terminate:) keyEquivalent:@"q"];
	[appMenuItem setSubmenu:appMenu];

	// Edit menu (Cmd+C/V/X/A/Z)
	NSMenuItem* editMenuItem = [[NSMenuItem alloc] init];
	[menubar addItem:editMenuItem];
	NSMenu* editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
	[editMenu addItemWithTitle:@"Undo"       action:@selector(undo:)      keyEquivalent:@"z"];
	[editMenu addItemWithTitle:@"Redo"       action:@selector(redo:)      keyEquivalent:@"Z"];
	[editMenu addItem:[NSMenuItem separatorItem]];
	[editMenu addItemWithTitle:@"Cut"        action:@selector(cut:)       keyEquivalent:@"x"];
	[editMenu addItemWithTitle:@"Copy"       action:@selector(copy:)      keyEquivalent:@"c"];
	[editMenu addItemWithTitle:@"Paste"      action:@selector(paste:)     keyEquivalent:@"v"];
	[editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
	[editMenuItem setSubmenu:editMenu];

	// Window menu
	NSMenuItem* windowMenuItem = [[NSMenuItem alloc] init];
	[menubar addItem:windowMenuItem];
	NSMenu* windowMenu = [[NSMenu alloc] initWithTitle:@"Window"];
	[windowMenu addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
	[windowMenu addItemWithTitle:@"Close"    action:@selector(performClose:)       keyEquivalent:@"w"];
	[windowMenuItem setSubmenu:windowMenu];
	[NSApp setWindowsMenu:windowMenu];

	[NSApp setMainMenu:menubar];
}

// ---------------------------------------------------------------------------
// Keepalive — exit when parent dies
// ---------------------------------------------------------------------------
static void monitor_parent(void) {
	dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
		char buf[1];
		read(3, buf, 1);
		dispatch_async(dispatch_get_main_queue(), ^{
			CefQuitMessageLoop();
		});
	});
}

// ---------------------------------------------------------------------------
// AppDelegate
// ---------------------------------------------------------------------------
@interface AppDelegate : NSObject <NSApplicationDelegate>
@end

@implementation AppDelegate
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication*)app {
	return YES;
}
@end

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
int main(int argc, char* argv[]) {
	// Load CEF framework at runtime.
	// Looks for ../Frameworks/Chromium Embedded Framework.framework
	// relative to the executable (standard app bundle layout).
	CefScopedLibraryLoader library_loader;
	if (!library_loader.LoadInMain()) {
		fprintf(stderr, "hydris-webview: failed to load CEF framework\n");
		return 1;
	}

	CefMainArgs main_args(argc, argv);

	// If CEF launched us as a subprocess (--type=renderer etc.), handle it.
	CefRefPtr<HydrisApp> app(new HydrisApp);
	int exit_code = CefExecuteProcess(main_args, app, nullptr);
	if (exit_code >= 0) return exit_code;

	// Parse our args
	for (int i = 1; i < argc; i++) {
		if (strcmp(argv[i], "--debug") == 0) {
			g_debug = true;
		} else if (argv[i][0] != '-') {
			g_url = argv[i];
		}
	}
	if (g_url.empty()) {
		fprintf(stderr, "usage: hydris-webview [--debug] URL\n");
		return 1;
	}

	@autoreleasepool {
		[NSApplication sharedApplication];
		[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];

		AppDelegate* delegate = [[AppDelegate alloc] init];
		[NSApp setDelegate:delegate];
		setup_menu();

		CefSettings settings;
		settings.no_sandbox = true;
		settings.command_line_args_disabled = false;
		if (g_debug) {
			settings.remote_debugging_port = 9222;
		}

		// Resolve paths relative to the executable (not CFBundleExecutable,
		// since that's "hydris", not "hydris-webview").
		NSString* exePath = [NSString stringWithUTF8String:argv[0]];
		if (![exePath isAbsolutePath]) {
			exePath = [[[NSFileManager defaultManager] currentDirectoryPath]
				stringByAppendingPathComponent:exePath];
		}
		exePath = [exePath stringByResolvingSymlinksInPath];
		NSString* macosDir = [exePath stringByDeletingLastPathComponent];
		NSString* contentsDir = [macosDir stringByDeletingLastPathComponent];

		// Framework path — CEF needs this since we're not the CFBundleExecutable.
		NSString* frameworkDir = [contentsDir stringByAppendingPathComponent:
			@"Frameworks/Chromium Embedded Framework.framework"];
		CefString(&settings.framework_dir_path).FromString([frameworkDir UTF8String]);

		// Main bundle path — so CEF finds the bundle structure correctly.
		NSString* bundlePath = [contentsDir stringByDeletingLastPathComponent];
		CefString(&settings.main_bundle_path).FromString([bundlePath UTF8String]);

		// Helper binary for renderer/GPU subprocesses.
		NSString* helperPath = [contentsDir stringByAppendingPathComponent:
			@"Frameworks/hydris-webview Helper.app/Contents/MacOS/hydris-webview Helper"];
		CefString(&settings.browser_subprocess_path).FromString([helperPath UTF8String]);

		// Cache directory (avoids process singleton warning).
		NSString* cacheDir = [NSString stringWithFormat:@"%@/Library/Caches/ai.project-q.hydris",
			NSHomeDirectory()];
		CefString(&settings.root_cache_path).FromString([cacheDir UTF8String]);

		CefInitialize(main_args, settings, app, nullptr);
		monitor_parent();
		CefRunMessageLoop();
		CefShutdown();
	}
	return 0;
}
