"use client";

/**
 * Credential form for one ONVIF device, and what it found.
 *
 * The password is typed here and sent to the engine, which talks to the
 * device on the local network. It is held only for the length of the
 * request — nothing is stored, so re-opening this panel asks again. That is
 * the intended trade: camera credentials are worth more than the typing.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Candidate, OnvifInventory } from "@/lib/use-camera-discovery";
import { Copy, Check, KeyRound } from "lucide-react";

export function OnvifConnect({
  candidate,
  onInventory,
}: {
  candidate: Candidate;
  onInventory: (url: string, user: string, password: string) => Promise<OnvifInventory>;
}) {
  const [user, setUser] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnvifInventory | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const serviceUrl = candidate.onvif_url;
  if (serviceUrl === null) return null;

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await onInventory(serviceUrl, user, password));
      setPassword(""); // not kept once it has been used
    } catch (err) {
      setError(err instanceof Error ? err.message : "connection failed");
    } finally {
      setBusy(false);
    }
  };

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-3 border-t border-border bg-muted/20 px-4 py-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="eyebrow">User</span>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="off"
            className="h-8 w-36 rounded-sm border border-border bg-background px-2 font-mono text-xs outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            className="h-8 w-44 rounded-sm border border-border bg-background px-2 font-mono text-xs outline-none focus:border-accent"
          />
        </label>
        <Button type="submit" size="sm" disabled={busy}>
          <KeyRound className="h-3.5 w-3.5" />
          {busy ? "Connecting…" : "Connect"}
        </Button>
        <span className="font-mono text-[0.65rem] text-muted-foreground">
          sent to the device, never stored
        </span>
      </form>

      {error !== null && (
        <p className="rounded-sm border border-danger/40 bg-danger/10 px-2 py-1.5 font-mono text-[0.7rem] text-danger">
          {error}
          {/* The two causes that look identical from here, worth naming. */}
          <span className="mt-1 block text-muted-foreground">
            If the credentials are right: enable ONVIF on the recorder (Settings → Network →
            Advanced → ONVIF), which may need its own separate user account.
          </span>
        </p>
      )}

      {result !== null && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">connected</Badge>
            <span className="text-sm font-semibold">
              {result.device.manufacturer} {result.device.model}
            </span>
            <span className="font-mono text-[0.65rem] text-muted-foreground">
              fw {result.device.firmware || "?"}
              {result.device.serial ? ` · sn ${result.device.serial}` : ""}
            </span>
          </div>

          {result.profiles.length === 0 ? (
            <p className="font-mono text-[0.7rem] text-muted-foreground">
              Connected, but the device listed no media profiles.
            </p>
          ) : (
            <div className="row-list rounded-sm border border-border">
              {result.profiles.map((p) => {
                const stream = result.streams.find(([token]) => token === p.token);
                return (
                  <div key={p.token} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-28 text-sm font-medium">{p.name || p.token}</span>
                    <Badge variant="outline">{p.token}</Badge>
                    {stream ? (
                      <>
                        <code className="flex-1 truncate text-[0.7rem]">{stream[1]}</code>
                        <button
                          type="button"
                          onClick={() => copy(stream[1])}
                          title="Copy RTSP URL"
                          className="inline-flex h-6 items-center gap-1 rounded-sm border border-border px-1.5 font-mono text-[0.6rem] uppercase text-muted-foreground hover:text-foreground"
                        >
                          {copied === stream[1] ? (
                            <Check className="h-3 w-3 text-primary" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          {copied === stream[1] ? "copied" : "copy"}
                        </button>
                      </>
                    ) : (
                      <span className="font-mono text-[0.65rem] text-muted-foreground">
                        no stream URL offered
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
