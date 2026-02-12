import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { WorldService } from "@projectqai/proto/world";
import { fetch as expoFetch } from "expo/fetch";
import Constants from "expo-constants";

function getBaseUrl() {
  if (Constants.expoConfig?.extra?.PUBLIC_HYDRIS_API_URL) {
    return Constants.expoConfig.extra.PUBLIC_HYDRIS_API_URL;
  }
  if (process.env.EXPO_OS !== "web") {
    return "http://localhost:50051";
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:50051";
}

const baseUrl = getBaseUrl();

const transport = createConnectTransport({
  baseUrl,
  useBinaryFormat: true,
  fetch: expoFetch as unknown as typeof globalThis.fetch,
});

export const worldClient = createClient(WorldService, transport);
