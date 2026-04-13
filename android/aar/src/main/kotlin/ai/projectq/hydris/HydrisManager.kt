package ai.projectq.hydris

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import hydris.Hydris
import ai.projectq.hydris.hal.KotlinBLE
import ai.projectq.hydris.hal.KotlinSerial
import ai.projectq.hydris.hal.KotlinSensors
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

object HydrisManager {
    private const val TAG = "HydrisManager"
    private const val PERMISSION_REQUEST_BASE = 9000

    @Volatile
    private var activityRef: WeakReference<Activity>? = null
    private val requestCode = AtomicInteger(PERMISSION_REQUEST_BASE)
    private val pendingRequests = mutableMapOf<Int, CountDownLatch>()

    /**
     * Set the current activity so the library can request permissions on demand.
     * Call from your Activity's onResume, clear in onPause.
     */
    fun setActivity(activity: Activity?) {
        activityRef = activity?.let { WeakReference(it) }
    }

    /**
     * Request a runtime permission if not already granted.
     * Blocks the calling thread until the user responds.
     * Returns true if permission is granted.
     * Must NOT be called from the main thread.
     */
    fun requestPermission(permission: String): Boolean {
        val activity = activityRef?.get()
        if (activity == null) {
            Log.w(TAG, "No activity to request permission: $permission")
            return false
        }

        if (ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED) {
            return true
        }

        val code = requestCode.getAndIncrement()
        val latch = CountDownLatch(1)
        synchronized(pendingRequests) {
            pendingRequests[code] = latch
        }

        activity.runOnUiThread {
            activity.requestPermissions(arrayOf(permission), code)
        }

        // Wait up to 60 seconds for user response
        latch.await(60, TimeUnit.SECONDS)

        synchronized(pendingRequests) {
            pendingRequests.remove(code)
        }

        return ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Request multiple runtime permissions in a single system dialog.
     * Filters out already-granted permissions. Returns true if all are granted.
     * Must NOT be called from the main thread.
     */
    fun requestPermissions(permissions: List<String>): Boolean {
        val activity = activityRef?.get()
        if (activity == null) {
            Log.w(TAG, "No activity to request permissions")
            return false
        }

        val needed = permissions.filter {
            ContextCompat.checkSelfPermission(activity, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isEmpty()) return true

        val code = requestCode.getAndIncrement()
        val latch = CountDownLatch(1)
        synchronized(pendingRequests) {
            pendingRequests[code] = latch
        }

        activity.runOnUiThread {
            activity.requestPermissions(needed.toTypedArray(), code)
        }

        latch.await(60, TimeUnit.SECONDS)

        synchronized(pendingRequests) {
            pendingRequests.remove(code)
        }

        return permissions.all {
            ContextCompat.checkSelfPermission(activity, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Call from your Activity's onRequestPermissionsResult to unblock waiting providers.
     */
    fun onPermissionsResult(requestCode: Int) {
        synchronized(pendingRequests) {
            pendingRequests[requestCode]?.countDown()
        }
    }

    /**
     * Register all peripheral providers with the Go engine.
     * Called internally by HydrisEngineService before starting the engine.
     */
    fun registerProviders(context: Context) {
        Log.d(TAG, "Registering HAL platform")
        Hydris.setHalPlatform(
            KotlinBLE(context, ::requestPermission, ::requestPermissions),
            KotlinSerial(context),
            KotlinSensors(context),
        )
        Log.d(TAG, "HAL platform registered")
    }

    fun startService(context: Context) {
        val intent = Intent(context, HydrisEngineService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    fun stopService(context: Context) {
        val intent = Intent(context, HydrisEngineService::class.java)
        context.stopService(intent)
    }

    fun isRunning(): Boolean = Hydris.isEngineRunning()

    fun getStatus(): String = Hydris.getEngineStatus()
}
