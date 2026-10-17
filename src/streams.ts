import type { DepartureOptions, MobiliteitClient } from "./client.js";

export type DepartureFetcher = Pick<MobiliteitClient, "getDepartures">;

export type DepartureSnapshot = {
  stopId: string;
  data: unknown;
  updatedAt: string;
  status: "ok" | "stale";
  error?: string;
};

type Feed = {
  snapshot?: DepartureSnapshot;
  serializedData?: string;
  lastError?: string;
  timer?: ReturnType<typeof setInterval>;
  inFlight?: Promise<void>;
  listeners: Set<() => void | Promise<void>>;
};

const DEPARTURE_OPTIONS = {
  durationMinutes: 60,
  limit: 20,
  language: "fr",
} as const;

export class DepartureStreams {
  private readonly feeds = new Map<string, Feed>();

  constructor(
    private readonly client: DepartureFetcher,
    private readonly intervalMs: number,
    private readonly maxActiveFeeds: number,
    private readonly onError: (stopId: string, error: Error) => void = (
      stopId,
      error,
    ) => {
      console.error(
        `Departure stream failed for stop ${stopId}: ${error.message}`,
      );
    },
  ) {
    if (!Number.isInteger(intervalMs) || intervalMs < 15_000) {
      throw new Error("The upstream polling interval must be at least 15 seconds");
    }
    if (!Number.isInteger(maxActiveFeeds) || maxActiveFeeds < 1) {
      throw new Error("The maximum active feed count must be a positive integer");
    }
  }

  async refreshNow(stopId: string): Promise<void> {
    const feed = this.feeds.get(stopId);
    if (feed) {
      await this.refresh(stopId, feed);
    }
  }

  async read(stopId: string): Promise<DepartureSnapshot> {
    const feed = this.feeds.get(stopId);
    if (feed?.inFlight) {
      await feed.inFlight;
    }
    if (feed?.snapshot) {
      return feed.snapshot;
    }
    if (feed?.lastError) {
      throw new Error(feed.lastError);
    }

    const data = await this.client.getDepartures(this.departureOptions(stopId));
    return {
      stopId,
      data,
      updatedAt: new Date().toISOString(),
      status: "ok",
    };
  }

  subscribe(
    stopId: string,
    listener: () => void | Promise<void>,
  ): () => void {
    let feed = this.feeds.get(stopId);
    if (!feed) {
      if (this.feeds.size >= this.maxActiveFeeds) {
        throw new Error(
          `The active departure feed limit (${this.maxActiveFeeds}) has been reached`,
        );
      }
      feed = { listeners: new Set() };
      this.feeds.set(stopId, feed);
      feed.timer = setInterval(() => {
        void this.refresh(stopId, feed!);
      }, this.intervalMs);
      feed.timer.unref();
      void this.refresh(stopId, feed);
    }

    feed.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      feed!.listeners.delete(listener);
      if (feed!.listeners.size === 0) {
        this.stop(stopId, feed!);
      }
    };
  }

  close(): void {
    for (const [stopId, feed] of this.feeds) {
      this.stop(stopId, feed);
    }
  }

  private departureOptions(stopId: string): DepartureOptions {
    return { stopId, ...DEPARTURE_OPTIONS };
  }

  private async refresh(stopId: string, feed: Feed): Promise<void> {
    if (feed.inFlight) {
      return feed.inFlight;
    }

    const request = (async () => {
      let changed = false;
      try {
        const data = await this.client.getDepartures(
          this.departureOptions(stopId),
        );
        const serializedData = JSON.stringify(data);
        changed =
          serializedData !== feed.serializedData || feed.lastError !== undefined;
        feed.serializedData = serializedData;
        feed.snapshot = {
          stopId,
          data,
          updatedAt: new Date().toISOString(),
          status: "ok",
        };
        feed.lastError = undefined;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown upstream error";
        if (message !== feed.lastError) {
          feed.lastError = message;
          changed = true;
        }
        if (feed.snapshot) {
          feed.snapshot = {
            ...feed.snapshot,
            status: "stale",
            error: message,
          };
        }
        this.onError(stopId, new Error(message));
      }

      if (changed) {
        await Promise.all(
          [...feed.listeners].map(async (listener) => {
            try {
              await listener();
            } catch (error) {
              this.onError(
                stopId,
                error instanceof Error ? error : new Error(String(error)),
              );
            }
          }),
        );
      }
    })();

    feed.inFlight = request;
    try {
      await request;
    } finally {
      if (feed.inFlight === request) {
        feed.inFlight = undefined;
      }
    }
  }

  private stop(stopId: string, feed: Feed): void {
    if (feed.timer) {
      clearInterval(feed.timer);
    }
    this.feeds.delete(stopId);
  }
}
