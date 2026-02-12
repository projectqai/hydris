package engine

import (
	"context"

	pb "github.com/projectqai/proto/go"

	"connectrpc.com/connect"
)

func (s *WorldServer) Reconcile(ctx context.Context, req *connect.Request[pb.ControllerReconciliationRequest], stream *connect.ServerStream[pb.ControllerReconciliationEvent]) error {
	controllerName := req.Msg.Controller

	consumer := NewConsumer(s, nil, nil, nil)
	s.bus.Register(consumer)
	defer s.bus.Unregister(consumer)

	isLocal := func(e *pb.Entity) bool {
		return e.Controller != nil && e.Controller.Node != nil && *e.Controller.Node == s.nodeID
	}

	// deviceMatchesConfig checks if a device matches a config.
	// The device must always belong to the same controller.
	// The device must declare a Configurable entry whose Key matches the config's Key.
	// If a selector is also set, the device must additionally match it.
	deviceMatchesConfig := func(device *pb.Entity, config *pb.ConfigurationComponent) bool {
		if device.Controller == nil || device.Controller.Id == nil || *device.Controller.Id != config.Controller {
			return false
		}
		// Device must advertise it accepts this config key.
		keyMatch := false
		if device.Device != nil {
			for _, c := range device.Device.Configurable {
				if c.Key == config.Key {
					keyMatch = true
					break
				}
			}
		}
		if !keyMatch {
			return false
		}
		if config.Selector != nil {
			return s.matchesEntityFilter(device, config.Selector)
		}
		return true
	}

	// State: configs for this controller and current match set.
	configs := make(map[string]*pb.Entity)              // configID -> config entity
	matches := make(map[string]map[string]struct{})     // configID -> set of deviceIDs
	deviceIndex := make(map[string]map[string]struct{}) // deviceID -> set of configIDs that match it

	send := func(t pb.ControllerDeviceConfigurationEventType, config *pb.Entity, device *pb.Entity) error {
		return stream.Send(&pb.ControllerReconciliationEvent{
			Event: &pb.ControllerReconciliationEvent_Config{
				Config: &pb.ControllerDeviceConfigurationEvent{
					T:      t,
					Config: config,
					Device: device,
				},
			},
		})
	}

	addMatch := func(configID string, config *pb.Entity, device *pb.Entity) error {
		if matches[configID] == nil {
			matches[configID] = make(map[string]struct{})
		}
		matches[configID][device.Id] = struct{}{}
		if deviceIndex[device.Id] == nil {
			deviceIndex[device.Id] = make(map[string]struct{})
		}
		deviceIndex[device.Id][configID] = struct{}{}
		return send(pb.ControllerDeviceConfigurationEventType_ControllerDeviceConfigurationEventNew, config, device)
	}

	removeMatch := func(configID string, config *pb.Entity, device *pb.Entity) error {
		delete(matches[configID], device.Id)
		if len(matches[configID]) == 0 {
			delete(matches, configID)
		}
		delete(deviceIndex[device.Id], configID)
		if len(deviceIndex[device.Id]) == 0 {
			delete(deviceIndex, device.Id)
		}
		return send(pb.ControllerDeviceConfigurationEventType_ControllerDeviceConfigurationEventRemoved, config, device)
	}

	// Build initial state under read lock.
	// Devices must be local (on this node). Configs are global directives.
	s.l.RLock()
	devices := make(map[string]*pb.Entity)
	for id, e := range s.head {
		if e.Device != nil && isLocal(e) {
			devices[id] = e
		}
		if e.Config != nil && e.Config.Controller == controllerName {
			configs[id] = e
		}
	}
	s.l.RUnlock()

	// Compute initial matches and send New events.
	for configID, config := range configs {
		for _, device := range devices {
			if deviceMatchesConfig(device, config.Config) {
				if err := addMatch(configID, config, device); err != nil {
					return err
				}
			}
		}
	}

	// Process entity changes.
	for {
		entityID, change, _, ok := consumer.popNext()
		if !ok {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-consumer.signal:
				continue
			}
		}

		isRemoval := change == pb.EntityChange_EntityChangeExpired || change == pb.EntityChange_EntityChangeUnobserved

		entity := s.GetHead(entityID)
		if entity == nil && !isRemoval {
			continue
		}

		// --- Handle config entity changes ---
		if entity != nil && entity.Config != nil && entity.Config.Controller == controllerName {
			oldConfig, existed := configs[entityID]

			if isRemoval {
				// Config removed: send Removed for all its matches.
				if existed {
					deviceIDs := make([]string, 0, len(matches[entityID]))
					for deviceID := range matches[entityID] {
						deviceIDs = append(deviceIDs, deviceID)
					}
					for _, deviceID := range deviceIDs {
						device := s.GetHead(deviceID)
						if device == nil {
							device = &pb.Entity{Id: deviceID}
						}
						if err := removeMatch(entityID, oldConfig, device); err != nil {
							return err
						}
					}
					delete(configs, entityID)
				}
				continue
			}

			// Config added or updated.
			configs[entityID] = entity

			// Recalculate device matches for this config.
			newMatches := make(map[string]struct{})
			s.l.RLock()
			for id, dev := range s.head {
				if dev.Device != nil && isLocal(dev) && deviceMatchesConfig(dev, entity.Config) {
					newMatches[id] = struct{}{}
				}
			}
			s.l.RUnlock()

			oldMatches := matches[entityID]
			if oldMatches == nil {
				oldMatches = make(map[string]struct{})
			}

			// Removed matches.
			for deviceID := range oldMatches {
				if _, ok := newMatches[deviceID]; !ok {
					device := s.GetHead(deviceID)
					if device == nil {
						device = &pb.Entity{Id: deviceID}
					}
					if err := removeMatch(entityID, entity, device); err != nil {
						return err
					}
				}
			}

			// New and changed matches.
			for deviceID := range newMatches {
				device := s.GetHead(deviceID)
				if device == nil {
					continue
				}
				if _, wasMatched := oldMatches[deviceID]; wasMatched {
					// Still matches — send Changed if config was updated.
					if existed {
						if err := send(pb.ControllerDeviceConfigurationEventType_ControllerDeviceConfigurationEventChanged, entity, device); err != nil {
							return err
						}
					}
				} else {
					// New match.
					if err := addMatch(entityID, entity, device); err != nil {
						return err
					}
				}
			}
			continue
		}

		// Config removed (entity gone from head or no longer has Config for us).
		if isRemoval || entity == nil {
			if oldConfig, existed := configs[entityID]; existed {
				for deviceID := range matches[entityID] {
					device := s.GetHead(deviceID)
					if device == nil {
						device = &pb.Entity{Id: deviceID}
					}
					if err := removeMatch(entityID, oldConfig, device); err != nil {
						return err
					}
				}
				delete(configs, entityID)
				continue
			}
		}

		// --- Handle device entity changes ---
		if configIDs, ok := deviceIndex[entityID]; ok && isRemoval {
			// Device removed: send Removed for all configs it matched.
			for configID := range configIDs {
				config := configs[configID]
				if config == nil {
					continue
				}
				device := &pb.Entity{Id: entityID}
				if err := removeMatch(configID, config, device); err != nil {
					return err
				}
			}
			continue
		}

		if entity != nil && entity.Device != nil && isLocal(entity) {
			// Device added or updated: check all configs.
			for configID, config := range configs {
				wasMatched := false
				if m, ok := matches[configID]; ok {
					_, wasMatched = m[entityID]
				}
				nowMatches := deviceMatchesConfig(entity, config.Config)

				if wasMatched && !nowMatches {
					if err := removeMatch(configID, config, entity); err != nil {
						return err
					}
				} else if !wasMatched && nowMatches {
					if err := addMatch(configID, config, entity); err != nil {
						return err
					}
				} else if wasMatched && nowMatches {
					// Device updated, still matches.
					if err := send(pb.ControllerDeviceConfigurationEventType_ControllerDeviceConfigurationEventChanged, config, entity); err != nil {
						return err
					}
				}
			}
		}
	}
}
