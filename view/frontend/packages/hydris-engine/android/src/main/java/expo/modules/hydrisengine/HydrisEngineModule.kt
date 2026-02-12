package expo.modules.hydrisengine

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NoContextException : CodedException("React context not available")

class HydrisEngineModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HydrisEngine")

    AsyncFunction("startEngineService") {
      val context = appContext.reactContext ?: throw NoContextException()
      val intent = Intent(context, HydrisEngineService::class.java)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }

      "started"
    }

    AsyncFunction("stopEngine") {
      val context = appContext.reactContext ?: throw NoContextException()
      context.stopService(Intent(context, HydrisEngineService::class.java))
      "stopped"
    }
  }
}
