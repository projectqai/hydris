//go:build linux

package platform

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/projectqai/hydris/hal"
)

// MetricKind/MetricUnit values matching the proto enums, to avoid importing proto.
const (
	kindTemperature = 1
	kindPressure    = 2
	kindPercentage  = 41
	kindVoltage     = 20

	unitCelsius     = 1
	unitPercent     = 20
	unitVolt        = 30
	unitHectopascal = 10
)

func init() {
	hal.P.ReadSensors = readSensorsLinux
}

func readSensorsLinux() []hal.SensorReading {
	var readings []hal.SensorReading
	var nextID uint32 = 1

	// Battery sensors from /sys/class/power_supply/BAT*
	batDirs, _ := filepath.Glob("/sys/class/power_supply/BAT*")
	for _, dir := range batDirs {
		name := filepath.Base(dir)

		if v, ok := readSysfsInt(filepath.Join(dir, "capacity")); ok {
			readings = append(readings, hal.SensorReading{
				ID: nextID, Label: name + " Level", Kind: kindPercentage, Unit: unitPercent, Value: float64(v),
			})
			nextID++
		}
		if v, ok := readSysfsInt(filepath.Join(dir, "temp")); ok {
			readings = append(readings, hal.SensorReading{
				ID: nextID, Label: name + " Temperature", Kind: kindTemperature, Unit: unitCelsius, Value: float64(v) / 10.0,
			})
			nextID++
		}
		if v, ok := readSysfsInt(filepath.Join(dir, "voltage_now")); ok {
			readings = append(readings, hal.SensorReading{
				ID: nextID, Label: name + " Voltage", Kind: kindVoltage, Unit: unitVolt, Value: float64(v) / 1e6,
			})
			nextID++
		}
	}

	// CPU thermal zones from /sys/class/thermal/thermal_zone*
	tzDirs, _ := filepath.Glob("/sys/class/thermal/thermal_zone*")
	for _, dir := range tzDirs {
		v, ok := readSysfsInt(filepath.Join(dir, "temp"))
		if !ok {
			continue
		}
		label := "CPU"
		if t, err := os.ReadFile(filepath.Join(dir, "type")); err == nil {
			label = strings.TrimSpace(string(t))
		}
		readings = append(readings, hal.SensorReading{
			ID: nextID, Label: label, Kind: kindTemperature, Unit: unitCelsius, Value: float64(v) / 1000.0,
		})
		nextID++
	}

	// Barometric pressure from IIO subsystem (rare on desktops, common on some laptops)
	iioDirs, _ := filepath.Glob("/sys/bus/iio/devices/iio:device*")
	for _, dir := range iioDirs {
		if v, ok := readSysfsFloat(filepath.Join(dir, "in_pressure_input")); ok {
			readings = append(readings, hal.SensorReading{
				ID: nextID, Label: "Barometer", Kind: kindPressure, Unit: unitHectopascal, Value: v * 10.0, // kPa → hPa
			})
			nextID++
		}
	}

	return readings
}

func readSysfsInt(path string) (int64, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	v, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

func readSysfsFloat(path string) (float64, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(string(data)), 64)
	if err != nil {
		return 0, false
	}
	return v, true
}
