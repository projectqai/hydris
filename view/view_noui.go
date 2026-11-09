//go:build noui

package view

import (
	"embed"
	"fmt"
	"net/http"
)

var Dist embed.FS

func NewWebServer() (http.Handler, error) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "this is a headless hydris. please use hydris --server or federation")
	})
	return mux, nil
}
