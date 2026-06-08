package rt

import (
	"strings"

	"github.com/dop251/goja"
	"golang.org/x/net/html"
)

type htmlHandler struct {
	selector string
	element  goja.Callable
	text     goja.Callable
}

func setupHTMLRewriter(vm *goja.Runtime) {
	vm.Set("HTMLRewriter", func(call goja.ConstructorCall) *goja.Object {
		var handlers []htmlHandler

		call.This.Set("on", func(fcall goja.FunctionCall) goja.Value {
			selector := fcall.Argument(0).String()
			obj := fcall.Argument(1).ToObject(vm)

			h := htmlHandler{selector: selector}
			if fn := obj.Get("element"); fn != nil && !goja.IsUndefined(fn) {
				h.element, _ = goja.AssertFunction(fn)
			}
			if fn := obj.Get("text"); fn != nil && !goja.IsUndefined(fn) {
				h.text, _ = goja.AssertFunction(fn)
			}
			handlers = append(handlers, h)
			return call.This
		})

		call.This.Set("transform", func(fcall goja.FunctionCall) goja.Value {
			resp := fcall.Argument(0).ToObject(vm)

			bodyStr := ""
			if v := resp.Get("_body"); v != nil && !goja.IsUndefined(v) {
				bodyStr = v.String()
			}

			processHTML(vm, bodyStr, handlers)

			result := vm.NewObject()
			result.Set("ok", true)
			result.Set("status", 200)
			result.Set("text", func() goja.Value {
				p, resolve, _ := vm.NewPromise()
				_ = resolve(vm.ToValue(bodyStr))
				return vm.ToValue(p)
			})
			return result
		})

		return nil
	})
}

var voidElements = map[string]bool{
	"area": true, "base": true, "br": true, "col": true,
	"embed": true, "hr": true, "img": true, "input": true,
	"link": true, "meta": true, "source": true, "track": true,
	"wbr": true,
}

func processHTML(vm *goja.Runtime, s string, handlers []htmlHandler) {
	z := html.NewTokenizer(strings.NewReader(s))
	var stack []string

	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}

		switch tt {
		case html.StartTagToken, html.SelfClosingTagToken:
			tn, _ := z.TagName()
			tag := string(tn)

			if tt == html.StartTagToken && !voidElements[tag] {
				stack = append(stack, tag)
			}

			for i := range handlers {
				if handlers[i].element != nil && selectorMatches(handlers[i].selector, tag) {
					el := vm.NewObject()
					el.Set("tagName", tag)
					el.Set("removed", false)
					el.Set("remove", func() { el.Set("removed", true) })
					_, _ = handlers[i].element(nil, el)
				}
			}

		case html.EndTagToken:
			tn, _ := z.TagName()
			tag := string(tn)
			for i := len(stack) - 1; i >= 0; i-- {
				if stack[i] == tag {
					stack = stack[:i]
					break
				}
			}

		case html.TextToken:
			text := string(z.Text())
			for i := range handlers {
				if handlers[i].text == nil {
					continue
				}
				if handlers[i].selector == "*" || matchesStack(handlers[i].selector, stack) {
					chunk := vm.NewObject()
					chunk.Set("text", text)
					chunk.Set("lastInTextNode", true)
					_, _ = handlers[i].text(nil, chunk)
				}
			}
		}
	}
}

func selectorMatches(selector, tag string) bool {
	if selector == "*" {
		return true
	}
	return strings.EqualFold(selector, tag)
}

func matchesStack(selector string, stack []string) bool {
	for _, tag := range stack {
		if strings.EqualFold(selector, tag) {
			return true
		}
	}
	return false
}
