package rt

import (
	"fmt"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
)

func runHTMLRewriterTest(t *testing.T, js string) goja.Value {
	t.Helper()
	loop := eventloop.NewEventLoop()
	loop.Start()
	t.Cleanup(func() { loop.Terminate() })

	ch := make(chan goja.Value, 1)
	loop.RunOnLoop(func(vm *goja.Runtime) {
		setupGlobals(loop, vm)
		setupFetch(loop, vm)
		vm.Set("__done", func(call goja.FunctionCall) goja.Value {
			if len(call.Arguments) > 0 {
				ch <- call.Argument(0)
			} else {
				ch <- goja.Undefined()
			}
			return goja.Undefined()
		})
		vm.Set("__fail", func(call goja.FunctionCall) goja.Value {
			msg := "JS error"
			if len(call.Arguments) > 0 {
				msg = call.Argument(0).String()
			}
			ch <- vm.NewGoError(fmt.Errorf("%s", msg))
			return goja.Undefined()
		})
		wrapped := "(async()=>{" + js + "\n})()"
		if _, err := vm.RunScript("test.js", wrapped); err != nil {
			t.Errorf("script error: %v", err)
			ch <- vm.NewGoError(err)
		}
	})

	select {
	case v := <-ch:
		return v
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for JS result")
		return nil
	}
}

func TestHTMLRewriter_SanitizeHTML(t *testing.T) {
	v := runHTMLRewriterTest(t, `
		async function sanitizeHTML(html) {
			let text = "";
			const rewriter = new HTMLRewriter()
				.on("br", { element() { text += "\n"; } })
				.on("*", { text(chunk) { text += chunk.text; } });
			await rewriter.transform(new Response(html)).text();
			return text.replace(/\n{3,}/g, "\n\n").trim();
		}

		const r = await sanitizeHTML("<p>Hello <b>world</b></p><br><br><br><p>Second paragraph</p>");
		if (r !== "Hello world\n\nSecond paragraph") {
			__fail("expected 'Hello world\\n\\nSecond paragraph' got '" + r + "'");
		} else {
			__done(r);
		}
	`)
	if v == nil {
		t.Fatal("nil result")
	}
	if err, ok := v.Export().(error); ok {
		t.Fatal(err)
	}
}

func TestHTMLRewriter_TextOnly(t *testing.T) {
	v := runHTMLRewriterTest(t, `
		let text = "";
		const rewriter = new HTMLRewriter()
			.on("*", { text(chunk) { text += chunk.text; } });
		await rewriter.transform(new Response("<div>one</div><span>two</span>")).text();
		if (text !== "onetwo") {
			__fail("expected 'onetwo' got '" + text + "'");
		} else {
			__done(text);
		}
	`)
	if err, ok := v.Export().(error); ok {
		t.Fatal(err)
	}
}

func TestHTMLRewriter_ElementHandler(t *testing.T) {
	v := runHTMLRewriterTest(t, `
		let count = 0;
		const rewriter = new HTMLRewriter()
			.on("br", { element(el) { count++; } });
		await rewriter.transform(new Response("a<br>b<br>c")).text();
		if (count !== 2) {
			__fail("expected 2 br elements, got " + count);
		} else {
			__done("ok");
		}
	`)
	if err, ok := v.Export().(error); ok {
		t.Fatal(err)
	}
}
