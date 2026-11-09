package simcam

import (
	"image"
	"image/draw"

	"golang.org/x/image/font"
	"golang.org/x/image/font/inconsolata"
	"golang.org/x/image/math/fixed"
)

const (
	glyphW = 8
	glyphH = 16
)

type glyph [glyphW * glyphH]uint8

// glyphs holds pre-rasterised coverage masks so drawing text is a plain
// alpha blit instead of a trip through font.Drawer every frame.
var glyphs = buildGlyphs()

func buildGlyphs() map[rune]*glyph {
	face := inconsolata.Regular8x16
	out := make(map[rune]*glyph)
	dst := image.NewAlpha(image.Rect(0, 0, glyphW, glyphH))
	add := func(r rune) {
		draw.Draw(dst, dst.Bounds(), image.Transparent, image.Point{}, draw.Src)
		d := &font.Drawer{Dst: dst, Src: image.Opaque, Face: face, Dot: fixed.P(0, face.Ascent)}
		d.DrawString(string(r))
		g := new(glyph)
		copy(g[:], dst.Pix)
		out[r] = g
	}
	for r := rune(32); r < 127; r++ {
		add(r)
	}
	add('°')
	add('×')
	add('©')
	return out
}

func glyphFor(r rune) *glyph {
	if r == ' ' {
		return nil
	}
	if g, ok := glyphs[r]; ok {
		return g
	}
	return glyphs['?']
}
