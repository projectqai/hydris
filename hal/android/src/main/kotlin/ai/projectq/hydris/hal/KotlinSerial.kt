package ai.projectq.hydris.hal

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Log
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import com.hoho.android.usbserial.util.SerialInputOutputManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Kotlin implementation of hydris.PlatformSerial (gomobile interface).
 * Uses usb-serial-for-android with SerialInputOutputManager for I/O.
 */
class KotlinSerial(private val context: Context) : hydris.PlatformSerial {

    companion object {
        private const val TAG = "HydrisSerial"
        private const val ACTION_USB_PERMISSION = "ai.projectq.hydris.USB_PERMISSION"
        private const val READ_TIMEOUT_MS = 1000L
        private const val WRITE_TIMEOUT_MS = 1000
    }

    private val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
    private val nextHandle = AtomicLong(1)
    private val connections = ConcurrentHashMap<Long, OpenPort>()
    private val openDeviceInfo = ConcurrentHashMap<Long, JSONObject>()

    @Volatile private var discovering = false
    private var usbReceiver: BroadcastReceiver? = null

    private class OpenPort(
        val port: UsbSerialPort,
        val ioManager: SerialInputOutputManager,
        val rxQueue: LinkedBlockingQueue<ByteArray>,
        @Volatile var error: Exception? = null,
    )

    // --- Discovery ---

    override fun startDiscovery() {
        if (discovering) return
        discovering = true

        val filter = IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        usbReceiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                pushSnapshot()
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(usbReceiver, filter)
        }

        pushSnapshot()

        Thread {
            while (discovering) {
                Thread.sleep(15_000)
                if (discovering) pushSnapshot()
            }
        }.start()
    }

    override fun stopDiscovery() {
        discovering = false
        usbReceiver?.let {
            try { context.unregisterReceiver(it) } catch (_: Exception) {}
        }
        usbReceiver = null
    }

    private fun pushSnapshot() {
        val arr = JSONArray()

        val openPaths = mutableSetOf<String>()
        val openKeys = mutableSetOf<String>()
        for ((_, info) in openDeviceInfo) {
            arr.put(info)
            openPaths.add(info.optString("Path", ""))
            openKeys.add(stableKey(info))
        }

        val prober = UsbSerialProber.getDefaultProber()
        for ((_, device) in usbManager.deviceList) {
            if (device.deviceName in openPaths) continue
            if (prober.probeDevice(device) == null) continue
            val obj = buildDeviceJson(device)
            if (stableKey(obj) in openKeys) continue
            arr.put(obj)
        }
        try {
            hydris.Hydris.getHalHandler()?.onSerialPorts(arr.toString())
        } catch (e: Exception) {
            Log.e(TAG, "failed to push serial snapshot", e)
        }
    }

    private fun buildDeviceJson(device: UsbDevice): JSONObject = JSONObject().apply {
        put("Key", "%04x-%04x".format(device.vendorId, device.productId))
        put("Path", device.deviceName)
        put("Name", deviceLabel(device))
        put("VendorID", device.vendorId)
        put("ProductID", device.productId)
        try { put("SerialNumber", device.serialNumber ?: "") } catch (_: SecurityException) { put("SerialNumber", "") }
        try { put("ManufacturerName", device.manufacturerName ?: "") } catch (_: SecurityException) { put("ManufacturerName", "") }
        try { put("ProductName", device.productName ?: "") } catch (_: SecurityException) { put("ProductName", "") }
    }

    private fun stableKey(obj: JSONObject): String {
        val vid = obj.optInt("VendorID", 0)
        val pid = obj.optInt("ProductID", 0)
        val serial = obj.optString("SerialNumber", "")
        return if (serial.isNotEmpty()) "$vid:$pid:$serial"
        else "$vid:$pid:${obj.optString("Name", "")}"
    }

    private fun deviceLabel(device: UsbDevice): String {
        return try { device.productName ?: device.deviceName } catch (_: SecurityException) { device.deviceName }
    }

    // --- Open / Close ---

    override fun open(path: String, baudRate: Long): Long {
        // Use probeDevice (no USB I/O) instead of findAllDrivers (which opens devices to probe).
        val device = usbManager.deviceList.values.find { it.deviceName == path }
            ?: throw Exception("Device not found: $path")
        val driver = UsbSerialProber.getDefaultProber().probeDevice(device)
            ?: throw Exception("No serial driver for: $path")

        ensurePermission(device)

        val info = buildDeviceJson(device)

        val connection = usbManager.openDevice(device)
            ?: throw Exception("Failed to open USB device")

        val port = driver.ports[0]
        port.open(connection)
        port.setParameters(baudRate.toInt(), 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
        port.dtr = true
        port.rts = true

        val rxQueue = LinkedBlockingQueue<ByteArray>()
        val handle = nextHandle.getAndIncrement()
        // Error ref shared between the listener and OpenPort
        var portError: Exception? = null

        val ioManager = SerialInputOutputManager(port, object : SerialInputOutputManager.Listener {
            override fun onNewData(data: ByteArray) {
                rxQueue.put(data)
            }
            override fun onRunError(e: Exception) {
                Log.e(TAG, "serial I/O error on handle $handle", e)
                portError = e
                connections[handle]?.error = e
                rxQueue.put(ByteArray(0)) // unblock waiting read
            }
        })
        ioManager.readTimeout = 200

        connections[handle] = OpenPort(port, ioManager, rxQueue)
        openDeviceInfo[handle] = info

        ioManager.start()
        return handle
    }

    override fun close(handle: Long) {
        openDeviceInfo.remove(handle)
        val conn = connections.remove(handle) ?: return
        try { conn.ioManager.stop() } catch (_: Exception) {}
        try { conn.port.close() } catch (_: Exception) {}
    }

    // --- I/O ---

    override fun read(handle: Long, maxLen: Long): ByteArray {
        val conn = connections[handle] ?: throw Exception("Not connected")
        conn.error?.let { throw it }

        while (true) {
            conn.error?.let { throw it }
            val data = conn.rxQueue.poll(READ_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                ?: continue

            if (data.isEmpty()) {
                conn.error?.let { throw it }
                throw Exception("serial connection closed")
            }

            return data
        }
    }

    override fun write(handle: Long, data: ByteArray): Long {
        val conn = connections[handle] ?: throw Exception("Not connected")
        conn.error?.let { throw it }
        conn.ioManager.writeAsync(data)
        return data.size.toLong()
    }

    // --- USB Permission ---

    private fun ensurePermission(device: UsbDevice) {
        if (usbManager.hasPermission(device)) return

        val latch = CountDownLatch(1)
        var granted = false
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                latch.countDown()
            }
        }
        val filter = IntentFilter(ACTION_USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }

        val permIntent = PendingIntent.getBroadcast(
            context, 0,
            Intent(ACTION_USB_PERMISSION).apply { setPackage(context.packageName) },
            PendingIntent.FLAG_MUTABLE,
        )
        usbManager.requestPermission(device, permIntent)
        latch.await(30, TimeUnit.SECONDS)

        try { context.unregisterReceiver(receiver) } catch (_: Exception) {}
        if (!granted) throw Exception("USB permission denied for ${device.deviceName}")
    }
}
