package ai.projectq.hydris.hal

import android.Manifest
import android.bluetooth.*
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Per-connection state holding the GATT instance and pending operation latches.
 */
private class GattConnection(val gatt: BluetoothGatt) {
    var readLatch: CountDownLatch? = null
    var readResult: ByteArray? = null
    var readError: Exception? = null

    var writeLatch: CountDownLatch? = null
    var writeError: Exception? = null
}

/**
 * Kotlin implementation of hydris.PlatformBLE (gomobile interface).
 */
class KotlinBLE(
    private val context: Context,
    private val requestPermission: (String) -> Boolean,
    private val requestPermissions: (List<String>) -> Boolean = { perms -> perms.all { requestPermission(it) } }
) : hydris.PlatformBLE {

    companion object {
        private const val TAG = "HydrisBLE"
        private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val adapter: BluetoothAdapter? get() = bluetoothManager?.adapter
    private val nextHandle = AtomicLong(1)
    private val connections = ConcurrentHashMap<Long, GattConnection>()
    private val discoveredDevices = ConcurrentHashMap<String, JSONObject>()
    @Volatile private var scanning = false

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device
            val name = try { device.name ?: "" } catch (_: SecurityException) { "" }
            val uuids = JSONArray().apply {
                result.scanRecord?.serviceUuids?.forEach { put(it.toString()) }
            }
            discoveredDevices[device.address] = JSONObject().apply {
                put("Address", device.address)
                put("Name", name)
                put("RSSI", result.rssi)
                put("ServiceUUIDs", uuids)
            }
        }
    }

    override fun startScan() {
        if (scanning) return
        val perms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            listOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        requestPermissions(perms)

        try {
            adapter?.bluetoothLeScanner?.startScan(scanCallback)
            scanning = true

            Thread {
                while (scanning) {
                    Thread.sleep(5000)
                    val arr = JSONArray()
                    discoveredDevices.values.forEach { arr.put(it) }
                    try {
                        hydris.Hydris.getHalHandler()?.onBLEDevices(arr.toString())
                    } catch (_: Exception) {}
                }
            }.start()
        } catch (e: SecurityException) {
            Log.w(TAG, "BLE scan permission denied", e)
        }
    }

    override fun stopScan() {
        scanning = false
        try { adapter?.bluetoothLeScanner?.stopScan(scanCallback) } catch (_: SecurityException) {}
        // Disconnect all active GATT connections
        val handles = connections.keys().toList()
        for (handle in handles) {
            connections.remove(handle)?.gatt?.let {
                try { it.disconnect(); it.close() } catch (_: SecurityException) {}
            }
        }
    }

    override fun connect(address: String): Long {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!requestPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
                throw Exception("BLE connect permission not granted")
            }
        }
        val device = adapter?.getRemoteDevice(address)
            ?: throw Exception("Device not found: $address")

        val handle = nextHandle.getAndIncrement()
        val latch = CountDownLatch(1)
        var connectError: Exception? = null

        device.connectGatt(context, false, object : BluetoothGattCallback() {
            override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
                try { gatt.discoverServices() } catch (e: SecurityException) {
                    connectError = e
                    latch.countDown()
                }
            }

            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    connections[handle] = GattConnection(gatt)
                    try {
                        if (!gatt.requestMtu(517)) {
                            gatt.discoverServices()
                        }
                    } catch (e: SecurityException) {
                        connectError = e
                        latch.countDown()
                    }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED && connections.containsKey(handle)) {
                    connections.remove(handle)
                    try {
                        hydris.Hydris.getHalHandler()?.onBLEDisconnect(handle)
                    } catch (_: Exception) {}
                    try { gatt.close() } catch (_: SecurityException) {}
                } else {
                    connectError = Exception("Connection failed status=$status newState=$newState")
                    try { gatt.close() } catch (_: SecurityException) {}
                    latch.countDown()
                }
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    connectError = Exception("Service discovery failed with status $status")
                }
                latch.countDown()
            }

            override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
                val conn = connections[handle] ?: return
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    conn.readResult = value
                } else {
                    conn.readError = Exception("Read failed with status $status")
                }
                conn.readLatch?.countDown()
            }

            @Suppress("DEPRECATION")
            override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
                val conn = connections[handle] ?: return
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    conn.readResult = characteristic.value
                } else {
                    conn.readError = Exception("Read failed with status $status")
                }
                conn.readLatch?.countDown()
            }

            override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
                val conn = connections[handle] ?: return
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    conn.writeError = Exception("Write failed with status $status")
                }
                conn.writeLatch?.countDown()
            }

            override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
                val conn = connections[handle] ?: return
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    conn.writeError = Exception("Descriptor write failed with status $status")
                }
                conn.writeLatch?.countDown()
            }

            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
                try {
                    hydris.Hydris.getHalHandler()?.onBLENotification(handle, characteristic.uuid.toString(), value)
                } catch (_: Exception) {}
            }

            @Suppress("DEPRECATION")
            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
                val value = characteristic.value ?: return
                try {
                    hydris.Hydris.getHalHandler()?.onBLENotification(handle, characteristic.uuid.toString(), value)
                } catch (_: Exception) {}
            }
        }, BluetoothDevice.TRANSPORT_LE)

        val connected = latch.await(10, TimeUnit.SECONDS)
        if (connectError != null) {
            connections.remove(handle)
            throw connectError!!
        }
        if (!connected) {
            connections.remove(handle)?.gatt?.let {
                try { it.disconnect(); it.close() } catch (_: SecurityException) {}
            }
            throw Exception("GATT connect timed out")
        }
        return handle
    }

    override fun disconnect(handle: Long) {
        val conn = connections.remove(handle) ?: return
        try { conn.gatt.disconnect(); conn.gatt.close() } catch (_: SecurityException) {}
    }

    override fun readCharacteristic(handle: Long, charUUID: String): ByteArray {
        val conn = connections[handle] ?: throw Exception("Not connected")
        val uuid = UUID.fromString(charUUID)
        val char = conn.gatt.services.flatMap { it.characteristics }.find { it.uuid == uuid }
            ?: throw Exception("Characteristic not found")

        conn.readResult = null
        conn.readError = null
        conn.readLatch = CountDownLatch(1)

        conn.gatt.readCharacteristic(char)
        conn.readLatch!!.await(5, TimeUnit.SECONDS)

        if (conn.readError != null) throw conn.readError!!
        return conn.readResult ?: throw Exception("Read timed out")
    }

    override fun writeCharacteristic(handle: Long, charUUID: String, data: ByteArray) {
        val conn = connections[handle] ?: throw Exception("Not connected")
        val uuid = UUID.fromString(charUUID)
        val char = conn.gatt.services.flatMap { it.characteristics }.find { it.uuid == uuid }
            ?: throw Exception("Characteristic not found")

        conn.writeError = null
        conn.writeLatch = CountDownLatch(1)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            conn.gatt.writeCharacteristic(char, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
        } else {
            @Suppress("DEPRECATION")
            char.value = data
            @Suppress("DEPRECATION")
            conn.gatt.writeCharacteristic(char)
        }

        conn.writeLatch!!.await(5, TimeUnit.SECONDS)
        if (conn.writeError != null) throw conn.writeError!!
    }

    override fun subscribe(handle: Long, charUUID: String) {
        val conn = connections[handle] ?: throw Exception("Not connected")
        val uuid = UUID.fromString(charUUID)
        val char = conn.gatt.services.flatMap { it.characteristics }.find { it.uuid == uuid }
            ?: throw Exception("Characteristic not found")
        conn.gatt.setCharacteristicNotification(char, true)

        // prefer notification over indication when both supported
        val cccd = char.getDescriptor(CCCD_UUID)
        if (cccd != null) {
            val isNotify = (char.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0
            val cccdValue = if (isNotify) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                            else BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
            conn.writeLatch = CountDownLatch(1)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                conn.gatt.writeDescriptor(cccd, cccdValue)
            } else {
                @Suppress("DEPRECATION")
                cccd.value = cccdValue
                @Suppress("DEPRECATION")
                conn.gatt.writeDescriptor(cccd)
            }
            conn.writeLatch!!.await(5, TimeUnit.SECONDS)
        }
    }

    override fun unsubscribe(handle: Long, charUUID: String) {
        val conn = connections[handle] ?: return
        val uuid = UUID.fromString(charUUID)
        val char = conn.gatt.services.flatMap { it.characteristics }.find { it.uuid == uuid } ?: return
        conn.gatt.setCharacteristicNotification(char, false)

        val cccd = char.getDescriptor(CCCD_UUID)
        if (cccd != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                conn.gatt.writeDescriptor(cccd, BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE)
            } else {
                @Suppress("DEPRECATION")
                cccd.value = BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
                @Suppress("DEPRECATION")
                conn.gatt.writeDescriptor(cccd)
            }
        }
    }
}
