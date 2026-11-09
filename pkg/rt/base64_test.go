package rt

import "testing"

func TestBase64BinaryStringsRoundTrip(t *testing.T) {
	js := `
		let s = ""; for (let i = 0; i < 256; i++) s += String.fromCharCode(i);
		const enc = btoa(s);
		const dec = atob(enc);
		const back = new Uint8Array(dec.length); for (let i = 0; i < dec.length; i++) back[i] = dec.charCodeAt(i);
		let same = back.length === 256;
		for (let i = 0; i < 256 && same; i++) same = back[i] === i;
		__done({ enc, same });
	`
	result, _ := runAsync(t, nil, js)
	got := awaitResult(t, result).Export().(map[string]any)
	if got["same"] != true {
		t.Error("atob(btoa(binary string)) did not round-trip all 256 byte values")
	}
	if enc, _ := got["enc"].(string); len(enc) < 8 || enc[:8] != "AAECAwQF" {
		t.Errorf("btoa = %q, want standard base64 of the raw bytes", enc)
	}
}

func TestAtobIsForgiving(t *testing.T) {
	js := `
		const fails = (s) => { try { atob(s); return "decoded"; } catch (e) { return e.name; } };
		__done({
			unpadded: atob("aGVsbG8"),
			wrapped: atob("aGVs\nbG8=\n"),
			spaced: atob(" aGVs bG8 "),
			padded: atob("aGVsbG8="),
			bad: fails("a"),
			junk: fails("aGVs!bG8"),
		});
	`
	result, _ := runAsync(t, nil, js)
	got := awaitResult(t, result).Export().(map[string]any)
	for _, k := range []string{"unpadded", "wrapped", "spaced", "padded"} {
		if got[k] != "hello" {
			t.Errorf("%s: atob = %q, want hello", k, got[k])
		}
	}
	for _, k := range []string{"bad", "junk"} {
		if got[k] != "TypeError" {
			t.Errorf("%s: atob = %v, want TypeError", k, got[k])
		}
	}
}
