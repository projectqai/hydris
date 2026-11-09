//go:build !android

package plugins

var (
	RunNative   = runNative
	ServeNative = func(dir string, info PluginInfo) (addr, token string, close func(), err error) {
		gw, err := serveNative(dir, info)
		if err != nil {
			return "", "", nil, err
		}
		return gw.addr, gw.token, gw.close, nil
	}
)
