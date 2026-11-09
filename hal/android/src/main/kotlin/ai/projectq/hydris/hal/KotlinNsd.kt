package ai.projectq.hydris.hal

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean

/**
 * hydris.PlatformMDNS backed by the system NsdManager, which performs the mDNS
 * traffic in netd, so no multicast lock is needed.
 */
class KotlinNsd(private val context: Context) : hydris.PlatformMDNS {

    companion object {
        private const val TAG = "HydrisNsd"
        private const val SNAPSHOT_INTERVAL_MS = 5000L
        private const val RERESOLVE_INTERVAL_MS = 60000L
    }

    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as? NsdManager

    // --- registration ---

    private var registrationListener: NsdManager.RegistrationListener? = null

    override fun register(instance: String, serviceType: String, port: Long, txtJSON: String) {
        val manager = nsdManager ?: run {
            Log.w(TAG, "NsdManager unavailable")
            return
        }
        unregister()

        val info = NsdServiceInfo().apply {
            serviceName = instance
            this.serviceType = serviceType
            setPort(port.toInt())
            try {
                val txt = JSONObject(txtJSON)
                for (key in txt.keys()) {
                    setAttribute(key, txt.getString(key))
                }
            } catch (e: Exception) {
                Log.w(TAG, "bad TXT json", e)
            }
        }

        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo) {
                Log.i(TAG, "registered ${serviceInfo.serviceName}")
            }
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.w(TAG, "registration failed: $errorCode")
            }
            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {}
            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.w(TAG, "unregistration failed: $errorCode")
            }
        }
        registrationListener = listener
        try {
            manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            Log.w(TAG, "registerService failed", e)
            registrationListener = null
        }
    }

    override fun unregister() {
        val listener = registrationListener ?: return
        registrationListener = null
        try { nsdManager?.unregisterService(listener) } catch (_: Exception) {}
    }

    // --- discovery ---

    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private val peers = ConcurrentHashMap<String, JSONObject>()
    // Last-seen info per service, kept for re-resolution: NsdManager does not
    // signal an address change under an unchanged service name.
    private val found = ConcurrentHashMap<String, NsdServiceInfo>()
    // NsdManager allows only one resolveService at a time; serialize them.
    private val resolveQueue = ConcurrentLinkedQueue<NsdServiceInfo>()
    private val resolving = AtomicBoolean(false)
    @Volatile private var browsing = false

    override fun startBrowse(serviceType: String) {
        val manager = nsdManager ?: run {
            Log.w(TAG, "NsdManager unavailable")
            return
        }
        if (browsing) return
        peers.clear()

        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(st: String) {
                Log.i(TAG, "discovery started for $st")
            }
            override fun onStartDiscoveryFailed(st: String, errorCode: Int) {
                Log.w(TAG, "discovery start failed: $errorCode")
                browsing = false
            }
            override fun onDiscoveryStopped(st: String) {}
            override fun onStopDiscoveryFailed(st: String, errorCode: Int) {
                Log.w(TAG, "discovery stop failed: $errorCode")
            }
            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                found[serviceInfo.serviceName] = serviceInfo
                resolveQueue.add(serviceInfo)
                pumpResolveQueue()
            }
            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                found.remove(serviceInfo.serviceName)
                peers.remove(serviceInfo.serviceName)
            }
        }
        discoveryListener = listener
        browsing = true
        try {
            manager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            Log.w(TAG, "discoverServices failed", e)
            discoveryListener = null
            browsing = false
            return
        }

        Thread {
            var ticks = 0
            while (browsing) {
                Thread.sleep(SNAPSHOT_INTERVAL_MS)
                // Re-resolve known services periodically to pick up address changes.
                ticks++
                if (ticks * SNAPSHOT_INTERVAL_MS >= RERESOLVE_INTERVAL_MS) {
                    ticks = 0
                    found.values.forEach { resolveQueue.add(it) }
                    pumpResolveQueue()
                }
                val arr = JSONArray()
                peers.values.forEach { arr.put(it) }
                try {
                    hydris.Hydris.getHalHandler()?.onMDNSPeers(arr.toString())
                } catch (_: Exception) {}
            }
        }.start()
    }

    override fun stopBrowse() {
        browsing = false
        val listener = discoveryListener ?: return
        discoveryListener = null
        try { nsdManager?.stopServiceDiscovery(listener) } catch (_: Exception) {}
        peers.clear()
        found.clear()
        resolveQueue.clear()
    }

    private fun pumpResolveQueue() {
        if (!resolving.compareAndSet(false, true)) return
        val next = resolveQueue.poll()
        if (next == null) {
            resolving.set(false)
            return
        }
        val manager = nsdManager ?: run {
            resolving.set(false)
            return
        }
        @Suppress("DEPRECATION")
        manager.resolveService(next, object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.d(TAG, "resolve failed for ${serviceInfo.serviceName}: $errorCode")
                resolving.set(false)
                pumpResolveQueue()
            }
            override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                addResolved(serviceInfo)
                resolving.set(false)
                pumpResolveQueue()
            }
        })
    }

    private fun addResolved(info: NsdServiceInfo) {
        @Suppress("DEPRECATION")
        val host = info.host ?: return
        // Prefer IPv4; the Go side federates over IPv4 L2 addresses.
        val addr = host.hostAddress ?: return
        if (host !is Inet4Address && addr.contains(':')) {
            // Keep IPv6 only if nothing better shows up later; still report it.
            Log.d(TAG, "resolved non-IPv4 address $addr for ${info.serviceName}")
        }
        val txt = JSONObject()
        try {
            for ((k, v) in info.attributes) {
                txt.put(k, if (v != null) String(v) else "")
            }
        } catch (_: Exception) {}

        peers[info.serviceName] = JSONObject().apply {
            put("Instance", info.serviceName)
            put("Hostname", host.hostName ?: "")
            put("Addrs", JSONArray().put(addr))
            put("Port", info.port)
            put("Txt", txt)
        }
    }
}
