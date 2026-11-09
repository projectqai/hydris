package ai.projectq.hydris.testapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.UserManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature

/**
 * Probes whether the node identity could survive unattended reboots:
 * triggered via adb broadcast (directBootAware, so it also runs Before First
 * Unlock when a lockscreen is set) and logs whether Android Keystore keys can
 * be generated/used and whether CE app storage is readable in that state.
 *
 *   adb shell am broadcast -a ai.projectq.hydris.testapp.KEYSTORE_TEST \
 *     ai.projectq.hydris.testapp/.KeystoreBfuTest
 */
class KeystoreBfuTest : BroadcastReceiver() {
    companion object {
        private const val TAG = "KeystoreBfu"
        private const val KEY = "bfu-test-key"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val um = context.getSystemService(UserManager::class.java)
        Log.i(TAG, "userUnlocked=${um?.isUserUnlocked}")

        // CE (credential-encrypted) app storage: where world.yaml and
        // node-tls.pem live today.
        Log.i(TAG, "ceStorage=" + runCatching {
            val f = File(context.cacheDir, "bfu-probe")
            f.writeText("x")
            f.delete()
            "accessible"
        }.getOrElse { "FAILED: $it" })

        // DE (device-encrypted) app storage: available before first unlock.
        Log.i(TAG, "deStorage=" + runCatching {
            val de = context.createDeviceProtectedStorageContext()
            val f = File(de.filesDir, "bfu-probe")
            f.writeText("x")
            f.delete()
            "accessible"
        }.getOrElse { "FAILED: $it" })

        // Use a key generated in an earlier (unlocked) run, if present.
        Log.i(TAG, "signExisting=" + runCatching {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val priv = ks.getKey(KEY, null) as? PrivateKey
                ?: return@runCatching "no key yet"
            sign(priv)
            "ok"
        }.getOrElse { "FAILED: $it" })

        // Generate a fresh key in the current state (first-boot scenario).
        // With --ez persist true, the key is kept under the fixed name so a
        // later (post-reboot) run can test signExisting.
        val persist = intent.getBooleanExtra("persist", false)
        Log.i(TAG, "generateAndSign=" + runCatching {
            val name = if (persist) KEY else "$KEY-tmp"
            val kpg = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            kpg.initialize(
                KeyGenParameterSpec.Builder(name, KeyProperties.PURPOSE_SIGN)
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setUserAuthenticationRequired(false)
                    .build())
            val kp = kpg.generateKeyPair()
            sign(kp.private)
            if (!persist) {
                // Keep the keystore tidy: this key was only for the probe.
                KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(name)
            }
            "ok"
        }.getOrElse { "FAILED: $it" })
    }

    private fun sign(priv: PrivateKey) {
        Signature.getInstance("SHA256withECDSA").run {
            initSign(priv)
            update("hydris-bfu-probe".toByteArray())
            sign()
        }
    }
}
