import registryDocument from "../../feeds.json";

import type { FeedRegistry } from "../types/gtfs";
import { parseFeedRegistry } from "./parse";

export function loadFeedRegistry(): FeedRegistry {
  return parseFeedRegistry(registryDocument);
}
