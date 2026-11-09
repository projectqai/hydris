import { fn } from "storybook/test";

import type * as real from "../world-client";

type Client = typeof real.worldClient;

export const baseUrl = "http://storybook.invalid";

function rejects(method: keyof Client) {
  return () => Promise.reject(new Error(`worldClient.${method} called from a story`));
}

function rejecting(method: keyof Client) {
  return fn(rejects(method)).mockName(`worldClient.${method}`);
}

export const worldClient = {
  listEntities: rejecting("listEntities"),
  getEntity: rejecting("getEntity"),
  watchEntities: fn<Client["watchEntities"]>(() => ({
    [Symbol.asyncIterator]: () => ({ next: rejects("watchEntities") }),
  })).mockName("worldClient.watchEntities"),
  push: rejecting("push"),
  expireEntity: rejecting("expireEntity"),
  getLocalNode: rejecting("getLocalNode"),
  getSelf: rejecting("getSelf"),
  runTask: rejecting("runTask"),
  cancelTask: rejecting("cancelTask"),
  hardReset: rejecting("hardReset"),
  loadMission: rejecting("loadMission"),
  timeSync: rejecting("timeSync"),
} satisfies Client;
