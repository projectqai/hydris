package engine

import (
	"fmt"
	"golang.org/x/sys/windows"
)

func osVersion() string {
	major, minor, build := windows.RtlGetNtVersionNumbers()
	return fmt.Sprintf("Windows %d.%d.%d", major, minor, build)
}
