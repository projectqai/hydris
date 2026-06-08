#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

// Minimal native macOS webview helper.
// Compiled once on a Mac, then the Go binary can be cross-compiled from any OS.
// Usage: hydris-webview [--debug] URL
//
// Fd 3 is a keepalive pipe from the parent process. When the parent exits
// (for any reason, including SIGKILL), the read returns EOF and we quit.

@interface AppDelegate : NSObject <NSApplicationDelegate>
@end

@implementation AppDelegate
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app {
	return YES;
}
@end

// WKWebView drops blob: URL downloads (and Content-Disposition responses)
// unless we route them through a WKDownloadDelegate ourselves.
API_AVAILABLE(macos(11.3))
@interface DownloadDelegate : NSObject <WKNavigationDelegate, WKDownloadDelegate, WKUIDelegate>
@end

@implementation DownloadDelegate

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
	if (navigationAction.shouldPerformDownload) {
		decisionHandler(WKNavigationActionPolicyDownload);
		return;
	}
	decisionHandler(WKNavigationActionPolicyAllow);
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationResponse:(WKNavigationResponse *)navigationResponse
                      decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler {
	if ([navigationResponse.response isKindOfClass:[NSHTTPURLResponse class]]) {
		NSString *cd = ((NSHTTPURLResponse *)navigationResponse.response).allHeaderFields[@"Content-Disposition"];
		if (cd && [cd.lowercaseString containsString:@"attachment"]) {
			decisionHandler(WKNavigationResponsePolicyDownload);
			return;
		}
	}
	decisionHandler(WKNavigationResponsePolicyAllow);
}

- (void)webView:(WKWebView *)webView
    navigationAction:(WKNavigationAction *)navigationAction
   didBecomeDownload:(WKDownload *)download {
	download.delegate = self;
}

- (void)webView:(WKWebView *)webView
    navigationResponse:(WKNavigationResponse *)navigationResponse
     didBecomeDownload:(WKDownload *)download {
	download.delegate = self;
}

- (void)download:(WKDownload *)download
    decideDestinationUsingResponse:(NSURLResponse *)response
                 suggestedFilename:(NSString *)suggestedFilename
                 completionHandler:(void (^)(NSURL *destination))completionHandler {
	NSURL *downloads = [[NSFileManager.defaultManager URLsForDirectory:NSDownloadsDirectory
	                                                         inDomains:NSUserDomainMask] firstObject];
	NSURL *dest = [downloads URLByAppendingPathComponent:suggestedFilename];
	NSString *base = dest.URLByDeletingPathExtension.lastPathComponent;
	NSString *ext = dest.pathExtension;
	NSUInteger i = 1;
	while ([NSFileManager.defaultManager fileExistsAtPath:dest.path]) {
		NSString *name = [NSString stringWithFormat:@"%@ (%lu)", base, (unsigned long)i++];
		if (ext.length > 0) name = [name stringByAppendingPathExtension:ext];
		dest = [downloads URLByAppendingPathComponent:name];
	}
	completionHandler(dest);
}

- (void)download:(WKDownload *)download didFailWithError:(NSError *)error resumeData:(NSData *)resumeData {
	NSLog(@"hydris-webview: download failed: %@", error.localizedDescription);
}

// WKWebView never shows a file picker for <input type="file"> on its own;
// the host must present the NSOpenPanel via this WKUIDelegate callback.
- (void)webView:(WKWebView *)webView
    runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
              initiatedByFrame:(WKFrameInfo *)frame
             completionHandler:(void (^)(NSArray<NSURL *> *URLs))completionHandler {
	NSOpenPanel *panel = [NSOpenPanel openPanel];
	panel.canChooseFiles = YES;
	panel.canChooseDirectories = NO;
	panel.allowsMultipleSelection = parameters.allowsMultipleSelection;
	[panel beginSheetModalForWindow:webView.window completionHandler:^(NSModalResponse result) {
		completionHandler(result == NSModalResponseOK ? panel.URLs : nil);
	}];
}

@end

static void monitor_parent(void) {
	dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
		char buf[1];
		// Blocks until EOF (parent closed the write end or died)
		read(3, buf, 1);
		dispatch_async(dispatch_get_main_queue(), ^{
			[NSApp terminate:nil];
		});
	});
}

int main(int argc, char *argv[]) {
	int debug = 0;
	const char *url = NULL;

	for (int i = 1; i < argc; i++) {
		if (strcmp(argv[i], "--debug") == 0) {
			debug = 1;
		} else {
			url = argv[i];
		}
	}
	if (!url) {
		fprintf(stderr, "usage: hydris-webview [--debug] URL\n");
		return 1;
	}

	@autoreleasepool {
		[NSApplication sharedApplication];
		[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];

		AppDelegate *delegate = [[AppDelegate alloc] init];
		[NSApp setDelegate:delegate];

		// Menu bar
		NSMenu *menubar = [[NSMenu alloc] init];

		// App menu
		NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
		[menubar addItem:appMenuItem];
		NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Hydris"];
		[appMenu addItemWithTitle:@"About Hydris"
				   action:@selector(orderFrontStandardAboutPanel:)
			    keyEquivalent:@""];
		[appMenu addItem:[NSMenuItem separatorItem]];
		[appMenu addItemWithTitle:@"Hide Hydris"
				   action:@selector(hide:)
			    keyEquivalent:@"h"];
		NSMenuItem *hideOthers = [appMenu addItemWithTitle:@"Hide Others"
				   action:@selector(hideOtherApplications:)
			    keyEquivalent:@"h"];
		[hideOthers setKeyEquivalentModifierMask:NSEventModifierFlagOption | NSEventModifierFlagCommand];
		[appMenu addItemWithTitle:@"Show All"
				   action:@selector(unhideAllApplications:)
			    keyEquivalent:@""];
		[appMenu addItem:[NSMenuItem separatorItem]];
		[appMenu addItemWithTitle:@"Quit Hydris"
				   action:@selector(terminate:)
			    keyEquivalent:@"q"];
		[appMenuItem setSubmenu:appMenu];

		// Edit menu (required for Cmd+C/V/X/A/Z in webview)
		NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
		[menubar addItem:editMenuItem];
		NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
		[editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
		[editMenu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"Z"];
		[editMenu addItem:[NSMenuItem separatorItem]];
		[editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
		[editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
		[editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
		[editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
		[editMenuItem setSubmenu:editMenu];

		// Window menu
		NSMenuItem *windowMenuItem = [[NSMenuItem alloc] init];
		[menubar addItem:windowMenuItem];
		NSMenu *windowMenu = [[NSMenu alloc] initWithTitle:@"Window"];
		[windowMenu addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
		[windowMenu addItemWithTitle:@"Close" action:@selector(performClose:) keyEquivalent:@"w"];
		[windowMenuItem setSubmenu:windowMenu];
		[NSApp setWindowsMenu:windowMenu];

		[NSApp setMainMenu:menubar];

		// Window
		NSRect frame = NSMakeRect(0, 0, 1280, 800);
		NSUInteger style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
			NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
		NSWindow *window = [[NSWindow alloc] initWithContentRect:frame
			styleMask:style
			backing:NSBackingStoreBuffered
			defer:NO];
		[window setTitle:@"Hydris"];
		[window setCollectionBehavior:NSWindowCollectionBehaviorFullScreenPrimary];
		[window setFrameAutosaveName:@"HydrisMainWindow"];
		if (!window.isVisible) [window center];

		// WebView
		WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
		config.websiteDataStore = [WKWebsiteDataStore defaultDataStore];
		WKPreferences *prefs = config.preferences;
		if (debug) {
			[prefs setValue:@YES forKey:@"developerExtrasEnabled"];
		}
		[prefs setValue:@YES forKey:@"javaScriptCanAccessClipboard"];
		[config setValue:@YES forKey:@"allowUniversalAccessFromFileURLs"];
		[config.preferences setValue:@YES forKey:@"allowFileAccessFromFileURLs"];

		WKWebView *webview = [[WKWebView alloc] initWithFrame:frame configuration:config];
		[webview setValue:@NO forKey:@"drawsBackground"];

		// WKWebView holds navigationDelegate and UIDelegate weakly, so retain via association.
		DownloadDelegate *dl = [[DownloadDelegate alloc] init];
		webview.navigationDelegate = dl;
		webview.UIDelegate = dl;
		objc_setAssociatedObject(webview, "hydris.dl", dl, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

		[window setContentView:webview];

		NSString *urlStr = [NSString stringWithUTF8String:url];
		[webview loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:urlStr]]];

		[window makeKeyAndOrderFront:nil];
		[NSApp activateIgnoringOtherApps:YES];

		// F11 to toggle fullscreen
		[NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
			if ([event keyCode] == 103) { // F11
				[window toggleFullScreen:nil];
				return nil;
			}
			return event;
		}];

		// Monitor parent process via keepalive pipe (fd 3)
		monitor_parent();

		[NSApp run];
	}
	return 0;
}
