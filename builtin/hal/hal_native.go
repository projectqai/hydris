//go:build linux || windows || darwin

package hal

import _ "github.com/projectqai/hydris/hal/native" // register native platform
