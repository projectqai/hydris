package main

import (
	"runtime"
	"syscall"
	"unsafe"

	"github.com/wailsapp/go-webview2/pkg/edge"
)

func init() {
	runtime.LockOSThread()
}

const (
	_WS_OVERLAPPEDWINDOW = 0x00CF0000
	_CW_USEDEFAULT       = 0x80000000
	_SW_SHOW             = 5
	_WM_DESTROY          = 0x0002
	_WM_SIZE             = 0x0005
	_WM_CLOSE            = 0x0010
	_WM_MOVE             = 0x0003
	_WM_KEYDOWN          = 0x0100
	_VK_F11              = 0x7A
	_GWL_STYLE           = 0xFFFFFFF0 // -16 as uint32
	_WS_POPUP            = 0x80000000
	_WS_VISIBLE          = 0x10000000
	_SWP_FRAMECHANGED    = 0x0020
	_MONITOR_DEFAULTTONEAREST = 0x00000002
)

type _WNDCLASSEXW struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

type _MSG struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      [2]int32
}

type _RECT struct {
	Left, Top, Right, Bottom int32
}

type _MONITORINFO struct {
	CbSize    uint32
	RcMonitor _RECT
	RcWork    _RECT
	DwFlags   uint32
}

type _WINDOWPLACEMENT struct {
	Length           uint32
	Flags            uint32
	ShowCmd          uint32
	PtMinPosition    [2]int32
	PtMaxPosition    [2]int32
	RcNormalPosition _RECT
}

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	ole32    = syscall.NewLazyDLL("ole32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	pRegisterClassExW = user32.NewProc("RegisterClassExW")
	pCreateWindowExW  = user32.NewProc("CreateWindowExW")
	pDestroyWindow    = user32.NewProc("DestroyWindow")
	pShowWindow       = user32.NewProc("ShowWindow")
	pGetMessageW      = user32.NewProc("GetMessageW")
	pTranslateMessage = user32.NewProc("TranslateMessage")
	pDispatchMessageW = user32.NewProc("DispatchMessageW")
	pPostQuitMessage  = user32.NewProc("PostQuitMessage")
	pDefWindowProcW   = user32.NewProc("DefWindowProcW")
	pGetModuleHandleW = kernel32.NewProc("GetModuleHandleW")
	pCoInitializeEx   = ole32.NewProc("CoInitializeEx")
	pLoadIconW          = user32.NewProc("LoadIconW")
	pSendMessageW       = user32.NewProc("SendMessageW")
	pGetWindowLongW     = user32.NewProc("GetWindowLongW")
	pSetWindowLongW     = user32.NewProc("SetWindowLongW")
	pSetWindowPos       = user32.NewProc("SetWindowPos")
	pGetWindowPlacement = user32.NewProc("GetWindowPlacement")
	pSetWindowPlacement = user32.NewProc("SetWindowPlacement")
	pMonitorFromWindow  = user32.NewProc("MonitorFromWindow")
	pGetMonitorInfoW    = user32.NewProc("GetMonitorInfoW")
)

var _webviewInstance *Webview

type Webview struct {
	hwnd       uintptr
	chromium   *edge.Chromium
	debug      bool
	fullscreen bool
	prevStyle  uintptr
	prevPlace  _WINDOWPLACEMENT
}

func toggleFullscreenWindows(w *Webview) {
	if w.fullscreen {
		// Restore windowed mode
		pSetWindowLongW.Call(w.hwnd, uintptr(_GWL_STYLE), w.prevStyle)
		pSetWindowPlacement.Call(w.hwnd, uintptr(unsafe.Pointer(&w.prevPlace)))
		pSetWindowPos.Call(w.hwnd, 0, 0, 0, 0, 0,
			0x0001|0x0002|0x0004|0x0010|_SWP_FRAMECHANGED) // NOMOVE|NOSIZE|NOZORDER|NOACTIVATE|FRAMECHANGED
		w.fullscreen = false
	} else {
		// Save current state
		w.prevStyle, _, _ = pGetWindowLongW.Call(w.hwnd, uintptr(_GWL_STYLE))
		w.prevPlace.Length = uint32(unsafe.Sizeof(w.prevPlace))
		pGetWindowPlacement.Call(w.hwnd, uintptr(unsafe.Pointer(&w.prevPlace)))

		// Get monitor dimensions
		mon, _, _ := pMonitorFromWindow.Call(w.hwnd, _MONITOR_DEFAULTTONEAREST)
		var mi _MONITORINFO
		mi.CbSize = uint32(unsafe.Sizeof(mi))
		pGetMonitorInfoW.Call(mon, uintptr(unsafe.Pointer(&mi)))

		// Set borderless fullscreen
		pSetWindowLongW.Call(w.hwnd, uintptr(_GWL_STYLE), _WS_POPUP|_WS_VISIBLE)
		pSetWindowPos.Call(w.hwnd, 0,
			uintptr(mi.RcMonitor.Left), uintptr(mi.RcMonitor.Top),
			uintptr(mi.RcMonitor.Right-mi.RcMonitor.Left),
			uintptr(mi.RcMonitor.Bottom-mi.RcMonitor.Top),
			_SWP_FRAMECHANGED)
		w.fullscreen = true
	}
}

var _wndProcCB = syscall.NewCallback(func(hwnd uintptr, msg uint32, wp, lp uintptr) uintptr {
	switch msg {
	case _WM_SIZE:
		if w := _webviewInstance; w != nil && w.chromium != nil {
			w.chromium.Resize()
		}
	case _WM_MOVE:
		if w := _webviewInstance; w != nil && w.chromium != nil {
			w.chromium.NotifyParentWindowPositionChanged()
		}
	case _WM_KEYDOWN:
		if wp == _VK_F11 {
			if w := _webviewInstance; w != nil {
				toggleFullscreenWindows(w)
			}
			return 0
		}
	case _WM_CLOSE:
		pDestroyWindow.Call(hwnd)
	case _WM_DESTROY:
		pPostQuitMessage.Call(0)
	}
	ret, _, _ := pDefWindowProcW.Call(hwnd, uintptr(msg), wp, lp)
	return ret
})

func NewWebview(title string, width, height int, debug bool) *Webview {
	pCoInitializeEx.Call(0, 0x2) // COINIT_APARTMENTTHREADED

	hInst, _, _ := pGetModuleHandleW.Call(0)
	cls, _ := syscall.UTF16PtrFromString("HydrisWebView")

	// Load app icon from embedded resource (IDI_ICON1 = 1)
	hIcon, _, _ := pLoadIconW.Call(hInst, uintptr(1))

	wcex := _WNDCLASSEXW{
		cbSize:        uint32(unsafe.Sizeof(_WNDCLASSEXW{})),
		lpfnWndProc:   _wndProcCB,
		hInstance:     hInst,
		hIcon:         hIcon,
		hIconSm:       hIcon,
		lpszClassName: cls,
		hbrBackground: 1,
	}
	pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wcex)))

	titleW, _ := syscall.UTF16PtrFromString(title)
	hwnd, _, _ := pCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(cls)),
		uintptr(unsafe.Pointer(titleW)),
		_WS_OVERLAPPEDWINDOW,
		uintptr(_CW_USEDEFAULT), uintptr(_CW_USEDEFAULT),
		uintptr(width), uintptr(height),
		0, 0, hInst, 0,
	)

	chromium := edge.NewChromium()
	chromium.Debug = debug

	w := &Webview{hwnd: hwnd, chromium: chromium, debug: debug}
	_webviewInstance = w

	pShowWindow.Call(hwnd, _SW_SHOW)

	chromium.Embed(hwnd)
	chromium.Resize()

	return w
}

func (w *Webview) Navigate(url string) {
	w.chromium.Navigate(url)
}

func (w *Webview) Run() {
	var msg _MSG
	for {
		ret, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if ret == 0 || int32(ret) == -1 {
			break
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		pDispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
	}
}

func (w *Webview) Shutdown() {}

func (w *Webview) Destroy() {
	pDestroyWindow.Call(w.hwnd)
}
