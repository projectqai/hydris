package simcam

import (
	"math"
	"strconv"
	"time"
)

const (
	tapeH   = 22
	statusH = 20
)

var (
	colorHUD    = rgb(236, 240, 236)
	colorHUDDim = rgb(170, 176, 170)
	colorAccent = rgb(255, 214, 64)
	colorLive   = rgb(232, 52, 52)
)

func drawHUD(c *canvas, v *view, p poseSnapshot, now time.Time) {
	drawCompassTape(c, v, p.Pan+p.Yaw)
	drawReticle(c)
	drawClock(c, now)
	drawStatus(c, p)
	drawAttribution(c)
}

func drawAttribution(c *canvas) {
	x := c.w - textWidth(tileAttribution) - 6
	c.text(tileAttribution, x+1, c.h-statusH-glyphH-1, colorBlack)
	c.text(tileAttribution, x, c.h-statusH-glyphH-2, colorHUDDim)
}

// tapeSteps pairs a labelled step with its minor tick spacing (degrees).
var tapeSteps = [][2]int{{1, 0}, {2, 1}, {5, 1}, {10, 5}, {15, 5}, {30, 10}, {45, 15}, {90, 30}}

func drawCompassTape(c *canvas, v *view, pan float64) {
	c.fillRect(0, 0, c.w, tapeH, colorBlack, 150)

	pxPerDeg := v.focal * deg2rad
	major, minor := 90, 30
	for _, s := range tapeSteps {
		if float64(s[0])*pxPerDeg >= 56 {
			major, minor = s[0], s[1]
			break
		}
	}
	if minor == 0 {
		minor = major
	}

	halfFov := math.Atan(v.cx/v.focal) / deg2rad
	start := int(math.Floor((pan-halfFov)/float64(minor))) * minor
	for a := start; float64(a) <= pan+halfFov+float64(minor); a += minor {
		off := wrapSigned(float64(a) - pan)
		if math.Abs(off) >= 89 {
			continue
		}
		// true projection, so ticks line up with the scene at the horizon
		x := int(math.Round(v.cx + v.focal*math.Tan(off*deg2rad)))
		ang := ((a % 360) + 360) % 360
		if ang%major != 0 {
			c.vline(x, 0, 4, colorHUDDim, 256)
			continue
		}
		c.vline(x, 0, 7, colorHUD, 256)
		label := cardinalLabel(ang)
		col := colorAccent
		if label == "" {
			label, col = pad3(ang), colorHUD
		}
		c.text(label, x-textWidth(label)/2, 6, col)
	}

	// heading box over the centre of the tape
	hd := pad3(int(math.Round(wrap360(pan)))%360) + "°"
	bw := textWidth(hd) + 8
	bx := int(v.cx) - bw/2
	c.fillRect(bx, 0, bx+bw, tapeH, colorBlack, 230)
	c.hline(bx, bx+bw-1, tapeH-1, colorAccent, 256)
	c.vline(bx, 0, tapeH-1, colorAccent, 256)
	c.vline(bx+bw-1, 0, tapeH-1, colorAccent, 256)
	c.text(hd, bx+4, 3, colorAccent)
	for dy := 0; dy < 4; dy++ {
		c.hline(int(v.cx)-3+dy, int(v.cx)+3-dy, tapeH+dy, colorAccent, 256)
	}
}

func cardinalLabel(ang int) string {
	switch ang {
	case 0:
		return "N"
	case 45:
		return "NE"
	case 90:
		return "E"
	case 135:
		return "SE"
	case 180:
		return "S"
	case 225:
		return "SW"
	case 270:
		return "W"
	case 315:
		return "NW"
	}
	return ""
}

func drawReticle(c *canvas) {
	cx, cy := c.w/2, c.h/2
	const gap, arm = 6, 14
	for _, pass := range []struct {
		off int
		col uint32
		a   uint32
	}{{1, colorBlack, 140}, {0, colorHUD, 240}} {
		o := pass.off
		c.hline(cx-gap-arm+o, cx-gap+o, cy+o, pass.col, pass.a)
		c.hline(cx+gap+o, cx+gap+arm+o, cy+o, pass.col, pass.a)
		c.vline(cx+o, cy-gap-arm+o, cy-gap+o, pass.col, pass.a)
		c.vline(cx+o, cy+gap+o, cy+gap+arm+o, pass.col, pass.a)
	}
	c.blendPx(cx, cy, colorHUD, 256)

	// corner brackets framing the centre of the image
	bw, bh, l := c.w/8, c.h/8, 10
	for _, sx := range []int{-1, 1} {
		for _, sy := range []int{-1, 1} {
			x, y := cx+sx*bw, cy+sy*bh
			c.hline(min(x, x-sx*l), max(x, x-sx*l), y, colorHUD, 150)
			c.vline(x, min(y, y-sy*l), max(y, y-sy*l), colorHUD, 150)
		}
	}
}

func drawClock(c *canvas, now time.Time) {
	s := now.Format("15:04:05")
	x := c.w - textWidth(s) - 6
	y := tapeH + 6
	c.shadowText(s, x, y, colorHUD)
	// pulse once per second so a frozen stream is obvious
	r := 3.5
	if now.Nanosecond() < 5e8 {
		r = 4.5
	}
	cx, cy := float64(x-10), float64(y+8)
	for py := int(cy - r - 1); py <= int(cy+r+1); py++ {
		for px := int(cx - r - 1); px <= int(cx+r+1); px++ {
			d := math.Hypot(float64(px)+0.5-cx, float64(py)+0.5-cy) - r
			c.blendPx(px, py, colorLive, unit256(0.5-d))
		}
	}
}

func drawStatus(c *canvas, p poseSnapshot) {
	y0 := c.h - statusH
	c.fillRect(0, y0, c.w, c.h, colorBlack, 150)
	ty := y0 + (statusH-glyphH)/2

	info := "AZ " + formatDeg(wrap360(p.Pan+p.Yaw), 1) +
		"  EL " + formatDeg(p.Tilt, 1) +
		"  FOV " + formatDeg(p.FovDeg, 1) +
		"  " + formatZoom(p.Zoom, p.RangeMax)
	infoX := c.w - textWidth(info) - 6
	c.text(info, infoX, ty, colorHUD)

	if p.Label != "" {
		maxChars := (infoX - 18) / glyphW
		label := []rune(p.Label)
		if maxChars < 1 {
			return
		}
		if len(label) > maxChars {
			label = append(label[:maxChars-1], '~')
		}
		c.text(string(label), 6, ty, colorAccent)
	}
}

// -- formatting ---------------------------------------------------------------

func pad3(n int) string {
	s := strconv.Itoa(n)
	for len(s) < 3 {
		s = "0" + s
	}
	return s
}

func formatDeg(d float64, prec int) string {
	s := strconv.FormatFloat(d, 'f', prec, 64)
	if s == "-0.0" {
		s = "0.0"
	}
	return s + "°"
}

// formatZoom shows the zoom position as 1.0×–10.0× across the range.
func formatZoom(zoom, rangeMax float64) string {
	z := 1.0
	if rangeMax > 0 {
		z += clamp(zoom/rangeMax, 0, 1) * 9
	}
	return strconv.FormatFloat(z, 'f', 1, 64) + "×"
}
