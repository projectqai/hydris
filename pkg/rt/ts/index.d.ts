// Type declarations for the Hydris plugin runtime (pkg/rt).
// These interfaces mirror the Web Bluetooth and serial APIs exposed by the
// Go runtime (goja) to JavaScript plugins.

declare global {
	const Hydris: {
		bluetooth: {
			/** Returns a BluetoothDevice handle for the given BLE address. */
			requestDevice(address: string): BluetoothDevice;

			/** Wraps a BLE connection as a serial-like byte stream. */
			openBLEStream(address: string, opts: {
				writeCharacteristic: string;
				readCharacteristic: string;
			}): Promise<SerialPort>;
		};

		serial: {
			/** Opens a serial port. Resolves to a SerialPort-like stream. */
			open(path: string, baudRate?: number): Promise<SerialPort>;
		};

	};

	interface BluetoothDevice {
		id: string;
		name: string;
		gatt: BluetoothRemoteGATTServer;
		addEventListener(
			event: "gattserverdisconnected",
			handler: (evt: { type: string }) => void,
			options?: { once?: boolean },
		): void;
	}

	interface BluetoothRemoteGATTServer {
		connected: boolean;
		connect(): Promise<BluetoothRemoteGATTServer>;
		disconnect(): void;
		getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>;
	}

	interface BluetoothRemoteGATTService {
		uuid: string;
		getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>;
	}

	interface BluetoothRemoteGATTCharacteristic {
		uuid: string;
		readValue(): Promise<ArrayBuffer>;
		writeValue(data: Uint8Array): Promise<void>;
		startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
		stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
		addEventListener(
			event: string,
			handler: (evt: { target: { uuid: string; value: ArrayBuffer } }) => void,
			options?: { once?: boolean },
		): void;
	}

	interface SerialPort {
		readyState: number;
		addEventListener(
			event: string,
			handler: (evt: { type: string; data?: ArrayBuffer; error?: string }) => void,
			options?: { once?: boolean },
		): void;
		write(data: Uint8Array): Promise<void>;
		close(): void;
	}
	/**
	 * Node.js-compatible `net` module.
	 *
	 *   const socket = net.createConnection(16810, "192.168.1.100");
	 *   socket.on("connect", () => console.log("connected"));
	 *   socket.on("data", (chunk) => { ... });
	 *   socket.write("hello");
	 *   socket.end();
	 */
	const net: {
		createConnection(port: number, host?: string, connectListener?: () => void): NetSocket;
		createConnection(options: { port: number; host?: string }, connectListener?: () => void): NetSocket;
		connect(port: number, host?: string, connectListener?: () => void): NetSocket;
		connect(options: { port: number; host?: string }, connectListener?: () => void): NetSocket;
		Socket: { new(): NetSocket };
	};

	/** Node.js net.Socket */
	interface NetSocket {
		readonly remoteAddress: string | undefined;
		readonly remotePort: number | undefined;
		readonly localAddress: string | undefined;
		readonly localPort: number | undefined;
		readonly connecting: boolean;
		readonly destroyed: boolean;
		readonly readyState: "opening" | "open" | "readOnly" | "writeOnly" | "closed";

		connect(port: number, host?: string, connectListener?: () => void): this;
		connect(options: { port: number; host?: string }, connectListener?: () => void): this;

		on(event: "connect", listener: () => void): this;
		on(event: "ready", listener: () => void): this;
		on(event: "data", listener: (data: Uint8Array) => void): this;
		on(event: "end", listener: () => void): this;
		on(event: "close", listener: (hadError: boolean) => void): this;
		on(event: "error", listener: (err: Error) => void): this;
		on(event: "timeout", listener: () => void): this;
		on(event: "drain", listener: () => void): this;
		on(event: string, listener: (...args: any[]) => void): this;

		once(event: "connect", listener: () => void): this;
		once(event: "ready", listener: () => void): this;
		once(event: "data", listener: (data: Uint8Array) => void): this;
		once(event: "end", listener: () => void): this;
		once(event: "close", listener: (hadError: boolean) => void): this;
		once(event: "error", listener: (err: Error) => void): this;
		once(event: "timeout", listener: () => void): this;
		once(event: string, listener: (...args: any[]) => void): this;

		addListener(event: string, listener: (...args: any[]) => void): this;
		removeListener(event: string, listener: (...args: any[]) => void): this;
		off(event: string, listener: (...args: any[]) => void): this;
		removeAllListeners(event?: string): this;

		write(data: Uint8Array | string, callback?: (err?: Error) => void): boolean;
		write(data: Uint8Array | string, encoding?: string, callback?: (err?: Error) => void): boolean;

		end(): this;
		end(data: Uint8Array | string, callback?: () => void): this;
		end(data: Uint8Array | string, encoding?: string, callback?: () => void): this;

		destroy(error?: Error): this;

		setTimeout(timeout: number, callback?: () => void): this;
		setNoDelay(noDelay?: boolean): this;
		setKeepAlive(enable?: boolean, initialDelay?: number): this;

		ref(): this;
		unref(): this;
	}
}

export {};
