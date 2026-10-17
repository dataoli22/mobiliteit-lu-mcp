const API_BASE_URL = "https://cdt.hafas.de/opendata/apiserver/";
const REQUEST_TIMEOUT_MS = 10_000;
const RATE_LIMIT_WINDOW_MS = 60_000;

export type NearbyStopsOptions = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  limit: number;
  language: string;
};

export type DepartureOptions = {
  stopId: string;
  date?: string;
  time?: string;
  durationMinutes: number;
  limit: number;
  language: string;
};

export type MobiliteitClientOptions = {
  baseUrl?: string;
  /** Upper bound on upstream requests in any rolling minute, shared by all callers. */
  maxRequestsPerMinute?: number;
};

export class MobiliteitClient {
  private readonly baseUrl: string;
  private readonly maxRequestsPerMinute: number;
  private readonly recentRequests: number[] = [];

  constructor(
    private readonly apiKey: string,
    private readonly fetchImplementation: typeof fetch = fetch,
    options: MobiliteitClientOptions = {},
  ) {
    if (!apiKey.trim()) {
      throw new Error("MOBILITEIT_API_KEY is required");
    }
    if (apiKey.length > 128) {
      throw new Error("MOBILITEIT_API_KEY must not be longer than 128 characters");
    }
    this.baseUrl = options.baseUrl ?? API_BASE_URL;
    this.maxRequestsPerMinute = options.maxRequestsPerMinute ?? 60;
    if (
      !Number.isInteger(this.maxRequestsPerMinute) ||
      this.maxRequestsPerMinute < 1
    ) {
      throw new Error("The upstream request limit must be a positive integer");
    }
  }

  findNearbyStops(options: NearbyStopsOptions): Promise<unknown> {
    return this.request("location.nearbystops", {
      originCoordLat: options.latitude,
      originCoordLong: options.longitude,
      r: options.radiusMeters,
      maxNo: options.limit,
      lang: options.language,
    });
  }

  getDepartures(options: DepartureOptions): Promise<unknown> {
    return this.request("departureBoard", {
      id: options.stopId,
      date: options.date,
      time: options.time,
      duration: options.durationMinutes,
      maxJourneys: options.limit,
      lang: options.language,
      // The WADL allows only OFF and SERVER_DEFAULT; the default includes real-time data.
      rtMode: "SERVER_DEFAULT",
    });
  }

  private async request(
    endpoint: string,
    parameters: Record<string, string | number | undefined>,
  ): Promise<unknown> {
    this.reserveRequest();
    const url = new URL(endpoint, this.baseUrl);
    url.searchParams.set("accessId", this.apiKey);
    url.searchParams.set("format", "json");

    for (const [name, value] of Object.entries(parameters)) {
      if (value !== undefined) {
        url.searchParams.set(name, String(value));
      }
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const isTimeout =
        error instanceof Error && error.name === "TimeoutError";
      throw new Error(
        isTimeout
          ? "Mobiliteit.lu API request timed out"
          : "Mobiliteit.lu API request failed due to a network error",
      );
    }

    if (!response.ok) {
      const quotaHint =
        response.status === 429
          ? " The API quota may have been exceeded."
          : "";
      throw new Error(
        `Mobiliteit.lu API returned HTTP ${response.status}.${quotaHint}`,
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error("Mobiliteit.lu API returned invalid JSON");
    }

    if (data === null || typeof data !== "object") {
      throw new Error("Mobiliteit.lu API returned an unexpected response");
    }
    return data;
  }

  private reserveRequest(): void {
    const now = Date.now();
    while (
      this.recentRequests.length > 0 &&
      this.recentRequests[0] <= now - RATE_LIMIT_WINDOW_MS
    ) {
      this.recentRequests.shift();
    }
    if (this.recentRequests.length >= this.maxRequestsPerMinute) {
      throw new Error(
        "The server's upstream request limit has been reached. Try again in a minute.",
      );
    }
    this.recentRequests.push(now);
  }
}
