package rt

import (
	"fmt"
	"io"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/projectqai/hydris/hal"
)

// ConnectBLEFunc establishes a BLE GATT connection via the HAL.
var ConnectBLEFunc = func(address string) (hal.BLEConnection, error) {
	return hal.ConnectBLE(address)
}

// OpenSerialFunc opens a serial port via the HAL.
var OpenSerialFunc = func(path string, baudRate int) (io.ReadWriteCloser, error) {
	return hal.OpenSerial(path, baudRate)
}

// setupDevice registers the Hydris.bluetooth and Hydris.serial namespaces on the VM.
func setupDevice(loop *eventloop.EventLoop, vm *goja.Runtime) {
	bluetooth := vm.NewObject()

	// requestDevice(address) → BluetoothDevice
	// Modeled after navigator.bluetooth.requestDevice()
	// Returns a device object with a .gatt property for connecting.
	bluetooth.Set("requestDevice", func(call goja.FunctionCall) goja.Value {
		address := call.Argument(0).String()
		return wrapBluetoothDevice(loop, vm, address)
	})

	serial := vm.NewObject()

	// open(path, baudRate?) → Promise<SerialPort>
	serial.Set("open", func(call goja.FunctionCall) goja.Value {
		path := call.Argument(0).String()
		baudRate := 115200
		if len(call.Arguments) > 1 && !goja.IsUndefined(call.Argument(1)) {
			baudRate = int(call.Argument(1).ToInteger())
		}
		promise, resolve, reject := vm.NewPromise()

		go func() {
			if OpenSerialFunc == nil {
				loop.RunOnLoop(func(vm *goja.Runtime) {
					_ = reject(vm.NewGoError(fmt.Errorf("serial not available on this platform")))
				})
				return
			}

			port, err := OpenSerialFunc(path, baudRate)
			if err != nil {
				loop.RunOnLoop(func(vm *goja.Runtime) {
					_ = reject(vm.NewGoError(err))
				})
				return
			}

			loop.RunOnLoop(func(vm *goja.Runtime) {
				obj := wrapSerialPort(loop, vm, port)
				_ = resolve(obj)
			})
		}()

		return vm.ToValue(promise)
	})

	// openBLEStream(address, { writeCharacteristic, readCharacteristic }) → Promise<SerialPort>
	// Convenience: wraps a BLE connection into a serial-like byte stream.
	bluetooth.Set("openBLEStream", func(call goja.FunctionCall) goja.Value {
		address := call.Argument(0).String()
		opts := call.Argument(1).ToObject(vm)
		writeUUID := opts.Get("writeCharacteristic").String()
		readUUID := opts.Get("readCharacteristic").String()

		promise, resolve, reject := vm.NewPromise()

		go func() {
			if ConnectBLEFunc == nil {
				loop.RunOnLoop(func(vm *goja.Runtime) {
					_ = reject(vm.NewGoError(fmt.Errorf("BLE not available on this platform")))
				})
				return
			}

			conn, err := ConnectBLEFunc(address)
			if err != nil {
				loop.RunOnLoop(func(vm *goja.Runtime) {
					_ = reject(vm.NewGoError(err))
				})
				return
			}

			stream, err := hal.NewStreamAdapter(conn, writeUUID, readUUID)
			if err != nil {
				_ = conn.Close()
				loop.RunOnLoop(func(vm *goja.Runtime) {
					_ = reject(vm.NewGoError(err))
				})
				return
			}

			loop.RunOnLoop(func(vm *goja.Runtime) {
				obj := wrapSerialPort(loop, vm, stream)
				_ = resolve(obj)
			})
		}()

		return vm.ToValue(promise)
	})

	hydris := vm.Get("Hydris")
	var hydrisObj *goja.Object
	if hydris == nil || goja.IsUndefined(hydris) {
		hydrisObj = vm.NewObject()
		vm.Set("Hydris", hydrisObj)
	} else {
		hydrisObj = hydris.ToObject(vm)
	}
	hydrisObj.Set("bluetooth", bluetooth)
	hydrisObj.Set("serial", serial)

}

// --- Web Bluetooth-style API ---
//
// Usage:
//   const device = Hydris.bluetooth.requestDevice("AA:BB:CC:DD:EE:FF");
//   const server = await device.gatt.connect();
//   const service = await server.getPrimaryService("service-uuid");
//   const char = await service.getCharacteristic("char-uuid");
//   await char.startNotifications();
//   char.addEventListener("characteristicvaluechanged", (evt) => {
//       const data = evt.target.value; // ArrayBuffer
//   });
//   await char.writeValue(new Uint8Array([...]));
//   const val = await char.readValue(); // ArrayBuffer
//   device.gatt.disconnect();

// wrapBluetoothDevice creates a BluetoothDevice-like object.
func wrapBluetoothDevice(loop *eventloop.EventLoop, vm *goja.Runtime, address string) *goja.Object {
	device := vm.NewObject()
	device.Set("id", address)
	device.Set("name", address)

	type listener struct {
		cb   goja.Callable
		once bool
	}
	var deviceListeners []listener

	gatt := vm.NewObject()

	device.Set("addEventListener", func(call goja.FunctionCall) goja.Value {
		event := call.Argument(0).String()
		cb, ok := goja.AssertFunction(call.Argument(1))
		if !ok || event != "gattserverdisconnected" {
			return goja.Undefined()
		}
		once := false
		if len(call.Arguments) > 2 && !goja.IsUndefined(call.Argument(2)) {
			opts := call.Argument(2).ToObject(vm)
			if v := opts.Get("once"); v != nil {
				once = v.ToBoolean()
			}
		}
		deviceListeners = append(deviceListeners, listener{cb, once})
		return goja.Undefined()
	})

	fireDisconnect := func() {
		gatt.Set("connected", false)
		evt := vm.NewObject()
		evt.Set("type", "gattserverdisconnected")
		remaining := deviceListeners[:0]
		for _, l := range deviceListeners {
			_, _ = l.cb(device, evt)
			if !l.once {
				remaining = append(remaining, l)
			}
		}
		deviceListeners = remaining
	}
	gatt.Set("connected", false)

	var conn hal.BLEConnection

	// gatt.connect() → Promise<BluetoothRemoteGATTServer>
	gatt.Set("connect", func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := vm.NewPromise()

		go func() {
			if ConnectBLEFunc == nil {
				loop.RunOnLoop(func(vm *goja.Runtime) {
					_ = reject(vm.NewGoError(fmt.Errorf("BLE not available on this platform")))
				})
				return
			}

			c, err := ConnectBLEFunc(address)
			if err != nil {
				loop.RunOnLoop(func(vm *goja.Runtime) {
					_ = reject(vm.NewGoError(err))
				})
				return
			}

			conn = c
			go func() {
				<-c.Disconnected()
				loop.RunOnLoop(func(vm *goja.Runtime) {
					fireDisconnect()
				})
			}()
			loop.RunOnLoop(func(vm *goja.Runtime) {
				gatt.Set("connected", true)
				server := wrapGATTServer(loop, vm, conn, gatt)
				_ = resolve(server)
			})
		}()

		return vm.ToValue(promise)
	})

	// gatt.disconnect()
	gatt.Set("disconnect", func(call goja.FunctionCall) goja.Value {
		if conn != nil {
			go func() {
				_ = conn.Close()
			}()
		}
		return goja.Undefined()
	})

	device.Set("gatt", gatt)
	return device
}

// wrapGATTServer creates a BluetoothRemoteGATTServer-like object.
func wrapGATTServer(loop *eventloop.EventLoop, vm *goja.Runtime, conn hal.BLEConnection, gatt *goja.Object) *goja.Object {
	server := vm.NewObject()
	server.Set("connected", true)

	// getPrimaryService(uuid) → Promise<BluetoothRemoteGATTService>
	// We don't filter by service — all characteristics were discovered at connect time.
	server.Set("getPrimaryService", func(call goja.FunctionCall) goja.Value {
		serviceUUID := call.Argument(0).String()
		promise, resolve, _ := vm.NewPromise()

		// Resolve synchronously — services were already discovered.
		service := wrapGATTService(loop, vm, conn, serviceUUID)
		_ = resolve(service)

		return vm.ToValue(promise)
	})

	return server
}

// wrapGATTService creates a BluetoothRemoteGATTService-like object.
func wrapGATTService(loop *eventloop.EventLoop, vm *goja.Runtime, conn hal.BLEConnection, serviceUUID string) *goja.Object {
	service := vm.NewObject()
	service.Set("uuid", serviceUUID)

	// getCharacteristic(uuid) → Promise<BluetoothRemoteGATTCharacteristic>
	service.Set("getCharacteristic", func(call goja.FunctionCall) goja.Value {
		charUUID := call.Argument(0).String()
		promise, resolve, _ := vm.NewPromise()

		char := wrapGATTCharacteristic(loop, vm, conn, charUUID)
		_ = resolve(char)

		return vm.ToValue(promise)
	})

	return service
}

// wrapGATTCharacteristic creates a BluetoothRemoteGATTCharacteristic-like object.
func wrapGATTCharacteristic(loop *eventloop.EventLoop, vm *goja.Runtime, conn hal.BLEConnection, charUUID string) *goja.Object {
	char := vm.NewObject()
	char.Set("uuid", charUUID)

	type listener struct {
		cb   goja.Callable
		once bool
	}
	listeners := map[string][]listener{}

	char.Set("addEventListener", func(call goja.FunctionCall) goja.Value {
		event := call.Argument(0).String()
		cb, ok := goja.AssertFunction(call.Argument(1))
		if !ok {
			return goja.Undefined()
		}
		once := false
		if len(call.Arguments) > 2 && !goja.IsUndefined(call.Argument(2)) {
			opts := call.Argument(2).ToObject(vm)
			if v := opts.Get("once"); v != nil {
				once = v.ToBoolean()
			}
		}
		listeners[event] = append(listeners[event], listener{cb, once})
		return goja.Undefined()
	})

	fire := func(event string, args ...goja.Value) {
		remaining := listeners[event][:0]
		for _, l := range listeners[event] {
			_, _ = l.cb(nil, args...)
			if !l.once {
				remaining = append(remaining, l)
			}
		}
		listeners[event] = remaining
	}

	// startNotifications() → Promise<void>
	char.Set("startNotifications", func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := vm.NewPromise()

		go func() {
			ch, err := conn.Subscribe(charUUID)
			if err != nil {
				loop.RunOnLoop(func(vm *goja.Runtime) {
					_ = reject(vm.NewGoError(err))
				})
				return
			}

			loop.RunOnLoop(func(vm *goja.Runtime) {
				_ = resolve(char)
			})

			// Read loop — dispatches "characteristicvaluechanged" events.
			for data := range ch {
				d := data
				loop.RunOnLoop(func(vm *goja.Runtime) {
					// Web Bluetooth uses evt.target.value
					evt := vm.NewObject()
					evt.Set("type", "characteristicvaluechanged")
					target := vm.NewObject()
					target.Set("uuid", charUUID)
					target.Set("value", vm.NewArrayBuffer(d))
					evt.Set("target", target)
					fire("characteristicvaluechanged", evt)
				})
			}
		}()

		return vm.ToValue(promise)
	})

	// stopNotifications() → Promise<void>
	char.Set("stopNotifications", func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := vm.NewPromise()

		go func() {
			err := conn.Unsubscribe(charUUID)
			loop.RunOnLoop(func(vm *goja.Runtime) {
				if err != nil {
					_ = reject(vm.NewGoError(err))
				} else {
					_ = resolve(char)
				}
			})
		}()

		return vm.ToValue(promise)
	})

	// writeValue(data) → Promise<void>
	char.Set("writeValue", func(call goja.FunctionCall) goja.Value {
		data := exportBytes(vm, call.Argument(0))
		promise, resolve, reject := vm.NewPromise()

		go func() {
			err := conn.WriteCharacteristic(charUUID, data)
			loop.RunOnLoop(func(vm *goja.Runtime) {
				if err != nil {
					_ = reject(vm.NewGoError(err))
				} else {
					_ = resolve(goja.Undefined())
				}
			})
		}()

		return vm.ToValue(promise)
	})

	// readValue() → Promise<ArrayBuffer>
	char.Set("readValue", func(call goja.FunctionCall) goja.Value {
		promise, resolve, reject := vm.NewPromise()

		go func() {
			data, err := conn.ReadCharacteristic(charUUID)
			loop.RunOnLoop(func(vm *goja.Runtime) {
				if err != nil {
					_ = reject(vm.NewGoError(err))
				} else {
					_ = resolve(vm.NewArrayBuffer(data))
				}
			})
		}()

		return vm.ToValue(promise)
	})

	return char
}

// --- Serial Port API ---

// wrapSerialPort wraps an io.ReadWriteCloser in a JS object with
// addEventListener("data"), write(), close().
func wrapSerialPort(loop *eventloop.EventLoop, vm *goja.Runtime, port io.ReadWriteCloser) *goja.Object {
	obj := vm.NewObject()
	obj.Set("readyState", 1) // OPEN

	type listener struct {
		cb   goja.Callable
		once bool
	}
	listeners := map[string][]listener{}

	obj.Set("addEventListener", func(call goja.FunctionCall) goja.Value {
		event := call.Argument(0).String()
		cb, ok := goja.AssertFunction(call.Argument(1))
		if !ok {
			return goja.Undefined()
		}
		once := false
		if len(call.Arguments) > 2 && !goja.IsUndefined(call.Argument(2)) {
			opts := call.Argument(2).ToObject(vm)
			if v := opts.Get("once"); v != nil {
				once = v.ToBoolean()
			}
		}
		listeners[event] = append(listeners[event], listener{cb, once})
		return goja.Undefined()
	})

	fire := func(event string, args ...goja.Value) {
		remaining := listeners[event][:0]
		for _, l := range listeners[event] {
			_, _ = l.cb(nil, args...)
			if !l.once {
				remaining = append(remaining, l)
			}
		}
		listeners[event] = remaining
	}

	// Background read loop.
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := port.Read(buf)
			if n > 0 {
				data := make([]byte, n)
				copy(data, buf[:n])
				loop.RunOnLoop(func(vm *goja.Runtime) {
					evt := vm.NewObject()
					evt.Set("type", "data")
					evt.Set("data", vm.NewArrayBuffer(data))
					fire("data", evt)
				})
			}
			if err != nil {
				loop.RunOnLoop(func(vm *goja.Runtime) {
					obj.Set("readyState", 3)
					evt := vm.NewObject()
					evt.Set("type", "close")
					if err != io.EOF {
						evt.Set("error", err.Error())
					}
					fire("close", evt)
				})
				return
			}
		}
	}()

	// write(data) → Promise<void>
	obj.Set("write", func(call goja.FunctionCall) goja.Value {
		data := exportBytes(vm, call.Argument(0))
		promise, resolve, reject := vm.NewPromise()

		go func() {
			_, err := port.Write(data)
			loop.RunOnLoop(func(vm *goja.Runtime) {
				if err != nil {
					_ = reject(vm.NewGoError(err))
				} else {
					_ = resolve(goja.Undefined())
				}
			})
		}()

		return vm.ToValue(promise)
	})

	// close()
	obj.Set("close", func(call goja.FunctionCall) goja.Value {
		obj.Set("readyState", 3)
		go func() {
			_ = port.Close()
			loop.RunOnLoop(func(vm *goja.Runtime) {
				evt := vm.NewObject()
				evt.Set("type", "close")
				fire("close", evt)
			})
		}()
		return goja.Undefined()
	})

	return obj
}
