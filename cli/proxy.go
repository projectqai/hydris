package cli

import (
	"context"
	"embed"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"

	"github.com/fatih/color"
	"github.com/rs/cors"

	"github.com/projectqai/hydris/goclient"
	"github.com/projectqai/hydris/pkg/media"
	"github.com/projectqai/hydris/pkg/version"
	"github.com/projectqai/hydris/view"
)

// proxyHandler serves embedded UI static files locally and proxies
// everything else to the remote server. WHEP requests are intercepted
// and handled locally: the proxy connects to the remote's RTSP relay
// through the tunnel and bridges it to a local WebRTC peer connection.
type proxyHandler struct {
	staticFS   http.FileSystem
	fileServer http.Handler
	proxy      *httputil.ReverseProxy
	bridges    *media.BridgeManager
	remoteAddr string
}

func (h *proxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/media/whep/") {
		h.handleWHEP(w, r)
		return
	}

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.proxy.ServeHTTP(w, r)
		return
	}

	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}
	if f, err := h.staticFS.Open(path); err == nil {
		_ = f.Close()
		h.fileServer.ServeHTTP(w, r)
		return
	}

	// No matching static file. Browser navigation gets the SPA shell;
	// everything else (GET API endpoints like /artifacts/) is proxied.
	if strings.Contains(r.Header.Get("Accept"), "text/html") {
		r2 := r.Clone(r.Context())
		r2.URL = &url.URL{Path: "/", RawQuery: r.URL.RawQuery}
		h.fileServer.ServeHTTP(w, r2)
		return
	}

	h.proxy.ServeHTTP(w, r)
}

func (h *proxyHandler) handleWHEP(w http.ResponseWriter, r *http.Request) {
	entityID := strings.TrimPrefix(r.URL.Path, "/media/whep/")
	if entityID == "" {
		http.Error(w, "missing entity ID", http.StatusBadRequest)
		return
	}

	streamParam := r.URL.Query().Get("stream")
	if streamParam == "" {
		streamParam = "0"
	}

	offerSDP, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "failed to read offer", http.StatusBadRequest)
		return
	}

	rtspURL := fmt.Sprintf("rtsp://%s/media/rtsp/%s?stream=%s", h.remoteAddr, entityID, streamParam)
	bridgeKey := entityID + "/" + streamParam

	bridge, err := h.bridges.GetOrCreate(bridgeKey, rtspURL)
	if err != nil {
		slog.Error("proxy whep: failed to create bridge", "entity", entityID, "url", rtspURL, "error", err)
		http.Error(w, "failed to connect to camera", http.StatusBadGateway)
		return
	}

	answerSDP, err := bridge.AddPeer(string(offerSDP))
	if err != nil {
		slog.Error("proxy whep: failed to add peer", "key", bridgeKey, "error", err)
		http.Error(w, "WebRTC negotiation failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/sdp")
	w.Header().Set("Location", r.URL.String())
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(answerSDP))
}

func newProxyHandler(distFS embed.FS, proxy *httputil.ReverseProxy, bridges *media.BridgeManager, remoteAddr string) (*proxyHandler, error) {
	sub, err := fs.Sub(distFS, "apps/foss/build")
	if err != nil {
		return nil, err
	}
	fsys := http.FS(sub)
	return &proxyHandler{
		staticFS:   fsys,
		fileServer: http.FileServer(fsys),
		proxy:      proxy,
		bridges:    bridges,
		remoteAddr: remoteAddr,
	}, nil
}

func StartProxyServer(server, wgConfigPath string) (listenAddr string, err error) {
	tunnel, remoteAddr, tunnelLabel, err := goclient.ParseServer(server, wgConfigPath)
	if err != nil {
		return "", err
	}
	targetURL := &url.URL{Scheme: "http", Host: remoteAddr}
	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	var dialContext func(ctx context.Context, network, addr string) (net.Conn, error)
	if tunnel != nil {
		dialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			return tunnel.Dial(ctx, addr)
		}
	}

	transport := &http.Transport{}
	if dialContext != nil {
		transport.DialContext = dialContext
	}
	proxy.Transport = transport

	bridges := media.NewBridgeManager()
	bridges.DialContext = dialContext

	handler, err := newProxyHandler(view.Dist, proxy, bridges, remoteAddr)
	if err != nil {
		return "", fmt.Errorf("failed to create proxy handler: %w", err)
	}

	corsHandler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	listener, err := net.Listen("tcp", ":"+port)
	if err != nil {
		return "", fmt.Errorf("failed to listen on port %s: %v", port, err)
	}

	listenAddr = "localhost:" + port

	green := color.New(color.FgGreen)
	cyan := color.New(color.FgCyan)
	bold := color.New(color.Bold)

	fmt.Println()
	_, _ = green.Print("  ➜ ")
	_, _ = bold.Print("Hydris Proxy ")
	fmt.Printf("(%s)", version.Version)
	fmt.Println(" forwarding to:")
	_, _ = green.Print("  ➜ ")
	fmt.Print("Remote:  ")
	_, _ = cyan.Println(remoteAddr)
	if tunnelLabel != "" {
		_, _ = green.Print("  ➜ ")
		fmt.Print("Tunnel:  ")
		_, _ = cyan.Println(tunnelLabel)
	}
	_, _ = green.Print("  ➜ ")
	fmt.Print("Local:   ")
	_, _ = cyan.Printf("http://%s\n", listenAddr)
	fmt.Println()

	var protos http.Protocols
	protos.SetHTTP1(true)
	protos.SetUnencryptedHTTP2(true)
	httpServer := &http.Server{
		Handler:   corsHandler.Handler(handler),
		Protocols: &protos,
	}
	go func() { _ = httpServer.Serve(listener) }()

	return listenAddr, nil
}
