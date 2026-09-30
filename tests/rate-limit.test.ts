import { describe, expect, it } from "vitest";
import { rateLimitRetry, retryPhrase } from "@/lib/rate-limit";

describe("rate limit errors", () => {
  it("reads the retry time only from PT429 errors", () => {
    expect(rateLimitRetry({ code: "PT429", details: "90" })).toBe(90);
    expect(rateLimitRetry({ code: "PT429", details: null })).toBe(60);
    expect(rateLimitRetry({ code: "PT429", details: "soon" })).toBe(60);
    expect(rateLimitRetry({ code: "23505", details: "90" })).toBeNull();
    expect(rateLimitRetry(null)).toBeNull();
  });
  it("phrases the wait for people", () => {
    expect(retryPhrase(1)).toBe("in 1 second");
    expect(retryPhrase(45)).toBe("in 45 seconds");
    expect(retryPhrase(60)).toBe("in 1 minute");
    expect(retryPhrase(61)).toBe("in 2 minutes");
    expect(retryPhrase(3600)).toBe("in about 1 hour");
    expect(retryPhrase(86_000)).toBe("in about 24 hours");
  });
});
