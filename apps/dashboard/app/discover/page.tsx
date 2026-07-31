"use client";

/**
 * Discover: find network cameras and NVRs, and read what they offer.
 *
 * Discovery reports; it never adopts. Nothing here registers a camera into
 * the pipeline — that stays an explicit action, so a scan cannot put an
 * unvetted source into the decision path.
 */
import { useState } from "react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, SectionHeading, StatStrip, type Stat } from "@/components/ui/page-header";
import { OnvifConnect } from "@/components/onvif-connect";
import { useCameraDiscovery } from "@/lib/use-camera-discovery";
import { Radar, ChevronDown, ChevronRight } from "lucide-react";

export default function DiscoverPage() {
  const d = useCameraDiscovery();
  const [open, setOpen] = useState<string | null>(null);

  const cameras = (d.candidates ?? []).filter((c) => c.onvif_url !== null);
  const others = (d.candidates ?? []).filter((c) => c.onvif_url === null);
  const selected = d.interfaces.find((i) => i.cidr === d.cidr);

  const stats: Stat[] = [
    { label: "Cameras", value: cameras.length, suffix: "ONVIF confirmed", tone: cameras.length > 0 ? "good" : "default" },
    { label: "Other hosts", value: others.length, suffix: "answered a port" },
    { label: "Range", value: selected?.hosts ?? 0, suffix: "addresses swept" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        eyebrow="WatchingEye · Camera discovery"
        title="Discover"
        lede="Sweep a subnet for cameras and recorders. An open port is only a hint — every candidate is asked directly whether it speaks ONVIF, and only a valid reply counts as a camera."
      />

      <section className="space-y-3">
        <SectionHeading
          title="Scan"
          tag={selected ? selected.name : "subnet"}
          note={
            d.interfaces.length > 0
              ? `${d.interfaces.length} network${d.interfaces.length === 1 ? "" : "s"} detected`
              : "detecting…"
          }
        />
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="eyebrow">Subnet (CIDR)</span>
              <input
                value={d.cidr}
                onChange={(e) => d.setCidr(e.target.value)}
                placeholder="192.168.1.0/24"
                className="h-9 w-56 rounded-sm border border-border bg-background px-2 font-mono text-xs outline-none focus:border-accent"
              />
            </label>

            {d.interfaces.length > 1 && (
              <label className="flex flex-col gap-1">
                <span className="eyebrow">Detected</span>
                <select
                  value={d.cidr}
                  onChange={(e) => d.setCidr(e.target.value)}
                  className="h-9 rounded-sm border border-border bg-background px-2 font-mono text-xs outline-none focus:border-accent"
                >
                  {d.interfaces.map((i) => (
                    <option key={i.cidr} value={i.cidr}>
                      {i.name} — {i.cidr}
                      {i.hosts === 0 ? " (too large)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <Button onClick={() => void d.scan()} disabled={d.scanning || d.cidr === ""}>
              <Radar className={d.scanning ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {d.scanning ? "Scanning…" : "Scan"}
            </Button>

            <p className="font-mono text-[0.65rem] leading-relaxed text-muted-foreground">
              {selected && selected.hosts > 0
                ? `${selected.hosts} addresses · takes about a minute`
                : "ranges wider than 4096 addresses are refused"}
            </p>
          </CardContent>
        </Card>

        {d.error !== null && (
          <p className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
            {d.error}
          </p>
        )}
      </section>

      {d.candidates !== null && (
        <>
          <StatStrip stats={stats} />

          <section className="space-y-3">
            <SectionHeading title="Cameras" tag="onvif" note={`${cameras.length} found`} />
            {cameras.length === 0 ? (
              <Card>
                <CardContent className="space-y-2 font-mono text-xs text-muted-foreground">
                  <p>No ONVIF device answered on this subnet.</p>
                  <p className="leading-relaxed">
                    PoE cameras behind an NVR will not appear here — the recorder puts them on
                    its own private subnet. Find the recorder instead and read its channels.
                    If you know a recorder is present, ONVIF may need enabling on it.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <div className="row-list">
                  {cameras.map((c) => (
                    <div key={c.address}>
                      <button
                        type="button"
                        onClick={() => setOpen(open === c.address ? null : c.address)}
                        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                      >
                        {open === c.address ? (
                          <ChevronDown className="h-4 w-4 text-accent" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-mono text-sm font-semibold">{c.address}</span>
                        <StatusBadge variant="success">onvif</StatusBadge>
                        <span className="flex-1 truncate font-mono text-[0.7rem] text-muted-foreground">
                          {c.onvif_url}
                        </span>
                        <span className="font-mono text-[0.65rem] text-muted-foreground">
                          {c.open_ports.join(" · ")}
                        </span>
                      </button>
                      {open === c.address && (
                        <OnvifConnect candidate={c} onInventory={d.inventory} />
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </section>

          {others.length > 0 && (
            <section className="space-y-3">
              <SectionHeading
                title="Other hosts"
                tag="not cameras"
                note={`${others.length} answered a port`}
              />
              <Card>
                <div className="row-list">
                  {others.map((c) => (
                    <div key={c.address} className="flex flex-wrap items-center gap-3 px-4 py-2">
                      <span className="font-mono text-sm">{c.address}</span>
                      <Badge variant="outline">{c.hint}</Badge>
                      <span className="font-mono text-[0.65rem] text-muted-foreground">
                        {c.open_ports.join(" · ")}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
              <p className="font-mono text-[0.65rem] text-muted-foreground">
                These answered on a port cameras also use, but did not speak ONVIF. Printers,
                NAS boxes and routers land here.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
