//go:build linux || windows

package platform

import (
	"time"

	"github.com/projectqai/hydris/hal"
)

const serialWatchInterval = 15 * time.Second

func init() {
	hal.P = hal.Platform{
		SerialWatch: serialWatch,
		SerialOpen:  serialOpen,
		SerialRead:  serialRead,
		SerialWrite: serialWrite,
		SerialClose: serialClose,

		BLEWatch:        bleWatch,
		BLEConnect:      bleConnect,
		BLEDisconnect:   bleDisconnect,
		BLERead:         bleRead,
		BLEWrite:        bleWrite,
		BLESubscribe:    bleSubscribe,
		BLEUnsubscribe:  bleUnsubscribe,
		BLEOnDisconnect: bleOnDisconnect,
	}
}
