import { useEffect, useRef, useState } from "react";

import { baseUrl } from "../../../../lib/api/world-client";
import { createBackoff } from "../../../../lib/backoff";
import { RTCPeerConnection, RTCSessionDescription } from "./rtc";
import type { ConnectionState } from "./types";

// Resolve potentially relative WHEP URLs against the API base URL.
function resolveUrl(url: string): string {
  return new URL(url, baseUrl).href;
}

type UseWHEPConnectionOptions = {
  url: string;
};

type ConnectionStatus = {
  state: ConnectionState;
  error: string | null;
};

type UseWHEPConnectionReturn = {
  stream: MediaStream | null;
  connectionState: ConnectionState;
  error: string | null;
  retry: () => void;
};

export function useWHEPConnection({ url }: UseWHEPConnectionOptions): UseWHEPConnectionReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>({ state: "idle", error: null });
  const [retryTrigger, setRetryTrigger] = useState(0);

  const backoffRef = useRef(createBackoff(250, 5000));
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let pc: RTCPeerConnection | null = null;
    let abortController: AbortController | null = null;
    let mounted = true;

    const cleanupPC = () => {
      if (pc) {
        pc.getSenders().forEach((sender) => sender.track?.stop());
        pc.getReceivers().forEach((receiver) => receiver.track?.stop());
        pc.ontrack = null;
        pc.oniceconnectionstatechange = null;
        pc.close();
        pc = null;
      }
    };

    const cleanup = () => {
      clearTimeout(retryTimeoutRef.current);
      abortController?.abort();
      abortController = null;
      cleanupPC();
    };

    const scheduleRetry = () => {
      const delay = backoffRef.current.next();
      retryTimeoutRef.current = setTimeout(() => {
        if (mounted) connect(true);
      }, delay);
    };

    const handleFailure = (error: string) => {
      if (!mounted) return;
      cleanupPC();
      setStatus({ state: "reconnecting", error });
      scheduleRetry();
    };

    const connect = async (isRetry = false) => {
      if (!mounted) return;

      cleanup();
      abortController = new AbortController();
      setStatus({ state: isRetry ? "reconnecting" : "connecting", error: null });

      try {
        pc = new RTCPeerConnection({
          iceServers: [],
          iceCandidatePoolSize: 0,
        });

        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });

        pc.ontrack = (event: RTCTrackEvent) => {
          if (!mounted) return;
          const incomingStream = event.streams[0];
          if (incomingStream?.getVideoTracks().length) {
            setStream(incomingStream);
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (!mounted || !pc) return;

          switch (pc.iceConnectionState) {
            case "connected":
            case "completed":
              setStatus({ state: "connected", error: null });
              backoffRef.current.reset();
              break;
            case "failed":
              handleFailure("Connection lost");
              break;
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const response = await fetch(resolveUrl(url), {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: offer.sdp,
          signal: abortController.signal,
        });

        if (!response.ok) {
          handleFailure(`WHEP error: ${response.status}`);
          return;
        }

        if (!mounted) return;

        const answerSdp = await response.text();
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: "answer", sdp: answerSdp }),
        );
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        handleFailure(err instanceof Error ? err.message : "Connection failed");
      }
    };

    connect();

    return () => {
      mounted = false;
      cleanup();
      setStream(null);
    };
  }, [url, retryTrigger]);

  const retry = () => {
    backoffRef.current.reset();
    setRetryTrigger((n) => n + 1);
  };

  return { stream, connectionState: status.state, error: status.error, retry };
}
