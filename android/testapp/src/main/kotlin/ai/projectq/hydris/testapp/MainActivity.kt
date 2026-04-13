package ai.projectq.hydris.testapp

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.app.Activity
import android.widget.Button
import android.widget.TextView
import ai.projectq.hydris.HydrisManager
import java.net.NetworkInterface

class MainActivity : Activity() {

    private lateinit var statusText: TextView
    private lateinit var addressText: TextView
    private lateinit var toggleButton: Button
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.statusText)
        addressText = findViewById(R.id.addressText)
        toggleButton = findViewById(R.id.toggleButton)

        toggleButton.setOnClickListener {
            if (HydrisManager.isRunning()) {
                HydrisManager.stopService(this)
            } else {
                HydrisManager.startService(this)
            }
            handler.postDelayed(::updateUI, 1000)
        }

        // Set activity before starting so permission dialogs work.
        HydrisManager.setActivity(this)

        // Auto-start engine
        if (!HydrisManager.isRunning()) {
            HydrisManager.startService(this)
        }

        startPollingStatus()
    }

    override fun onResume() {
        super.onResume()
        HydrisManager.setActivity(this)
    }

    override fun onPause() {
        HydrisManager.setActivity(null)
        super.onPause()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        HydrisManager.onPermissionsResult(requestCode)
    }

    private fun startPollingStatus() {
        handler.post(object : Runnable {
            override fun run() {
                updateUI()
                handler.postDelayed(this, 2000)
            }
        })
    }

    private fun updateUI() {
        val running = HydrisManager.isRunning()
        statusText.text = if (running) "Engine: running" else "Engine: stopped"
        toggleButton.text = if (running) "Stop" else "Start"
        addressText.text = if (running) "http://${getLocalIp()}:50051" else ""
    }

    private fun getLocalIp(): String {
        try {
            for (iface in NetworkInterface.getNetworkInterfaces()) {
                for (addr in iface.inetAddresses) {
                    if (!addr.isLoopbackAddress && addr is java.net.Inet4Address) {
                        return addr.hostAddress ?: "localhost"
                    }
                }
            }
        } catch (_: Exception) {}
        return "localhost"
    }
}
