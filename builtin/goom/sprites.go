package goom

import (
	"bytes"
	"context"
	_ "embed"
	"image"
	"image/color"
	"image/png"

	"github.com/projectqai/hydris/builtin/artifacts"
	"github.com/projectqai/hydris/builtin/controller"
	pb "github.com/projectqai/proto/go"
)

const (
	enemySpriteID  = controllerName + ".sprite.enemy"
	healthSpriteID = controllerName + ".sprite.health"
	ammoSpriteID   = controllerName + ".sprite.ammo"
)

//go:embed enemy.png
var enemyPNG []byte

func pushSprites(ctx context.Context) error {
	sprites := []struct {
		id  string
		img image.Image
	}{
		{enemySpriteID, loadEnemySprite()},
		{healthSpriteID, generateHealthSprite()},
		{ammoSpriteID, generateAmmoSprite()},
	}

	var entities []*pb.Entity
	for _, sp := range sprites {
		entities = append(entities, &pb.Entity{
			Id:      sp.id,
			Routing: &pb.Routing{Channels: []*pb.Channel{{}}},
			Artifact: &pb.ArtifactComponent{
				Id:          sp.id,
				ContentType: "image/png",
			},
		})
	}
	if err := controller.Push(ctx, controllerName, entities...); err != nil {
		return err
	}

	store := artifacts.Server
	if store == nil {
		return nil
	}
	for _, sp := range sprites {
		var buf bytes.Buffer
		if err := png.Encode(&buf, sp.img); err != nil {
			continue
		}
		_ = store.Local().Put(ctx, sp.id, &buf)
	}
	return nil
}

func loadEnemySprite() image.Image {
	img, err := png.Decode(bytes.NewReader(enemyPNG))
	if err != nil {
		return image.NewRGBA(image.Rect(0, 0, 1, 1))
	}
	return img
}

func generateHealthSprite() image.Image {
	const w, h = 24, 24
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	green := color.RGBA{50, 200, 50, 255}

	cx, cy := w/2, h/2
	armW, armH := 4, 10
	fillRectSprite(img, cx-armW/2, cy-armH, cx+armW/2, cy+armH, green)
	fillRectSprite(img, cx-armH, cy-armW/2, cx+armH, cy+armW/2, green)

	return img
}

func generateAmmoSprite() image.Image {
	const w, h = 20, 24
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	yellow := color.RGBA{220, 190, 50, 255}
	dark := color.RGBA{160, 140, 30, 255}

	fillRectSprite(img, 3, 6, w-3, h-2, yellow)
	fillRectSprite(img, 3, 10, w-3, 14, dark)

	return img
}

func fillRectSprite(img *image.RGBA, x0, y0, x1, y1 int, c color.RGBA) {
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			if x >= 0 && x < img.Bounds().Dx() && y >= 0 && y < img.Bounds().Dy() {
				img.Set(x, y, c)
			}
		}
	}
}
