package artifacts

import (
	"context"
	"io"
	"slices"
	"sync"
)

// Store abstracts blob storage for artifacts.
type Store interface {
	Get(ctx context.Context, id string) (io.ReadCloser, error)
	Put(ctx context.Context, id string, r io.Reader) error
	Delete(ctx context.Context, id string) error
	Exists(ctx context.Context, id string) (bool, error)
}

// NamedStore pairs a Store with a human-readable name.
type NamedStore struct {
	Name  string
	Store Store
}

var (
	pluginStoresMu  sync.RWMutex
	pluginStores    []NamedStore
	onStoresChanged func() // called after register/unregister
)

// OnStoresChanged sets a callback invoked when the plugin store list changes.
func OnStoresChanged(fn func()) {
	pluginStoresMu.Lock()
	defer pluginStoresMu.Unlock()
	onStoresChanged = fn
}

// RegisterPluginStore adds a named store to the global registry.
// The last registered store is preferred by "auto" mode.
func RegisterPluginStore(name string, s Store) {
	pluginStoresMu.Lock()
	for i, ns := range pluginStores {
		if ns.Name == name {
			pluginStores[i].Store = s
			cb := onStoresChanged
			pluginStoresMu.Unlock()
			if cb != nil {
				cb()
			}
			return
		}
	}
	pluginStores = append(pluginStores, NamedStore{Name: name, Store: s})
	cb := onStoresChanged
	pluginStoresMu.Unlock()
	if cb != nil {
		cb()
	}
}

// UnregisterPluginStore removes a store by name.
func UnregisterPluginStore(name string) {
	pluginStoresMu.Lock()
	pluginStores = slices.DeleteFunc(pluginStores, func(ns NamedStore) bool {
		return ns.Name == name
	})
	cb := onStoresChanged
	pluginStoresMu.Unlock()
	if cb != nil {
		cb()
	}
}

// PluginStores returns a snapshot of all registered plugin stores.
func PluginStores() []NamedStore {
	pluginStoresMu.RLock()
	defer pluginStoresMu.RUnlock()
	out := make([]NamedStore, len(pluginStores))
	copy(out, pluginStores)
	return out
}

// LastPluginStore returns the most recently registered plugin store.
func LastPluginStore() (NamedStore, bool) {
	pluginStoresMu.RLock()
	defer pluginStoresMu.RUnlock()
	if len(pluginStores) == 0 {
		return NamedStore{}, false
	}
	return pluginStores[len(pluginStores)-1], true
}

// GetPluginStore returns a specific plugin store by name.
func GetPluginStore(name string) (Store, bool) {
	pluginStoresMu.RLock()
	defer pluginStoresMu.RUnlock()
	for _, ns := range pluginStores {
		if ns.Name == name {
			return ns.Store, true
		}
	}
	return nil, false
}
