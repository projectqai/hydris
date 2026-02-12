# Hydra OPA Policy Example
#
# This policy is evaluated for every entity access.
# Input structure:
#   {
#     "action": "read",                    # action: read, write, timeline
#     "connection": {
#       "source_ip": "192.168.1.1"         # client IP address
#     },
#     "entity": {
#       "id": "entity-123",                # entity ID
#       "components": [1, 11, 12]          # proto field numbers present
#     }
#   }
#
# Entity proto field numbers:
#   1  = id
#   2  = label
#   3  = controller
#   4  = lifetime
#   5  = priority
#   11 = geo
#   12 = symbol
#   15 = camera
#   16 = detection
#   17 = bearing
#   20 = location_uncertainty
#   21 = track
#   22 = locator
#   23 = taskable
#   24 = kinematics
#   25 = shape
#   26 = classification
#   51 = config

package hydra.authz

default allow = false

allow if {

	input.connection.source_ip = "127.0.0.1"
}

# Allow specific trusted networks full access
allow if {
	net.cidr_contains("192.168.0.0/16", input.connection.source_ip)
}

allow if {
	net.cidr_contains("10.0.0.0/8", input.connection.source_ip)
}

# Example: Read-only access from any network
# allow if {
#     input.action == "read"
# }

# Example: Restrict writing entities with geo (field 11) to specific IPs
# allow if {
#     input.action == "write"
#     not 11 in input.entity.components
# }
# allow if {
#     input.action == "write"
#     net.cidr_contains("10.0.0.0/8", input.connection.source_ip)
# }

# Example: Timeline access only from admin network
# allow if {
#     input.action == "timeline"
#     net.cidr_contains("10.0.0.0/8", input.connection.source_ip)
# }

