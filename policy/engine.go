package policy

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/fsnotify/fsnotify"
	"github.com/open-policy-agent/opa/v1/rego"
)

type Engine struct {
	mu       sync.RWMutex
	query    *rego.PreparedEvalQuery
	filePath string
	watcher  *fsnotify.Watcher
}

// Connection holds connection-related info for policy evaluation
type Connection struct {
	SourceIP string `json:"source_ip"`
	// Future: DestIP, TLS SNI, etc.
}

// Entity holds entity-related info for policy evaluation
type Entity struct {
	ID         string `json:"id,omitempty"`
	Components []int  `json:"components,omitempty"` // proto field numbers present
}

// Input is the structure passed to OPA for policy evaluation
type Input struct {
	Action     string     `json:"action"` // read, write, timeline
	Connection Connection `json:"connection"`
	Entity     Entity     `json:"entity,omitempty"`
}

// NewEngine creates a new OPA policy engine from a Rego file path
// If the file is invalid, it returns an error.
// After creation, the engine watches for file changes and auto-reloads if its valid
func NewEngine(filePath string) (*Engine, error) {
	e := &Engine{
		filePath: filePath,
	}

	if err := e.loadPolicy(); err != nil {
		return nil, fmt.Errorf("failed to load initial policy: %w", err)
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("failed to create file watcher: %w", err)
	}
	e.watcher = watcher

	// Watch directory, not file - editors often replace files via rename
	dir := filepath.Dir(filePath)
	if err := watcher.Add(dir); err != nil {
		_ = watcher.Close()
		return nil, fmt.Errorf("failed to watch policy directory: %w", err)
	}

	go e.watchLoop()

	return e, nil
}

func (e *Engine) loadPolicy() error {
	content, err := os.ReadFile(e.filePath)
	if err != nil {
		return fmt.Errorf("failed to read policy file: %w", err)
	}

	ctx := context.Background()
	query, err := rego.New(
		rego.Query("data.hydris.authz.allow"),
		rego.Module(e.filePath, string(content)),
	).PrepareForEval(ctx)
	if err != nil {
		return fmt.Errorf("failed to compile policy: %w", err)
	}

	e.mu.Lock()
	e.query = &query
	e.mu.Unlock()

	slog.Info("loaded OPA policy", "file", e.filePath)
	return nil
}

func (e *Engine) watchLoop() {
	absPath, _ := filepath.Abs(e.filePath)

	for {
		select {
		case event, ok := <-e.watcher.Events:
			if !ok {
				return
			}
			// Filter for our specific file
			eventPath, _ := filepath.Abs(event.Name)
			if eventPath != absPath {
				continue
			}
			if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) {
				if err := e.loadPolicy(); err != nil {
					slog.Warn("failed to reload policy (keeping previous)", "error", err)
				}
			}
		case err, ok := <-e.watcher.Errors:
			if !ok {
				return
			}
			slog.Error("policy file watcher error", "error", err)
		}
	}
}

func (e *Engine) Close() error {
	if e.watcher != nil {
		return e.watcher.Close()
	}
	return nil
}

// Evaluate evaluates the policy with the given input.
// Returns true if allowed, false otherwise.
func (e *Engine) Evaluate(ctx context.Context, input *Input) (bool, error) {
	e.mu.RLock()
	query := e.query
	e.mu.RUnlock()

	if query == nil {
		return true, nil
	}

	results, err := query.Eval(ctx, rego.EvalInput(input))
	if err != nil {
		return false, fmt.Errorf("policy evaluation failed: %w", err)
	}

	if len(results) == 0 {
		return false, nil
	}

	allowed, ok := results[0].Expressions[0].Value.(bool)
	if !ok {
		return false, fmt.Errorf("policy did not return a boolean")
	}

	return allowed, nil
}
