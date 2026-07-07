package goclient

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"net"
	"os"
	"os/user"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type SSHTunnel struct {
	client *ssh.Client
}

func (t *SSHTunnel) Dial(ctx context.Context, address string) (net.Conn, error) {
	return t.client.Dial("tcp", address)
}

func (t *SSHTunnel) Close() error {
	return t.client.Close()
}

// ParseSSHDestination parses an OpenSSH-style destination string
// into user, host, and port. Accepted formats:
//
//	host
//	host:port
//	user@host
//	user@host:port
func ParseSSHDestination(dest string) (sshUser, host, port string) {
	port = "22"
	if at := findByte(dest, '@'); at >= 0 {
		sshUser = dest[:at]
		dest = dest[at+1:]
	}
	if h, p, err := net.SplitHostPort(dest); err == nil {
		host, port = h, p
	} else {
		host = dest
	}
	if sshUser == "" {
		if u, err := user.Current(); err == nil {
			sshUser = u.Username
		}
	}
	return
}

func findByte(s string, b byte) int {
	for i := range s {
		if s[i] == b {
			return i
		}
	}
	return -1
}

// knownHostKeyAlgorithms returns the host-key algorithms pinned for addr in
// the known_hosts database, in no particular order. It probes the callback
// with a throwaway key: on a known host this yields a *knownhosts.KeyError
// whose Want lists every key we already trust. Returns nil for unknown hosts
// (or the insecure callback), leaving negotiation at Go's defaults.
func knownHostKeyAlgorithms(cb ssh.HostKeyCallback, addr string) []string {
	dummy, err := ssh.NewPublicKey(ed25519.PublicKey(make([]byte, ed25519.PublicKeySize)))
	if err != nil {
		return nil
	}
	host, _, _ := net.SplitHostPort(addr)
	remote := &net.TCPAddr{IP: net.ParseIP(host)}

	var keyErr *knownhosts.KeyError
	if !errors.As(cb(addr, remote, dummy), &keyErr) {
		return nil
	}
	var algos []string
	seen := map[string]bool{}
	for _, k := range keyErr.Want {
		if t := k.Key.Type(); !seen[t] {
			seen[t] = true
			algos = append(algos, t)
		}
	}
	return algos
}

// NewSSHTunnel establishes an SSH connection to the given destination
// (user@host:port) using the SSH agent and default key files.
func NewSSHTunnel(destination string) (*SSHTunnel, error) {
	sshUser, host, port := ParseSSHDestination(destination)

	var authMethods []ssh.AuthMethod

	if sock := os.Getenv("SSH_AUTH_SOCK"); sock != "" {
		if conn, err := net.Dial("unix", sock); err == nil {
			authMethods = append(authMethods, ssh.PublicKeysCallback(agent.NewClient(conn).Signers))
		}
	}

	home, _ := os.UserHomeDir()
	if home != "" {
		for _, name := range []string{"id_ed25519", "id_ecdsa", "id_rsa"} {
			path := filepath.Join(home, ".ssh", name)
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			signer, err := ssh.ParsePrivateKey(data)
			if err != nil {
				continue
			}
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		}
	}

	if len(authMethods) == 0 {
		return nil, fmt.Errorf("no SSH authentication methods available (no agent, no key files)")
	}

	var hostKeyCallback ssh.HostKeyCallback
	if home != "" {
		if cb, err := knownhosts.New(filepath.Join(home, ".ssh", "known_hosts")); err == nil {
			hostKeyCallback = cb
		}
	}
	if hostKeyCallback == nil {
		hostKeyCallback = ssh.InsecureIgnoreHostKey()
	}

	// Go's knownhosts does case-sensitive matching, but hostnames are
	// case-insensitive (RFC 4251 §6) and ssh-keyscan lowercases them.
	host = strings.ToLower(host)
	addr := net.JoinHostPort(host, port)

	// Unlike OpenSSH, Go does not order host-key negotiation by what we
	// already trust, so the server may offer a key type we have no entry
	// for and knownhosts reports a spurious mismatch. Constrain negotiation
	// to the algorithms actually pinned for this host.
	hostKeyAlgos := knownHostKeyAlgorithms(hostKeyCallback, addr)

	client, err := ssh.Dial("tcp", addr, &ssh.ClientConfig{
		User:              sshUser,
		Auth:              authMethods,
		HostKeyCallback:   hostKeyCallback,
		HostKeyAlgorithms: hostKeyAlgos,
	})
	if err != nil {
		return nil, fmt.Errorf("SSH dial %s: %w", addr, err)
	}

	return &SSHTunnel{client: client}, nil
}

// ConnectWithSSH establishes a gRPC connection through an SSH tunnel.
// destination is an OpenSSH-style string: [user@]host[:port]
// serverAddr is the gRPC address as seen from the SSH host.
func ConnectWithSSH(serverAddr string, destination string) (*Connection, error) {
	tunnel, err := NewSSHTunnel(destination)
	if err != nil {
		return nil, err
	}

	conn, err := grpc.NewClient(
		serverAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(tunnel.Dial),
	)
	if err != nil {
		_ = tunnel.Close()
		return nil, err
	}

	return &Connection{ClientConn: conn, Tunnel: tunnel}, nil
}
