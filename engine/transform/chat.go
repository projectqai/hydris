package transform

import pb "github.com/projectqai/proto/go"

type ChatTransformer struct {
	nodeEntityID string
}

func NewChatTransformer() *ChatTransformer {
	return &ChatTransformer{}
}

// SetNodeEntityID sets the local node entity ID used to stamp outgoing chat messages.
func (ct *ChatTransformer) SetNodeEntityID(id string) {
	ct.nodeEntityID = id
}

func (ct *ChatTransformer) Validate(head map[string]*pb.Entity, incoming *pb.Entity) error {
	if incoming.Chat == nil {
		return nil
	}

	if (incoming.Chat.Sender == nil || *incoming.Chat.Sender == "") && ct.nodeEntityID != "" {
		incoming.Chat.Sender = &ct.nodeEntityID
	}

	// Self-originated chat messages default to being routable so they
	// reach other nodes.
	if incoming.Chat.Sender != nil && *incoming.Chat.Sender == ct.nodeEntityID && incoming.Routing == nil {
		incoming.Routing = &pb.Routing{
			Channels: []*pb.Channel{{}},
		}
	}

	return nil
}

func (ct *ChatTransformer) Resolve(head map[string]*pb.Entity, changedID string) (upsert []*pb.Entity, remove []string) {
	return nil, nil
}
