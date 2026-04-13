package ai.projectq.hydris.hal

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.BatteryManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * Kotlin implementation of hydris.PlatformSensors (gomobile interface).
 * Registers listeners for no-permission sensors and caches latest values.
 * readSensors() returns a JSON snapshot for Go to consume.
 */
class KotlinSensors(private val context: Context) : hydris.PlatformSensors, SensorEventListener {

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    // Cached latest values: sensor type -> float value
    @Volatile private var pressure: Float? = null
    @Volatile private var light: Float? = null
    @Volatile private var proximity: Float? = null
    @Volatile private var ambientTemp: Float? = null
    @Volatile private var humidity: Float? = null
    @Volatile private var magneticField: FloatArray? = null

    // MetricKind / MetricUnit constants matching the proto enums.
    companion object {
        private const val KIND_TEMPERATURE = 1
        private const val KIND_PRESSURE = 2
        private const val KIND_HUMIDITY = 3
        private const val KIND_ILLUMINANCE = 4
        private const val KIND_PERCENTAGE = 41
        private const val KIND_DISTANCE = 60
        private const val KIND_SIGNAL_STRENGTH = 115

        private const val UNIT_CELSIUS = 1
        private const val UNIT_HECTOPASCAL = 10
        private const val UNIT_PERCENT = 20
        private const val UNIT_LUX = 60
        private const val UNIT_METER = 50
    }

    init {
        // Register listeners for all available no-permission sensors.
        // SensorManager.SENSOR_DELAY_NORMAL is ~200ms, fine for slow polling.
        val types = intArrayOf(
            Sensor.TYPE_PRESSURE,
            Sensor.TYPE_LIGHT,
            Sensor.TYPE_PROXIMITY,
            Sensor.TYPE_AMBIENT_TEMPERATURE,
            Sensor.TYPE_RELATIVE_HUMIDITY,
            Sensor.TYPE_MAGNETIC_FIELD,
        )
        for (type in types) {
            sensorManager.getDefaultSensor(type)?.let { sensor ->
                sensorManager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL)
            }
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_PRESSURE -> pressure = event.values[0]
            Sensor.TYPE_LIGHT -> light = event.values[0]
            Sensor.TYPE_PROXIMITY -> proximity = event.values[0]
            Sensor.TYPE_AMBIENT_TEMPERATURE -> ambientTemp = event.values[0]
            Sensor.TYPE_RELATIVE_HUMIDITY -> humidity = event.values[0]
            Sensor.TYPE_MAGNETIC_FIELD -> magneticField = event.values.copyOf()
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    override fun readSensors(): String {
        val arr = JSONArray()
        var id = 1

        // Battery (via sticky broadcast, no permission needed)
        val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        if (batteryIntent != null) {
            val level = batteryIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = batteryIntent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            if (level >= 0 && scale > 0) {
                arr.put(JSONObject().apply {
                    put("ID", id++)
                    put("Label", "Battery Level")
                    put("Kind", KIND_PERCENTAGE)
                    put("Unit", UNIT_PERCENT)
                    put("Value", (level.toDouble() / scale) * 100.0)
                })
            }
            val tempRaw = batteryIntent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1)
            if (tempRaw > 0) {
                arr.put(JSONObject().apply {
                    put("ID", id++)
                    put("Label", "Battery Temperature")
                    put("Kind", KIND_TEMPERATURE)
                    put("Unit", UNIT_CELSIUS)
                    put("Value", tempRaw.toDouble() / 10.0)
                })
            }
        }

        pressure?.let {
            arr.put(JSONObject().apply {
                put("ID", id++)
                put("Label", "Barometer")
                put("Kind", KIND_PRESSURE)
                put("Unit", UNIT_HECTOPASCAL)
                put("Value", it.toDouble())
            })
        }

        light?.let {
            arr.put(JSONObject().apply {
                put("ID", id++)
                put("Label", "Ambient Light")
                put("Kind", KIND_ILLUMINANCE)
                put("Unit", UNIT_LUX)
                put("Value", it.toDouble())
            })
        }

        proximity?.let {
            arr.put(JSONObject().apply {
                put("ID", id++)
                put("Label", "Proximity")
                put("Kind", KIND_DISTANCE)
                put("Unit", UNIT_METER)
                put("Value", it.toDouble())
            })
        }

        ambientTemp?.let {
            arr.put(JSONObject().apply {
                put("ID", id++)
                put("Label", "Ambient Temperature")
                put("Kind", KIND_TEMPERATURE)
                put("Unit", UNIT_CELSIUS)
                put("Value", it.toDouble())
            })
        }

        humidity?.let {
            arr.put(JSONObject().apply {
                put("ID", id++)
                put("Label", "Relative Humidity")
                put("Kind", KIND_HUMIDITY)
                put("Unit", UNIT_PERCENT)
                put("Value", it.toDouble())
            })
        }

        magneticField?.let { values ->
            // Report total field strength in microtesla
            val magnitude = Math.sqrt(
                (values[0] * values[0] + values[1] * values[1] + values[2] * values[2]).toDouble()
            )
            arr.put(JSONObject().apply {
                put("ID", id++)
                put("Label", "Magnetic Field")
                put("Kind", KIND_SIGNAL_STRENGTH)
                put("Unit", 0) // no specific unit for microtesla in proto
                put("Value", magnitude)
            })
        }

        return if (arr.length() > 0) arr.toString() else ""
    }
}
