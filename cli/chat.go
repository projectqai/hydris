package cli

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/projectqai/hydris/goclient"
	pb "github.com/projectqai/proto/go"
	"github.com/spf13/cobra"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var (
	chatChannel  string
	chatCallsign string
	chatTo       string
)

func init() {
	chatCmd := &cobra.Command{
		Use:               "chat",
		Aliases:           []string{"c"},
		Short:             "chat messaging",
		PersistentPreRunE: connect,
		RunE:              runChat,
	}
	AddConnectionFlags(chatCmd)
	chatCmd.PersistentFlags().StringVar(&chatChannel, "channel", "", "routing channel name")
	chatCmd.PersistentFlags().StringVar(&chatCallsign, "name", "", "sender callsign (default: node label)")
	chatCmd.PersistentFlags().StringVar(&chatTo, "to", "", "recipient entity ID")

	sendCmd := &cobra.Command{
		Use:   "send [message]",
		Short: "send a chat message",
		Args:  cobra.MinimumNArgs(1),
		RunE:  runChatSend,
	}

	historyCmd := &cobra.Command{
		Use:   "history",
		Short: "show chat history",
		RunE:  runChatHistory,
	}

	chatCmd.AddCommand(sendCmd, historyCmd)
	CMD.AddCommand(chatCmd)
}

// runChat is the default: streams live chat and reads stdin to send.
func runChat(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)
	ctx := cmd.Context()

	callsign, nodeID := resolveIdentity(ctx, client)

	// Start live stream in background (replays existing + live)
	go streamChat(ctx, client)

	fmt.Fprintln(os.Stderr, "--- type message + enter to send, ctrl-c to quit ---")

	// Read stdin and send messages
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		text := strings.TrimSpace(scanner.Text())
		if text == "" {
			continue
		}
		if err := sendMessage(ctx, client, text, callsign, nodeID); err != nil {
			fmt.Fprintf(os.Stderr, "send error: %v\n", err)
		}
	}

	return scanner.Err()
}

func runChatSend(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)
	ctx := cmd.Context()

	callsign, nodeID := resolveIdentity(ctx, client)
	text := strings.Join(args, " ")

	return sendMessage(ctx, client, text, callsign, nodeID)
}

func runChatHistory(cmd *cobra.Command, args []string) error {
	client := pb.NewWorldServiceClient(conn)
	return printHistory(cmd.Context(), client)
}

func resolveIdentity(ctx context.Context, client pb.WorldServiceClient) (callsign, nodeID string) {
	callsign = chatCallsign
	if callsign == "" {
		resp, err := client.GetLocalNode(ctx, &pb.GetLocalNodeRequest{})
		if err == nil && resp.Entity != nil {
			if resp.Entity.Label != nil {
				callsign = *resp.Entity.Label
			}
			if resp.Entity.Controller != nil && resp.Entity.Controller.Node != nil {
				nodeID = *resp.Entity.Controller.Node
			}
		}
	}
	if callsign == "" {
		callsign = "cli"
	}
	return callsign, nodeID
}

func sendMessage(ctx context.Context, client pb.WorldServiceClient, text, callsign, nodeID string) error {
	now := time.Now()
	entityID := fmt.Sprintf("hydris.chat.%s.%d", nodeID, now.UnixNano())
	if nodeID == "" {
		entityID = fmt.Sprintf("hydris.chat.cli.%d", now.UnixNano())
	}

	entity := &pb.Entity{
		Id:      entityID,
		Label:   &callsign,
		Routing: &pb.Routing{Channels: []*pb.Channel{{Name: chatChannel}}},
		Chat: &pb.ChatComponent{
			Message: text,
		},
		Lifetime: &pb.Lifetime{
			From:  timestamppb.New(now),
			Until: timestamppb.New(now.Add(3 * time.Hour)),
			Fresh: timestamppb.New(now),
		},
	}

	if chatTo != "" {
		entity.Chat.To = proto.String(chatTo)
	}

	_, err := client.Push(ctx, &pb.EntityChangeRequest{Changes: []*pb.Entity{entity}})
	return err
}

func printHistory(ctx context.Context, client pb.WorldServiceClient) error {
	req := &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{39}, // EntityComponentChat
		},
	}
	if chatChannel != "" {
		req.Filter.Channel = &pb.ChannelFilter{Name: chatChannel}
	}

	resp, err := client.ListEntities(ctx, req)
	if err != nil {
		return fmt.Errorf("list entities: %w", err)
	}

	sort.Slice(resp.Entities, func(i, j int) bool {
		return entityFromTime(resp.Entities[i]).Before(entityFromTime(resp.Entities[j]))
	})

	for _, entity := range resp.Entities {
		printChatEntity(entity)
	}
	return nil
}

func entityFromTime(e *pb.Entity) time.Time {
	if e.Lifetime != nil && e.Lifetime.From != nil {
		return e.Lifetime.From.AsTime()
	}
	return time.Time{}
}

func chatFilter() *pb.ListEntitiesRequest {
	req := &pb.ListEntitiesRequest{
		Filter: &pb.EntityFilter{
			Component: []uint32{39},
		},
	}
	if chatChannel != "" {
		req.Filter.Channel = &pb.ChannelFilter{Name: chatChannel}
	}
	return req
}

func streamChat(ctx context.Context, client pb.WorldServiceClient) {
	stream, err := goclient.WatchEntitiesWithRetry(ctx, client, chatFilter())
	if err != nil {
		fmt.Fprintf(os.Stderr, "watch error: %v\n", err)
		return
	}

	seen := make(map[string]struct{})

	for {
		event, err := stream.Recv()
		if err != nil {
			if err == io.EOF || ctx.Err() != nil {
				return
			}
			fmt.Fprintf(os.Stderr, "stream error: %v\n", err)
			return
		}

		if event.Entity == nil || event.Entity.Chat == nil {
			continue
		}
		if event.T == pb.EntityChange_EntityChangeExpired {
			continue
		}
		if _, ok := seen[event.Entity.Id]; ok {
			continue
		}
		seen[event.Entity.Id] = struct{}{}

		printChatEntity(event.Entity)
	}
}

func printChatEntity(entity *pb.Entity) {
	chat := entity.Chat
	if chat == nil {
		return
	}

	ts := ""
	if entity.Lifetime != nil && entity.Lifetime.From != nil {
		ts = entity.Lifetime.From.AsTime().Local().Format("15:04:05")
	}

	sender := "?"
	if entity.Label != nil && *entity.Label != "" {
		sender = *entity.Label
	}

	to := ""
	if chat.To != nil && *chat.To != "" {
		to = fmt.Sprintf(" -> %s", *chat.To)
	}

	fmt.Printf("[%s] %s%s: %s\n", ts, sender, to, chat.Message)
}
