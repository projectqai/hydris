// Public C API exported by libhydris_hal.dylib.
// Called from Go via purego (see backend_darwin.go).

#ifndef HYDRIS_HAL_H
#define HYDRIS_HAL_H

#include <stdint.h>
#include <stddef.h>

typedef void (*HalDataCallback)(const uint8_t *data, int32_t len);

// Error: copies last error string into buf, returns length (0 = no error).
int32_t HalGetError(uint8_t *buf, int32_t n);

// Serial watch: calls cb with JSON []SerialPort snapshots on changes.
uintptr_t HalSerialWatch(HalDataCallback cb);
void      HalStopWatch(uintptr_t handle);

// Serial I/O (handle-based).
int64_t HalSerialOpen(const char *path, int32_t baud);
int32_t HalSerialRead(int64_t handle, uint8_t *buf, int32_t n);
int32_t HalSerialWrite(int64_t handle, const uint8_t *buf, int32_t n);
int32_t HalSerialClose(int64_t handle);

// BLE watch: calls cb with JSON []BLEDevice snapshots periodically.
uintptr_t HalBleWatch(HalDataCallback cb);

// BLE connection (handle-based).
int64_t HalBleConnect(const char *address);
int32_t HalBleDisconnect(int64_t handle);
int32_t HalBleRead(int64_t handle, const char *charUUID, uint8_t *buf, int32_t n);
int32_t HalBleWrite(int64_t handle, const char *charUUID, const uint8_t *data, int32_t n);
int32_t HalBleSubscribe(int64_t handle, const char *charUUID, HalDataCallback cb);
int32_t HalBleUnsubscribe(int64_t handle, const char *charUUID);

// BLE disconnect notification: registers a callback fired on remote disconnect.
void    HalBleOnDisconnect(int64_t handle, void (*cb)(void));

// BLE service discovery: copies JSON []GATTService into buf, returns length (-1 = error).
int32_t HalBleServices(int64_t handle, uint8_t *buf, int32_t n);

#endif
