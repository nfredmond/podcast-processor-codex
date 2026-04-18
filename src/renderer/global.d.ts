import type { PodcastApi } from "../preload/preload";

declare global {
  interface Window {
    podcast: PodcastApi;
  }
}
