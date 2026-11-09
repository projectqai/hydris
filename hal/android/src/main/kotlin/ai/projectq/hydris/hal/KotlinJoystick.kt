package ai.projectq.hydris.hal

import android.app.Activity
import android.hardware.input.InputManager
import android.content.Context
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.Window
import org.json.JSONArray
import org.json.JSONObject
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Proxy
import java.util.concurrent.ConcurrentHashMap

/**
 * Kotlin implementation of hydris.PlatformJoystick (gomobile interface).
 *
 * Android delivers gamepad input only to the focused window, so state is captured
 * by watching the current activity's events on their way through, and a pad does
 * nothing while the app is in the background. Reports the layout documented on
 * hal.JoystickState.
 */
class KotlinJoystick(context: Context) : hydris.PlatformJoystick {

    private val inputManager = context.getSystemService(Context.INPUT_SERVICE) as InputManager

    private class PadState {
        val axes = FloatArray(AXIS_COUNT).also {
            it[AXIS_LEFT_TRIGGER] = -1f
            it[AXIS_RIGHT_TRIGGER] = -1f
        }
        val buttons = BooleanArray(BUTTON_KEYS.size)
    }

    private val pads = ConcurrentHashMap<Int, PadState>()

    /** Starts capturing input from this activity's window. */
    fun attach(activity: Activity) {
        val window = activity.window ?: return
        val inner = window.callback ?: return
        if (Proxy.isProxyClass(inner.javaClass)) return

        window.callback = Proxy.newProxyInstance(
            Window.Callback::class.java.classLoader,
            arrayOf(Window.Callback::class.java)
        ) { _, method, args ->
            when (val event = args?.firstOrNull()) {
                is MotionEvent -> if (method.name == "dispatchGenericMotionEvent") onMotion(event)
                is KeyEvent -> if (method.name == "dispatchKeyEvent") onKey(event)
            }
            try {
                if (args == null) method.invoke(inner) else method.invoke(inner, *args)
            } catch (e: InvocationTargetException) {
                throw e.targetException
            }
        } as Window.Callback
    }

    private fun isPad(device: InputDevice?): Boolean {
        if (device == null) return false
        val s = device.sources
        return s and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD ||
            s and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK
    }

    private fun onMotion(e: MotionEvent) {
        if (!isPad(e.device)) return
        val pad = pads.getOrPut(e.deviceId) { PadState() }
        pad.axes[0] = e.getAxisValue(MotionEvent.AXIS_X)
        pad.axes[1] = e.getAxisValue(MotionEvent.AXIS_Y)
        pad.axes[AXIS_LEFT_TRIGGER] = e.getAxisValue(MotionEvent.AXIS_LTRIGGER) * 2 - 1
        pad.axes[3] = e.getAxisValue(MotionEvent.AXIS_Z)
        pad.axes[4] = e.getAxisValue(MotionEvent.AXIS_RZ)
        pad.axes[AXIS_RIGHT_TRIGGER] = e.getAxisValue(MotionEvent.AXIS_RTRIGGER) * 2 - 1
        pad.axes[6] = e.getAxisValue(MotionEvent.AXIS_HAT_X)
        pad.axes[7] = e.getAxisValue(MotionEvent.AXIS_HAT_Y)
    }

    private fun onKey(e: KeyEvent) {
        if (!isPad(e.device)) return
        val index = BUTTON_KEYS.indexOf(e.keyCode)
        if (index < 0) return
        pads.getOrPut(e.deviceId) { PadState() }.buttons[index] = e.action == KeyEvent.ACTION_DOWN
    }

    private fun padIds(): List<Int> =
        inputManager.inputDeviceIds.filter { isPad(inputManager.getInputDevice(it)) }

    /** Stays the same when a pad reconnects, unlike Android's device id. */
    private fun stableId(device: InputDevice): String {
        val clean = device.descriptor.map { if (it.isLetterOrDigit()) it else '-' }.joinToString("")
        return "%04x-%04x-%s".format(device.vendorId, device.productId, clean.take(16))
    }

    override fun listJoysticks(): String {
        val list = JSONArray()
        for (id in padIds()) {
            val device = inputManager.getInputDevice(id) ?: continue
            list.put(JSONObject().apply {
                put("ID", stableId(device))
                put("Name", device.name)
                put("VendorID", device.vendorId)
                put("ProductID", device.productId)
                put("Axes", AXIS_COUNT)
                put("Buttons", BUTTON_KEYS.size)
            })
        }
        return list.toString()
    }

    override fun readJoystick(id: String): String {
        for (deviceId in padIds()) {
            val device = inputManager.getInputDevice(deviceId) ?: continue
            if (stableId(device) != id) continue
            val pad = pads.getOrPut(deviceId) { PadState() }
            return JSONObject().apply {
                put("Axes", JSONArray().apply { pad.axes.forEach { put(it.toDouble()) } })
                put("Buttons", JSONArray().apply { pad.buttons.forEach { put(it) } })
            }.toString()
        }
        return ""
    }

    private companion object {
        const val AXIS_COUNT = 8
        const val AXIS_LEFT_TRIGGER = 2
        const val AXIS_RIGHT_TRIGGER = 5

        val BUTTON_KEYS = intArrayOf(
            KeyEvent.KEYCODE_BUTTON_A,
            KeyEvent.KEYCODE_BUTTON_B,
            KeyEvent.KEYCODE_BUTTON_X,
            KeyEvent.KEYCODE_BUTTON_Y,
            KeyEvent.KEYCODE_BUTTON_L1,
            KeyEvent.KEYCODE_BUTTON_R1,
            KeyEvent.KEYCODE_BUTTON_SELECT,
            KeyEvent.KEYCODE_BUTTON_START,
        )
    }
}
