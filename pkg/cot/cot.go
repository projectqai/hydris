package cot

import (
	"encoding/xml"
	"fmt"
	"strings"
	"time"

	pb "github.com/projectqai/proto/go"
)

// see https://github.com/deptofdefense/AndroidTacticalAssaultKit-CIV/tree/22d11cba15dd5cfe385c0d0790670bc7e9ab7df4/takcot/mitre

// CoT XML message structures
type Event struct {
	XMLName xml.Name `xml:"event"`
	Version string   `xml:"version,attr"`
	Type    string   `xml:"type,attr"`
	How     string   `xml:"how,attr"`
	UID     string   `xml:"uid,attr"`
	Time    string   `xml:"time,attr"`
	Start   string   `xml:"start,attr"`
	Stale   string   `xml:"stale,attr"`
	Point   Point    `xml:"point"`
	Detail  Detail   `xml:"detail"`
}

type Point struct {
	Lat float64 `xml:"lat,attr"`
	Lon float64 `xml:"lon,attr"`
	Hae float64 `xml:"hae,attr"`
	CE  float64 `xml:"ce,attr"`
	LE  float64 `xml:"le,attr"`
}

type Detail struct {
	Contact     Contact      `xml:"contact"`
	Group       Group        `xml:"group"`
	Milsym      *Milsym      `xml:"__milsym,omitempty"`
	Link        *Link        `xml:"link,omitempty"`
	ForceDelete *ForceDelete `xml:"__forcedelete,omitempty"`
}

type ForceDelete struct {
	XMLName xml.Name `xml:"__forcedelete"`
}

type Link struct {
	UID      string `xml:"uid,attr"`
	Type     string `xml:"type,attr,omitempty"`
	Relation string `xml:"relation,attr"`
}

type Contact struct {
	Callsign string `xml:"callsign,attr"`
}

type Group struct {
	Name string `xml:"name,attr"`
	Role string `xml:"role,attr"`
}

type Milsym struct {
	ID string `xml:"id,attr"`
}

// CoTToEntity converts a CoT XML event to a Hydris entity
func CoTToEntity(cotXML []byte, controllerName string, trackerID string) (*pb.Entity, error) {
	var event Event
	if err := xml.Unmarshal(cotXML, &event); err != nil {
		return nil, fmt.Errorf("failed to unmarshal CoT XML: %w", err)
	}

	// Get callsign from contact detail
	callsign := event.Detail.Contact.Callsign
	if callsign == "" {
		callsign = event.UID
	}

	// Convert CoT type to SIDC
	sidc := cotTypeToSIDC(event.Type)

	hae := event.Point.Hae
	entity := &pb.Entity{
		Id:    event.UID,
		Label: &callsign,
		Geo: &pb.GeoSpatialComponent{
			Latitude:  event.Point.Lat,
			Longitude: event.Point.Lon,
			Altitude:  &hae,
		},
		Symbol: &pb.SymbolComponent{
			MilStd2525C: sidc,
		},
		Controller: &pb.Controller{
			Id: &controllerName,
		},
		Track: &pb.TrackComponent{
			Tracker: &trackerID,
		},
	}

	return entity, nil
}

func cotTypeToSIDC(cotType string) string {
	// Parse CoT type format: a-[affiliation]-[dimension]-...
	parts := strings.Split(cotType, "-")
	if len(parts) < 3 {
		return "SUGP----------*"
	}

	// Map affiliation
	affiliation := "U"
	if len(parts) > 1 {
		switch parts[1] {
		case "f":
			affiliation = "F"
		case "h":
			affiliation = "H"
		case "n":
			affiliation = "N"
		case "u":
			affiliation = "U"
		}
	}

	// Map dimension
	dimension := "G"
	if len(parts) > 2 {
		switch parts[2] {
		case "P":
			dimension = "P"
		case "A":
			dimension = "A"
		case "G":
			dimension = "G"
		case "S":
			dimension = "S"
		case "U":
			dimension = "U"
		}
	}

	// Build basic SIDC: S[affiliation][dimension][status]----------
	// Status defaults to P (Present)
	return fmt.Sprintf("S%s%sP----------*", affiliation, dimension)
}

// EntityToCoT converts a Hydris entity to a CoT XML event.
func EntityToCoT(entity *pb.Entity) ([]byte, error) {
	expired := entity.Lifetime != nil && entity.Lifetime.Until != nil &&
		!entity.Lifetime.Until.AsTime().After(time.Now())

	if entity.Geo == nil && !expired {
		return nil, nil
	}

	geo := entity.Geo
	if geo == nil {
		geo = &pb.GeoSpatialComponent{}
	}

	callsign := entity.Id
	if entity.Label != nil && *entity.Label != "" {
		callsign = *entity.Label
	}

	cotType := "a-u-G"
	var milsym *Milsym
	if entity.Symbol != nil && entity.Symbol.GetMilStd2525C() != "" {
		sidc := entity.Symbol.GetMilStd2525C()
		cotType = sidcToCoTType(sidc)
		milsym = &Milsym{ID: padSIDC(sidc)}
	}

	now := time.Now().UTC()
	startTime := now
	staleTime := now.Add(10 * 365 * 24 * time.Hour).Format(time.RFC3339)

	if entity.Lifetime != nil {
		if entity.Lifetime.From != nil {
			startTime = entity.Lifetime.From.AsTime()
		}
		if entity.Lifetime.Until != nil {
			staleTime = entity.Lifetime.Until.AsTime().Format(time.RFC3339)
		}
	}

	if expired {
		startTime = now
		staleTime = now.Add(-time.Minute).Format(time.RFC3339)
	}

	altitude := 0.0
	if geo.Altitude != nil {
		altitude = *geo.Altitude
	}

	event := Event{
		Version: "2.0",
		Type:    cotType,
		How:     "h-g-i-g-o",
		UID:     entity.Id,
		Time:    now.Format(time.RFC3339),
		Start:   startTime.Format(time.RFC3339),
		Stale:   staleTime,
		Point: Point{
			Lat: geo.Latitude,
			Lon: geo.Longitude,
			Hae: altitude,
			CE:  9999999.0,
			LE:  9999999.0,
		},
		Detail: Detail{
			Contact: Contact{Callsign: callsign},
			Group:   Group{Name: "Hydris", Role: "Entity"},
			Milsym:  milsym,
		},
	}

	// Marshal to XML
	xmlData, err := xml.MarshalIndent(event, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal XML: %w", err)
	}

	// Add newline separator for ATAK (no XML header for streaming)
	fullXML := []byte(string(xmlData) + "\n")
	return fullXML, nil
}

// EntityDeleteCoT generates a t-x-d-d CoT event that tells TAK clients
// to remove the entity from the map.
func EntityDeleteCoT(entity *pb.Entity) ([]byte, error) {
	now := time.Now().UTC().Format(time.RFC3339)

	event := Event{
		Version: "2.0",
		Type:    "t-x-d-d",
		How:     "h-g-i-g-o",
		UID:     entity.Id + "-delete",
		Time:    now,
		Start:   now,
		Stale:   now,
		Point: Point{
			CE: 9999999.0,
			LE: 9999999.0,
		},
		Detail: Detail{
			Link: &Link{
				UID:      entity.Id,
				Type:     "none",
				Relation: "none",
			},
			ForceDelete: &ForceDelete{},
		},
	}

	xmlData, err := xml.MarshalIndent(event, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal XML: %w", err)
	}

	return append(xmlData, '\n'), nil
}

func sidcToCoTType(sidc string) string {
	if len(sidc) < 3 {
		return "a-u-G"
	}

	sidc = strings.ToUpper(sidc)

	// Map affiliation (position 1)
	affiliation := "u"
	switch sidc[1] {
	case 'F':
		affiliation = "f"
	case 'H':
		affiliation = "h"
	case 'N':
		affiliation = "n"
	case 'U':
		affiliation = "u"
	}

	// Map dimension (position 2)
	dimension := "G"
	switch sidc[2] {
	case 'P':
		dimension = "P"
	case 'A':
		dimension = "A"
	case 'G':
		dimension = "G"
	case 'S':
		dimension = "S"
	case 'U':
		dimension = "U"
	}

	// Check for equipment/sensor types (positions 4-6)
	// SIDC format: S[affiliation][dimension][status][function]...
	if len(sidc) >= 6 {
		// Position 4 = function ID first character
		// Position 5 = function ID second character
		funcID := sidc[4:6]

		// Equipment categories (position 4 = 'E' or 'I')
		if sidc[4] == 'E' || sidc[4] == 'I' {
			// Check specific equipment types
			switch funcID {
			case "ES": // Equipment/Sensor
				return fmt.Sprintf("a-%s-%s-E-S", affiliation, dimension)
			case "PE": // Equipment/Position Equipment
				return fmt.Sprintf("a-%s-%s-E", affiliation, dimension)
			default:
				// Generic equipment
				return fmt.Sprintf("a-%s-%s-E", affiliation, dimension)
			}
		}

		// Check for units (position 4 = 'U')
		if sidc[4] == 'U' {
			return fmt.Sprintf("a-%s-%s-U", affiliation, dimension)
		}
	}

	// Default to basic affiliation-dimension
	return fmt.Sprintf("a-%s-%s", affiliation, dimension)
}

func padSIDC(sidc string) string {
	const sidcLength = 15
	if len(sidc) >= sidcLength {
		return sidc[:sidcLength]
	}
	return sidc + strings.Repeat("*", sidcLength-len(sidc))
}
