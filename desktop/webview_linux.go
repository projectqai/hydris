package main

/*
#cgo linux pkg-config: gtk+-3.0 webkit2gtk-4.1

#include <gtk/gtk.h>
#include <gdk/gdkkeysyms.h>
#include <webkit2/webkit2.h>

static GtkWidget *window;
static GtkWidget *webview;

static gboolean on_key_press(GtkWidget *widget, GdkEventKey *event, gpointer data) {
	if (event->keyval == GDK_KEY_F11) {
		GdkWindow *gdk_win = gtk_widget_get_window(window);
		GdkWindowState state = gdk_window_get_state(gdk_win);
		if (state & GDK_WINDOW_STATE_FULLSCREEN) {
			gtk_window_unfullscreen(GTK_WINDOW(window));
		} else {
			gtk_window_fullscreen(GTK_WINDOW(window));
		}
		return TRUE;
	}
	return FALSE;
}

static void webview_init(const char *title, int width, int height, int debug) {
	gtk_init(NULL, NULL);

	window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
	gtk_window_set_title(GTK_WINDOW(window), title);
	gtk_window_set_default_size(GTK_WINDOW(window), width, height);
	g_signal_connect(window, "destroy", G_CALLBACK(gtk_main_quit), NULL);
	g_signal_connect(window, "key-press-event", G_CALLBACK(on_key_press), NULL);

	gtk_window_set_icon_name(GTK_WINDOW(window), "hydris");

	webview = webkit_web_view_new();

	WebKitSettings *settings = webkit_web_view_get_settings(WEBKIT_WEB_VIEW(webview));
	webkit_settings_set_hardware_acceleration_policy(settings, WEBKIT_HARDWARE_ACCELERATION_POLICY_ALWAYS);

	if (debug) {
		webkit_settings_set_enable_developer_extras(settings, TRUE);
	}

	gtk_container_add(GTK_CONTAINER(window), webview);
	gtk_widget_show_all(window);
}

static void webview_navigate(const char *url) {
	webkit_web_view_load_uri(WEBKIT_WEB_VIEW(webview), url);
}

static void webview_eval(const char *js) {
	webkit_web_view_run_javascript(WEBKIT_WEB_VIEW(webview), js, NULL, NULL, NULL);
}

static void webview_run() {
	gtk_main();
}

static void webview_destroy() {
	gtk_widget_destroy(window);
}
*/
import "C"
import (
	"runtime"
	"unsafe"
)

func init() {
	runtime.LockOSThread()
}

type Webview struct{}

func NewWebview(title string, width, height int, debug bool) *Webview {
	cTitle := C.CString(title)
	defer C.free(unsafe.Pointer(cTitle))

	d := C.int(0)
	if debug {
		d = 1
	}
	C.webview_init(cTitle, C.int(width), C.int(height), d)
	return &Webview{}
}

func (w *Webview) Navigate(url string) {
	cURL := C.CString(url)
	defer C.free(unsafe.Pointer(cURL))
	C.webview_navigate(cURL)
}

func (w *Webview) Run() {
	C.webview_run()
}

func (w *Webview) Shutdown() {}

func (w *Webview) Destroy() {
	C.webview_destroy()
}
