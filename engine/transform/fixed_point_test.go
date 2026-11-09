package transform

import (
	"testing"

	pb "github.com/projectqai/proto/go"
	"google.golang.org/protobuf/proto"
)

func ptr[T any](v T) *T { return &v }

func TestFixedPointTransformer(t *testing.T) {
	tests := []struct {
		name string
		in   *pb.Entity
		want *pb.Entity
	}{
		{
			name: "geo",
			in:   &pb.Entity{Geo: &pb.GeoSpatialComponent{LatitudeE7: ptr(int32(-334567890)), LongitudeE7: ptr(int32(1512345678)), AltitudeCm: ptr(int32(-1250))}},
			want: &pb.Entity{Geo: &pb.GeoSpatialComponent{Latitude: -33.456789, Longitude: 151.2345678, Altitude: ptr(-12.5), LatitudeE7: ptr(int32(-334567890)), LongitudeE7: ptr(int32(1512345678)), AltitudeCm: ptr(int32(-1250))}},
		},
		{
			name: "geo partial fixed-point",
			in:   &pb.Entity{Geo: &pb.GeoSpatialComponent{LatitudeE7: ptr(int32(1234567))}},
			want: &pb.Entity{Geo: &pb.GeoSpatialComponent{Latitude: 0.1234567, LatitudeE7: ptr(int32(1234567))}},
		},
		{
			name: "geo fills only the unset coordinate",
			in:   &pb.Entity{Geo: &pb.GeoSpatialComponent{Latitude: 52, LatitudeE7: ptr(int32(1)), LongitudeE7: ptr(int32(1512345678))}},
			want: &pb.Entity{Geo: &pb.GeoSpatialComponent{Latitude: 52, Longitude: 151.2345678, LatitudeE7: ptr(int32(1)), LongitudeE7: ptr(int32(1512345678))}},
		},
		{
			name: "geo already set",
			in:   &pb.Entity{Geo: &pb.GeoSpatialComponent{Latitude: 52, Longitude: 13, Altitude: ptr(30.0), LatitudeE7: ptr(int32(1)), LongitudeE7: ptr(int32(1)), AltitudeCm: ptr(int32(1))}},
			want: &pb.Entity{Geo: &pb.GeoSpatialComponent{Latitude: 52, Longitude: 13, Altitude: ptr(30.0), LatitudeE7: ptr(int32(1)), LongitudeE7: ptr(int32(1)), AltitudeCm: ptr(int32(1))}},
		},
		{
			name: "polar",
			in:   &pb.Entity{Pose: &pb.PoseComponent{Offset: &pb.PoseComponent_Polar{Polar: &pb.PolarOffset{AzimuthCdeg: ptr(uint32(35999)), AzimuthErrorCdeg: ptr(uint32(250))}}}},
			want: &pb.Entity{Pose: &pb.PoseComponent{Offset: &pb.PoseComponent_Polar{Polar: &pb.PolarOffset{Azimuth: 359.99, AzimuthErrorDeg: ptr(2.5), AzimuthCdeg: ptr(uint32(35999)), AzimuthErrorCdeg: ptr(uint32(250))}}}},
		},
		{
			name: "azimuth already set",
			in:   &pb.Entity{Pose: &pb.PoseComponent{Offset: &pb.PoseComponent_Polar{Polar: &pb.PolarOffset{Azimuth: 90, AzimuthCdeg: ptr(uint32(4500))}}}},
			want: &pb.Entity{Pose: &pb.PoseComponent{Offset: &pb.PoseComponent_Polar{Polar: &pb.PolarOffset{Azimuth: 90, AzimuthCdeg: ptr(uint32(4500))}}}},
		},
		{
			name: "battery",
			in:   &pb.Entity{Power: &pb.PowerComponent{BatteryChargePercent: ptr(uint32(40))}},
			want: &pb.Entity{Power: &pb.PowerComponent{BatteryChargeRemaining: ptr(float32(0.4)), BatteryChargePercent: ptr(uint32(40))}},
		},
		{
			name: "confidence",
			in:   &pb.Entity{Classification: &pb.ClassificationComponent{Taxonomy: []*pb.ClassificationTaxonomy{{Confidence: &pb.ClassificationConfidence{ConfidencePercent: ptr(uint32(91))}}}}},
			want: &pb.Entity{Classification: &pb.ClassificationComponent{Taxonomy: []*pb.ClassificationTaxonomy{{Confidence: &pb.ClassificationConfidence{Confidence: 0.91, ConfidencePercent: ptr(uint32(91))}}}}},
		},
		{
			name: "nothing fixed-point",
			in:   &pb.Entity{Geo: &pb.GeoSpatialComponent{Latitude: 52, Longitude: 13}, Power: &pb.PowerComponent{}},
			want: &pb.Entity{Geo: &pb.GeoSpatialComponent{Latitude: 52, Longitude: 13}, Power: &pb.PowerComponent{}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			NewFixedPointTransformer().Resolve(map[string]*pb.Entity{"e": tt.in}, "e", nil)
			if !proto.Equal(tt.in, tt.want) {
				t.Errorf("got %v\nwant %v", tt.in, tt.want)
			}
		})
	}
}
