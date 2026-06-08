package simcam

import (
	"image"
	"image/color"

	"golang.org/x/image/font"
	"golang.org/x/image/font/inconsolata"
	"golang.org/x/image/math/fixed"
)

var textFace = inconsolata.Regular8x16

func drawText5x7(img *image.RGBA, s string, x, y int, c color.RGBA) int {
	d := &font.Drawer{
		Dst:  img,
		Src:  image.NewUniform(c),
		Face: textFace,
		Dot:  fixed.P(x, y+textFace.Ascent),
	}
	d.DrawString(s)
	return d.Dot.X.Ceil()
}

//nolint:unused
func drawText5x7Scaled(img *image.RGBA, s string, x, y int, c color.RGBA, scale int) int {
	if scale <= 1 {
		return drawText5x7(img, s, x, y, c)
	}

	w := font.MeasureString(textFace, s).Ceil()
	h := textFace.Height

	tmp := image.NewRGBA(image.Rect(0, 0, w, h))
	d := &font.Drawer{
		Dst:  tmp,
		Src:  image.NewUniform(color.White),
		Face: textFace,
		Dot:  fixed.P(0, textFace.Ascent),
	}
	d.DrawString(s)

	for ty := 0; ty < h; ty++ {
		for tx := 0; tx < w; tx++ {
			if tmp.Pix[ty*tmp.Stride+tx*4+3] == 0 {
				continue
			}
			for sy := 0; sy < scale; sy++ {
				for sx := 0; sx < scale; sx++ {
					setPx(img, x+tx*scale+sx, y+ty*scale+sy, c)
				}
			}
		}
	}
	return x + w*scale
}
