// Package authn manages the trust anchors under authn.service: it gives each
// anchor child a config schema and validates the certificate an operator pastes.
//
// The engine reads the anchor subtree directly, so authentication keeps working
// with this controller stopped; only UI editing and parse feedback stop.
package authn

import (
	"context"
	"crypto/x509"
	"fmt"
	"log/slog"
	"strings"

	"github.com/projectqai/hydris/builtin"
	"github.com/projectqai/hydris/builtin/controller"
	"github.com/projectqai/hydris/engine"
	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/types/known/structpb"
)

const controllerName = "authn"

func init() {
	builtin.Register(controllerName, Run)
}

func Run(ctx context.Context, logger *slog.Logger, _ string) error {
	classes := []controller.DeviceClass{{
		Class:  engine.AnchorDeviceClass,
		Label:  "Trust Anchor",
		Schema: anchorSchema(),
	}}

	return controller.WatchChildren(ctx, controllerName, engine.AuthnServiceEntity, controllerName, classes,
		func(ctx context.Context, entityID string) error {
			return controller.Run(ctx, controllerName, entityID, func(ctx context.Context, entity *pb.Entity, ready func()) error {
				return runAnchor(ctx, logger, entity, ready)
			})
		})
}

func anchorSchema() *structpb.Struct {
	s, _ := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			engine.AnchorPEMKey: map[string]any{
				"type":           "string",
				"title":          "CA Certificate (PEM)",
				"description":    "Manufacturer CA whose device certificates (IEEE 802.1AR IDevIDs) this node will recognize. Paste the full PEM including the BEGIN and END lines. Recognizing a device is not the same as trusting it: authn.policy still has to map it to an identity entity.",
				"ui:widget":      "textarea",
				"ui:placeholder": "-----BEGIN CERTIFICATE-----",
				"ui:order":       0,
			},
		},
		"required": []any{engine.AnchorPEMKey},
	})
	return s
}

// runAnchor validates the configured PEM. A returned error marks the entity
// Failed, surfacing the bad paste to the operator.
func runAnchor(ctx context.Context, logger *slog.Logger, entity *pb.Entity, ready func()) error {
	raw := entity.GetConfig().GetValue().GetFields()[engine.AnchorPEMKey].GetStringValue()
	if strings.TrimSpace(raw) == "" {
		return fmt.Errorf("no certificate configured")
	}

	certs, err := parseCAs(raw)
	if err != nil {
		return err
	}
	logger.Info("trust anchor active", "entity", entity.Id, "subject", certs[0].Subject.CommonName)

	ready()
	<-ctx.Done()
	return nil
}

// parseCAs runs the same parse the engine uses, so the UI verdict matches what
// it will trust: accepted if any usable CA remains; skips reported only if none do.
func parseCAs(raw string) ([]*x509.Certificate, error) {
	certs, skipped := engine.ParseAnchorCerts(raw)
	if len(certs) == 0 {
		if len(skipped) > 0 {
			return nil, fmt.Errorf("no usable CA certificate: %s", strings.Join(skipped, "; "))
		}
		return nil, fmt.Errorf("no CERTIFICATE block found; paste the PEM including the BEGIN and END lines")
	}
	return certs, nil
}
