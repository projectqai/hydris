# Unsafe LoRa

Decodes unauthenticated hydris frames from LoRa port 0x4E and pushes them into
the world model. Nothing verifies the sender: anyone with a radio in range can
inject frames so don't actually use this. A real plugin would put authentication on top.

## What a sender can do

A frame is a protobuf `Entity` (after one flags byte, which must be zero). The
plugin forwards it as-is, then sets `controller`, `routing`, `link` and
`lifetime` itself. A frame with a `detection` is attached to the device named
in `detection.detector_entity_id` and expires after two minutes; any other
frame becomes a tracked device.

What a frame can change is bounded by policy, not by the plugin code, and
frames are kept apart from the code: the plugin itself runs as the entity it
was installed under and pushes every frame-derived entity as a second identity,
`unsafelora.actor`, declared in `package.json`. The engine authorizes each push
against the policy on the identity it came from. The policy for
`unsafelora.actor` ships in `defaults.yaml`, stands on its own, and allows a
push only when both hold:

- the entity carries nothing but sensor-report components: `label`, `geo`,
  `gnss`, `power`, `kinematics`, `orientation`, `detection`, `classification`,
  `bearing`, plus the `controller`, `routing`, `link`, `lifetime`, `pose` and
  `track` the plugin sets itself
- the target entity does not exist yet, has no controller, or already came
  from the air (its controller is `unsafelora.actor`)

Everything else is denied: `device`, `config`, `policy`, `authorization`, any
other component, and any write into an entity another controller owns, the
plugin's own service entity included.

A rejected frame counts under "frames rejected" on the service entity and is
logged with the rule that denied it.

## Changing the policy

The policy is an ordinary `policy` component on the `unsafelora.actor` entity.
Edit it there to widen or narrow what frames may do. `defaults.yaml` is loaded
with the same rules as the engine's own defaults: every entity carries a
`lifetime.fresh` near the Unix epoch, so it never overwrites an edit, and a
changed default only takes effect when that timestamp is bumped in the file.
Delete the component to get the default back on the next start.

## defaults.yaml

Any plugin may ship a `defaults.yaml` next to its `package.json`. It is a
stream of YAML entity documents, the format of `builtin/defaults.yaml`, and
`hydris plugin build` always packs it. Every entity must carry a
`lifetime.fresh` before the year 2000. The plugin's own code runs as the entity
it was installed under; it may push as any identity listed under
`hydris.actors` by passing it to `connect()`, and those fixed ids are where a
shipped policy goes. If neither a default nor an operator gives an identity a
policy, the host seeds one that allows ordinary reads and writes.

The file may hold any entity. The host pushes all of it as the plugin, so
`authz.policy` and the plugin's own policy decide on it the way they decide on
a push from the plugin's code. A default that carries a policy, or that changes
an entity carrying one, is denied, with one exception: `authz.policy` has a
rule that lets a plugin write the entities of the identities it lists under
`hydris.actors`, policy included. The plugin carries that list in policy as
`actor.plugin.actors`; an identity it pushes as carries none.

The host refuses to start a plugin, with a Conflict on its install entity,
when:

- `defaults.yaml` does not parse or an entity lacks the epoch timestamp
- policy denies one of the defaults; none of them is written then
- an identity under `hydris.actors` already exists and is not this plugin's.
  The host records the owner as the `controller` of the identity, set to the
  plugin's install entity, on the first start. Installing the plugin again
  under another entity id therefore needs the old identity removed first.

## package.json

| Field | Description |
|-------|-------------|
| `main` | TypeScript entry point |
| `hydris.actors` | Identities the plugin may push as besides its install entity, for data it trusts less; their `policy` components bound those pushes |
| `files` | Extra data files to pack; `defaults.yaml` is packed without being listed |
