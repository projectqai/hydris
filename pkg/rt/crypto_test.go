package rt

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"testing"

	"github.com/dop251/goja"
)

const (
	vectorKey   = "2001efc8fde812e6b97b3db2a1923757d6826703c788ef0f38e3e3adad1c5c85"
	vectorFrame = "8130c64c3f765cd7d37f07943591263032fa830f7ec9279f0be35fc26187939d1091"
)

func TestSubtleAESGCMAndHKDFMatchStdlib(t *testing.T) {
	js := `
		const hex = b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join("");
		const root = new Uint8Array(32); for (let i = 0; i < 32; i++) root[i] = i;
		const info = new TextEncoder().encode("test-info");
		const hk = await crypto.subtle.importKey("raw", root, "HKDF", false, ["deriveBits"]);
		const dk = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info }, hk, 256));
		const aad = new Uint8Array([1, 2, 3, 4]);
		const iv = new Uint8Array(12); for (let i = 0; i < 12; i++) iv[i] = i;
		const key = await crypto.subtle.importKey("raw", dk, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
		const params = { name: "AES-GCM", iv, additionalData: aad };
		const ct = new Uint8Array(await crypto.subtle.encrypt(params, key, new TextEncoder().encode("hello sealed world")));
		const back = new TextDecoder().decode(await crypto.subtle.decrypt(params, key, ct));
		const tampered = ct.slice(); tampered[2] ^= 1;
		let rejected = false;
		try { await crypto.subtle.decrypt(params, key, tampered); } catch (e) { rejected = true; }
		const wrongAAD = { ...params, additionalData: new Uint8Array([1, 2, 3, 5]) };
		let aadRejected = false;
		try { await crypto.subtle.decrypt(wrongAAD, key, ct); } catch (e) { aadRejected = true; }
		__done({ dk: hex(dk), frame: hex(ct), back, rejected, aadRejected });
	`
	result, _ := runAsync(t, nil, js)
	got, ok := awaitResult(t, result).Export().(map[string]any)
	if !ok {
		t.Fatal("script did not return an object")
	}

	root := make([]byte, 32)
	for i := range root {
		root[i] = byte(i)
	}
	dk, err := hkdf.Key(sha256.New, root, nil, "test-info", 32)
	if err != nil {
		t.Fatal(err)
	}
	if hex.EncodeToString(dk) != vectorKey {
		t.Fatalf("stdlib HKDF disagrees with the recorded vector: %x", dk)
	}
	nonce := make([]byte, 12)
	for i := range nonce {
		nonce[i] = byte(i)
	}
	block, _ := aes.NewCipher(dk)
	gcm, _ := cipher.NewGCM(block)
	frame := gcm.Seal(nil, nonce, []byte("hello sealed world"), []byte{1, 2, 3, 4})
	if hex.EncodeToString(frame) != vectorFrame {
		t.Fatalf("stdlib AES-GCM disagrees with the recorded vector: %x", frame)
	}

	if got["dk"] != vectorKey {
		t.Errorf("HKDF in runtime = %v, want %s", got["dk"], vectorKey)
	}
	if got["frame"] != vectorFrame {
		t.Errorf("AES-GCM in runtime = %v, want %s", got["frame"], vectorFrame)
	}
	if got["back"] != "hello sealed world" {
		t.Errorf("decrypt = %q", got["back"])
	}
	if got["rejected"] != true {
		t.Error("a tampered ciphertext must be rejected")
	}
	if got["aadRejected"] != true {
		t.Error("changed associated data must be rejected")
	}
}

func TestSubtleAESGCMRejectsShortTag(t *testing.T) {
	js := `
		const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, ["encrypt"]);
		try {
			await crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(12), tagLength: 64 }, key, new Uint8Array(4));
			__done("accepted");
		} catch (e) { __done("rejected"); }
	`
	result, _ := runAsync(t, nil, js)
	if v := awaitResult(t, result).String(); v != "rejected" {
		t.Errorf("64-bit tag: %s, want rejected (Go's GCM refuses tags under 96 bits)", v)
	}
}

func TestSubtleDecryptRejectionIsHandledBeforeTrackerRuns(t *testing.T) {
	vm := goja.New()
	setupCrypto(vm)
	var unhandled int
	vm.SetPromiseRejectionTracker(func(_ *goja.Promise, op goja.PromiseRejectionOperation) {
		if op == goja.PromiseRejectionReject {
			unhandled++
		}
	})

	v, err := vm.RunString(`(async () => {
		const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, ["decrypt"]);
		try {
			await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(12) }, key, new Uint8Array(16));
			return false;
		} catch (_) {
			return true;
		}
	})()`)
	if err != nil {
		t.Fatal(err)
	}
	p := v.Export().(*goja.Promise)
	if p.State() != goja.PromiseStateFulfilled || p.Result().Export() != true {
		t.Fatalf("decrypt catch: state %v, result %v", p.State(), p.Result())
	}
	if unhandled != 0 {
		t.Fatalf("decrypt caused %d unhandled rejection notifications", unhandled)
	}

	vm.Set("rejectImmediately", func() goja.Value {
		p, _, reject := vm.NewPromise()
		_ = reject(vm.ToValue("invalid ciphertext"))
		return vm.ToValue(p)
	})
	_, err = vm.RunString(`(async () => {
		try { await rejectImmediately(); } catch (_) { return true; }
	})()`)
	if err != nil {
		t.Fatal(err)
	}
	if unhandled != 1 {
		t.Fatalf("immediate native rejection caused %d unhandled notifications, want 1", unhandled)
	}
}

func TestSubtleFailuresRejectWithDOMExceptionNames(t *testing.T) {
	js := `
		const name = async (p) => { try { await p; return "fulfilled"; } catch (e) { return e.name; } };
		const key = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-GCM", false, ["encrypt", "decrypt"]);
		const hk = await crypto.subtle.importKey("raw", new Uint8Array(32), "HKDF", false, ["deriveBits"]);
		__done({
			badHash: await name(crypto.subtle.deriveBits({ name: "HKDF", hash: "MD5", salt: new Uint8Array(0), info: new Uint8Array(0) }, hk, 256)),
			badFormat: await name(crypto.subtle.importKey("jwk", {}, "HMAC", false, ["sign"])),
			wrongKey: await name(crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new Uint8Array(0) }, key, 256)),
			tampered: await name(crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(12) }, key, new Uint8Array(16))),
			badLength: await name(crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new Uint8Array(0) }, hk, 12)),
		});
	`
	result, _ := runAsync(t, nil, js)
	got, ok := awaitResult(t, result).Export().(map[string]any)
	if !ok {
		t.Fatal("script did not return an object")
	}
	want := map[string]string{
		"badHash":   "NotSupportedError",
		"badFormat": "NotSupportedError",
		"wrongKey":  "InvalidAccessError",
		"tampered":  "OperationError",
		"badLength": "OperationError",
	}
	for k, w := range want {
		if got[k] != w {
			t.Errorf("%s: rejected with %v, want %s", k, got[k], w)
		}
	}
}

func TestSubtleSHA384(t *testing.T) {
	js := `
		const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
		const data = new TextEncoder().encode("abc");
		const key = await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "HMAC", hash: "SHA-384" }, false, ["sign"]);
		__done({
			digest: hex(await crypto.subtle.digest("SHA-384", data)),
			hmac: hex(await crypto.subtle.sign("HMAC", key, data)),
		});
	`
	result, _ := runAsync(t, nil, js)
	got, ok := awaitResult(t, result).Export().(map[string]any)
	if !ok {
		t.Fatal("script did not return an object")
	}
	sum := sha512.Sum384([]byte("abc"))
	if want := hex.EncodeToString(sum[:]); got["digest"] != want {
		t.Errorf("digest = %v, want %s", got["digest"], want)
	}
	mac := hmac.New(sha512.New384, make([]byte, 32))
	mac.Write([]byte("abc"))
	if want := hex.EncodeToString(mac.Sum(nil)); got["hmac"] != want {
		t.Errorf("hmac = %v, want %s", got["hmac"], want)
	}
}
