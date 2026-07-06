import { describe, expect, it } from "vitest";
import { isFetchableCssUrl } from "./url-safety.js";

describe("isFetchableCssUrl", () => {
  it("allows a normal public https URL", () => {
    expect(isFetchableCssUrl("https://cdn.example.com/styles.css")).toBe(true);
  });

  it("allows a normal public http URL", () => {
    expect(isFetchableCssUrl("http://cdn.example.com/styles.css")).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    expect(isFetchableCssUrl("file:///etc/passwd")).toBe(false);
    expect(isFetchableCssUrl("javascript:alert(1)")).toBe(false);
    expect(isFetchableCssUrl("chrome://settings")).toBe(false);
    expect(isFetchableCssUrl("ftp://example.com/x.css")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isFetchableCssUrl("not a url")).toBe(false);
    expect(isFetchableCssUrl("")).toBe(false);
  });

  it("rejects IPv4 loopback", () => {
    expect(isFetchableCssUrl("http://127.0.0.1/x.css")).toBe(false);
    expect(isFetchableCssUrl("http://127.0.0.1:8080/x.css")).toBe(false);
  });

  it("rejects localhost", () => {
    expect(isFetchableCssUrl("http://localhost/x.css")).toBe(false);
    expect(isFetchableCssUrl("http://foo.localhost/x.css")).toBe(false);
  });

  it("rejects RFC 1918 private ranges", () => {
    expect(isFetchableCssUrl("http://10.0.0.5/x.css")).toBe(false);
    expect(isFetchableCssUrl("http://172.16.0.1/x.css")).toBe(false);
    expect(isFetchableCssUrl("http://172.31.255.255/x.css")).toBe(false);
    expect(isFetchableCssUrl("http://192.168.1.1/x.css")).toBe(false);
  });

  it("rejects link-local / cloud-metadata addresses", () => {
    expect(isFetchableCssUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("does not falsely reject public addresses that merely start with a private octet", () => {
    // 172.32.x.x is outside the 172.16.0.0/12 range (16-31) and must not be blocked.
    expect(isFetchableCssUrl("http://172.32.0.1/x.css")).toBe(true);
    // 11.0.0.1 is not in 10.0.0.0/8.
    expect(isFetchableCssUrl("http://11.0.0.1/x.css")).toBe(true);
  });

  it("rejects IPv6 loopback and link-local/unique-local addresses", () => {
    expect(isFetchableCssUrl("http://[::1]/x.css")).toBe(false);
    expect(isFetchableCssUrl("http://[fe80::1]/x.css")).toBe(false);
    expect(isFetchableCssUrl("http://[fc00::1]/x.css")).toBe(false);
    expect(isFetchableCssUrl("http://[fd12:3456::1]/x.css")).toBe(false);
  });

  it("allows a public IPv6 address", () => {
    expect(isFetchableCssUrl("http://[2001:4860:4860::8888]/x.css")).toBe(true);
  });
});
