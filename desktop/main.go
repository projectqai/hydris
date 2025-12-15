package main

import (
	"flag"
	"fmt"

	"github.com/projectqai/hydra/cmd"
	"github.com/projectqai/hydra/engine"
	_ "github.com/projectqai/hydra/view"
	"github.com/spf13/cobra"
	webview "github.com/webview/webview_go"
)

func main() {
	port := flag.String("p", cmd.DefaultPort, "port to listen on")
	flag.StringVar(port, "port", cmd.DefaultPort, "port to listen on")
	flag.Parse()

	engine.Port = *port
	go engine.RunEngine(&cobra.Command{}, []string{})

	w := webview.New(false)
	defer w.Destroy()
	w.SetTitle("Basic Example")
	w.SetSize(480, 320, webview.HintNone)
	w.Navigate(fmt.Sprintf("http://localhost:%s", *port))
	w.Run()
}
