package expo.modules.hydrisengine

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import ai.projectq.hydris.HydrisManager
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

class HydrisEngineModule : Module() {

  companion object {
    // HydrisManager uses codes starting at 9000 for HAL runtime requests.
    // We use 8999 for the JS batch permission request to avoid collision.
    private const val PERMISSIONS_REQUEST_CODE = 8999

    private val permissionLock = ReentrantLock()
    @Volatile private var permissionLatch: CountDownLatch? = null

    /**
     * Called from MainActivity.onRequestPermissionsResult to unblock
     * [requestRequiredPermissions]. Safe to call with any request code —
     * codes that don't match are ignored.
     */
    fun onPermissionsResult(requestCode: Int) {
      if (requestCode == PERMISSIONS_REQUEST_CODE) {
        permissionLatch?.countDown()
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("HydrisEngine")

    OnActivityEntersForeground {
      appContext.currentActivity?.let { HydrisManager.setActivity(it) }
    }

    OnActivityEntersBackground {
      HydrisManager.setActivity(null)
    }

    AsyncFunction("requestRequiredPermissions") {
      val activity = appContext.currentActivity
        ?: throw CodedException("No activity available")

      permissionLock.withLock {
        val needed = requiredPermissions().filter {
          ContextCompat.checkSelfPermission(activity, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isEmpty()) return@AsyncFunction true

        val latch = CountDownLatch(1)
        permissionLatch = latch

        activity.runOnUiThread {
          activity.requestPermissions(needed.toTypedArray(), PERMISSIONS_REQUEST_CODE)
        }

        latch.await(60, TimeUnit.SECONDS)
        permissionLatch = null

        requiredPermissions().all {
          ContextCompat.checkSelfPermission(activity, it) == PackageManager.PERMISSION_GRANTED
        }
      }
    }

    AsyncFunction("startEngineService") {
      val context = appContext.reactContext
        ?: throw CodedException("React context not available")
      HydrisManager.startService(context)
      "started"
    }

    AsyncFunction("stopEngine") {
      val context = appContext.reactContext
        ?: throw CodedException("React context not available")
      HydrisManager.stopService(context)
      "stopped"
    }

    AsyncFunction("isRunning") {
      HydrisManager.isRunning()
    }
  }

  private fun requiredPermissions(): List<String> = buildList {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      add(Manifest.permission.BLUETOOTH_SCAN)
      add(Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      add(Manifest.permission.ACCESS_FINE_LOCATION)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      add(Manifest.permission.POST_NOTIFICATIONS)
    }
  }
}
