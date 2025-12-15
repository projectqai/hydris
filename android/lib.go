package hydra

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	_goconnect "github.com/projectqai/proto/go/_goconnect"

	"github.com/projectqai/hydra/engine"
	"github.com/projectqai/hydra/view"
	"github.com/rs/cors"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

// Port is the configurable port for the engine server
var Port int = 50051

// SetPort sets the port for the engine server. Must be called before StartEngine().
// Returns an error message if the engine is already running.
// Using string here instead of go error for easier interoperability with Android/TS.
func SetPort(p int) string {
	if globalService != nil {
		return "Error: cannot change port while engine is running"
	}
	Port = p
	return fmt.Sprintf("port set to %d", p)
}

type EngineService struct {
	server     *http.Server
	engine     *engine.WorldServer
	ctx        context.Context
	cancelFunc context.CancelFunc
	mu         sync.Mutex
}

var globalService *EngineService

func StartEngine() string {
	if globalService != nil {
		return "Error: engine already running"
	}

	ctx, cancel := context.WithCancel(context.Background())
	service := &EngineService{
		ctx:        ctx,
		cancelFunc: cancel,
	}

	service.engine = engine.NewWorldServer()

	mux := http.NewServeMux()

	worldPath, worldHandler := _goconnect.NewWorldServiceHandler(service.engine)
	mux.Handle(worldPath, worldHandler)

	timelinePath, timelineHandler := _goconnect.NewTimelineServiceHandler(service.engine)
	mux.Handle(timelinePath, timelineHandler)

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("OK"))
	})

	webServer, err := view.NewWebServer()
	if err == nil {
		mux.Handle("/", webServer)
	}

	corsHandler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	})

	service.server = &http.Server{
		Addr:    fmt.Sprintf(":%d", Port),
		Handler: h2c.NewHandler(corsHandler.Handler(mux), &http2.Server{}),
	}

	go func() {
		if err := service.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("Engine server error: %v\n", err)
		}
	}()

	time.Sleep(100 * time.Millisecond)
	globalService = service
	return fmt.Sprintf("Engine started on :%d", Port)
}

func StopEngine() string {
	if globalService == nil {
		return "Error: engine not running"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := globalService.server.Shutdown(ctx); err != nil {
		return fmt.Sprintf("Error stopping engine: %v", err)
	}

	globalService.cancelFunc()
	globalService = nil

	return "Engine stopped"
}

func IsEngineRunning() bool {
	return globalService != nil
}

func GetEngineStatus() string {
	if globalService == nil {
		return "stopped"
	}
	return fmt.Sprintf("running on :%d", Port)
}

// GetPort returns the currently configured port.
func GetPort() int {
	return Port
}
