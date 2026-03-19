package media

import "github.com/pion/webrtc/v4"

// Peer represents a single WHEP viewer connected to a Bridge.
type Peer struct {
	id string
	pc *webrtc.PeerConnection
}
